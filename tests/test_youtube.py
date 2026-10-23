import os
import time
import unittest
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
import app
import youtube
from test_integrations import ENV, USER

AUTH = {'Authorization': 'Bearer test'}
VID = 'M7lc1UVf-VE'
YTENV = {**ENV, 'YOUTUBE_API_KEY': 'segredo-yt', 'GOOGLE_OAUTH_CLIENT_ID': 'cid', 'GOOGLE_OAUTH_CLIENT_SECRET': 'csecret',
         'YOUTUBE_TOKEN_KEY': 'chave-de-teste-bem-longa-123', 'PUBLIC_BASE_URL': 'https://orbita.test'}


class Helpers(unittest.TestCase):
    def test_duration(self):
        self.assertEqual(youtube.duration_seconds('PT1H2M3S'), 3723)
        self.assertEqual(youtube.duration_seconds('PT45S'), 45)
        self.assertEqual(youtube.duration_seconds('P1DT1S'), 86401)
        self.assertEqual(youtube.duration_seconds('lixo'), 0)

    def test_cache_ttl_and_size(self):
        now = [0]
        c = youtube.TTLCache(2, clock=lambda: now[0])
        c.set('a', 1, 10); c.set('b', 2, 100)
        now[0] = 11
        self.assertIsNone(c.get('a')); self.assertEqual(c.get('b'), 2)
        c.set('c', 3, 5); c.set('d', 4, 5)
        self.assertIsNone(c.get('b')); self.assertEqual(c.get('d'), 4)

    def test_state_signed_bound_to_cookie_and_expiring(self):
        key = b'k' * 32
        s = youtube.make_state(USER, 'nonce1', now=1000, key=key)
        self.assertEqual(youtube.check_state(s, 'nonce1', now=1001, key=key), USER)
        self.assertIsNone(youtube.check_state(s, 'outro', now=1001, key=key))
        self.assertIsNone(youtube.check_state(s, None, now=1001, key=key))
        self.assertIsNone(youtube.check_state(s, 'nonce1', now=1000 + 601, key=key))
        body, sig = s.split('.')
        self.assertIsNone(youtube.check_state(body + 'x.' + sig, 'nonce1', now=1001, key=key))
        self.assertIsNone(youtube.check_state(s, 'nonce1', now=1001, key=b'z' * 32))

    def test_seal_roundtrip_and_tamper(self):
        key = b'q' * 32
        blob = youtube.seal({'rt': 'x'}, key)
        self.assertNotIn('x"', blob)
        self.assertEqual(youtube.unseal(blob, key), {'rt': 'x'})
        self.assertIsNone(youtube.unseal(blob[:-4] + 'AAAA', key))

    def test_normalizers_filter_bad_ids_and_hosts(self):
        self.assertIsNone(youtube.video({'id': 'curto'}))
        v = youtube.video({'id': VID, 'snippet': {'title': 'T', 'thumbnails': {'high': {'url': 'https://evil.example/x.jpg'}}}, 'contentDetails': {'duration': 'PT1M'}})
        self.assertEqual(v['thumb'], f'https://i.ytimg.com/vi/{VID}/hqdefault.jpg'); self.assertEqual(v['duration'], 60)


