import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import astro_call as astro
import test_astro as fixture


class CloeAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        async def user():
            return ({'id': fixture.UID}, {})
        astro.install_astro(self.app, user, lambda: dict(
            LIVEKIT_URL='test', LIVEKIT_API_KEY='test', LIVEKIT_API_SECRET='test'))
        self.client = TestClient(self.app)
        self.livekit = patch.object(astro.api, 'LiveKitAPI', fixture.FakeLiveKit)
        self.livekit.start()
        self.addCleanup(self.livekit.stop)
        fixture.FakeLiveKit.allowed = fixture.FakeLiveKit.can_publish = True
        astro.reset_daily_usage()

    def test_departed_participant_cannot_read_new_events_after_a_cached_success(self):
        response = self.client.get('/api/astro/' + fixture.ROOM)
        self.assertEqual(response.status_code, 200)
        fixture.FakeLiveKit.allowed = False
        self.app.state.astro_calls[fixture.ROOM].add('transcript', 'Participante', 'Conversa privada nova')
        response = self.client.get('/api/astro/' + fixture.ROOM)
        self.assertEqual(response.status_code, 403)
        self.assertNotIn('Conversa privada nova', response.text)

    def test_revoked_publish_permission_cannot_submit_questions_after_a_cached_success(self):
        self.assertEqual(self.client.get('/api/astro/' + fixture.ROOM).status_code, 200)
        fixture.FakeLiveKit.can_publish = False
        with patch.object(astro, 'groq_json', AsyncMock(return_value={
                'choices': [{'message': {'content': 'Resposta indevida'}}]})):
            response = self.client.post('/api/astro/' + fixture.ROOM + '/ask',
                                        json={'text': 'Qual foi o combinado?'})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(list(self.app.state.astro_calls[fixture.ROOM].events), [])

    def test_livekit_failure_does_not_reuse_a_previous_positive_authorization(self):
        self.assertEqual(self.client.get('/api/astro/' + fixture.ROOM).status_code, 200)
        with patch.object(fixture.FakeLiveKit, 'get_participant', AsyncMock(side_effect=RuntimeError('offline'))):
            response = self.client.get('/api/astro/' + fixture.ROOM)
        self.assertEqual(response.status_code, 403)
