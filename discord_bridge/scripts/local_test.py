"""Teste local da ponte sem precisar de duas pessoas reais.

    python -m discord_bridge.scripts.local_test [--seconds 15]

Monta uma BridgeSession real do lado LiveKit, mas troca o Discord por um
"canal falso" no mesmo processo:

- usuário falso do Discord: fala em rajadas de 200ms a cada 1s (440Hz) e
  "ouve" o que a ponte tocaria no Discord, no ritmo de 20ms do AudioPlayer;
- participante falso do Órbita: entra na mesma sala LiveKit, fala em rajadas
  (880Hz) e ouve a track publicada pela ponte.

Cada lado mede quanto tempo a rajada do outro leva para chegar: é a latência
ponta a ponta através do servidor LiveKit (rede + Opus + buffers da ponte).
Precisa só de um LiveKit acessível — o `scripts/local-test` sobe um em modo dev.
"""
import argparse
import asyncio
import os
import statistics
import sys
import time
import uuid
from pathlib import Path

import numpy as np
from dotenv import load_dotenv
from livekit import rtc

from ..audio.format import CHANNELS, FRAME_SECONDS, SAMPLE_RATE, SAMPLES_PER_FRAME, SILENCE_FRAME, peak
from ..audio.mixer import Mixer
from ..bridge.session import BridgeSession
from ..livekit_side.link import LiveKitCredentials, LiveKitLink, make_token

BURST_EVERY = 1.0
BURST_LEN = 0.2
ONSET_PEAK = 2000
QUIET_BEFORE_ONSET = 0.4
TARGET_MS = 250


class BurstGenerator:
    def __init__(self, freq: float):
        self._freq = freq
        self._t0 = None
        self._sample = 0
        self.burst_starts: list[float] = []

    def frame(self, now: float) -> bytes:
        if self._t0 is None:
            self._t0 = now
        phase = (now - self._t0) % BURST_EVERY
        if phase >= BURST_LEN:
            self._sample = 0
            return SILENCE_FRAME
        if self._sample == 0:
            self.burst_starts.append(now)
        t = (self._sample + np.arange(SAMPLES_PER_FRAME)) / SAMPLE_RATE
        self._sample += SAMPLES_PER_FRAME
        mono = (8000 * np.sin(2 * np.pi * self._freq * t)).astype(np.int16)
        return np.repeat(mono, CHANNELS).tobytes()


class OnsetDetector:
    def __init__(self, source: BurstGenerator):
        self._source = source
        self._last_loud = -1e9
        self.latencies_ms: list[float] = []

    def feed(self, pcm: bytes, now: float) -> None:
        if peak(pcm) < ONSET_PEAK:
            return
        if now - self._last_loud >= QUIET_BEFORE_ONSET:
            starts = [s for s in self._source.burst_starts if s <= now]
            if starts and now - starts[-1] < BURST_EVERY - BURST_LEN:
                self.latencies_ms.append((now - starts[-1]) * 1000)
        self._last_loud = now


class FakeDiscordLink:
    """Substitui o DiscordLink: escreve um falante falso em to_livekit e puxa to_discord a cada 20ms."""

    def __init__(self, to_livekit: Mixer, to_discord: Mixer, speaker: BurstGenerator, listener: OnsetDetector):
        self._to_livekit, self._to_discord = to_livekit, to_discord
        self._speaker, self._listener = speaker, listener
        self._task = None
        self.connected = False
        self.reconnects = 0

    async def start(self):
        self._task = asyncio.create_task(self._run())
        self.connected = True

    async def wait_connected(self, timeout):
        return True

    async def stop(self):
        if self._task:
            self._task.cancel()
        self.connected = False

    def status(self):
        return {'connected': self.connected, 'fake': True}

    async def _run(self):
        next_tick = time.monotonic()
        while True:
            now = time.monotonic()
            self._to_livekit.push('fake-discord-user', self._speaker.frame(now))
            self._listener.feed(self._to_discord.pull_frame(), now)
            next_tick += FRAME_SECONDS
            await asyncio.sleep(max(0.0, next_tick - time.monotonic()))


