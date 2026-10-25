"""Uma ponte ativa: um canal de voz do Discord <-> uma sala LiveKit do Órbita.

    Discord (usuários) ──PCM por usuário──▶ to_livekit (Mixer) ──20ms──▶ LiveKitLink.publish
    LiveKit (tracks)   ──PCM por track────▶ to_discord (Mixer) ──20ms──▶ Discord AudioPlayer

Os dois links são independentes: se um cair, o outro continua e o que caiu
reconecta sozinho. A sessão só junta os dois, expõe status/métricas e faz o
shutdown ordenado.
"""
import asyncio
import time
from typing import Protocol

import structlog

from ..audio.format import FRAME_MS
from ..audio.mixer import Mixer

log = structlog.get_logger('bridge.session')

DRAIN_LIMIT_S = 0.5


class VoiceLink(Protocol):
    connected: bool
    reconnects: int

    async def start(self) -> None: ...
    async def stop(self) -> None: ...
    async def wait_connected(self, timeout: float) -> bool: ...
    def status(self) -> dict: ...


class BridgeSession:
    def __init__(self, key, *, room_name: str, to_livekit: Mixer, to_discord: Mixer,
                 livekit: VoiceLink, discord: VoiceLink, stats_interval: float = 30.0):
        self.key = key
        self.room_name = room_name
        self.to_livekit = to_livekit
        self.to_discord = to_discord
        self.livekit = livekit
        self.discord = discord
        self.started_at = time.time()
        self._stats_interval = stats_interval
        self._stats_task: asyncio.Task | None = None
        self._log = log.bind(bridge=str(key), room=room_name)

    async def start(self, connect_timeout: float = 15.0) -> dict:
        """Inicia os dois lados e espera a primeira conexão de cada um (até o timeout).
        Mesmo se um lado não conectar a tempo, ele segue tentando em segundo plano."""
        await self.livekit.start()
        await self.discord.start()
        lk_ok, dc_ok = await asyncio.gather(self.livekit.wait_connected(connect_timeout),
                                            self.discord.wait_connected(connect_timeout))
        if self._stats_interval > 0:
            self._stats_task = asyncio.create_task(self._stats_loop(), name=f'stats-{self.key}')
        self._log.info('bridge_started', livekit_connected=lk_ok, discord_connected=dc_ok)
        return {'livekit': lk_ok, 'discord': dc_ok}

    async def stop(self, *, drain: bool = True) -> None:
        """Shutdown: para de aceitar áudio novo, deixa o que está bufferizado sair, fecha os dois lados."""
        self.to_livekit.close_input()
        self.to_discord.close_input()
        if drain:
            pending_ms = max(self.to_livekit.snapshot().buffered_ms, self.to_discord.snapshot().buffered_ms)
            await asyncio.sleep(min(DRAIN_LIMIT_S, pending_ms / 1000 + FRAME_MS / 1000))
        if self._stats_task:
            self._stats_task.cancel()
        await asyncio.gather(self.discord.stop(), self.livekit.stop(), return_exceptions=True)
        self.to_livekit.clear()
        self.to_discord.clear()
        self._log.info('bridge_stopped', uptime_s=round(time.time() - self.started_at))

    def direction_stats(self) -> dict:
        out = {}
        for direction, mixer in (('discord_to_livekit', self.to_livekit), ('livekit_to_discord', self.to_discord)):
            snap = mixer.snapshot()
            t = snap.totals
            lost = t.underruns + t.drift_drops + t.overflow_drops
            out[direction] = {
                'speakers': snap.sources,
                'buffer_ms': snap.buffered_ms,
                'jitter_ms': round(snap.jitter_ms, 2),
                # atraso que a ponte adiciona: buffer + 1 frame de mixagem (rede não incluída)
                'bridge_latency_ms': snap.buffered_ms + FRAME_MS,
                'frames_in': t.frames_in,
                'frames_out': t.frames_out,
                'underruns': t.underruns,
                'drift_drops': t.drift_drops,
                'overflow_drops': t.overflow_drops,
                'loss_ratio': round(lost / t.frames_in, 4) if t.frames_in else 0.0,
            }
        return out

    def status(self) -> dict:
        return {'key': str(self.key), 'room': self.room_name, 'uptime_s': round(time.time() - self.started_at),
                'livekit': self.livekit.status(), 'discord': self.discord.status(),
                'audio': self.direction_stats()}

    async def _stats_loop(self) -> None:
        while True:
            await asyncio.sleep(self._stats_interval)
            self._log.info('bridge_stats', livekit_connected=self.livekit.connected,
                           discord_connected=self.discord.connected, **self.direction_stats())
