import asyncio
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import cloe_web as web


class FakeResponse:
    def __init__(self, status=200, payload=None, content=b'', headers=None):
        self.status_code = status
        self._payload = payload or {}
        self.content = content
        self.headers = headers or {}
        self.text = content.decode('utf-8', 'replace') if content else ''

    @property
    def is_error(self):
        return self.status_code >= 400

    def json(self):
        return self._payload


class FakeClient:
    def __init__(self, response=None):
        self.response = response
        self.calls = []

    async def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.response


def app_with(client):
    app = SimpleNamespace(state=SimpleNamespace())
    app.state.upstream = client
    return app


class IntentTests(unittest.TestCase):
    def test_explicit_requests_and_fresh_facts_are_searched(self):
        for text in ('pesquisa sobre a seleção brasileira',
                     'Ei Cloe, procura na internet o preço do dólar',
                     'quais são as últimas notícias de tecnologia?',
                     'qual a previsão do tempo em São Paulo hoje?'):
            with self.subTest(text=text):
                self.assertTrue(web.wants_search(text))

    def test_natural_phrases_about_daily_facts_are_searched(self):
        for text in ('me fala sobre o jogo de ontem', 'o que aconteceu no mundo hoje',
                     'Cloe, procure na web sobre o filme', 'me atualiza sobre a eleição',
                     'busque o preço do dólar'):
            with self.subTest(text=text):
                self.assertTrue(web.wants_search(text))

    def test_ordinary_conversation_stays_with_the_model(self):
        for text in ('resume a conversa', 'qual é o seu nome?', 'o João falou do projeto',
                     'quanto é 2 + 2', ''):
            with self.subTest(text=text):
                self.assertFalse(web.wants_search(text))

    def test_query_drops_the_command_and_the_name(self):
        self.assertEqual(web.search_query('Ei Cloe, pesquisa na internet sobre gatos'),
                         'gatos')
        self.assertEqual(web.search_query('pesquise notícias de hoje para mim'),
                         'notícias de hoje')
        self.assertEqual(web.search_query('pesquisa sobre o filme'), 'o filme')
        self.assertEqual(web.search_query('Ei Cloe, me fala sobre o jogo de ontem'),
                         'o jogo de ontem')


class UrlTests(unittest.TestCase):
    def test_only_public_http_urls_are_accepted(self):
        self.assertEqual(web.clean_url('https://exemplo.com/a#parte'), 'https://exemplo.com/a')
        for raw in ('file:///etc/passwd', 'javascript:alert(1)', 'http://localhost/x',
                    'http://127.0.0.1:8080/', 'http://exemplo.com:8080/',
                    'https://user:senha@exemplo.com/', 'http://servidor.local/',
                    'http://metadata.google.internal/latest/meta-data'):
            with self.subTest(raw=raw):
                with self.assertRaises(web.SearchProblem):
                    web.clean_url(raw)

    def test_private_addresses_are_rejected_even_with_a_public_name(self):
        def private(host, *args, **kwargs):
            return [(2, 1, 6, '', ('10.0.0.7', 0))]

        def public(host, *args, **kwargs):
            return [(2, 1, 6, '', ('93.184.216.34', 0))]

        with patch.object(web.socket, 'getaddrinfo', private):
            self.assertFalse(asyncio.run(web.public_host('parceiro.exemplo')))
        with patch.object(web.socket, 'getaddrinfo', public):
            self.assertTrue(asyncio.run(web.public_host('exemplo.com')))


class ExtractionTests(unittest.TestCase):
    def test_html_text_skips_scripts_and_styles(self):
        html = (b'<html><head><style>p{color:red}</style></head><body>'
                b'<script>roube()</script><h1>Noticia</h1><p>Primeiro paragrafo.</p>'
                b'<nav>Menu</nav><p>Segundo paragrafo.</p></body></html>')
        text = web.page_text(html, 'text/html; charset=utf-8')
        self.assertIn('Noticia', text)
        self.assertIn('Primeiro paragrafo.', text)
        self.assertNotIn('roube', text)
        self.assertNotIn('color:red', text)
        self.assertNotIn('Menu', text)

    def test_text_is_bounded(self):
        self.assertLessEqual(len(web.page_text(b'a' * 10000, 'text/plain')),
                             web.MAX_PAGE_CHARS)


class BraveTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'BRAVE_API_KEY': 'chave-teste'})
        self.env.start()
        self.addCleanup(self.env.stop)
        web.reset_cache()

    def test_missing_key_is_reported_instead_of_invented(self):
        with patch.dict(os.environ, {name: '' for name in web._KEY_ENVS}):
            with self.assertRaises(web.SearchProblem):
                asyncio.run(web._brave(SimpleNamespace(), 'teste'))

    def test_key_accepts_aliases_and_strips_quotes(self):
        empty = {name: '' for name in web._KEY_ENVS}
        with patch.dict(os.environ, {**empty, 'BRAVE_API_KEY': ' "chave"'}, clear=False):
            self.assertEqual(web._key(), 'chave')
        with patch.dict(os.environ, {**empty, 'BRAVE_SEARCH_API_KEY': 'outra'}, clear=False):
            self.assertEqual(web._key(), 'outra')

    def test_brave_results_are_cleaned_and_limited(self):
        payload = {'web': {'results': [
            {'title': 'Resultado 1', 'url': 'https://exemplo.com/1', 'description': ' Um  '},
            {'title': 'Interno', 'url': 'http://127.0.0.1/segredo', 'description': 'x'},
            {'title': 'Sem link', 'description': 'x'},
            {'title': 'Resultado 2', 'url': 'https://exemplo.com/2', 'description': 'Dois'},
        ]}}
        client = FakeClient(FakeResponse(payload=payload))
        results = asyncio.run(web._brave(app_with(client), 'gatos'))
        self.assertEqual([item['url'] for item in results],
                         ['https://exemplo.com/1', 'https://exemplo.com/2'])
        self.assertEqual(results[0]['title'], 'Resultado 1')
        sent = client.calls[0]
        self.assertEqual(sent[1]['headers']['X-Subscription-Token'], 'chave-teste')
        self.assertEqual(sent[1]['headers']['Cache-Control'], 'no-cache')
        self.assertEqual(sent[1]['params']['search_lang'], 'pt-br')

    def test_rate_limit_and_rejected_key_are_readable(self):
        client = FakeClient(FakeResponse(status=429))
        with self.assertRaises(web.SearchProblem) as caught:
            asyncio.run(web._brave(app_with(client), 'gatos'))
        self.assertIn('limite', str(caught.exception).lower())
        client = FakeClient(FakeResponse(status=401))
        with self.assertRaises(web.SearchProblem) as caught:
            asyncio.run(web._brave(app_with(client), 'gatos'))
        self.assertIn('chave', str(caught.exception).lower())

    def test_unexpected_status_is_reported(self):
        client = FakeClient(FakeResponse(status=422))
        with self.assertRaises(web.SearchProblem) as caught:
            asyncio.run(web._brave(app_with(client), 'gatos'))
        self.assertIn('não respondeu', str(caught.exception))

    def test_redirect_to_a_private_address_is_blocked(self):
        client = FakeClient(FakeResponse(status=302, headers={'location': 'http://127.0.0.1/'}))

        async def public(host):
            return host == 'exemplo.com'

        with patch.object(web, 'public_host', public):
            with self.assertRaises(web.SearchProblem):
                asyncio.run(web._fetch_page(client, 'https://exemplo.com/a'))

    def test_research_reads_pages_and_caches(self):
        found = [{'title': f'Pagina {i}', 'url': f'https://exemplo.com/{i}',
                  'description': 'resumo'} for i in range(1, 5)]

        async def fetch(client, url):
            return 'conteúdo de ' + url

        brave = AsyncMock(return_value=found)
        with patch.object(web, '_brave', brave), patch.object(web, '_fetch_page', fetch):
            result = asyncio.run(web.research(app_with(FakeClient()), 'gatos'))
            again = asyncio.run(web.research(app_with(FakeClient()), 'gatos'))
        self.assertEqual(len(result['sources']), 3)
        self.assertIn('[1] Pagina 1', result['context'])
        self.assertIn('https://exemplo.com/3', result['context'])
        self.assertNotIn('https://exemplo.com/4', result['context'])
        self.assertIs(again, result)
        self.assertEqual(brave.await_count, 1)

    def test_research_without_results_is_none(self):
        with patch.object(web, '_brave', AsyncMock(return_value=[])):
            self.assertIsNone(asyncio.run(web.research(app_with(FakeClient()), 'nada')))


if __name__ == '__main__':
    unittest.main()
