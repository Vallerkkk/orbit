"""Push do app iOS (APNs): payload, token do provedor, respostas da Apple e migração."""
import asyncio
import unittest
from pathlib import Path

import httpx
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pydantic import ValidationError

import apns
from community_features import IOSPushRegistration

ROOT = Path(__file__).resolve().parents[1]
TOKEN = 'ab' * 32


def private_key_pem():
    key = ec.generate_private_key(ec.SECP256R1())
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption()).decode()


def settings(**extra):
    base = {'APNS_KEY_ID': 'KEY123', 'APNS_TEAM_ID': 'TEAM456', 'APNS_PRIVATE_KEY': private_key_pem(),
            'APNS_BUNDLE_ID': 'app.orbita.ios', 'APNS_PRODUCTION': ''}
    base.update(extra)
    return base


def sender_with(handler):
    sender = apns.APNsSender()
    sender._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return sender


class IOSPushTests(unittest.TestCase):
    def test_registration_accepts_only_apns_tokens(self):
        self.assertEqual(IOSPushRegistration(device_token=TOKEN.upper()).device_token, TOKEN.upper())
        for bad in ('', 'ab' * 31, 'zz' * 32, TOKEN + '00'):
            with self.assertRaises(ValidationError):
                IOSPushRegistration(device_token=bad)

    def test_alert_payload_moves_title_and_body_into_aps(self):
        payload = apns.alert_payload({'title': 'Oi', 'body': 'Mensagem', 'url': '/?dm=1', 'tag': 'orbita-x'})
        self.assertEqual(payload['aps']['alert'], {'title': 'Oi', 'body': 'Mensagem'})
        self.assertEqual(payload['url'], '/?dm=1')
        self.assertNotIn('title', payload)
        self.assertNotIn('body', payload)

    def test_provider_token_is_cached_and_signed(self):
        config = settings()
        sender = apns.APNsSender()
        first = sender._provider_token(config)
        self.assertEqual(first, sender._provider_token(config))
        header = jwt.get_unverified_header(first)
        self.assertEqual((header['alg'], header['kid']), ('ES256', 'KEY123'))
        self.assertEqual(jwt.decode(first, options={'verify_signature': False})['iss'], 'TEAM456')
        sender._token_at -= apns.TOKEN_TTL + 1
        self.assertIsNotNone(sender._provider_token(config))

    def test_send_maps_apple_responses(self):
        cases = [(200, {}, 'ok'), (410, {'reason': 'Unregistered'}, 'expired'),
                 (400, {'reason': 'BadDeviceToken'}, 'expired'), (429, {'reason': 'TooManyRequests'}, 'retry')]
        for status, body, expected in cases:
            seen = {}

            def handler(request, status=status, body=body):
                seen['url'], seen['topic'] = str(request.url), request.headers['apns-topic']
                return httpx.Response(status, json=body)

            outcome = asyncio.run(sender_with(handler).send(settings(), TOKEN, {'title': 'Oi'}))
            self.assertEqual(outcome, expected, status)
            self.assertEqual(seen['url'], f'https://api.sandbox.push.apple.com/3/device/{TOKEN}')
            self.assertEqual(seen['topic'], 'app.orbita.ios')

    def test_expired_provider_token_forces_new_token(self):
        sender = sender_with(lambda request: httpx.Response(403, json={'reason': 'ExpiredProviderToken'}))
        self.assertEqual(asyncio.run(sender.send(settings(), TOKEN, {})), 'retry')
        self.assertIsNone(sender._token)

    def test_production_host_and_invalid_token(self):
        seen = {}
        sender = sender_with(lambda request: seen.setdefault('host', request.url.host) and httpx.Response(200))
        asyncio.run(sender.send(settings(APNS_PRODUCTION='true'), TOKEN, {}))
        self.assertEqual(seen['host'], 'api.push.apple.com')
        self.assertEqual(asyncio.run(apns.APNsSender().send(settings(), 'nope', {})), 'expired')

    def test_migration_keeps_one_job_per_event_and_scoped_cleanup(self):
        sql = (ROOT / 'supabase/migrations/20261025010000_ios_push_notifications.sql').read_text(encoding='utf-8')
        self.assertEqual(sql.count('orbita_private.has_push_device(recipient.id)'), 1)
        self.assertEqual(sql.count('orbita_private.has_push_device(target.id)'), 1)
        self.assertNotIn('ios_message_activity', sql)  # nenhum gatilho paralelo que duplicaria o push
        self.assertIn('limit 5', sql)
        self.assertIn("interval '90 seconds'", sql)
        self.assertIn('delete from public.ios_push_subscriptions s using orbita_private.push_jobs j', sql)
        self.assertIn('on conflict(device_token) do update set user_id=excluded.user_id', sql)


if __name__ == '__main__':
    unittest.main()
