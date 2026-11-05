"""Ações administrativas pedidas pelo dono do Órbita durante uma call.

O dono é identificado por CLOE_OWNER_ID (id da conta no Supabase). O texto do pedido
nunca chega ao modelo: ele é interpretado por padrões fechados, vira uma proposta com
alvo resolvido e só é executado depois que o próprio dono fala a frase de confirmação.
As ações usam o JWT do dono, então as permissões e o RLS do Supabase continuam valendo.
"""
from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from uuid import UUID

import httpx
from livekit import api
from upstream import client_for

log = logging.getLogger('orbita.cloe_admin')
DENIED = 'Só o dono do Órbita pode dar comandos administrativos pela Cloe.'
REASON = 'Pedido do dono pela Cloe.'
_ACCENTS = str.maketrans('áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')
_ADDRESS = re.compile(
    r'^\s*(?:(?:ei|oi|ola|olá|hey|escuta|fala|psiu)\s*[,!.?:;\-–—]*\s*)?'
    r'(?:cloe|chloe|kloe|cloi)\b\s*[,!.?:;\-–—]*\s*', re.I)
_POLITE_LEAD = re.compile(r'^(?:por\s+favor|pf)\s*[,!.?:;\-–—]*\s*', re.I)
_POLITE_TAIL = re.compile(r'[,\s]+(?:por\s+favor|por\s+gentileza|pf)\s*[.!?]*\s*$', re.I)
_CONFIRM_QUESTION = re.compile(
    r'\b(?:frase|palavra|senha)\s+(?:de\s+)?confirmacao\b|\bcomo\s+(?:eu\s+)?confirmo\b')
_CANCEL = re.compile(
    r'\b(?:cancela|cancelar|cancele|aborta|abortar|aborte|desiste|desistir|esquece'
    r'|deixa\s+(?:pra|para)\s+la|deixa\s+quieto)\b')

COLORS = {
    'azul': '#3b82f6', 'vermelho': '#ef4444', 'verde': '#22c55e', 'amarelo': '#eab308',
    'roxo': '#a855f7', 'rosa': '#ec4899', 'laranja': '#f97316', 'branco': '#ffffff',
    'preto': '#000000', 'cinza': '#99aab5',
}
PERMISSIONS = {
    'gerenciar canais': 'manage_channels',
    'gerenciar cargos': 'manage_roles',
    'gerenciar cargos e emojis': 'manage_roles',
    'gerenciar emojis': 'manage_roles',
    'gerenciar mensagens': 'manage_messages',
    'publicar anuncios': 'manage_messages',
    'criar convites': 'create_invite',
    'gerenciar membros': 'manage_members',
}
PERMISSION_LABELS = {
    'manage_channels': 'gerenciar canais', 'manage_roles': 'gerenciar cargos e emojis',
    'manage_messages': 'gerenciar mensagens', 'create_invite': 'criar convites',
    'manage_members': 'gerenciar membros',
}


def fold(text):
    return text.lower().translate(_ACCENTS)


def normalize(text):
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', fold(text))).strip()


def strip_address(text):
    """Remove o nome da assistente e a polidez das pontas, preservando o resto da fala."""
    value = ' '.join(str(text or '').split()).strip()
    value = _ADDRESS.sub('', value).strip()
    while True:
        cleaned = _POLITE_LEAD.sub('', value).strip()
        if cleaned == value:
            break
        value = cleaned
    return _POLITE_TAIL.sub('', value).strip(' ,;')


def _levenshtein(a, b):
    if a == b:
        return 0
    if abs(len(a) - len(b)) > 1:
        return 2
    previous = list(range(len(b) + 1))
    for i, char in enumerate(a, 1):
        current = [i]
        for j, other in enumerate(b, 1):
            current.append(min(current[-1] + 1, previous[j] + 1,
                               previous[j - 1] + (char != other)))
        previous = current
    return previous[-1]


def _tokens_close(said, expected):
    if len(said) != len(expected):
        return False
    for left, right in zip(said, expected):
        if left == right:
            continue
        # O Whisper às vezes troca uma letra em nomes próprios (Kalil/Calil).
        if min(len(left), len(right)) >= 5 and _levenshtein(left, right) <= 1:
            continue
        return False
    return True


def _name(raw):
    value = ' '.join(str(raw or '').strip().strip('"“”\'').split())
    value = re.sub(r'^(?:o|a|os|as|um|uma)\s+', '', value, flags=re.I)
    value = re.sub(r'\s+(?:agora|por\s+favor|pf)\s*$', '', value, flags=re.I)
    return value.strip(' ,;')[:80]


def _channel_name(raw):
    value = _name(raw)
    value = re.sub(r'^(?:o\s+|a\s+)?canal\s+', '', value, flags=re.I)
    value = re.sub(r'^(?:de|do|da)\s+', '', value, flags=re.I)
    value = re.sub(r'\s+(?:privado|publico)$', '', value, flags=re.I)
    return value[:60].strip(' ,;')


def _role_name(raw):
    value = _name(raw)
    value = re.sub(r'^(?:o\s+|a\s+)?cargo\s+', '', value, flags=re.I)
    return value[:32].strip(' ,;')


def _duration(raw):
    text = normalize(raw)
    if re.search(r'para\s+sempre|permanentemente|indeterminado', text):
        return 87600, '10 anos'
    table = {'uma': 1, 'um': 1, 'duas': 2, 'dois': 2, 'tres': 3, 'quatro': 4,
             'cinco': 5, 'seis': 6, 'sete': 7, 'oito': 8, 'nove': 9, 'dez': 10,
             'meia': .5}
    match = re.fullmatch(r'(\d+|' + '|'.join(table) + r')\s*(hora|horas|dia|dias|'
                         r'semana|semanas|mes|meses)', text)
    if not match:
        return None
    amount = float(match.group(1)) if match.group(1).isdigit() else table[match.group(1)]
    unit = match.group(2)
    hours = amount * (1 if unit.startswith('hora') else 24 if unit.startswith('dia')
                      else 168 if unit.startswith('semana') else 720)
    hours = max(1, min(87600, int(round(hours))))
    if hours % 24 == 0 and hours >= 24:
        days = hours // 24
        return hours, f'{days} dia' + ('s' if days > 1 else '')
    return hours, f'{hours} hora' + ('s' if hours > 1 else '')


