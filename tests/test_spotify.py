import os
import time
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

    def test_state_is_signed_and_bound_to_the_browser(self):
        key = spotify._state_key({'client_secret': 'segredo'})
        state = spotify.make_state('u1', 'nonce-do-navegador', key)
        self.assertEqual(spotify.check_state(state, 'nonce-do-navegador', key), 'u1')
        self.assertIsNone(spotify.check_state(state, 'outro-navegador', key))
        self.assertIsNone(spotify.check_state(state + 'x', 'nonce-do-navegador', key))
        self.assertIsNone(spotify.check_state(state, 'nonce-do-navegador', key, now=time.time() + 601))

    def test_pending_verifier_cannot_be_moved_to_another_state(self):
        key = spotify._state_key({'client_secret': 'segredo'})
        blob = spotify.seal_pending('verifier-123', 'nonce-a', key)
        self.assertEqual(spotify.unseal_pending(blob, 'nonce-a', key), 'verifier-123')
        self.assertIsNone(spotify.unseal_pending(blob, 'nonce-b', key))
        self.assertIsNone(spotify.unseal_pending(blob + 'x', 'nonce-a', key))
