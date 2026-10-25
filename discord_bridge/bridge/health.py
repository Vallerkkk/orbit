"""Servidor HTTP de saúde: GET /health (JSON) e GET /metrics (formato Prometheus)."""
from typing import Callable

from aiohttp import web

from .manager import BridgeManager


def render_metrics(manager: BridgeManager, discord_ready: bool) -> str:
    lines = [
        '# HELP bridge_discord_gateway_ready 1 se o bot está conectado ao gateway do Discord.',
        '# TYPE bridge_discord_gateway_ready gauge',
        f'bridge_discord_gateway_ready {int(discord_ready)}',
        '# TYPE bridge_active_bridges gauge',
        f'bridge_active_bridges {len(manager.sessions)}',
    ]
    gauges = {'speakers': 'bridge_speakers', 'buffer_ms': 'bridge_buffer_ms', 'jitter_ms': 'bridge_jitter_ms',
              'bridge_latency_ms': 'bridge_latency_ms', 'loss_ratio': 'bridge_loss_ratio'}
    counters = {'frames_in': 'bridge_frames_in_total', 'frames_out': 'bridge_frames_out_total',
                'underruns': 'bridge_underruns_total', 'drift_drops': 'bridge_drift_drops_total',
                'overflow_drops': 'bridge_overflow_drops_total'}
    samples: dict[str, list[str]] = {}
    for session in manager.sessions.values():
        base = f'bridge="{session.key}",room="{session.room_name}"'
        for side, link in (('livekit', session.livekit), ('discord', session.discord)):
            samples.setdefault('bridge_side_connected', []).append(
                f'bridge_side_connected{{{base},side="{side}"}} {int(link.connected)}')
            samples.setdefault('bridge_reconnects_total', []).append(
                f'bridge_reconnects_total{{{base},side="{side}"}} {link.reconnects}')
        for direction, stats in session.direction_stats().items():
            labels = f'{{{base},direction="{direction}"}}'
            for key, name in {**gauges, **counters}.items():
                samples.setdefault(name, []).append(f'{name}{labels} {stats[key]}')
        dave = session.discord.status().get('dave_failures', 0)
        samples.setdefault('bridge_dave_decrypt_failures_total', []).append(
            f'bridge_dave_decrypt_failures_total{{{base}}} {dave}')
    kinds = {name: 'gauge' for name in gauges.values()} | {name: 'counter' for name in counters.values()}
    kinds |= {'bridge_side_connected': 'gauge', 'bridge_reconnects_total': 'counter',
              'bridge_dave_decrypt_failures_total': 'counter'}
    for name, rows in samples.items():
        lines.append(f'# TYPE {name} {kinds[name]}')
        lines.extend(rows)
    return '\n'.join(lines) + '\n'


class HealthServer:
    def __init__(self, manager: BridgeManager, discord_ready: Callable[[], bool], host: str, port: int):
        self._manager = manager
        self._discord_ready = discord_ready
        self._host = host
        self._port = port
        self._runner: web.AppRunner | None = None

    async def start(self) -> None:
        app = web.Application()
        app.router.add_get('/health', self._health)
        app.router.add_get('/metrics', self._metrics)
        self._runner = web.AppRunner(app, access_log=None)
        await self._runner.setup()
        await web.TCPSite(self._runner, self._host, self._port).start()

    async def stop(self) -> None:
        if self._runner:
            await self._runner.cleanup()

    async def _health(self, request: web.Request) -> web.Response:
        ready = self._discord_ready()
        body = {'status': 'ok' if ready else 'starting', 'discord_gateway': ready,
                'bridges': [s.status() for s in self._manager.sessions.values()]}
        return web.json_response(body, status=200 if ready else 503)

    async def _metrics(self, request: web.Request) -> web.Response:
        return web.Response(text=render_metrics(self._manager, self._discord_ready()),
                            content_type='text/plain', charset='utf-8')