@dataclass
class Intent:
    kind: str
    args: dict = field(default_factory=dict)


@dataclass
class Plan:
    kind: str
    summary: str
    params: dict
    result: str
    context: dict = field(default_factory=dict)

    @property
    def preview(self):
        return f'{self.summary} Para confirmar, diga a sua frase de confirmação.'


def parse_intent(text):
    """Interpreta só ordens fechadas; perguntas normais devolvem None."""
    original = strip_address(' '.join(str(text or '').split())).strip(' .,;:!?')
    if not original:
        return None
    folded = fold(original)

    def capture(match, group):
        return _name(original[match.start(group):match.end(group)])

    if (re.search(r'\b(?:apaga|apagar|apague|exclui|excluir|exclua|deleta|deletar|delete'
                  r'|remove|remover|remova)\s+(?:o\s+)?canal\b', folded)
            or re.search(r'\b(?:apaga|apagar|apague|exclui|excluir|exclua|deleta|deletar|delete)'
                         r'\s+(?:o\s+)?(?:servidor|comunidade)\b', folded)):
        return Intent('forbidden', {'message': 'Não posso excluir canais nem servidores. '
                                               'Isso continua no menu do servidor, para evitar acidentes.'})
    if re.search(r'\b(?:apaga|apagar|apague|exclui|excluir|exclua|deleta|deletar|delete'
                 r'|remove|remover|remova)\s+(?:o\s+)?cargo\b', folded):
        return Intent('forbidden', {'message': 'Não posso excluir cargos. Isso continua no menu de '
                                               'cargos do servidor, para evitar acidentes.'})
    if re.search(r'\b(?:transfere|transferir|transferindo|passa|passar)\s+(?:a\s+)?'
                 r'(?:posse|propriedade)\b|\bmuda\s+o\s+dono\b|\btransfere\s+(?:o\s+)?'
                 r'(?:servidor|comunidade)\b', folded):
        return Intent('forbidden', {'message': 'Não posso transferir a posse do servidor. '
                                               'Isso precisa ser feito no painel.'})
    if re.fullmatch(r'(?:apaga|apagar|apague|exclui|excluir|exclua|deleta|deletar|delete)'
                    r'\s+tudo', folded):
        return Intent('forbidden', {'message': 'Não posso apagar tudo. Diga exatamente o que deve ser apagado.'})

    match = re.fullmatch(r'(?:encerra|encerrar|encerre|termina|terminar|termine|acaba|acabar'
                         r'|finaliza|finalizar|finalize)\s+(?:a\s+|essa\s+|esta\s+)?'
                         r'(?:call|chamada|sala(?:\s+de\s+voz)?)'
                         r'(?:\s+(?:do|da)\s+canal\s+(.+))?', folded)
    if match:
        channel = original[match.start(1):match.end(1)] if match.group(1) else None
        return Intent('end_call', {'channel': _channel_name(channel) if channel else None})

    match = re.fullmatch(r'(?:expulsa|expulsar|expulse|remove|remover|remova|tira|tirar|tire)'
                         r'\s+(?:o\s+|a\s+)?(.+?)\s+(?:da|desta|dessa)\s+'
                         r'(?:call|chamada|sala)(?:\s+agora)?'
                         r'(?:\s+(?:do|da)\s+canal\s+.+)?', folded)
    if match:
        return Intent('kick', {'name': capture(match, 1)})

    match = re.fullmatch(r'(?:desmuta|desmutar|desmute|desilencia|desilenciar|desilencie)'
                         r'\s+(?:o\s+|a\s+)?(.+?)(?:\s+(?:na|da|desta)\s+(?:call|chamada|sala))?',
                         folded)
    if not match:
        match = re.fullmatch(r'libera(?:r|e)?\s+o\s+microfone\s+(?:do|da|de)\s+(.+)', folded)
    if match:
        return Intent('unmute', {'name': capture(match, 1)})

    match = re.fullmatch(r'(?:silencia|silenciar|silencie|muta|mutar|mute)'
                         r'\s+(?:o\s+|a\s+)?(.+?)(?:\s+(?:na|da|desta)\s+(?:call|chamada|sala))?',
                         folded)
    if match:
        return Intent('mute', {'name': capture(match, 1)})

    match = re.fullmatch(r'(?:apaga|apagar|apague|exclui|excluir|exclua|deleta|deletar|delete)'
                         r'\s+(?:a\s+)?(?:ultima\s+)?mensagem'
                         r'(?:\s+(?:de|do|da)\s+(?!canal\b)(.+?))?'
                         r'(?:\s+(?:no|do|na|da)\s+canal\s+(.+))?', folded)
    if match:
        author = capture(match, 1) if match.group(1) else None
        channel = _channel_name(original[match.start(2):match.end(2)]) if match.group(2) else None
        return Intent('delete_message', {'author': author, 'channel': channel})

    match = re.fullmatch(r'(?:da|dar|de|concede|conceder|conceda|adiciona|adicionar|adicione'
                         r'|coloca|colocar|coloque)\s+(?:a\s+)?permiss(?:ao|oes)\s+(?:de\s+)?(.+?)'
                         r'\s+(?:ao|no)\s+cargo\s+(.+)', folded)
    if match:
        return Intent('role_permission', {
            'permissions': _permission_list(original[match.start(1):match.end(1)]),
            'role': _role_name(original[match.start(2):match.end(2)]), 'add': True})
    match = re.fullmatch(r'(?:tira|tirar|tire|remove|remover|remova)\s+(?:a\s+)?'
                         r'permiss(?:ao|oes)\s+(?:de\s+)?(.+?)\s+(?:do|da)\s+cargo\s+(.+)', folded)
    if match:
        return Intent('role_permission', {
            'permissions': _permission_list(original[match.start(1):match.end(1)]),
            'role': _role_name(original[match.start(2):match.end(2)]), 'add': False})

    match = re.fullmatch(r'(?:suspende|suspender|suspenda|bloqueia|bloquear|bloqueie)'
                         r'\s+(?:a\s+conta\s+(?:de|do|da)\s+|o\s+|a\s+)?(.+?)'
                         r'\s+por\s+(.+)', folded)
    if match:
        duration = _duration(original[match.start(2):match.end(2)])
        if not duration:
            raise AdminProblem('Diga a duração, por exemplo: “suspende o João por 24 horas”.')
        return Intent('suspend', {'name': capture(match, 1), 'hours': duration[0],
                                  'duration': duration[1]})
    if re.fullmatch(r'(?:suspende|suspender|suspenda|bloqueia|bloquear|bloqueie)'
                    r'\s+(?:a\s+conta\s+(?:de|do|da)\s+|o\s+|a\s+)?(.+)', folded):
        raise AdminProblem('Por quanto tempo? Diga, por exemplo: “suspende o João por 24 horas”.')

    match = re.fullmatch(r'(?:bane|banir|bani)\s+(?:o\s+|a\s+)?(.+?)'
                         r'(?:\s+(?:do|da|deste|desta)\s+(?:servidor|comunidade))?', folded)
    if match:
        return Intent('ban', {'name': capture(match, 1)})
    match = re.fullmatch(r'(?:desbane|desbanir|desbani|perdoa|perdoar|perdoe)'
                         r'\s+(?:o\s+|a\s+)?(.+?)'
                         r'(?:\s+(?:do|da|deste|desta)\s+(?:servidor|comunidade))?', folded)
    if match:
        return Intent('unban', {'name': capture(match, 1)})
    match = re.fullmatch(r'(?:remove|remover|remova|tira|tirar|tire|expulsa|expulsar|expulse)'
                         r'\s+(?:o\s+|a\s+)?(.+?)'
                         r'(?:\s+(?:do|da|deste|desta)\s+(?:servidor|comunidade))?', folded)
    if match:
        return Intent('remove', {'name': capture(match, 1)})

    match = re.fullmatch(r'(?:cria|criar|crie)\s+(?:um\s+|o\s+|a\s+)?canal'
                         r'(?:\s+de\s+(texto|voz|voz\s+e\s+video))?'
                         r'(?:\s+(?:chamado|com\s+o\s+nome|de\s+nome))?\s*(.+)', folded)
    if match:
        kind = 'voice' if match.group(1) and 'voz' in match.group(1) else 'text'
        raw_name = _channel_name(original[match.start(2):match.end(2)])
        private = bool(re.search(r'\s+privado$', original[match.start(2):match.end(2)], re.I))
        return Intent('create_channel', {'name': raw_name, 'kind': kind, 'private': private})

    match = re.fullmatch(r'(?:renomeia|renomear|renomeie|muda\s+o\s+nome\s+do)'
                         r'\s+(?:o\s+|a\s+)?canal\s+(.+?)\s+(?:para|pra)\s+(.+)', folded)
    if match:
        return Intent('rename_channel', {
            'name': _channel_name(original[match.start(1):match.end(1)]),
            'new': _channel_name(original[match.start(2):match.end(2)])})
    match = re.fullmatch(r'(?:muda|altera|alterar|altere)\s+a\s+descricao\s+do\s+canal'
                         r'\s+(.+?)\s+(?:para|pra)\s+(.+)', folded)
    if match:
        return Intent('channel_description', {
            'name': _channel_name(original[match.start(1):match.end(1)]),
            'text': original[match.start(2):match.end(2)].strip(' ,;')[:240]})
    match = re.fullmatch(r'(?:deixa|deixar|deixe|torna|tornar|torne|coloca|colocar|coloque)'
                         r'\s+(?:o\s+|a\s+)?canal\s+(.+?)\s+(privado|publico)', folded)
    if match:
        return Intent('channel_privacy', {
            'name': _channel_name(original[match.start(1):match.end(1)]),
            'private': match.group(2) == 'privado'})

    match = re.fullmatch(r'(?:cria|criar|crie)\s+(?:um\s+|o\s+)?cargo'
                         r'(?:\s+(?:chamado|com\s+o\s+nome|de\s+nome))?\s*(.+)', folded)
    if match:
        raw = original[match.start(1):match.end(1)].strip(' ,;')
        searched = fold(raw)
        permissions = []
        perm = re.search(r'\s+com\s+(?:as?\s+)?permiss(?:ao|oes)\s+(?:de\s+)?(.+?)$', searched, re.I)
        if perm:
            permissions = _permission_list(raw[perm.start(1):perm.end(1)])
            raw = raw[:perm.start()].strip(' ,;')
            searched = searched[:perm.start()].strip(' ,;')
        color = '#99aab5'
        color_match = re.search(r'\s+(?:na\s+)?cor\s+(?:de\s+)?([a-z#0-9]+)$', searched, re.I)
        if color_match:
            color = _color(color_match.group(1))
            raw = raw[:color_match.start()].strip(' ,;')
        return Intent('create_role', {'name': _role_name(raw), 'color': color,
                                      'permissions': permissions})

    match = re.fullmatch(r'(?:renomeia|renomear|renomeie|muda\s+o\s+nome\s+do)'
                         r'\s+(?:o\s+|a\s+)?cargo\s+(.+?)\s+(?:para|pra)\s+(.+)', folded)
    if match:
        return Intent('rename_role', {
            'name': _role_name(original[match.start(1):match.end(1)]),
            'new': _role_name(original[match.start(2):match.end(2)])})
    match = re.fullmatch(r'(?:muda|altera|alterar|altere)\s+a\s+cor\s+do\s+cargo'
                         r'\s+(.+?)\s+(?:para|pra)\s+(.+)', folded)
    if match:
        return Intent('role_color', {
            'name': _role_name(original[match.start(1):match.end(1)]),
            'color': _color(original[match.start(2):match.end(2)])})
    match = re.fullmatch(r'(?:muda|altera|alterar|altere)\s+o\s+nome\s+(?:do|da)\s+'
                         r'(?:servidor|comunidade)\s+(?:para|pra)\s+(.+)', folded)
    if match:
        return Intent('community_name', {'name': original[match.start(1):match.end(1)].strip(' ,;')[:60]})
    match = re.fullmatch(r'(?:muda|altera|alterar|altere)\s+a\s+descricao\s+(?:do|da)\s+'
                         r'(?:servidor|comunidade)\s+(?:para|pra)\s+(.+)', folded)
    if match:
        return Intent('community_description',
                      {'text': original[match.start(1):match.end(1)].strip(' ,;')[:240]})
    if re.fullmatch(r'(?:deixa|deixar|deixe|torna|tornar|torne|fecha|fechar|feche)\s+'
                    r'(?:o\s+)?(?:servidor|comunidade)(?:\s+(?:so|apenas|somente))?'
                    r'\s*(?:com\s+)?convite', folded) or re.fullmatch(r'fecha\s+(?:o\s+)?'
                                                                     r'(?:servidor|comunidade)', folded):
        return Intent('community_invite', {'invite_only': True})
    if re.fullmatch(r'(?:abre|abrir|abra|deixa|deixar|deixe|torna|tornar|torne)\s+'
                    r'(?:o\s+)?(?:servidor|comunidade)\s+(?:para\s+)?(?:todos|publico)', folded):
        return Intent('community_invite', {'invite_only': False})
    return None


