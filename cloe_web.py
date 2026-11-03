"""Pesquisa na internet da Cloe: Brave Search + leitura segura das páginas.

A chave fica só no servidor (BRAVE_API_KEY). O conteúdo das páginas é dado não
confiável: é resumido para o modelo, nunca obedecido como instrução.
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import os
import re
import socket
import time
from collections import OrderedDict
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx
from upstream import client_for

log = logging.getLogger('orbita.cloe_web')

BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search'
MAX_QUERY = 300
MAX_PAGES = 3
MAX_PAGE_CHARS = 4000
MAX_CONTEXT_CHARS = 12000
MAX_BODY_BYTES = 600_000
PAGE_TIMEOUT = 8
SEARCH_TIMEOUT = 8
CACHE_SECONDS = 600
CACHE_LIMIT = 64
USER_AGENT = ('Mozilla/5.0 (compatible; OrbitaCloe/1.0; +https://orbita.chat) '
              'AppleWebKit/537.36 (KHTML, like Gecko)')
_ALLOWED_PORTS = (80, 443)
# Pedido explícito de pesquisa ou assunto que muda rápido demais para o modelo saber.
_EXPLICIT = re.compile(
    r'\b(?:pesquis[ae]|pesquisar|pesquise|procura(?:r)?\s+(?:na|no)\s+(?:internet|google|web)'
    r'|busca(?:r)?\s+(?:na|no)\s+(?:internet|google|web)|consulta(?:r)?\s+(?:na|no)\s+(?:internet|web)'
    r'|olha(?:r)?\s+(?:na|no)\s+(?:internet|web))\b'
    r'|\b(?:noticia|noticias|ultimas?\s+noticias|manchetes?|cotacao|dolar|euro|bitcoin'
    r'|placar|resultado\s+do\s+jogo|previsao\s+do\s+tempo|temperatura\s+em)\b'
    r'|\b(?:quem\s+ganhou|quem\s+foi\s+eleito|qual\s+o\s+preco|quanto\s+custa)\b')
_QUERY_LEAD = re.compile(
    r'^(?:ei\s+|oi\s+)?(?:cloe\s*[,!.;:-]*\s*)?(?:por\s+favor\s*[,!.;:-]*\s*)?'
    r'(?:(?:pesquis[ae]|pesquisar|pesquise|procura(?:r)?|busca(?:r)?|consulta(?:r)?|olha(?:r)?)'
    r'\s+(?:(?:na|no)\s+)?(?:internet|google|web)\s*'
    r'|(?:pesquis[ae]|pesquisar|pesquise)\s+)'
    r'(?:sobre|por|de)?\s*', re.I)
_QUERY_TAIL = re.compile(r'\s+(?:para\s+mim|pra\s+mim|por\s+favor|pf)\s*[.!?]*\s*$', re.I)
_ACCENTS = str.maketrans('áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')
_CACHE = OrderedDict()


class SearchProblem(Exception):
    pass


def configured():
    return bool(os.getenv('BRAVE_API_KEY', '').strip())


def _fold(text):
    return str(text or '').lower().translate(_ACCENTS)


def wants_search(text):
    """Só pesquisa quando o pedido é explícito ou sobre algo que muda todo dia."""
    value = re.sub(r'\s+', ' ', _fold(text)).strip()
    return bool(value) and bool(_EXPLICIT.search(value))


def search_query(text):
    original = str(text or '')
    folded = _QUERY_TAIL.sub('', original).strip()
    match = _QUERY_LEAD.match(_fold(folded))
    if match:
        folded = folded[match.end():]
    return folded.strip(' ,.;:!?-')[:MAX_QUERY] or original[:MAX_QUERY]


class _Reader(HTMLParser):
    _SKIP = {'script', 'style', 'noscript', 'svg', 'iframe', 'form', 'nav', 'footer',
             'header', 'aside', 'template'}
    _BLOCK = {'p', 'br', 'div', 'li', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4',
              'h5', 'h6', 'section', 'article', 'blockquote', 'pre'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP:
            self.skip += 1
        elif tag in self._BLOCK:
            self.parts.append(' ')

    def handle_startendtag(self, tag, attrs):
        if tag in self._BLOCK:
            self.parts.append(' ')

    def handle_endtag(self, tag):
        if tag in self._SKIP and self.skip:
            self.skip -= 1
        elif tag in self._BLOCK:
            self.parts.append(' ')

    def handle_data(self, data):
        if not self.skip and data:
            self.parts.append(data)


def page_text(body, content_type=''):
    """Extrai só o texto legível; HTML malformado não interrompe a pesquisa."""
    kind = (content_type or '').split(';')[0].strip().lower()
    if kind in ('text/plain', 'text/csv'):
        return ' '.join(body.decode('utf-8', 'ignore').split())[:MAX_PAGE_CHARS]
    reader = _Reader()
    try:
        reader.feed(body.decode('utf-8', 'ignore'))
        reader.close()
    except Exception:
        pass
    text = re.sub(r'\s+', ' ', ''.join(reader.parts)).strip()
    return text[:MAX_PAGE_CHARS]


def clean_url(raw):
    """Aceita só http(s) público, sem credenciais e nas portas usuais."""
    parts = urlsplit(str(raw or '').strip())
    if parts.scheme not in ('http', 'https') or not parts.hostname:
        raise SearchProblem('endereço inválido')
    if parts.username or parts.password:
        raise SearchProblem('endereço com credenciais')
    try:
        port = parts.port
    except ValueError:
        raise SearchProblem('porta inválida')
    if port not in (None,) + _ALLOWED_PORTS:
        raise SearchProblem('porta não permitida')
    host = parts.hostname.lower().rstrip('.')
    if host in ('localhost',) or host.endswith(('.local', '.internal', '.home.arpa')):
        raise SearchProblem('endereço interno')
    try:
        if not ipaddress.ip_address(host).is_global:
            raise SearchProblem('endereço interno')
    except ValueError:
        pass
    return parts._replace(fragment='').geturl()


async def public_host(host):
    try:
        infos = await asyncio.to_thread(socket.getaddrinfo, host, None, proto=socket.IPPROTO_TCP)
    except OSError:
        return False
    if not infos:
        return False
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0].split('%')[0])
        except ValueError:
            return False
        # is_global barra loopback, privado, link-local, reservado e metadados de nuvem.
        if not ip.is_global:
            return False
    return True


async def _fetch_page(client, url):
    current = clean_url(url)
    for _ in range(4):
        parts = urlsplit(current)
        if not await public_host(parts.hostname):
            raise SearchProblem('endereço interno')
        response = await client.get(current, headers={'User-Agent': USER_AGENT,
                                                     'Accept': 'text/html,text/plain;q=0.9'},
                                     follow_redirects=False, timeout=PAGE_TIMEOUT)
        if response.status_code in (301, 302, 303, 307, 308):
            location = response.headers.get('location', '')
            if not location:
                break
            current = clean_url(urljoin(current, location))
            continue
        if response.status_code != 200:
            raise SearchProblem(f'status {response.status_code}')
        content_type = response.headers.get('content-type', '')
        kind = content_type.split(';')[0].strip().lower()
        if kind and kind not in ('text/html', 'text/plain', 'application/xhtml+xml'):
            raise SearchProblem('formato não suportado')
        if len(response.content) > MAX_BODY_BYTES:
            raise SearchProblem('página muito grande')
        return page_text(response.content, content_type)
    raise SearchProblem('redirecionamentos demais')


async def _brave(app, query):
    key = os.getenv('BRAVE_API_KEY', '').strip()
    if not key:
        raise SearchProblem('A pesquisa na internet ainda não está configurada no servidor.')
    try:
        async with client_for(app) as client:
            response = await client.get(BRAVE_URL, params={
                'q': query, 'count': 5, 'search_lang': 'pt', 'country': 'BR',
                'safesearch': 'moderate', 'text_decorations': 'false'},
                headers={'Accept': 'application/json', 'X-Subscription-Token': key},
                timeout=SEARCH_TIMEOUT)
    except httpx.HTTPError:
        raise SearchProblem('A pesquisa na internet está indisponível agora.')
    if response.status_code in (401, 403):
        log.warning('Brave recusou a chave: %s', response.status_code)
        raise SearchProblem('A chave da pesquisa na internet foi recusada.')
    if response.status_code == 429:
        raise SearchProblem('O limite de pesquisas de hoje foi atingido. Tente mais tarde.')
    if response.is_error:
        raise SearchProblem('A pesquisa na internet não respondeu agora.')
    try:
        results = response.json().get('web', {}).get('results', [])
    except ValueError:
        raise SearchProblem('A pesquisa devolveu uma resposta inválida.')
    found = []
    for item in results if isinstance(results, list) else []:
        if not isinstance(item, dict):
            continue
        try:
            url = clean_url(item.get('url', ''))
        except SearchProblem:
            continue
        title = ' '.join(str(item.get('title') or '').split())[:160]
        description = ' '.join(str(item.get('description') or '').split())[:400]
        found.append({'title': title or url, 'url': url, 'description': description})
    return found


async def research(app, query):
    """Devolve {'sources': [...], 'context': texto} ou None sem resultados."""
    normalized = re.sub(r'\s+', ' ', str(query or '')).strip().lower()
    cached = _CACHE.get(normalized)
    if cached and cached[0] > time.time():
        _CACHE.move_to_end(normalized)
        return cached[1]
    results = await _brave(app, search_query(query))
    if not results:
        return None
    pages = results[:MAX_PAGES]
    pages_text, used = [], []
    async with client_for(app) as client:
        reads = await asyncio.gather(*[_fetch_page(client, item['url']) for item in pages],
                                     return_exceptions=True)
    for item, text in zip(pages, reads):
        if isinstance(text, str) and text:
            used.append(item)
            pages_text.append(f"[{len(used)}] {item['title']}\n{text}")
            if len(used) >= MAX_PAGES:
                break
    if not pages_text:
        used = pages
        pages_text = [f"[{index}] {item['title']}: {item['description']}"
                      for index, item in enumerate(pages, 1)]
    context = '\n\n'.join(pages_text)[:MAX_CONTEXT_CHARS]
    sources = used
    result = {'sources': sources, 'context': context}
    _CACHE[normalized] = (time.time() + CACHE_SECONDS, result)
    _CACHE.move_to_end(normalized)
    while len(_CACHE) > CACHE_LIMIT:
        _CACHE.popitem(last=False)
    return result


def reset_cache():
    _CACHE.clear()
