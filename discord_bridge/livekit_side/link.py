"""Lado LiveKit da ponte: entra na sala da chamada do Órbita como participante,
publica o áudio vindo do Discord e joga o áudio de cada participante do site no
mixer que alimenta o Discord.

Usa o SDK realtime `livekit` (rtc) diretamente — é a mesma base do framework
livekit-agents, mas sem o worker/dispatch de jobs, que não faz sentido para um
bot acionado por comando do Discord. Nenhum STT/LLM/TTS envolvido.

Se a conexão cair (e o próprio SDK desistir de reconectar), um supervisor cria
uma sala nova com backoff exponencial; o lado Discord continua funcionando.
"""
import asyncio
import logging
from dataclasses import dataclass
from datetime import timedelta

import aiohttp
import structlog
from livekit import api, rtc

from ..audio.format import CHANNELS, FRAME_MS, FRAME_SECONDS, SAMPLE_RATE, SAMPLES_PER_FRAME, to_bridge_format
from ..audio.mixer import Mixer
from ..bridge.backoff import Backoff

log = structlog.get_logger('bridge.livekit')


@dataclass(frozen=True)
class LiveKitCredentials:
    url: str
    api_key: str
    api_secret: str


def make_token(creds: LiveKitCredentials, room_name: str, identity: str, name: str) -> str:
    return (api.AccessToken(creds.api_key, creds.api_secret)
            .with_identity(identity).with_name(name)
            .with_ttl(timedelta(hours=24))
            .with_grants(api.VideoGrants(room_join=True, room=room_name,
                                         can_publish=True, can_subscribe=True, can_publish_data=False))
            .to_jwt())