def _permission_list(raw):
    value = normalize(raw)
    found = []
    for phrase, key in sorted(PERMISSIONS.items(), key=lambda item: -len(item[0])):
        if phrase in value and key not in found:
            found.append(key)
    if not found:
        raise AdminProblem('Não conheço essa permissão. Use, por exemplo: gerenciar canais, '
                           'gerenciar cargos, gerenciar mensagens, criar convites ou gerenciar membros.')
    return found


def _color(raw):
    value = normalize(raw)
    if re.fullmatch(r'#[0-9a-f]{6}', str(raw).strip()):
        return str(raw).strip().lower()
    if value in COLORS:
        return COLORS[value]
    raise AdminProblem('Não conheço essa cor. Use um código como #3b82f6 ou um nome simples, como azul.')


class AdminProblem(Exception):
    pass


class OwnerAdmin:
    def __init__(self, app, settings):
        self.app = app
        self.settings = settings

    @property
    def owner_id(self):
        return os.getenv('CLOE_OWNER_ID', '').strip().lower()

    @property
    def enabled(self):
        return bool(self.owner_id)

    def is_owner(self, user):
        value = user.get('id') if isinstance(user, dict) else user
        return self.enabled and str(value or '').strip().lower() == self.owner_id

    @property
    def phrase(self):
        return os.getenv('CLOE_CONFIRM_PHRASE', 'Eu Kalil Confirmo').strip() or 'Eu Kalil Confirmo'

    @property
    def pending_seconds(self):
        try:
            return max(15, int(os.getenv('CLOE_OWNER_ACTION_SECONDS', '90')))
        except ValueError:
            return 90

    @property
    def max_attempts(self):
        try:
            return max(1, int(os.getenv('CLOE_OWNER_ATTEMPTS', '3')))
        except ValueError:
            return 3

    def is_confirmation(self, text):
        said = normalize(strip_address(text)).split()
        expected = normalize(self.phrase).split()
        return bool(said and expected) and _tokens_close(said, expected)

    def looks_like_confirmation(self, text):
        said = normalize(strip_address(text))
        return 'confirm' in said or (said.startswith('eu ') and len(said.split()) <= 6)

    def redact(self, text):
        """A frase nunca entra na transcrição nem no contexto enviado ao modelo."""
        value = normalize(text)
        needle = normalize(self.phrase).split()
        tokens = value.split()
        if needle and any(_tokens_close(tokens[i:i + len(needle)], needle)
                          for i in range(max(0, len(tokens) - len(needle) + 1))):
            return '[fala de confirmação]'
        return text

    def asks_confirmation_phrase(self, text):
        return bool(_CONFIRM_QUESTION.search(fold(text)))

    def cancels(self, text):
        return bool(_CANCEL.search(fold(strip_address(text))))

    def classify(self, text):
        """Intent, None para pergunta comum, ou Intent('invalid') para ordem incompleta."""
        try:
            return parse_intent(text)
        except AdminProblem:
            return Intent('invalid')

    async def _request(self, method, path, headers, *, params=None, json=None, prefer=None):
        config = self.settings()
        base = (config.get('SUPABASE_URL') or '').rstrip('/')
        if not base:
            raise AdminProblem('O Supabase não está configurado no servidor.')
        outgoing = dict(headers or {})
        if prefer:
            outgoing['Prefer'] = prefer
        try:
            async with client_for(self.app) as client:
                response = await client.request(method, base + '/rest/v1/' + path,
                                                headers=outgoing, params=params,
                                                json=json, timeout=10)
        except httpx.HTTPError:
            raise AdminProblem('O serviço de dados está indisponível agora.')
        if response.is_error:
            log.warning('Cloe admin: %s %s respondeu %s: %s', method, path,
                        response.status_code, response.text[:400])
            if response.status_code in (401, 403):
                raise AdminProblem('Sua conta não tem permissão para fazer isso.')
            if response.status_code == 404:
                raise AdminProblem('Esse item não existe mais.')
            if response.status_code == 409:
                raise AdminProblem('Já existe um item com esse nome.')
            raise AdminProblem('O banco recusou a alteração. Confira os dados e tente de novo.')
        if not response.content:
            return None
        try:
            return response.json()
        except ValueError:
            raise AdminProblem('O serviço de dados devolveu uma resposta inválida.')

    async def _get(self, path, headers, params):
        value = await self._request('GET', path, headers, params=params)
        return value if isinstance(value, list) else []

    async def _rpc(self, name, headers, body):
        await self._request('POST', 'rpc/' + name, headers, json=body)

    async def community_for_room(self, room, headers):
        if not re.fullmatch(r'channel-[0-9a-f-]{36}', room):
            raise AdminProblem('Isso só funciona em uma call de canal do servidor.')
        channel_id = room.split('-', 1)[1]
        try:
            UUID(channel_id)
        except ValueError:
            raise AdminProblem('Canal inválido.')
        rows = await self._get('channels', headers, {
            'id': 'eq.' + channel_id, 'select': 'id,name,kind,community_id'})
        if not rows:
            raise AdminProblem('Não encontrei o canal desta call.')
        channel = rows[0]
        communities = await self._get('communities', headers, {
            'id': 'eq.' + str(channel['community_id']), 'select': 'id,name,created_by'})
        if not communities:
            raise AdminProblem('Não encontrei o servidor desta call.')
        return {**channel, 'community_name': communities[0].get('name') or 'Órbita',
                'community_owner': communities[0].get('created_by')}

    async def _channels(self, community_id, headers):
        return await self._get('channels', headers, {
            'community_id': 'eq.' + str(community_id),
            'select': 'id,name,kind,position,is_private,description', 'order': 'position.asc'})

    async def _roles(self, community_id, headers):
        return await self._get('community_roles', headers, {
            'community_id': 'eq.' + str(community_id),
            'select': 'id,name,color,position,permissions', 'order': 'position.desc'})

    async def _member_ids(self, community_id, headers):
        rows = await self._get('community_members', headers, {
            'community_id': 'eq.' + str(community_id), 'select': 'user_id'})
        return {str(row.get('user_id')) for row in rows if row.get('user_id')}

    async def _profiles(self, name, headers):
        term = re.sub(r'[,()*%\\]', ' ', str(name or '')).strip()[:60]
        if not term:
            raise AdminProblem('Diga o nome da pessoa.')
        return await self._get('profiles', headers, {
            'select': 'id,username,display_name', 'limit': '50',
            'or': f'(display_name.ilike.*{term}*,username.ilike.*{term}*)'})

    def _pick_person(self, rows, name):
        wanted = normalize(name)
        exact = [row for row in rows if wanted in (normalize(row.get('username', '')),
                                                   normalize(row.get('display_name', '')))]
        pool = exact or [row for row in rows if wanted and wanted in normalize(
            str(row.get('username', '')) + ' ' + str(row.get('display_name', '')))]
        if not pool:
            raise AdminProblem(f'Não encontrei ninguém com o nome {name} neste servidor.')
        if len(pool) > 1:
            labels = ', '.join('@' + str(row.get('username')) for row in pool[:3])
            raise AdminProblem(f'Encontrei mais de uma pessoa: {labels}. Use o @usuario exato.')
        return pool[0]

    async def _member(self, community_id, name, headers, *, any_account=False):
        rows = await self._profiles(name, headers)
        if not any_account:
            ids = await self._member_ids(community_id, headers)
            rows = [row for row in rows if str(row.get('id')) in ids]
        return self._pick_person(rows, name)

    def _pick_named(self, rows, name, label):
        wanted = normalize(name)
        exact = [row for row in rows if normalize(row.get('name', '')) == wanted]
        pool = exact or [row for row in rows if wanted and wanted in normalize(row.get('name', ''))]
        if not pool:
            raise AdminProblem(f'Não encontrei o {label} {name}.')
        if len(pool) > 1:
            names = ', '.join(str(row.get('name')) for row in pool[:3])
            raise AdminProblem(f'Encontrei mais de um {label}: {names}. Diga o nome exato.')
        return pool[0]

    async def _livekit_participants(self, room):
        config = self.settings()
        if not all(config.get(key) for key in ('LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET')):
            raise AdminProblem('As chamadas não estão configuradas no servidor.')
        try:
            async with api.LiveKitAPI(config['LIVEKIT_URL'], config['LIVEKIT_API_KEY'],
                                      config['LIVEKIT_API_SECRET']) as lk:
                result = await lk.room.list_participants(api.ListParticipantsRequest(room=room))
        except Exception:
            raise AdminProblem('Não consegui consultar os participantes da call agora.')
        return list(getattr(result, 'participants', []) or [])

    def _pick_participant(self, participants, name):
        wanted = normalize(name)
        exact = [person for person in participants if normalize(getattr(person, 'name', '')) == wanted]
        pool = exact or [person for person in participants
                         if wanted and wanted in normalize(getattr(person, 'name', ''))]
        if not pool:
            raise AdminProblem(f'Não encontrei {name} nesta call.')
        if len(pool) > 1:
            raise AdminProblem(f'Há mais de uma pessoa chamada {name} nesta call. '
                               'Use o nome completo do perfil.')
        return pool[0]

    def _person_label(self, row):
        return str(row.get('display_name') or row.get('username') or 'essa pessoa')

    async def plan_for(self, text, room, headers, user_id=None):
        if not self.is_owner(user_id):
            raise AdminProblem(DENIED)
        intent = parse_intent(text)
        if not intent:
            return None
        if intent.kind == 'forbidden':
            raise AdminProblem(intent.args['message'])
        channel = await self.community_for_room(room, headers)
        community_id = channel['community_id']
        community = channel['community_name']
        context = {'community_id': community_id, 'community': community,
                   'channel_id': channel['id'], 'channel': channel['name']}
        args = intent.args

        if intent.kind == 'end_call':
            target = channel
            if args.get('channel'):
                rows = await self._channels(community_id, headers)
                target = self._pick_named([row for row in rows if row.get('kind') == 'voice'],
                                          args['channel'], 'canal de voz')
            return Plan('end_call', f'Vou encerrar a call do canal {target["name"]}.',
                        {'channel_id': target['id'], 'channel_name': target['name']},
                        f'Pronto. Encerrei a call do canal {target["name"]}.', context)

        if intent.kind in ('kick', 'mute', 'unmute'):
            if intent.kind == 'kick':
                target = self._pick_participant(await self._livekit_participants(room), args['name'])
            else:
                participants = await self._livekit_participants(room)
                try:
                    target = self._pick_participant(participants, args['name'])
                except AdminProblem:
                    member = await self._member(community_id, args['name'], headers)
                    target = next((person for person in participants
                                   if str(getattr(person, 'identity', '')) == str(member['id'])), None)
                    if target is None:
                        raise AdminProblem(f'{self._person_label(member)} não está nesta call.')
            if str(getattr(target, 'identity', '')) == self.owner_id:
                raise AdminProblem('Não vou aplicar isso a você mesmo.')
            name = getattr(target, 'name', '') or 'essa pessoa'
            if intent.kind == 'kick':
                return Plan('kick', f'Vou tirar {name} da call do canal {channel["name"]}.',
                            {'channel_id': channel['id'], 'member': str(target.identity),
                             'name': name},
                            f'Pronto. {name} saiu da call.', context)
            verb = 'silenciar' if intent.kind == 'mute' else 'liberar o microfone de'
            return Plan(intent.kind, f'Vou {verb} {name} nesta call.',
                        {'member': str(target.identity), 'name': name},
                        f'Pronto. {"Silenciei" if intent.kind == "mute" else "Liberei o microfone de"} {name}.',
                        context)

        if intent.kind == 'delete_message':
            if not args.get('channel'):
                raise AdminProblem('Diga o canal: por exemplo, “apaga a última mensagem do canal geral”.')
            rows = await self._channels(community_id, headers)
            target_channel = self._pick_named([row for row in rows if row.get('kind') == 'text'],
                                              args['channel'], 'canal de texto')
            params = {'channel_id': 'eq.' + str(target_channel['id']),
                      'select': 'id,content,author_id,created_at',
                      'order': 'created_at.desc', 'limit': '1'}
            author = None
            if args.get('author'):
                author = await self._member(community_id, args['author'], headers)
                params['author_id'] = 'eq.' + str(author['id'])
            messages = await self._get('messages', headers, params)
            if not messages:
                raise AdminProblem('Não encontrei uma mensagem para apagar nesse canal.')
            message = messages[0]
            who = self._person_label(author) if author else 'alguém'
            snippet = ' '.join(str(message.get('content') or '').split())[:80]
            return Plan('delete_message',
                        f'Vou apagar a última mensagem de {who} no canal {target_channel["name"]}: '
                        f'“{snippet}”.',
                        {'message': str(message['id']), 'channel_name': target_channel['name'],
                         'author': who},
                        f'Pronto. Apaguei a última mensagem de {who} no canal {target_channel["name"]}.',
                        context)

        if intent.kind in ('ban', 'unban', 'remove', 'suspend'):
            member = await self._member(community_id, args['name'], headers,
                                        any_account=intent.kind in ('unban', 'suspend'))
            label = self._person_label(member)
            summary = {
                'ban': f'Vou banir {label} do servidor {community}.',
                'unban': f'Vou desbanir {label} no servidor {community}.',
                'remove': f'Vou remover {label} do servidor {community}.',
                'suspend': f'Vou suspender a conta de {label} por {args.get("duration")}.',
            }[intent.kind]
            if intent.kind == 'suspend':
                result = f'Pronto. A conta de {label} ficou suspensa por {args["duration"]}.'
            else:
                result = {
                    'ban': f'Pronto. {label} foi banido do servidor {community}.',
                    'unban': f'Pronto. {label} foi desbanido e pode voltar ao servidor {community}.',
                    'remove': f'Pronto. {label} foi removido do servidor {community}.',
                }[intent.kind]
            return Plan(intent.kind, summary, {
                'community_id': str(community_id), 'member': str(member['id']),
                'username': str(member.get('username') or ''), 'label': label,
                'hours': args.get('hours')}, result, context)

        if intent.kind == 'create_channel':
            name = re.sub(r'\s+privado$', '', args['name'], flags=re.I).strip()
            if not name:
                raise AdminProblem('Diga o nome do canal.')
            rows = await self._channels(community_id, headers)
            if any(normalize(row.get('name')) == normalize(name) for row in rows):
                raise AdminProblem(f'Já existe um canal chamado {name}.')
            position = max([int(row.get('position') or 0) for row in rows] or [0]) + 1
            kind_name = 'voz' if args['kind'] == 'voice' else 'texto'
            privacy = ', privado' if args['private'] else ''
            return Plan('create_channel',
                        f'Vou criar o canal de {kind_name} {name}{privacy} no servidor {community}.',
                        {'community_id': str(community_id), 'name': name, 'kind': args['kind'],
                         'position': position, 'private': args['private']},
                        f'Pronto. Criei o canal de {kind_name} {name}.', context)

        if intent.kind == 'rename_channel':
            rows = await self._channels(community_id, headers)
            target = self._pick_named(rows, args['name'], 'canal')
            new = args['new']
            if not new:
                raise AdminProblem('Diga o novo nome do canal.')
            return Plan('rename_channel', f'Vou renomear o canal {target["name"]} para {new}.',
                        {'id': str(target['id']), 'name': new},
                        f'Pronto. O canal {target["name"]} agora se chama {new}.', context)

        if intent.kind == 'channel_description':
            rows = await self._channels(community_id, headers)
            target = self._pick_named(rows, args['name'], 'canal')
            text = args['text']
            return Plan('channel_description',
                        f'Vou mudar a descrição do canal {target["name"]} para “{text}”.',
                        {'id': str(target['id']), 'text': text},
                        f'Pronto. Atualizei a descrição do canal {target["name"]}.', context)

        if intent.kind == 'channel_privacy':
            rows = await self._channels(community_id, headers)
            target = self._pick_named(rows, args['name'], 'canal')
            private = bool(args['private'])
            return Plan('channel_privacy',
                        f'Vou deixar o canal {target["name"]} {"privado" if private else "público"}.',
                        {'id': str(target['id']), 'private': private},
                        f'Pronto. O canal {target["name"]} agora é '
                        f'{"privado" if private else "público"}.', context)

        if intent.kind == 'create_role':
            name = args['name']
            if not name:
                raise AdminProblem('Diga o nome do cargo.')
            rows = await self._roles(community_id, headers)
            if any(normalize(row.get('name')) == normalize(name) for row in rows):
                raise AdminProblem(f'Já existe um cargo chamado {name}.')
            position = max([int(row.get('position') or 0) for row in rows] or [0]) + 1
            permissions = args['permissions']
            labels = ', '.join(PERMISSION_LABELS.get(item, item) for item in permissions) or 'nenhuma'
            return Plan('create_role',
                        f'Vou criar o cargo {name}, cor {args["color"]}, com as permissões: {labels}.',
                        {'community_id': str(community_id), 'name': name,
                         'color': args['color'], 'position': position,
                         'permissions': permissions},
                        f'Pronto. Criei o cargo {name}.', context)

        if intent.kind == 'rename_role':
            rows = await self._roles(community_id, headers)
            target = self._pick_named(rows, args['name'], 'cargo')
            new = args['new']
            if not new:
                raise AdminProblem('Diga o novo nome do cargo.')
            return Plan('rename_role', f'Vou renomear o cargo {target["name"]} para {new}.',
                        {'id': str(target['id']), 'name': new},
                        f'Pronto. O cargo {target["name"]} agora se chama {new}.', context)

        if intent.kind == 'role_color':
            rows = await self._roles(community_id, headers)
            target = self._pick_named(rows, args['name'], 'cargo')
            return Plan('role_color', f'Vou mudar a cor do cargo {target["name"]} para {args["color"]}.',
                        {'id': str(target['id']), 'color': args['color']},
                        f'Pronto. Atualizei a cor do cargo {target["name"]}.', context)

        if intent.kind == 'role_permission':
            rows = await self._roles(community_id, headers)
            target = self._pick_named(rows, args['role'], 'cargo')
            current = list(target.get('permissions') or [])
            wanted = args['permissions']
            updated = list(current)
            for permission in wanted:
                if args['add'] and permission not in updated:
                    updated.append(permission)
                if not args['add'] and permission in updated:
                    updated.remove(permission)
            if updated == current:
                raise AdminProblem('Esse cargo já está com essa configuração.')
            labels = ', '.join(PERMISSION_LABELS.get(item, item) for item in wanted)
            verb = 'dar' if args['add'] else 'tirar'
            return Plan('role_permission',
                        f'Vou {verb} a permissão de {labels} {"ao" if args["add"] else "do"} '
                        f'cargo {target["name"]}.',
                        {'id': str(target['id']), 'permissions': updated},
                        f'Pronto. Atualizei as permissões do cargo {target["name"]}.', context)

        if intent.kind == 'community_name':
            name = args['name']
            if len(name) < 2:
                raise AdminProblem('Diga o novo nome do servidor.')
            return Plan('community_name', f'Vou mudar o nome do servidor {community} para {name}.',
                        {'id': str(community_id), 'name': name},
                        f'Pronto. O servidor agora se chama {name}.', context)

        if intent.kind == 'community_description':
            return Plan('community_description',
                        f'Vou mudar a descrição do servidor {community} para “{args["text"]}”.',
                        {'id': str(community_id), 'text': args['text']},
                        f'Pronto. Atualizei a descrição do servidor {community}.', context)

        if intent.kind == 'community_invite':
            invite = bool(args['invite_only'])
            return Plan('community_invite',
                        f'Vou deixar o servidor {community} '
                        f'{"apenas com convite" if invite else "aberto para qualquer pessoa entrar"}.',
                        {'id': str(community_id), 'invite_only': invite},
                        f'Pronto. O servidor {community} agora '
                        f'{"aceita apenas convites" if invite else "é aberto para todos"}.', context)

        raise AdminProblem('Não reconheci essa ação administrativa.')

    async def _livekit(self):
        config = self.settings()
        if not all(config.get(key) for key in ('LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET')):
            return None
        return api.LiveKitAPI(config['LIVEKIT_URL'], config['LIVEKIT_API_KEY'],
                              config['LIVEKIT_API_SECRET'])

    async def _drop_everywhere(self, member_id, community_id, headers, all_rooms=False):
        try:
            if all_rooms:
                lk = await self._livekit()
                if lk is None:
                    return
                async with lk:
                    listed = await lk.room.list_rooms(api.ListRoomsRequest())
                    rooms = [room.name for room in listed.rooms]
                    for room in rooms:
                        try:
                            await lk.room.remove_participant(api.RoomParticipantIdentity(
                                room=room, identity=str(member_id)))
                        except api.TwirpError as error:
                            if error.code != 'not_found':
                                raise
                return
            channels = await self._channels(community_id, headers)
            rooms = ['channel-' + str(row['id']) for row in channels if row.get('kind') == 'voice']
            lk = await self._livekit()
            if lk is None or not rooms:
                return
            async with lk:
                for room in rooms:
                    try:
                        await lk.room.remove_participant(api.RoomParticipantIdentity(
                            room=room, identity=str(member_id)))
                    except api.TwirpError as error:
                        if error.code != 'not_found':
                            raise
        except Exception:
            log.warning('Cloe admin: não foi possível retirar %s das calls', member_id)

    async def _mute_tracks(self, room, member_id, muted):
        lk = await self._livekit()
        if lk is None:
            raise AdminProblem('As chamadas não estão configuradas no servidor.')
        try:
            async with lk:
                result = await lk.room.list_participants(api.ListParticipantsRequest(room=room))
                person = next((item for item in result.participants
                               if str(item.identity) == str(member_id)), None)
                if person is None:
                    raise AdminProblem('Essa pessoa não está mais na call.')
                tracks = [track for track in person.tracks
                          if getattr(track, 'type', None) == api.TrackType.AUDIO]
                if not tracks:
                    raise AdminProblem('Essa pessoa não está com o microfone publicado nesta call.')
                changed = 0
                for track in tracks:
                    if bool(getattr(track, 'muted', False)) == muted:
                        continue
                    await lk.room.mute_published_track(api.MuteRoomTrackRequest(
                        room=room, identity=str(member_id), track_sid=track.sid, muted=muted))
                    changed += 1
                if not changed:
                    raise AdminProblem('O microfone dessa pessoa já está nesse estado.')
        except AdminProblem:
            raise
        except Exception:
            raise AdminProblem('Não consegui alterar o microfone agora.')

    async def execute(self, plan, headers, room):
        kind = plan.kind
        params = plan.params
        if kind in ('ban', 'remove', 'unban'):
            action = {'ban': 'ban', 'remove': 'remove', 'unban': 'unban'}[kind]
            await self._rpc('admin_member_action', headers, {
                'community': params['community_id'], 'member': params['member'],
                'action_name': action, 'reason_text': REASON})
            if kind in ('ban', 'remove'):
                await self._drop_everywhere(params['member'], params['community_id'], headers)
        elif kind == 'suspend':
            await self._rpc('admin_suspend_account', headers, {
                'member': params['member'], 'confirm_username': params['username'],
                'hours': params['hours'], 'reason_text': REASON})
            await self._drop_everywhere(params['member'], params['community_id'], headers,
                                        all_rooms=True)
        elif kind == 'delete_message':
            await self._rpc('admin_delete_message', headers, {
                'message': params['message'], 'reason_text': REASON})
        elif kind in ('end_call', 'kick'):
            action = 'end_call' if kind == 'end_call' else 'kick_participant'
            body = {'channel': params['channel_id'], 'action_name': action,
                    'reason_text': REASON}
            if kind == 'kick':
                body['member'] = params['member']
            await self._rpc('admin_call_action', headers, body)
            lk = await self._livekit()
            if lk is None:
                raise AdminProblem('As chamadas não estão configuradas no servidor.')
            try:
                async with lk:
                    if kind == 'end_call':
                        await lk.room.delete_room(api.DeleteRoomRequest(
                            room='channel-' + params['channel_id']))
                    else:
                        await lk.room.remove_participant(api.RoomParticipantIdentity(
                            room=room, identity=params['member']))
            except api.TwirpError as error:
                if error.code != 'not_found':
                    raise AdminProblem('A ação foi salva, mas a call não pôde ser atualizada agora.')
            except Exception:
                raise AdminProblem('A ação foi salva, mas a call não pôde ser atualizada agora.')
        elif kind in ('mute', 'unmute'):
            await self._mute_tracks(room, params['member'], kind == 'mute')
        elif kind == 'create_channel':
            await self._request('POST', 'channels', headers, prefer='return=representation', json={
                'community_id': params['community_id'], 'name': params['name'],
                'kind': params['kind'], 'position': params['position'],
                'description': '', 'is_private': bool(params['private'])})
        elif kind in ('rename_channel', 'channel_description', 'channel_privacy'):
            payload = ({'name': params['name']} if kind == 'rename_channel'
                       else {'description': params['text']} if kind == 'channel_description'
                       else {'is_private': bool(params['private'])})
            await self._request('PATCH', 'channels', headers,
                                params={'id': 'eq.' + params['id']}, json=payload)
        elif kind == 'create_role':
            await self._request('POST', 'community_roles', headers,
                                prefer='return=representation', json={
                                    'community_id': params['community_id'], 'name': params['name'],
                                    'color': params['color'], 'position': params['position'],
                                    'permissions': params['permissions']})
        elif kind in ('rename_role', 'role_color', 'role_permission'):
            payload = ({'name': params['name']} if kind == 'rename_role'
                       else {'color': params['color']} if kind == 'role_color'
                       else {'permissions': params['permissions']})
            await self._request('PATCH', 'community_roles', headers,
                                params={'id': 'eq.' + params['id']}, json=payload)
        elif kind in ('community_name', 'community_description', 'community_invite'):
            payload = ({'name': params['name']} if kind == 'community_name'
                       else {'description': params['text']} if kind == 'community_description'
                       else {'invite_only': bool(params['invite_only'])})
            await self._request('PATCH', 'communities', headers,
                                params={'id': 'eq.' + params['id']}, json=payload)
        else:
            raise AdminProblem('Ação administrativa desconhecida.')
        log.info('Cloe admin: %s executada pelo dono (%s)', kind,
                 plan.context.get('community', 'sem servidor'))
        return plan.result
