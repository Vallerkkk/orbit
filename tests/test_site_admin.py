import os
import unittest
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
import app
from test_integrations import ENV, USER, TARGET

AUTH = {'Authorization': 'Bearer test'}
COMMANDS = [
    ('/api/admin/communities/{t}/delete', {'confirm': 'Servidor', 'reason': 'spam'}),
    ('/api/admin/channels/{t}/delete', {'confirm': 'geral'}),
    ('/api/admin/messages/{t}/delete', {'reason': 'spam'}),
    ('/api/admin/communities/{t}/members/{t}', {'action': 'remove'}),
    ('/api/admin/communities/{t}/members/{t}', {'action': 'ban'}),
    ('/api/admin/communities/{t}/members/{t}', {'action': 'unban'}),
    ('/api/admin/users/{t}/suspend', {'hours': 24, 'confirm': 'alvo'}),
    ('/api/admin/communities/{t}/transfer', {'new_owner': TARGET, 'confirm': 'Servidor'}),
    ('/api/admin/channels/{t}/call', {'action': 'end_call'}),
    ('/api/admin/channels/{t}/call', {'action': 'kick_participant', 'member': TARGET}),
]


class SiteAdminCommandTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, ENV); self.env.start(); self.client = TestClient(app.app); self.calls = []
    def tearDown(self):
        self.env.stop()

    def remote(self, roles=(), rpc_status=200):
        async def request(_client, method, url, **kwargs):
            self.calls.append(url)
            if url.endswith('/auth/v1/user'):
                return httpx.Response(200, json={'id': USER})
            if url.endswith('/rest/v1/site_roles'):
                self.assertEqual(kwargs.get('params', {}).get('user_id'), 'eq.' + USER)
                return httpx.Response(200, json=[{'role': r} for r in roles])
            if '/rest/v1/rpc/admin_' in url:
                return httpx.Response(rpc_status, json=True if rpc_status == 200 else {'message': 'Somente administradores do app podem usar este comando.'})
            if url.endswith('/rest/v1/channels') or url.endswith('/rest/v1/site_admin_actions'):
                return httpx.Response(200, json=[])
            raise AssertionError('Unexpected outbound request: ' + url)
        return patch.object(httpx.AsyncClient, 'request', request)

    def test_regular_user_gets_403_on_every_command(self):
        for path, body in COMMANDS:
            with self.subTest(path=path, body=body):
                self.calls.clear()
                with self.remote(), patch('site_admin.api.LiveKitAPI') as lk:
                    response = self.client.post(path.format(t=TARGET), json=body, headers=AUTH)
                self.assertEqual(response.status_code, 403, response.text)
                self.assertFalse([c for c in self.calls if '/rpc/' in c], 'a RPC não pode ser chamada')
                lk.assert_not_called()

    def test_regular_user_cannot_read_admin_audit(self):
        with self.remote():
            self.assertEqual(self.client.get('/api/admin/actions', headers=AUTH).status_code, 403)

    def test_server_owner_or_moderator_role_is_not_global_admin(self):
        for role in ('owner', 'moderator', 'member', 'Admin'):
            with self.subTest(role=role), self.remote(roles=(role,)):
                response = self.client.post(f'/api/admin/communities/{TARGET}/delete', json={'confirm': 'x'}, headers=AUTH)
                self.assertEqual(response.status_code, 403)

    def test_client_flags_are_ignored(self):
        headers = {**AUTH, 'X-Site-Admin': 'true', 'Cookie': 'siteRoles=admin'}
        with self.remote():
            response = self.client.post(f'/api/admin/messages/{TARGET}/delete', json={'reason': '', 'is_admin': True, 'role': 'creator'}, headers=headers)
        self.assertEqual(response.status_code, 403)

    def test_anonymous_requests_are_rejected(self):
        for path, body in COMMANDS:
            with self.subTest(path=path):
                self.assertIn(self.client.post(path.format(t=TARGET), json=body).status_code, (401, 403))

    def test_database_recheck_blocks_even_if_role_lookup_passes(self):
        with self.remote(roles=('admin',), rpc_status=403), patch('site_admin.api.LiveKitAPI') as lk:
            response = self.client.post(f'/api/admin/channels/{TARGET}/call', json={'action': 'end_call'}, headers=AUTH)
        self.assertEqual(response.status_code, 403); lk.assert_not_called()

    def test_global_admin_reaches_the_audited_rpc(self):
        with self.remote(roles=('admin',)):
            response = self.client.post(f'/api/admin/communities/{TARGET}/delete', json={'confirm': 'Servidor'}, headers=AUTH)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(any(c.endswith('/rpc/admin_delete_community') for c in self.calls))

    def test_destructive_commands_require_typed_confirmation(self):
        with self.remote(roles=('admin',)):
            for path in ('/api/admin/communities/{t}/delete', '/api/admin/channels/{t}/delete'):
                self.assertEqual(self.client.post(path.format(t=TARGET), json={'confirm': ''}, headers=AUTH).status_code, 422)


if __name__ == '__main__':
    unittest.main()