class LiveKitLink:
    # fila interna do AudioSource: só o suficiente para absorver o agendamento do loop
    SOURCE_QUEUE_MS = 100

    def __init__(self, creds: LiveKitCredentials, room_name: str, identity: str, display_name: str, *,
                 to_discord: Mixer, from_discord: Mixer, backoff: Backoff | None = None):
        self._creds = creds
        self.room_name = room_name
        self.identity = identity
        self._display_name = display_name
        self._to_discord = to_discord
        self._from_discord = from_discord
        self._backoff = backoff or Backoff()
        self._log = log.bind(room=room_name)

        self._room: rtc.Room | None = None
        self._source: rtc.AudioSource | None = None
        self._tasks: set[asyncio.Task] = set()
        self._stream_tasks: dict[str, asyncio.Task] = {}
        self._dropped = asyncio.Event()
        self._connected_once = asyncio.Event()
        self._supervisor: asyncio.Task | None = None
        self._stopping = False

        self.connected = False
        self.reconnects = 0
        self.last_error: str | None = None
        self.remote_participants = 0

    async def start(self) -> None:
        self._supervisor = asyncio.create_task(self._supervise(), name=f'livekit-{self.room_name}')

    async def wait_connected(self, timeout: float) -> bool:
        try:
            await asyncio.wait_for(self._connected_once.wait(), timeout)
            return True
        except asyncio.TimeoutError:
            return False

    async def stop(self) -> None:
        self._stopping = True
        self._dropped.set()
        if self._supervisor:
            self._supervisor.cancel()
            await asyncio.gather(self._supervisor, return_exceptions=True)
        await self._teardown()

    async def _supervise(self) -> None:
        while not self._stopping:
            try:
                await self._connect_once()
                self._backoff.reset()
                await self._dropped.wait()
                if not self._stopping:
                    self._log.warning('livekit_dropped')
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.last_error = repr(exc)
                self._log.warning('livekit_connect_failed', error=self.last_error)
            await self._teardown()
            if self._stopping:
                break
            delay = self._backoff.next_delay()
            self.reconnects += 1
            self._log.info('livekit_reconnect_scheduled', delay_s=round(delay, 2), attempt=self._backoff.attempts)
            await asyncio.sleep(delay)

    async def _server_reachable(self) -> None:
        """Falha rápido se o servidor não responde HTTP.

        No livekit 1.1.21, quando o primeiro `room.connect` só dá certo numa das
        tentativas internas do SDK, a sala fica "conectada" mas sem mídia nos dois
        sentidos (reproduzido com o teste local). Checando antes, a falha cai no
        nosso supervisor, que tenta de novo com uma sala nova.
        """
        url = self._creds.url.replace('wss://', 'https://', 1).replace('ws://', 'http://', 1)
        timeout = aiohttp.ClientTimeout(total=5)
        async with aiohttp.ClientSession(timeout=timeout) as http:
            async with http.get(url):
                pass  # qualquer status HTTP serve: só queremos saber se há alguém ouvindo

    async def _connect_once(self) -> None:
        self._dropped.clear()
        await self._server_reachable()
        room = self._room = rtc.Room()
        room.on('track_subscribed', self._on_track_subscribed)
        room.on('track_unsubscribed', self._on_track_unsubscribed)
        room.on('participant_connected', lambda *_: self._count_participants())
        room.on('participant_disconnected', lambda *_: self._count_participants())
        room.on('disconnected', lambda *_: self._dropped.set())
        room.on('reconnecting', lambda: self._log.info('livekit_reconnecting'))
        room.on('reconnected', lambda: self._log.info('livekit_reconnected'))

        token = make_token(self._creds, self.room_name, self.identity, self._display_name)
        await room.connect(self._creds.url, token, options=rtc.RoomOptions(auto_subscribe=True))

        self._source = rtc.AudioSource(SAMPLE_RATE, CHANNELS, queue_size_ms=self.SOURCE_QUEUE_MS)
        track = rtc.LocalAudioTrack.create_audio_track('discord-bridge', self._source)
        await room.local_participant.publish_track(
            track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
        self._spawn(self._publish_loop(self._source), 'publish')

        self.connected = True
        self.last_error = None
        self._count_participants()
        self._connected_once.set()
        self._log.info('livekit_connected', identity=self.identity, participants=self.remote_participants)

    async def _teardown(self) -> None:
        self.connected = False
        tasks = list(self._tasks) + list(self._stream_tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()
        self._stream_tasks.clear()
        room, self._room = self._room, None
        if room is not None:
            try:
                await room.disconnect()
            except Exception:
                logging.getLogger(__name__).debug('erro ao desconectar sala', exc_info=True)
        if self._source is not None:
            await self._source.aclose()
            self._source = None

    def _spawn(self, coro, name: str) -> asyncio.Task:
        task = asyncio.create_task(coro, name=f'livekit-{name}-{self.room_name}')
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    def _count_participants(self) -> None:
        self.remote_participants = len(self._room.remote_participants) if self._room else 0

    async def _publish_loop(self, source: rtc.AudioSource) -> None:
        """A cada 20ms (relógio próprio, sem acumular atraso), publica um frame mixado do Discord."""
        loop = asyncio.get_running_loop()
        next_tick = loop.time()
        while True:
            frame = rtc.AudioFrame(self._from_discord.pull_frame(), SAMPLE_RATE, CHANNELS, SAMPLES_PER_FRAME)
            await source.capture_frame(frame)
            next_tick += FRAME_SECONDS
            delay = next_tick - loop.time()
            if delay < -0.2:  # loop ficou travado: realinha em vez de disparar uma rajada
                next_tick = loop.time()
                delay = 0
            await asyncio.sleep(max(0.0, delay))

    def _on_track_subscribed(self, track, publication, participant) -> None:
        if track.kind != rtc.TrackKind.KIND_AUDIO:
            return
        stream = rtc.AudioStream(track, sample_rate=SAMPLE_RATE, num_channels=CHANNELS,
                                 frame_size_ms=FRAME_MS, capacity=50)
        self._log.info('livekit_track_subscribed', participant=participant.identity, track=publication.sid)
        task = asyncio.create_task(self._consume(stream, publication.sid), name=f'livekit-recv-{publication.sid}')
        self._stream_tasks[publication.sid] = task

    def _on_track_unsubscribed(self, track, publication, participant) -> None:
        task = self._stream_tasks.pop(publication.sid, None)
        if task:
            task.cancel()
        self._to_discord.remove(publication.sid)

    async def _consume(self, stream: rtc.AudioStream, sid: str) -> None:
        try:
            async for event in stream:
                frame = event.frame
                pcm = to_bridge_format(bytes(frame.data), frame.sample_rate, frame.num_channels)
                self._to_discord.push(sid, pcm)
        finally:
            await stream.aclose()

    def status(self) -> dict:
        return {'connected': self.connected, 'room': self.room_name, 'participants': self.remote_participants,
                'reconnects': self.reconnects, 'last_error': self.last_error}
