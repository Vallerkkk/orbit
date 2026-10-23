import os
import unittest
from unittest.mock import patch, AsyncMock, MagicMock
import httpx
from fastapi.testclient import TestClient
from livekit import api as lkapi
import app
from test_integrations import ENV, USER, TARGET

AUTH = {'Authorization': 'Bearer test'}


class BadgeTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {**ENV, 'PUSH_TRANSPORT_KEY': 'k'}); self.env.start()
        self.client = TestClient(app.app); self.events = []
    def tearDown(self):
        self.env.stop()

    def remote(self):
        async def request(_client, method, url, **kwargs):
            if url.endswith('/auth/v1/user'):
                return httpx.Response(200, json={'id': USER})
            if url.endswith('/rpc/record_badge_event'):
                self.assertEqual(kwargs['json']['transport_key'], 'k')
                self.assertNotIn('event_amount', kwargs['json'], 'o cliente nunca define quantidade')
                self.events.append(kwargs['json']['event_kind']); return httpx.Response(200, json=True)
            if url.endswith('/rpc/sync_my_badges'):
                return httpx.Response(200, json=2)
            if url.endswith('/rpc/badge_state'):
                return httpx.Response(200, json={'user_id': kwargs['json']['target'], 'badges': [], 'showcase': ['dono']})
            raise AssertionError(url)
        return patch.object(httpx.AsyncClient, 'request', request)

    def livekit(self, tracks=None, missing=False):
        lk = MagicMock(); lk.__aenter__ = AsyncMock(return_value=lk); lk.__aexit__ = AsyncMock(return_value=False)
        if missing:
            lk.room.get_participant = AsyncMock(side_effect=RuntimeError('not_found'))
        else:
            lk.room.get_participant = AsyncMock(return_value=MagicMock(tracks=[MagicMock(source=s, muted=False) for s in tracks or []]))
        return patch('badges.api.LiveKitAPI', return_value=lk)

    def test_heartbeat_without_call_only_records_active_day(self):
        with self.remote():
            r = self.client.post('/api/badges/heartbeat', json={}, headers=AUTH)
        self.assertEqual(r.status_code, 200); self.assertEqual(self.events, ['active_day'])

    def test_call_minutes_require_livekit_confirmation(self):
        with self.remote(), self.livekit(missing=True):
            self.client.post('/api/badges/heartbeat', json={'channel_id': TARGET, 'watch_party': True}, headers=AUTH)
        self.assertEqual(self.events, ['active_day'], 'quem não está na sala não ganha minutos')

    def test_screen_and_camera_counted_from_published_tracks(self):
        with self.remote(), self.livekit([lkapi.TrackSource.SCREEN_SHARE, lkapi.TrackSource.CAMERA]):
            r = self.client.post('/api/badges/heartbeat', json={'channel_id': TARGET}, headers=AUTH)
        self.assertEqual(self.events, ['active_day', 'call_minute', 'screenshare_minute', 'camera_minute']); self.assertEqual(r.json()['unlocked'], 2)

    def test_client_cannot_inject_counts(self):
        with self.remote():
            r = self.client.post('/api/badges/heartbeat', json={'call_minutes': 9999, 'event_amount': 50}, headers=AUTH)
        self.assertEqual(r.status_code, 200); self.assertEqual(self.events, ['active_day'])

    def test_anonymous_is_rejected(self):
        self.assertEqual(self.client.post('/api/badges/heartbeat', json={}).status_code, 401)
        self.assertEqual(self.client.get('/api/badges/' + TARGET).status_code, 401)

    def test_state_is_read_from_database(self):
        with self.remote():
            r = self.client.get('/api/badges/' + TARGET, headers=AUTH)
        self.assertEqual(r.json()['showcase'], ['dono'])

    def test_migration_guards(self):
        sql = open('supabase/migrations/20261023000500_profile_studio_badges.sql', encoding='utf-8').read()
        for needle in ('exclusivo dos administradores', "'50e5ae56-07e3-4023-9461-f653997fcc2e'", 'transport_hash', 'security definer', 'profile_notes_own'):
            self.assertIn(needle, sql)
        self.assertNotIn('kalioptha', open('static/cosmetics.js', encoding='utf-8').read() + open('static/badges-catalog.js', encoding='utf-8').read())
