import asyncio
import json
import os
import time
from urllib.parse import parse_qs
import unittest
from unittest import mock
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

import app
import spotify


class SpotifyTests(unittest.TestCase):
    def test_disabled_without_env(self):
        with mock.patch.dict(os.environ, {'SPOTIFY_CLIENT_ID': '', 'SPOTIFY_CLIENT_SECRET': '', 'SUPABASE_SERVICE_ROLE_KEY': ''}):
            self.assertFalse(spotify.enabled())

    def test_enabled_needs_all_keys_and_default_redirect(self):
        env = {'SPOTIFY_CLIENT_ID': 'a', 'SPOTIFY_CLIENT_SECRET': 'b', 'SUPABASE_URL': 'https://x.supabase.co', 'SUPABASE_SERVICE_ROLE_KEY': 'c', 'SPOTIFY_REDIRECT_URI': ''}
        with mock.patch.dict(os.environ, env):
            self.assertTrue(spotify.enabled())
            self.assertEqual(spotify.config()['redirect'], 'https://orbita-8nwu.onrender.com/api/spotify/callback')

    def test_routes_require_login_and_bad_callback_redirects(self):
        client = TestClient(app.app)
        self.assertEqual(client.post('/api/spotify/login').status_code, 401)
        self.assertEqual(client.get('/api/spotify/status').status_code, 401)
        r = client.get('/api/spotify/callback?code=x&state=nope', follow_redirects=False)
        self.assertEqual(r.status_code, 303)
        self.assertIn('spotify=erro', r.headers['location'])

    def test_state_is_signed_and_bound_to_the_browser(self):
        key = spotify._state_key({'client_secret': 'segredo'})
        state = spotify.make_state('u1', 'nonce-do-navegador', key)
        self.assertEqual(spotify.check_state(state, 'nonce-do-navegador', key), 'u1')
        self.assertIsNone(spotify.check_state(state, 'outro-navegador', key))
        self.assertIsNone(spotify.check_state(state + 'x', 'nonce-do-navegador', key))
        self.assertIsNone(spotify.check_state(state, 'nonce-do-navegador', key, now=time.time() + 601))

    def test_privacy_changes_do_not_confirm_failed_storage_requests(self):
        uid = '11111111-1111-4111-8111-111111111111'
        config = {'client_id': 'test', 'client_secret': 'test', 'redirect': 'test',
                  'url': 'https://storage.invalid', 'service': 'test'}
        for action, method in [('settings', 'PATCH'), ('disconnect', 'DELETE')]:
            for failure in (403, 503, 'timeout'):
                with self.subTest(action=action, failure=failure):
                    requests = []

                    def handler(request):
                        requests.append(request.method)
                        if request.method == 'GET':
                            return httpx.Response(200, json=[{'user_id': uid, 'show_on_profile': True}])
                        if request.method != method:
                            raise AssertionError('Unexpected storage operation')
                        if failure == 'timeout':
                            raise httpx.ReadTimeout('Storage unavailable', request=request)
                        return httpx.Response(failure, json={'message': 'rejected'})

                    @asynccontextmanager
                    async def clients(application):
                        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as upstream:
                            yield upstream

                    application = FastAPI()
                    async def user():
                        return ({'id': uid}, {})
                    spotify.install_spotify(application, user)
                    with mock.patch.object(spotify, 'config', return_value=config), \
                            mock.patch.object(spotify, 'client_for', clients), \
                            TestClient(application, raise_server_exceptions=False) as client:
                        response = client.post('/api/spotify/' + action, json={'showOnProfile': False})
                    self.assertIn(method, requests)
                    self.assertEqual(response.status_code, 503)
                    self.assertNotEqual(response.json(), {'ok': True})

    def test_successful_privacy_changes_are_visible_to_subsequent_reads(self):
        import json
        uid = '11111111-1111-4111-8111-111111111111'
        config = {'client_id': 'test', 'client_secret': 'test', 'redirect': 'test',
                  'url': 'https://storage.invalid', 'service': 'test'}
        rows = [{'user_id': uid, 'show_on_profile': True}]
        def handler(request):
            if request.url.params.get('user_id') != 'eq.' + uid:
                raise AssertionError('Storage request must be scoped to the authenticated user')
            if request.method == 'GET':
                return httpx.Response(200, json=rows)
            if request.method == 'PATCH':
                rows[0].update(json.loads(request.content))
                return httpx.Response(204)
            if request.method == 'DELETE':
                rows.clear()
                return httpx.Response(204)
            raise AssertionError('Unexpected storage operation')

        @asynccontextmanager
        async def clients(application):
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as upstream:
                yield upstream

        application = FastAPI()
        async def user():
            return ({'id': uid}, {})
        spotify.install_spotify(application, user)
        with mock.patch.object(spotify, 'config', return_value=config), \
                mock.patch.object(spotify, 'client_for', clients), TestClient(application) as client:
            self.assertTrue(client.get('/api/spotify/status').json()['showOnProfile'])
            self.assertEqual(client.post('/api/spotify/settings', json={'showOnProfile': False}).json(), {'ok': True})
            self.assertFalse(client.get('/api/spotify/status').json()['showOnProfile'])
            self.assertEqual(client.post('/api/spotify/disconnect').json(), {'ok': True})
            self.assertFalse(client.get('/api/spotify/status').json()['connected'])

    def test_pending_verifier_cannot_be_moved_to_another_state(self):
        key = spotify._state_key({'client_secret': 'segredo'})
        blob = spotify.seal_pending('verifier-123', 'nonce-a', key)
        self.assertEqual(spotify.unseal_pending(blob, 'nonce-a', key), 'verifier-123')
        self.assertIsNone(spotify.unseal_pending(blob, 'nonce-b', key))
        self.assertIsNone(spotify.unseal_pending(blob + 'x', 'nonce-a', key))


