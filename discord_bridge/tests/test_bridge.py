import asyncio

import pytest

from discord_bridge.audio.mixer import Mixer
from discord_bridge.bridge import config as config_mod
from discord_bridge.bridge.health import render_metrics
from discord_bridge.bridge.manager import BridgeError, BridgeManager
from discord_bridge.bridge.session import BridgeSession

from .conftest import frame_of

UUID = '3f2b8c1e-0a4d-4e5f-9b6c-7d8e9f0a1b2c'
BASE_ENV = {'DISCORD_TOKEN': 't', 'LIVEKIT_URL': 'wss://x.livekit.cloud',
            'LIVEKIT_API_KEY': 'k', 'LIVEKIT_API_SECRET': 's'}


class FakeLink:
    def __init__(self, connects=True):
        self.connected = False
        self.reconnects = 0
        self._connects = connects
        self.started = self.stopped = False

    async def start(self):
        self.started = True
        self.connected = self._connects

    async def stop(self):
        self.stopped = True
        self.connected = False

    async def wait_connected(self, timeout):
        return self.connected

    def status(self):
        return {'connected': self.connected, 'reconnects': self.reconnects}


def make_session(key='g1', livekit_ok=True):
    return BridgeSession(key, room_name=f'channel-{UUID}', to_livekit=Mixer('a'), to_discord=Mixer('b'),
                         livekit=FakeLink(livekit_ok), discord=FakeLink(), stats_interval=0)


# --- config ---------------------------------------------------------------

def test_config_accepts_legacy_token_name_and_defaults():
    env = dict(BASE_ENV)
    env['DISCORD_BOT_TOKEN'] = env.pop('DISCORD_TOKEN')
    cfg = config_mod.from_env(env, load_files=False)
    assert cfg.discord_token == 't'
    assert cfg.room_for(UUID.upper()) == f'channel-{UUID}'
    assert cfg.health_port == 8080 and cfg.max_bridges == 10


def test_config_lists_missing_vars():
    with pytest.raises(config_mod.ConfigError, match='LIVEKIT_API_SECRET'):
        config_mod.from_env({'DISCORD_TOKEN': 't', 'LIVEKIT_URL': 'ws://l', 'LIVEKIT_API_KEY': 'k'},
                            load_files=False)


def test_room_template_requires_uuid_unless_fixed():
    cfg = config_mod.from_env(BASE_ENV, load_files=False)
    with pytest.raises(config_mod.ConfigError):
        cfg.room_for('not-a-uuid')
    fixed = config_mod.from_env({**BASE_ENV, 'LIVEKIT_ROOM_NAME': 'sala-fixa'}, load_files=False)
    assert fixed.room_for(None) == 'sala-fixa' and not fixed.needs_channel_id


def test_config_rejects_bad_jitter_bounds():
    with pytest.raises(config_mod.ConfigError):
        config_mod.from_env({**BASE_ENV, 'JITTER_MIN_FRAMES': '5', 'JITTER_MAX_FRAMES': '2'}, load_files=False)


# --- session / manager -----------------------------------------------------

def test_session_reports_partial_connection_and_stops_both_sides():
    async def scenario():
        session = make_session(livekit_ok=False)
        connected = await session.start(connect_timeout=0.01)
        assert connected == {'livekit': False, 'discord': True}
        session.to_livekit.push('user', frame_of(1))
        await session.stop()
        assert session.livekit.stopped and session.discord.stopped
        session.to_livekit.push('user', frame_of(1))     # entrada fechada após stop
        assert session.to_livekit.snapshot().sources == 0
    asyncio.run(scenario())


def test_manager_one_bridge_per_guild_and_limit():
    async def scenario():
        manager = BridgeManager(max_bridges=2)
        await manager.enter('g1', make_session)
        with pytest.raises(BridgeError, match='leave'):
            await manager.enter('g1', make_session)
        await manager.enter('g2', make_session)
        with pytest.raises(BridgeError, match='Limite'):
            await manager.enter('g3', make_session)
        assert await manager.leave('g1') is True
        assert await manager.leave('g1') is False
        await manager.stop_all()
        assert manager.sessions == {}
    asyncio.run(scenario())


def test_metrics_render_prometheus_text():
    async def scenario():
        manager = BridgeManager(max_bridges=5)
        session, _ = await manager.enter('g1', make_session)
        session.to_discord.push('track', frame_of(3) * 3)
        text = render_metrics(manager, discord_ready=True)
        assert 'bridge_discord_gateway_ready 1' in text
        assert 'bridge_active_bridges 1' in text
        assert 'bridge_side_connected{bridge="g1",room="channel-' in text
        assert 'bridge_frames_in_total{bridge="g1"' in text and 'direction="livekit_to_discord"} 3' in text
        assert text.count('# TYPE bridge_latency_ms gauge') == 1
        await manager.stop_all()
    asyncio.run(scenario())
