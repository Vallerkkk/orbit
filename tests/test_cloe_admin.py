import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import httpx

import cloe_admin as admin
from cloe_admin import AdminProblem, OwnerAdmin, Plan

OWNER = '11111111-1111-4111-8111-111111111111'
OTHER = '22222222-2222-4222-8222-222222222222'
COMM = '33333333-3333-4333-8333-333333333333'
CHANNEL = '44444444-4444-4444-8444-444444444444'
VOICE = '55555555-5555-4555-8555-555555555555'
MEMBER = '66666666-6666-4666-8666-666666666666'
ROLE = '77777777-7777-4777-8777-777777777777'
MESSAGE = '88888888-8888-4888-8888-888888888888'
ROOM = 'channel-' + CHANNEL
HEADERS = {'Authorization': 'Bearer dono'}


def settings():
    return {'SUPABASE_URL': 'https://exemplo.supabase.co', 'SUPABASE_PUBLISHABLE_KEY': 'k'}


class ParserTests(unittest.TestCase):
    def kinds(self):
        return {
            'Ei Cloe, expulsa o João da call': ('kick', {'name': 'João'}),
            'Cloe, silencia a Maria': ('mute', {'name': 'Maria'}),
            'desmuta o João': ('unmute', {'name': 'João'}),
            'bane o João do servidor': ('ban', {'name': 'João'}),
            'desbane o João': ('unban', {'name': 'João'}),
            'remove o João do servidor': ('remove', {'name': 'João'}),
            'suspende a conta do João por 2 dias': ('suspend', {'name': 'João', 'hours': 48}),
            'encerra a call': ('end_call', {'channel': None}),
            'apaga a última mensagem do canal geral': ('delete_message',
                                                       {'author': None, 'channel': 'geral'}),
            'cria um canal de voz chamado Música': ('create_channel',
                                                    {'name': 'Música', 'kind': 'voice'}),
            'renomeia o canal geral para avisos': ('rename_channel',
                                                   {'name': 'geral', 'new': 'avisos'}),
            'deixa o canal geral privado': ('channel_privacy',
                                            {'name': 'geral', 'private': True}),
            'muda a descrição do canal geral para conversas do dia': (
                'channel_description', {'name': 'geral'}),
            'cria um cargo Moderador na cor azul com a permissão de gerenciar mensagens': (
                'create_role', {'name': 'Moderador', 'color': '#3b82f6',
                                'permissions': ['manage_messages']}),
            'renomeia o cargo Moderador para Ajudante': ('rename_role',
                                                         {'name': 'Moderador', 'new': 'Ajudante'}),
            'muda a cor do cargo Moderador para vermelho': ('role_color',
                                                            {'name': 'Moderador',
                                                             'color': '#ef4444'}),
            'dá a permissão de gerenciar canais ao cargo Moderador': (
                'role_permission', {'role': 'Moderador', 'add': True,
                                    'permissions': ['manage_channels']}),
            'tira a permissão de criar convites do cargo Moderador': (
                'role_permission', {'role': 'Moderador', 'add': False,
                                    'permissions': ['create_invite']}),
            'muda o nome do servidor para Órbita': ('community_name', {'name': 'Órbita'}),
            'muda a descrição do servidor para a nossa casa': ('community_description', {}),
            'deixa o servidor apenas com convite': ('community_invite', {'invite_only': True}),
            'abre o servidor para todos': ('community_invite', {'invite_only': False}),
        }

    def test_every_command_is_parsed(self):
        for text, (kind, expected) in self.kinds().items():
            with self.subTest(text=text):
                intent = admin.parse_intent(text)
                self.assertIsNotNone(intent, text)
                self.assertEqual(intent.kind, kind)
                for key, value in expected.items():
                    self.assertEqual(intent.args[key], value)

    def test_normal_questions_are_not_commands(self):
        for text in ('qual é o resumo da call?', 'como eu confirmo?', 'quem é o dono?',
                     'o que você acha do João?', 'toca uma música', ''):
            with self.subTest(text=text):
                self.assertIsNone(admin.parse_intent(text))

    def test_forbidden_actions_never_become_plans(self):
        for text in ('apaga o canal geral', 'exclui o servidor', 'transfere a posse do servidor',
                     'remove o cargo Admin', 'apaga tudo'):
            with self.subTest(text=text):
                intent = admin.parse_intent(text)
                self.assertEqual(intent.kind, 'forbidden')

    def test_invalid_details_raise_a_readable_problem(self):
        with self.assertRaises(AdminProblem):
            admin.parse_intent('suspende o João por duas luas')
        with self.assertRaises(AdminProblem):
            admin.parse_intent('dá a permissão de voar ao cargo Moderador')
        with self.assertRaises(AdminProblem):
            admin.parse_intent('muda a cor do cargo Moderador para cinza-espacial')


class OwnerGateTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'CLOE_OWNER_ID': OWNER})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.owner = OwnerAdmin(SimpleNamespace(), settings)
        self.gets = []

    def test_owner_is_exact_and_disabled_without_configuration(self):
        self.assertTrue(self.owner.is_owner(OWNER))
        self.assertTrue(self.owner.is_owner({'id': OWNER.upper()}))
        self.assertFalse(self.owner.is_owner(OTHER))
        self.assertFalse(self.owner.is_owner(None))
        with patch.dict(os.environ, {'CLOE_OWNER_ID': ''}):
            self.assertFalse(self.owner.enabled)
            self.assertFalse(self.owner.is_owner(OWNER))

    def test_phrase_matching_tolerates_case_accent_and_one_letter(self):
        self.assertTrue(self.owner.is_confirmation('Eu Kalil Confirmo'))
        self.assertTrue(self.owner.is_confirmation('  cloe, eu kalil confirmo!  '))
        self.assertTrue(self.owner.is_confirmation('Eu Calil Confirmo'))
        self.assertFalse(self.owner.is_confirmation('Eu Kalil confirmei'))
        self.assertFalse(self.owner.is_confirmation('kalil confirmo'))
        self.assertFalse(self.owner.is_confirmation('sim'))

    def test_phrase_is_redacted_from_transcripts(self):
        self.assertEqual(self.owner.redact('Eu Kalil Confirmo'), '[fala de confirmação]')
        self.assertEqual(self.owner.redact('Cloe, eu kalil confirmo'), '[fala de confirmação]')
        self.assertEqual(self.owner.redact('o João saiu da call'), 'o João saiu da call')
        self.assertTrue(self.owner.looks_like_confirmation('confirmo'))
        self.assertTrue(self.owner.looks_like_confirmation('eu acho que pode'))
        self.assertTrue(self.owner.asks_confirmation_phrase('qual é a frase de confirmação?'))
        self.assertTrue(self.owner.cancels('deixa pra lá'))
        self.assertTrue(self.owner.cancels('Cloe, cancela isso'))
        self.assertFalse(self.owner.cancels('confirma'))

    def test_other_users_are_denied_before_any_lookup(self):
        async def fake_get(self, path, headers, params):
            self.gets.append(path)
            return []

        async def run():
            with patch.object(OwnerAdmin, '_get', fake_get):
                await self.owner.plan_for('apaga a última mensagem do canal geral',
                                          ROOM, HEADERS, OTHER)

        with self.assertRaises(AdminProblem) as caught:
            import asyncio
            asyncio.run(run())
        self.assertEqual(str(caught.exception), admin.DENIED)
        self.assertEqual(self.gets, [])

    def test_forbidden_is_refused_without_network(self):
        async def fake_get(self, path, headers, params):
            self.gets.append(path)
            return []

        async def run():
            with patch.object(OwnerAdmin, '_get', fake_get):
                await self.owner.plan_for('apaga o canal geral', ROOM, HEADERS, OWNER)

        with self.assertRaises(AdminProblem) as caught:
            import asyncio
            asyncio.run(run())
        self.assertIn('Não posso excluir canais', str(caught.exception))
        self.assertEqual(self.gets, [])

    def assert_delete_message_plan(self, text, who, author_id=None):
        calls = []
        channels = [
            {'id': OTHER, 'name': 'geral', 'kind': 'text', 'community_id': OTHER,
             'position': 1, 'description': '', 'is_private': False},
            {'id': CHANNEL, 'name': 'geral', 'kind': 'text', 'community_id': COMM,
             'position': 1, 'description': '', 'is_private': False},
            {'id': VOICE, 'name': 'voz', 'kind': 'voice', 'community_id': COMM,
             'position': 2, 'description': '', 'is_private': False},
        ]

        def handle_request(request):
            calls.append(request)
            self.assertEqual(request.method, 'GET', 'Não deve executar DELETE antes de confirmar.')
            self.assertEqual(request.headers['Authorization'], HEADERS['Authorization'])
            self.assertEqual(request.url.host, 'exemplo.supabase.co')
            params = dict(request.url.params)
            path = request.url.path
            if path == '/rest/v1/channels':
                if 'id' in params:
                    self.assertEqual(params, {
                        'id': 'eq.' + VOICE, 'select': 'id,name,kind,community_id'})
                    rows = [row for row in channels if row['id'] == VOICE]
                else:
                    self.assertEqual(params, {
                        'community_id': 'eq.' + COMM,
                        'select': 'id,name,kind,position,is_private,description',
                        'order': 'position.asc'})
                    rows = [row for row in channels if row['community_id'] == COMM]
            elif path == '/rest/v1/communities':
                self.assertEqual(params, {'id': 'eq.' + COMM, 'select': 'id,name,created_by'})
                rows = [{'id': COMM, 'name': 'Servidor', 'created_by': OWNER}]
            elif path == '/rest/v1/profiles':
                self.assertIsNotNone(author_id)
                self.assertEqual(params, {
                    'select': 'id,username,display_name', 'limit': '50',
                    'or': '(display_name.ilike.*João*,username.ilike.*João*)'})
                rows = [{'id': MEMBER, 'username': 'joao', 'display_name': 'João'}]
            elif path == '/rest/v1/community_members':
                self.assertIsNotNone(author_id)
                self.assertEqual(params, {'community_id': 'eq.' + COMM, 'select': 'user_id'})
                rows = [{'user_id': MEMBER}]
            elif path == '/rest/v1/messages':
                self.assertEqual(params.get('channel_id'), 'eq.' + CHANNEL)
                self.assertNotIn('channel_name', params)
                expected = {'channel_id': 'eq.' + CHANNEL,
                            'select': 'id,content,author_id,created_at',
                            'order': 'created_at.desc', 'limit': '1'}
                if author_id is not None:
                    expected['author_id'] = 'eq.' + author_id
                self.assertEqual(params, expected)
                rows = [{'id': MESSAGE, 'content': 'mensagem antiga', 'author_id': MEMBER,
                         'created_at': '2026-11-01T12:00:00Z'}]
            else:
                self.fail(f'Requisição inesperada: {request.method} {path}')
            return httpx.Response(200, json=rows)

        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handle_request)) as client:
                self.owner.app = SimpleNamespace(state=SimpleNamespace(upstream=client))
                return await self.owner.plan_for(text, 'channel-' + VOICE, HEADERS, OWNER)

        import asyncio
        plan = asyncio.run(run())
        self.assertEqual(plan.kind, 'delete_message')
        self.assertEqual(plan.params, {'message': MESSAGE, 'channel_name': 'geral', 'author': who})
        self.assertEqual(plan.context, {
            'community_id': COMM, 'community': 'Servidor', 'channel_id': VOICE, 'channel': 'voz'})
        self.assertEqual(plan.preview,
                         f'Vou apagar a última mensagem de {who} no canal geral: “mensagem antiga”.'
                         ' Para confirmar, diga a sua frase de confirmação.')
        self.assertEqual(plan.result,
                         f'Pronto. Apaguei a última mensagem de {who} no canal geral.')
        self.assertEqual([request.url.path for request in calls], [
            '/rest/v1/channels', '/rest/v1/communities', '/rest/v1/channels',
            *(['/rest/v1/profiles', '/rest/v1/community_members'] if author_id else []),
            '/rest/v1/messages'])

    def test_plan_for_uses_the_owner_jwt_and_current_room(self):
        self.assert_delete_message_plan(
            'apaga a última mensagem do canal geral', 'alguém')

    def test_plan_for_delete_message_filters_optional_author(self):
        self.assert_delete_message_plan(
            'apaga a última mensagem do João no canal geral', 'João', MEMBER)

    def assert_moderation_plan(self, text, kind, summary, result, hours=None):
        async def fake_get(self, path, headers, params):
            rows = {
                'channels': [{'id': CHANNEL, 'name': 'geral', 'kind': 'text',
                              'community_id': COMM}],
                'communities': [{'id': COMM, 'name': 'Servidor', 'created_by': OWNER}],
                'profiles': [{'id': MEMBER, 'username': 'joao', 'display_name': 'João'}],
                'community_members': [{'user_id': MEMBER}],
            }
            return rows[path]

        intent = admin.parse_intent(text)
        if kind == 'suspend':
            self.assertEqual(intent.args['duration'], '2 dias')
        else:
            self.assertNotIn('duration', intent.args)

        import asyncio
        with patch.object(OwnerAdmin, '_get', fake_get), \
                patch.object(OwnerAdmin, '_request', side_effect=AssertionError(
                    'O planejamento não deve executar ações ou chamar serviços reais.')):
            plan = asyncio.run(self.owner.plan_for(text, ROOM, HEADERS, OWNER))

        self.assertEqual(plan, Plan(kind, summary, {
            'community_id': COMM, 'member': MEMBER, 'username': 'joao',
            'label': 'João', 'hours': hours}, result, {
                'community_id': COMM, 'community': 'Servidor',
                'channel_id': CHANNEL, 'channel': 'geral'}))
        self.assertEqual(plan.preview,
                         summary + ' Para confirmar, diga a sua frase de confirmação.')

    def test_plan_for_ban_without_duration(self):
        self.assert_moderation_plan(
            'bane o João do servidor', 'ban',
            'Vou banir João do servidor Servidor.',
            'Pronto. João foi banido do servidor Servidor.')

    def test_plan_for_unban_without_duration(self):
        self.assert_moderation_plan(
            'desbane o João', 'unban',
            'Vou desbanir João no servidor Servidor.',
            'Pronto. João foi desbanido e pode voltar ao servidor Servidor.')

    def test_plan_for_remove_without_duration(self):
        self.assert_moderation_plan(
            'remove o João do servidor', 'remove',
            'Vou remover João do servidor Servidor.',
            'Pronto. João foi removido do servidor Servidor.')

    def test_plan_for_suspend_with_duration(self):
        self.assert_moderation_plan(
            'suspende a conta do João por 2 dias', 'suspend',
            'Vou suspender a conta de João por 2 dias.',
            'Pronto. A conta de João ficou suspensa por 2 dias.', hours=48)


class ExecuteTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'CLOE_OWNER_ID': OWNER})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.owner = OwnerAdmin(SimpleNamespace(), settings)
        self.rpcs = []
        self.requests = []

    def plan(self, kind, params, result='Pronto.'):
        return Plan(kind, 'resumo', params, result, {'community': 'Servidor'})

    def test_moderation_goes_through_the_audited_rpc(self):
        rpcs, dropped = self.rpcs, self.requests

        async def fake_rpc(self, name, headers, body):
            rpcs.append((name, headers, body))

        async def fake_drop(self, member, community, headers, all_rooms=False):
            dropped.append(('drop', member, all_rooms))

        import asyncio
        with patch.object(OwnerAdmin, '_rpc', fake_rpc), \
                patch.object(OwnerAdmin, '_drop_everywhere', fake_drop):
            asyncio.run(self.owner.execute(
                self.plan('ban', {'community_id': COMM, 'member': MEMBER, 'label': 'João'}),
                HEADERS, ROOM))
            asyncio.run(self.owner.execute(
                self.plan('suspend', {'community_id': COMM, 'member': MEMBER,
                                      'username': 'joao', 'hours': 24, 'label': 'João'}),
                HEADERS, ROOM))
        self.assertEqual(self.rpcs[0][0], 'admin_member_action')
        self.assertEqual(self.rpcs[0][2]['action_name'], 'ban')
        self.assertEqual(self.rpcs[1][0], 'admin_suspend_account')
        self.assertEqual(self.rpcs[1][2]['confirm_username'], 'joao')
        self.assertIn(('drop', MEMBER, True), self.requests)

    def test_structure_writes_use_the_owner_session(self):
        requests = self.requests

        async def fake_request(self, method, path, headers, **kwargs):
            requests.append((method, path, headers, kwargs))
            return None

        import asyncio
        with patch.object(OwnerAdmin, '_request', fake_request):
            asyncio.run(self.owner.execute(
                self.plan('create_channel', {'community_id': COMM, 'name': 'avisos',
                                             'kind': 'text', 'position': 3, 'private': True}),
                HEADERS, ROOM))
            asyncio.run(self.owner.execute(
                self.plan('rename_channel', {'id': CHANNEL, 'name': 'novo'}), HEADERS, ROOM))
            asyncio.run(self.owner.execute(
                self.plan('role_permission', {'id': ROLE, 'permissions': ['manage_messages']}),
                HEADERS, ROOM))
            asyncio.run(self.owner.execute(
                self.plan('community_name', {'id': COMM, 'name': 'Novo nome'}), HEADERS, ROOM))
        self.assertEqual([entry[:2] for entry in self.requests],
                         [('POST', 'channels'), ('PATCH', 'channels'),
                          ('PATCH', 'community_roles'), ('PATCH', 'communities')])
        self.assertTrue(all(entry[2] is HEADERS for entry in self.requests))
        self.assertEqual(self.requests[0][3]['json']['is_private'], True)
        self.assertEqual(self.requests[1][3]['params'], {'id': 'eq.' + CHANNEL})
        self.assertEqual(self.requests[3][3]['json'], {'name': 'Novo nome'})

    def test_unknown_plan_is_refused(self):
        import asyncio
        with self.assertRaises(AdminProblem):
            asyncio.run(self.owner.execute(self.plan('drop_database', {}), HEADERS, ROOM))


if __name__ == '__main__':
    unittest.main()