class SpotifyAsyncTests(unittest.IsolatedAsyncioTestCase):
    uid = '11111111-1111-4111-8111-111111111111'
    old_expiry = '2000-01-01T00:00:00+00:00'
    config = {'client_id': 'test', 'client_secret': 'test', 'redirect': 'https://test.invalid/callback',
              'url': 'https://storage.invalid', 'service': 'test'}

    async def asyncSetUp(self):
        self.rows = [{'user_id': self.uid, 'access_token': 'expired-access',
                      'refresh_token': 'old-refresh', 'expires_at': self.old_expiry,
                      'display_name': 'Private listener', 'show_on_profile': False}]
        self.requests = []
        self.refresh_started = asyncio.Event()
        self.refresh_release = asyncio.Event()
        self.refresh_release.set()
        self.get_timeout = False
        self.patch_failure = None
        self.callback_refresh = 'replacement-refresh'
        patch = mock.patch.object(spotify, 'config', return_value=self.config)
        patch.start()
        self.addCleanup(patch.stop)
        self.upstream = httpx.AsyncClient(transport=httpx.MockTransport(self.handle_request))
        self.addAsyncCleanup(self.upstream.aclose)
        self.application = self.make_application()
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.application, raise_app_exceptions=False),
            base_url='https://test.invalid')
        self.addAsyncCleanup(self.client.aclose)

    def make_application(self):
        application = FastAPI()

        async def user():
            return ({'id': self.uid}, {})

        spotify.install_spotify(application, user)
        application.state.upstream = self.upstream
        return application

    async def handle_request(self, request):
        self.requests.append(request)
        if request.url.host == 'storage.invalid':
            self.assertEqual(request.url.path, '/rest/v1/spotify_connections')
            params = request.url.params
            self.assertEqual(params.get('user_id', 'eq.' + self.uid), 'eq.' + self.uid)
            if request.method == 'GET':
                if self.get_timeout:
                    raise httpx.ReadTimeout('Storage unavailable', request=request)
                return httpx.Response(200, json=self.rows)
            if request.method == 'DELETE':
                self.rows.clear()
                return httpx.Response(204)
            payload = json.loads(request.content)
            if request.method == 'POST':
                self.assertEqual(params.get('on_conflict'), 'user_id')
                self.assertIn('resolution=merge-duplicates', request.headers.get('Prefer', ''))
                if self.rows:
                    self.rows[0].update(payload)
                else:
                    self.rows.append({'show_on_profile': True, **payload})
                return httpx.Response(201)
            if request.method == 'PATCH':
                if self.patch_failure is not None:
                    if self.patch_failure == 'timeout':
                        raise httpx.ReadTimeout('Storage unavailable', request=request)
                    status, body = self.patch_failure
                    return httpx.Response(status, content=body, headers={'Content-Type': 'application/json'})
                matched = [row for row in self.rows if all(
                    value == ('is.null' if row.get(key) is None else 'eq.' + str(row[key]))
                    for key, value in params.items())]
                for row in matched:
                    row.update(payload)
                if request.headers.get('Prefer') == 'return=representation':
                    return httpx.Response(200, json=matched)
                return httpx.Response(204)
            raise AssertionError('Unexpected storage operation')
        if request.url.host == 'accounts.spotify.com':
            self.assertEqual(request.url.path, '/api/token')
            self.assertEqual(request.method, 'POST')
            data = parse_qs(request.content.decode())
            if data['grant_type'] == ['refresh_token']:
                self.assertEqual(data['refresh_token'], ['old-refresh'])
                self.refresh_started.set()
                await self.refresh_release.wait()
                return httpx.Response(200, json={'access_token': 'refreshed-access',
                                                'refresh_token': 'rotated-refresh', 'expires_in': 3600})
            self.assertEqual(data['grant_type'], ['authorization_code'])
            return httpx.Response(200, json={'access_token': 'replacement-access',
                                            'refresh_token': self.callback_refresh, 'expires_in': 7200})
        if request.url.host == 'api.spotify.com':
            if request.url.path == '/v1/me':
                return httpx.Response(200, json={'display_name': 'Replacement listener'})
            self.assertEqual(request.url.path, '/v1/me/player/currently-playing')
            self.assertEqual(request.headers['Authorization'], 'Bearer refreshed-access')
            return httpx.Response(200, json={'is_playing': True, 'progress_ms': 123,
                'item': {'type': 'track', 'name': 'Test track', 'duration_ms': 200000,
                         'artists': [{'name': 'Test artist'}],
                         'album': {'name': 'Test album', 'images': []},
                         'external_urls': {'spotify': 'https://open.spotify.com/track/test'}}})
        raise AssertionError('Unexpected upstream host')

    def storage_requests(self, method):
        return [request for request in self.requests
                if request.url.host == 'storage.invalid' and request.method == method]

    def playback_requests(self):
        return [request for request in self.requests
                if request.url.path == '/v1/me/player/currently-playing']

    async def test_disconnect_during_refresh_does_not_recreate_connection(self):
        self.refresh_release.clear()
        pending = asyncio.create_task(self.client.get('/api/spotify/now-playing/' + self.uid))
        await asyncio.wait_for(self.refresh_started.wait(), 2)
        try:
            disconnected = await self.client.post('/api/spotify/disconnect')
        finally:
            self.refresh_release.set()
        response = await asyncio.wait_for(pending, 2)
        status = await self.client.get('/api/spotify/status')
        self.assertEqual(disconnected.status_code, 200)
        self.assertEqual(disconnected.json(), {'ok': True})
        self.assertEqual(status.status_code, 200)
        self.assertFalse(status.json()['connected'])
        self.assertEqual(self.rows, [])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'playing': False})
        self.assertEqual(self.storage_requests('POST'), [])
        self.assertEqual(len(self.storage_requests('PATCH')), 1)
        self.assertEqual(self.playback_requests(), [])

    async def test_successful_refresh_plays_and_preserves_private_connection(self):
        response = await self.client.get('/api/spotify/now-playing/' + self.uid)
        status = await self.client.get('/api/spotify/status')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['playing'])
        self.assertEqual(response.json()['track'], 'Test track')
        self.assertTrue(status.json()['connected'])
        self.assertFalse(status.json()['showOnProfile'])
        self.assertFalse(self.rows[0]['show_on_profile'])
        self.assertEqual(self.rows[0]['access_token'], 'refreshed-access')
        self.assertEqual(self.rows[0]['refresh_token'], 'rotated-refresh')
        self.assertEqual(self.storage_requests('POST'), [])
        patches = self.storage_requests('PATCH')
        self.assertEqual(len(patches), 1)
        self.assertEqual(dict(patches[0].url.params), {
            'user_id': 'eq.' + self.uid, 'refresh_token': 'eq.old-refresh',
            'expires_at': 'eq.' + self.old_expiry})
        self.assertEqual(patches[0].headers['Prefer'], 'return=representation')
        self.assertNotIn('show_on_profile', json.loads(patches[0].content))
        self.assertEqual(len(self.playback_requests()), 1)

    async def test_refresh_without_expiry_uses_null_version_condition(self):
        self.rows[0]['expires_at'] = None
        response = await self.client.get('/api/spotify/now-playing/' + self.uid)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['playing'])
        self.assertFalse(self.rows[0]['show_on_profile'])
        self.assertEqual(self.storage_requests('POST'), [])
        patches = self.storage_requests('PATCH')
        self.assertEqual(len(patches), 1)
        self.assertEqual(patches[0].url.params.get('expires_at'), 'is.null')
        self.assertEqual(patches[0].url.params.get('refresh_token'), 'eq.old-refresh')
        self.assertNotIn('show_on_profile', json.loads(patches[0].content))

    async def assert_callback_replacement_survives_refresh(self, refresh_token):
        self.callback_refresh = refresh_token
        self.refresh_release.clear()
        pending = asyncio.create_task(self.client.get('/api/spotify/now-playing/' + self.uid))
        await asyncio.wait_for(self.refresh_started.wait(), 2)
        try:
            key = spotify._state_key(self.config)
            nonce = 'callback-nonce'
            self.client.cookies.set(spotify.STATE_COOKIE, nonce, path=spotify.COOKIE_PATH)
            self.client.cookies.set(spotify.PENDING_COOKIE,
                                    spotify.seal_pending('callback-verifier', nonce, key),
                                    path=spotify.COOKIE_PATH)
            callback = await self.client.get('/api/spotify/callback', params={
                'code': 'replacement-code', 'state': spotify.make_state(self.uid, nonce, key)})
            replacement = dict(self.rows[0])
        finally:
            self.refresh_release.set()
        response = await asyncio.wait_for(pending, 2)
        self.assertEqual(callback.status_code, 303)
        self.assertEqual(callback.headers['location'], '/#spotify=conectado')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'playing': False})
        self.assertEqual(self.rows, [replacement])
        self.assertEqual(self.rows[0]['access_token'], 'replacement-access')
        self.assertEqual(self.rows[0]['refresh_token'], refresh_token)
        self.assertFalse(self.rows[0]['show_on_profile'])
        self.assertEqual(len(self.storage_requests('POST')), 1)  # Only the OAuth callback may UPSERT.
        self.assertEqual(len(self.storage_requests('PATCH')), 1)
        self.assertEqual(self.playback_requests(), [])
        status = await self.client.get('/api/spotify/status')
        self.assertTrue(status.json()['connected'])
        self.assertFalse(status.json()['showOnProfile'])

    async def test_callback_replacement_is_not_overwritten_by_pending_refresh(self):
        await self.assert_callback_replacement_survives_refresh('replacement-refresh')

    async def test_callback_reusing_refresh_token_is_protected_by_expiry_version(self):
        await self.assert_callback_replacement_survives_refresh('old-refresh')

    async def test_refresh_rejects_failed_or_invalid_patch_representations(self):
        failures = [(403, b'[]'), (503, b'[]'), 'timeout', (204, b''), (200, b'not-json'),
                    (200, b'{}'), (200, b'[null]'), (200, b'[{}]'), (200, b'[{}, {}]'),
                    (200, json.dumps([{'user_id': 'another-user', 'access_token': 'refreshed-access',
                                       'refresh_token': 'rotated-refresh'}]).encode()),
                    (200, json.dumps([{'user_id': self.uid, 'access_token': 'replacement-access',
                                       'refresh_token': 'rotated-refresh'}]).encode()),
                    (200, json.dumps([{'user_id': self.uid, 'access_token': 'refreshed-access',
                                       'refresh_token': 'replacement-refresh'}]).encode())]
        for failure in failures:
            with self.subTest(failure=failure):
                self.patch_failure = failure
                self.requests.clear()
                # Each request has an independent cache, so errors cannot hide behind a cache hit.
                async with httpx.AsyncClient(transport=httpx.ASGITransport(
                        app=self.make_application(), raise_app_exceptions=False),
                        base_url='https://test.invalid') as client:
                    response = await client.get('/api/spotify/now-playing/' + self.uid)
                self.assertEqual(response.status_code, 503)
                self.assertEqual(self.storage_requests('POST'), [])
                self.assertEqual(self.playback_requests(), [])

    async def test_storage_get_timeout_returns_503_on_all_reading_routes(self):
        self.get_timeout = True
        for method, path in [('GET', '/api/spotify/status'), ('POST', '/api/spotify/settings'),
                             ('GET', '/api/spotify/now-playing/' + self.uid)]:
            with self.subTest(path=path):
                response = await self.client.request(method, path, json={'showOnProfile': False})
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json(), {'detail': 'Spotify indisponível no momento.'})
        self.assertEqual([request.method for request in self.requests], ['GET', 'GET', 'GET'])
        self.assertFalse(self.rows[0]['show_on_profile'])