class Routes(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, YTENV); self.env.start()
        self.client = TestClient(app.app); self.seen = []; self.store = {}; self.profile_writes = []

    def tearDown(self):
        self.env.stop()

    def remote(self):
        async def request(_c, method, url, **kw):
            self.seen.append((method, url, kw.get('params'), kw.get('data')))
            if url.endswith('/auth/v1/user'):
                return httpx.Response(200, json={'id': USER, 'email': 'eu@orbita.test'})
            if '/rest/v1/rpc/youtube_token_put' in url:
                self.store['c'] = kw['json']['ciphertext']; return httpx.Response(204)
            if '/rest/v1/rpc/youtube_token_get' in url:
                return httpx.Response(200, json=self.store.get('c'))
            if '/rest/v1/rpc/youtube_token_clear' in url:
                self.store.pop('c', None); return httpx.Response(204)
            if '/rest/v1/' in url or '/auth/v1/' in url:
                self.profile_writes.append(url); return httpx.Response(500)
            if url == youtube.TOKEN_URL:
                if kw['data']['grant_type'] == 'authorization_code':
                    return httpx.Response(200, json={'access_token': 'at1', 'refresh_token': 'rt-secreto', 'expires_in': 3600,
                                                     'scope': 'openid https://www.googleapis.com/auth/youtube.readonly', 'id_token': 'x.eyJuYW1lIjoiS2FsaWwifQ.y'})
                return httpx.Response(200, json={'access_token': 'at2', 'expires_in': 3600})
            if url == youtube.REVOKE_URL:
                return httpx.Response(200)
            if url.startswith(youtube.API):
                if url.endswith('/videos') and kw['params'].get('myRating'):
                    assert kw['headers']['Authorization'].startswith('Bearer at')
                return httpx.Response(200, json={'items': [{'id': VID, 'snippet': {'title': 'Vídeo', 'channelTitle': 'Canal'}, 'contentDetails': {'duration': 'PT2M'}, 'statistics': {'viewCount': '10'}}]})
            raise AssertionError('Unexpected outbound request: ' + url)
        return patch.object(httpx.AsyncClient, 'request', request)

    def test_not_configured_message(self):
        with patch.dict(os.environ, {'YOUTUBE_API_KEY': ''}), self.remote():
            r = self.client.get('/api/youtube/trending', headers=AUTH)
            s = self.client.get('/api/youtube/status', headers=AUTH)
        self.assertEqual(r.status_code, 503); self.assertIn('YOUTUBE_API_KEY', r.json()['detail'])
        self.assertFalse(s.json()['available'])

    def test_trending_cached_and_key_hidden(self):
        with self.remote():
            a = self.client.get('/api/youtube/trending', headers=AUTH)
            b = self.client.get('/api/youtube/trending', headers=AUTH)
        self.assertEqual(a.json()['items'][0]['id'], VID); self.assertEqual(a.json(), b.json())
        self.assertNotIn('segredo-yt', a.text)
        self.assertEqual(len([s for s in self.seen if s[1].startswith(youtube.API)]), 1)

    def test_requires_login(self):
        self.assertEqual(self.client.get('/api/youtube/trending').status_code, 401)

    def test_oauth_flow_is_separate_from_orbita_account(self):
        with self.remote():
            start = self.client.post('/api/youtube/oauth/start', headers=AUTH)
            url = start.json()['url']
            self.assertIn('redirect_uri=https%3A%2F%2Forbita.test%2Fapi%2Fyoutube%2Foauth%2Fcallback', url)
            self.assertIn('youtube.readonly', url)
            state = url.split('state=')[1].split('&')[0]
            from urllib.parse import unquote
            state = unquote(state)
            # Sem o cookie do navegador que iniciou: recusado (CSRF)
            other = TestClient(app.app)
            bad = other.get('/api/youtube/oauth/callback', params={'state': state, 'code': 'c'}, follow_redirects=False)
            self.assertIn('estado-invalido', bad.headers['location'])
            cb = self.client.get('/api/youtube/oauth/callback', params={'state': state, 'code': 'c'}, follow_redirects=False)
            self.assertIn('youtube=conectado', cb.headers['location'])
            self.assertNotIn('rt-secreto', str(cb.headers))
            fin = self.client.post('/api/youtube/oauth/finish', headers=AUTH)
            self.assertTrue(fin.json()['connected'])
            self.assertNotIn('rt-secreto', self.store['c'])
            self.assertTrue(self.client.get('/api/youtube/me', headers=AUTH).json()['connected'])
            self.assertEqual(self.client.get('/api/youtube/mine/liked', headers=AUTH).status_code, 200)
            out = self.client.post('/api/youtube/oauth/logout', headers=AUTH)
            self.assertFalse(out.json()['connected']); self.assertNotIn('c', self.store)
            self.assertFalse(self.client.get('/api/youtube/me', headers=AUTH).json()['connected'])
        # Nada toca a conta do Órbita: nenhuma escrita em auth/perfis, só as RPCs do token do YouTube.
        self.assertEqual(self.profile_writes, [])
        supa = [s[1] for s in self.seen if 'example.supabase.co' in s[1]]
        self.assertTrue(all(u.endswith('/auth/v1/user') or '/rpc/youtube_token_' in u for u in supa), supa)
        self.assertTrue(all(s[0] == 'GET' for s in self.seen if '/auth/v1/' in s[1]))
        self.assertTrue(any(s[1] == youtube.REVOKE_URL for s in self.seen))

    def test_finish_rejects_other_user(self):
        with self.remote():
            self.client.cookies.set(youtube.PENDING_COOKIE, youtube.seal({'u': 'outro', 'rt': 'x', 'until': time.time() + 60}), path=youtube.COOKIE_PATH)
            r = self.client.post('/api/youtube/oauth/finish', headers=AUTH)
        self.assertEqual(r.status_code, 400); self.assertNotIn('c', self.store)
