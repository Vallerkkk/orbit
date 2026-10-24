"""Lado LiveKit da ponte: entra na sala da chamada do Órbita como um participante,
publica o áudio vindo do Discord e encaminha o áudio dos participantes do site
para o mixer que alimenta o Discord."""
import asyncio
import logging
from datetime import timedelta

from livekit import api, rtc

from .audio_mixer import CHANNELS, SAMPLE_RATE, SAMPLES_PER_FRAME, RollingMixer

log = logging.getLogger('orbita.bridge.livekit')


def make_bot_token(api_key: str, api_secret: str, room_name: str, identity: str) -> str:
    return (api.AccessToken(api_key, api_secret)
            .with_identity(identity).with_name('Ponte Discord')
            .with_ttl(timedelta(hours=6))
            .with_grants(api.VideoGrants(room_join=True, room=room_name,
                can_publish=True, can_subscribe=True, can_publish_data=False))
            .to_jwt())


class LiveKitSide:
    """Uma conexão à sala LiveKit `room_name`, publicando `from_discord` e
    despejando o áudio recebido dos participantes do site em `to_discord`."""

    def __init__(self, livekit_url: str, api_key: str, api_secret: str,
                 room_name: str, identity: str, to_discord: RollingMixer):
        self._url = livekit_url
        self._api_key = api_key
        self._api_secret = api_secret
        self._room_name = room_name
        self._identity = identity
        self.to_discord = to_discord
        self.room = rtc.Room()
        self._source = rtc.AudioSource(SAMPLE_RATE, CHANNELS)
        self._publish_task: asyncio.Task | None = None
        self._stream_tasks: dict[str, asyncio.Task] = {}

        self.room.on('track_subscribed', self._on_track_subscribed)
        self.room.on('track_unsubscribed', self._on_track_unsubscribed)

    async def connect(self):
        token = make_bot_token(self._api_key, self._api_secret, self._room_name, self._identity)
        await self.room.connect(self._url, token, options=rtc.RoomOptions(auto_subscribe=True))
        track = rtc.LocalAudioTrack.create_audio_track('discord-bridge', self._source)
        await self.room.local_participant.publish_track(
            track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
        self._publish_task = asyncio.create_task(self._publish_loop())
        log.info('Conectado à sala LiveKit %s como %s', self._room_name, self._identity)

    async def disconnect(self):
        if self._publish_task:
            self._publish_task.cancel()
        for task in self._stream_tasks.values():
            task.cancel()
        await self.room.disconnect()

    async def _publish_loop(self):
        """A cada 20ms, pega um frame do mixer alimentado pelo Discord e publica no LiveKit."""
        frame_interval = SAMPLES_PER_FRAME / SAMPLE_RATE
        next_tick = asyncio.get_event_loop().time()
        while True:
            pcm = self._from_discord_mixer.pull_frame()
            frame = rtc.AudioFrame.create(SAMPLE_RATE, CHANNELS, SAMPLES_PER_FRAME)
            frame.data.cast('B')[:] = pcm
            await self._source.capture_frame(frame)
            next_tick += frame_interval
            await asyncio.sleep(max(0.0, next_tick - asyncio.get_event_loop().time()))

    def set_from_discord_mixer(self, mixer: RollingMixer):
        self._from_discord_mixer = mixer

    def _on_track_subscribed(self, track, publication, participant):
        if track.kind != rtc.TrackKind.KIND_AUDIO:
            return
        stream = rtc.AudioStream(track, sample_rate=SAMPLE_RATE, num_channels=CHANNELS)
        self._stream_tasks[publication.sid] = asyncio.create_task(self._consume(stream, publication.sid))

    def _on_track_unsubscribed(self, track, publication, participant):
        task = self._stream_tasks.pop(publication.sid, None)
        if task:
            task.cancel()

    async def _consume(self, stream: 'rtc.AudioStream', sid: str):
        try:
            async for event in stream:
                self.to_discord.add_pcm(bytes(event.frame.data))
        except asyncio.CancelledError:
            pass
        finally:
            await stream.aclose()
