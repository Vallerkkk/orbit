"""Regression checks for privacy, persistence failures and upstream outages."""
import os
import unittest
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from spotify import install_spotify

OWNER = '11111111-1111-4111-8111-111111111111'
VIEWER = '22222222-2222-4222-8222-222222222222'
ENV = dict(SPOTIFY_CLIENT_ID='test', SPOTIFY_CLIENT_SECRET='test',
           SUPABASE_URL='https://db.invalid', SUPABASE_SERVICE_ROLE_KEY='server-only')


class SpotifyReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.viewer = OWNER
        self.show = False
        self.calls = []
        self.app = FastAPI()
        async def identity():
            return ({'id': self.viewer}, {})
        install_spotify(self.app, identity)
        self.client = TestClient(self.app)
        self.env = patch.dict(os.environ, ENV)
        self.env.start()
        self.addCleanup(self.env.stop)

    async def get(self, url, **kwargs):
        self.calls.append(url)
        if url.endswith('/spotify_connections'):
            return httpx.Response(200, json=[{
                'user_id': OWNER, 'show_on_profile': self.show,
                'access_token': 'test', 'expires_at': '2099-01-01T00:00:00+00:00'}])
        return httpx.Response(200, json={
            'is_playing': True, 'item': {'name': 'Private song', 'type': 'track',
                                       'duration_ms': 120000}})

    def now(self):
        return self.client.get('/api/spotify/now-playing/' + OWNER)

    def test_private_owner_cache_never_leaks_to_other_viewers(self):
        async def get(_client, url, **kwargs):
            return await self.get(url, **kwargs)
        with patch.object(httpx.AsyncClient, 'get', get):
            self.assertTrue(self.now().json()['playing'])
            self.viewer = VIEWER
            self.assertEqual(self.now().json(), {'playing': False})
            self.viewer = OWNER
            self.assertTrue(self.now().json()['playing'])
        self.assertEqual(sum('currently-playing' in url for url in self.calls), 1)

    def test_public_cache_reuses_playback_for_other_viewers(self):
        self.show = True
        self.viewer = VIEWER
        async def get(_client, url, **kwargs):
            return await self.get(url, **kwargs)
        with patch.object(httpx.AsyncClient, 'get', get):
            self.assertTrue(self.now().json()['playing'])
            self.viewer = '33333333-3333-4333-8333-333333333333'
            self.assertTrue(self.now().json()['playing'])
        self.assertEqual(sum('currently-playing' in url for url in self.calls), 1)

    def test_settings_and_disconnect_do_not_report_success_when_db_fails(self):
        async def get(_client, url, **kwargs):
            return await self.get(url, **kwargs)
        async def fail(*args, **kwargs):
            return httpx.Response(503)
        with patch.object(httpx.AsyncClient, 'get', get), patch.object(httpx.AsyncClient, 'patch', fail), patch.object(httpx.AsyncClient, 'delete', fail):
            self.assertEqual(self.client.post('/api/spotify/settings', json={'showOnProfile': False}).status_code, 503)
            self.assertEqual(self.client.post('/api/spotify/disconnect').status_code, 503)

    def test_invalid_settings_are_validation_errors(self):
        for payload in ([], {}, {'showOnProfile': []}, {'showOnProfile': False, 'unexpected': 1}):
            with self.subTest(payload=payload):
                self.assertEqual(self.client.post('/api/spotify/settings', json=payload).status_code, 422)

    def test_database_timeout_is_a_recoverable_service_error(self):
        async def fail(*args, **kwargs):
            raise httpx.ReadTimeout('upstream')
        with patch.object(httpx.AsyncClient, 'get', fail):
            self.assertEqual(self.client.get('/api/spotify/status').status_code, 503)

    def test_privacy_update_invalidates_owner_and_public_cache(self):
        self.show = True
        async def get(_client, url, **kwargs):
            return await self.get(url, **kwargs)
        async def update(_client, url, **kwargs):
            self.show = kwargs['json']['show_on_profile']
            return httpx.Response(204)
        with patch.object(httpx.AsyncClient, 'get', get), patch.object(httpx.AsyncClient, 'patch', update):
            self.assertTrue(self.now().json()['playing'])
            self.viewer = VIEWER
            self.assertTrue(self.now().json()['playing'])
            self.viewer = OWNER
            self.assertEqual(self.client.post('/api/spotify/settings', json={'showOnProfile': False}).status_code, 200)
            self.viewer = VIEWER
            self.assertFalse(self.now().json()['playing'])
            self.viewer = OWNER
            self.assertTrue(self.now().json()['playing'])