class FakeOrbitaUser:
    def __init__(self, creds: LiveKitCredentials, room_name: str, bridge_identity: str,
                 speaker: BurstGenerator, listener: OnsetDetector):
        self._creds, self._room_name, self._bridge_identity = creds, room_name, bridge_identity
        self._speaker, self._listener = speaker, listener
        self.room = rtc.Room()
        self._tasks: list[asyncio.Task] = []

    async def start(self):
        self.room.on('track_subscribed', self._on_track)
        token = make_token(self._creds, self._room_name, 'fake-orbita-user', 'Usuário falso do Órbita')
        await self.room.connect(self._creds.url, token)
        source = rtc.AudioSource(SAMPLE_RATE, CHANNELS, queue_size_ms=100)
        track = rtc.LocalAudioTrack.create_audio_track('mic', source)
        await self.room.local_participant.publish_track(
            track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
        self._tasks.append(asyncio.create_task(self._speak(source)))

    async def stop(self):
        for task in self._tasks:
            task.cancel()
        await self.room.disconnect()

    def _on_track(self, track, publication, participant):
        if track.kind == rtc.TrackKind.KIND_AUDIO and participant.identity == self._bridge_identity:
            stream = rtc.AudioStream(track, sample_rate=SAMPLE_RATE, num_channels=CHANNELS, frame_size_ms=20)
            self._tasks.append(asyncio.create_task(self._listen(stream)))

    async def _speak(self, source: rtc.AudioSource):
        next_tick = time.monotonic()
        while True:
            pcm = self._speaker.frame(time.monotonic())
            await source.capture_frame(rtc.AudioFrame(pcm, SAMPLE_RATE, CHANNELS, SAMPLES_PER_FRAME))
            next_tick += FRAME_SECONDS
            await asyncio.sleep(max(0.0, next_tick - time.monotonic()))

    async def _listen(self, stream: rtc.AudioStream):
        async for event in stream:
            self._listener.feed(bytes(event.frame.data), time.monotonic())


def summarize(label: str, detector: OnsetDetector, emitted: int) -> bool:
    lat = detector.latencies_ms
    if not lat:
        print(f'  {label}: nenhuma rajada chegou ({emitted} enviadas)  FALHOU')
        return False
    median = statistics.median(lat)
    p95 = sorted(lat)[max(0, round(len(lat) * 0.95) - 1)]
    ok = len(lat) >= emitted * 0.5 and median < TARGET_MS
    print(f'  {label}: {len(lat)}/{emitted} rajadas · mediana {median:.0f}ms · p95 {p95:.0f}ms  '
          f'{"OK" if ok else "FALHOU"}')
    return ok


async def main(seconds: float) -> int:
    pkg = Path(__file__).resolve().parent.parent
    load_dotenv(pkg / '.env', override=False)
    load_dotenv(pkg.parent / '.env', override=False)
    url, key, secret = (os.getenv(n, '').strip() for n in ('LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'))
    if not (url and key and secret):
        print('Defina LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET (ou use scripts/local-test).')
        return 2
    creds = LiveKitCredentials(url, key, secret)
    room_name = f'bridge-local-test-{uuid.uuid4().hex[:8]}'
    bridge_identity = 'discord-bridge-local-test'

    discord_speaker, orbita_speaker = BurstGenerator(440), BurstGenerator(880)
    heard_in_orbita, heard_in_discord = OnsetDetector(discord_speaker), OnsetDetector(orbita_speaker)

    to_livekit, to_discord = Mixer('discord->livekit'), Mixer('livekit->discord')
    session = BridgeSession(
        'local-test', room_name=room_name, to_livekit=to_livekit, to_discord=to_discord,
        livekit=LiveKitLink(creds, room_name, bridge_identity, 'Ponte (teste local)',
                            to_discord=to_discord, from_discord=to_livekit),
        discord=FakeDiscordLink(to_livekit, to_discord, discord_speaker, heard_in_discord),
        stats_interval=0)
    orbita = FakeOrbitaUser(creds, room_name, bridge_identity, orbita_speaker, heard_in_orbita)

    print(f'LiveKit: {url} · sala {room_name}')
    connected = await session.start(connect_timeout=15)
    if not connected['livekit']:
        print('A ponte não conectou no LiveKit:', session.livekit.status()['last_error'])
        await session.stop(drain=False)
        return 1
    await orbita.start()
    print(f'Medindo por {seconds:.0f}s...')
    await asyncio.sleep(seconds)
    stats = session.direction_stats()
    await orbita.stop()
    await session.stop()

    print('Resultado (alvo: mediana < 250ms):')
    ok = summarize('Discord -> Órbita', heard_in_orbita, len(discord_speaker.burst_starts))
    ok &= summarize('Órbita -> Discord', heard_in_discord, len(orbita_speaker.burst_starts))
    for direction, s in stats.items():
        print(f'  {direction}: jitter {s["jitter_ms"]}ms · underruns {s["underruns"]} · '
              f'drift drops {s["drift_drops"]} · perda {s["loss_ratio"]:.2%}')
    return 0 if ok else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--seconds', type=float, default=15)
    sys.exit(asyncio.run(main(parser.parse_args().seconds)))
