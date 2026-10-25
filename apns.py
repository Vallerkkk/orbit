"""Envio de notificações para o app iOS (Apple Push Notification service).

A Apple exige HTTP/2 e um token JWT (ES256) assinado com a chave .p8 do
desenvolvedor. O token é reaproveitado por 40 minutos: a Apple recusa tokens
com mais de 1 hora e bloqueia (TooManyProviderTokenUpdates) quem troca o token
mais de uma vez a cada 20 minutos.
"""
import re
import time

import httpx
import jwt

APNS_KEYS = ('APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_PRIVATE_KEY', 'APNS_BUNDLE_ID')
TOKEN_TTL = 40 * 60
DEVICE_TOKEN = re.compile(r'^[0-9a-f]{64}$')


def configured(settings):
    return all(settings.get(key) for key in APNS_KEYS)


def alert_payload(job_payload):
    """Converte o payload da fila (title/body/url/tag) no formato do APNs."""
    extra = {k: v for k, v in job_payload.items() if k not in ('title', 'body') and isinstance(k, str)}
    return {'aps': {'alert': {'title': str(job_payload.get('title') or 'Órbita')[:120],
                              'body': str(job_payload.get('body') or 'Você tem uma nova atividade.')[:240]},
                    'sound': 'default', 'thread-id': str(job_payload.get('tag') or 'orbita')[:64]},
            **extra}


class APNsSender:
    def __init__(self):
        self._token = None
        self._token_at = 0.0
        self._token_key = None
        self._client = None

    def _provider_token(self, settings):
        key_id = settings['APNS_KEY_ID']
        if self._token and self._token_key == key_id and time.time() - self._token_at < TOKEN_TTL:
            return self._token
        private_key = settings['APNS_PRIVATE_KEY'].replace('\\n', '\n')
        now = int(time.time())
        self._token = jwt.encode({'iss': settings['APNS_TEAM_ID'], 'iat': now}, private_key,
                                 algorithm='ES256', headers={'kid': key_id})
        self._token_at, self._token_key = now, key_id
        return self._token

    def _http(self):
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(http2=True, timeout=httpx.Timeout(10, connect=5),
                                             limits=httpx.Limits(max_connections=10))
        return self._client

    async def send(self, settings, device_token, job_payload):
        """Retorna 'ok', 'expired' (aparelho não existe mais) ou 'retry'."""
        if not DEVICE_TOKEN.match(device_token or ''):
            return 'expired'
        production = str(settings.get('APNS_PRODUCTION', '')).lower() == 'true'
        host = 'api.push.apple.com' if production else 'api.sandbox.push.apple.com'
        try:
            reply = await self._http().post(
                f'https://{host}/3/device/{device_token}',
                headers={'authorization': 'bearer ' + self._provider_token(settings),
                         'apns-topic': settings['APNS_BUNDLE_ID'], 'apns-push-type': 'alert',
                         'apns-priority': '10', 'apns-expiration': str(int(time.time()) + 300)},
                json=alert_payload(job_payload))
        except httpx.HTTPError:
            return 'retry'
        if reply.status_code == 200:
            return 'ok'
        reason = ''
        try:
            reason = reply.json().get('reason', '')
        except (ValueError, AttributeError):
            pass
        if reply.status_code == 410 or reason in ('BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'):
            return 'expired'
        if reason in ('ExpiredProviderToken', 'InvalidProviderToken'):
            self._token = None  # gera um novo no próximo envio
        return 'retry'

    async def close(self):
        if self._client is not None:
            await self._client.aclose()
