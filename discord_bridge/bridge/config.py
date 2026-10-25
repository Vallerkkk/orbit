"""Configuração da ponte via variáveis de ambiente (.env).

Ordem de leitura: variáveis já definidas no processo (Docker/compose) >
discord_bridge/.env > .env da raiz do projeto (o mesmo que o app usa).
"""
import os
import re
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

from ..livekit_side.link import LiveKitCredentials

PACKAGE_DIR = Path(__file__).resolve().parent.parent
UUID_RE = re.compile(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class Config:
    discord_token: str
    livekit: LiveKitCredentials
    room_template: str
    health_host: str
    health_port: int
    log_level: str
    log_format: str
    max_bridges: int
    jitter_min_frames: int
    jitter_max_frames: int
    stats_interval: float

    def room_for(self, channel_id: str | None) -> str:
        """Nome da sala LiveKit. Com `{channel_id}` no template, exige o UUID do canal do Órbita."""
        if '{channel_id}' not in self.room_template:
            return self.room_template
        channel_id = (channel_id or '').strip()
        if not UUID_RE.match(channel_id):
            raise ConfigError('Informe o UUID do canal de voz do Órbita (ex.: 3f2b...-...).')
        return self.room_template.format(channel_id=channel_id.lower())

    @property
    def needs_channel_id(self) -> bool:
        return '{channel_id}' in self.room_template


def _int(env, name: str, default: int, minimum: int = 0) -> int:
    raw = env.get(name, '').strip()
    try:
        value = int(raw) if raw else default
    except ValueError:
        raise ConfigError(f'{name} precisa ser um número inteiro (recebido {raw!r}).')
    if value < minimum:
        raise ConfigError(f'{name} precisa ser >= {minimum}.')
    return value


def from_env(env=None, *, load_files: bool = True) -> Config:
    if load_files:
        load_dotenv(PACKAGE_DIR / '.env', override=False)
        load_dotenv(PACKAGE_DIR.parent / '.env', override=False)
    env = os.environ if env is None else env
    get = lambda name, default='': (env.get(name) or default).strip()

    token = get('DISCORD_TOKEN') or get('DISCORD_BOT_TOKEN')
    missing = [name for name, value in [('DISCORD_TOKEN', token), ('LIVEKIT_URL', get('LIVEKIT_URL')),
                                        ('LIVEKIT_API_KEY', get('LIVEKIT_API_KEY')),
                                        ('LIVEKIT_API_SECRET', get('LIVEKIT_API_SECRET'))] if not value]
    if missing:
        raise ConfigError('Faltam variáveis no .env: ' + ', '.join(missing))

    url = get('LIVEKIT_URL')
    if not url.startswith(('ws://', 'wss://', 'http://', 'https://')):
        raise ConfigError('LIVEKIT_URL deve começar com wss:// (Cloud) ou ws:// (self-hosted local).')

    log_format = get('LOG_FORMAT', 'json').lower()
    if log_format not in ('json', 'console'):
        raise ConfigError('LOG_FORMAT deve ser json ou console.')

    min_frames = _int(env, 'JITTER_MIN_FRAMES', 1, minimum=1)
    max_frames = _int(env, 'JITTER_MAX_FRAMES', 6, minimum=1)
    if min_frames > max_frames:
        raise ConfigError('JITTER_MIN_FRAMES não pode ser maior que JITTER_MAX_FRAMES.')

    return Config(
        discord_token=token,
        livekit=LiveKitCredentials(url, get('LIVEKIT_API_KEY'), get('LIVEKIT_API_SECRET')),
        room_template=get('LIVEKIT_ROOM_NAME', 'channel-{channel_id}'),
        health_host=get('HEALTH_HOST', '127.0.0.1'),
        health_port=_int(env, 'HEALTH_PORT', 8080),
        log_level=get('LOG_LEVEL', 'INFO').upper(),
        log_format=log_format,
        max_bridges=_int(env, 'MAX_BRIDGES', 10, minimum=1),
        jitter_min_frames=min_frames,
        jitter_max_frames=max_frames,
        stats_interval=float(_int(env, 'STATS_LOG_INTERVAL', 30, minimum=0)),
    )
