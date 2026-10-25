import os
import unittest
from unittest import mock

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
