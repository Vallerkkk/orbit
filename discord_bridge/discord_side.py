"""Lado Discord da ponte: captura o áudio de quem fala no canal de voz do Discord
e reproduz, nesse mesmo canal, o áudio mixado vindo da sala LiveKit do Órbita."""
import queue

import discord
from discord.ext import voice_recv

from .audio_mixer import FRAME_BYTES, SILENCE_FRAME, RollingMixer


class FromLiveKitSource(discord.AudioSource):
    """AudioSource que o discord.py consome a cada 20ms; alimentado pela ponte LiveKit."""

    def __init__(self):
        self._queue: queue.Queue[bytes] = queue.Queue(maxsize=50)

    def push(self, pcm_frame: bytes):
        try:
            self._queue.put_nowait(pcm_frame)
        except queue.Full:
            pass

    def read(self) -> bytes:
        try:
            return self._queue.get(timeout=0.02)
        except queue.Empty:
            return SILENCE_FRAME

    def is_opus(self) -> bool:
        return False


class ToLiveKitSink(voice_recv.AudioSink):
    """Sink do voice_recv: recebe PCM descompactado de cada pessoa falando no Discord
    e soma tudo no mixer que o lado LiveKit publica."""

    def __init__(self, mixer: RollingMixer):
        super().__init__()
        self._mixer = mixer

    def wants_opus(self) -> bool:
        return False

    def write(self, user, data: voice_recv.VoiceData):
        pcm = bytes(data.pcm)
        if len(pcm) == FRAME_BYTES:
            self._mixer.add_pcm(pcm)
        else:
            # pacotes de tamanho irregular: trunca/preenche para o tamanho esperado
            padded = (pcm + SILENCE_FRAME)[:FRAME_BYTES]
            self._mixer.add_pcm(padded)

    def cleanup(self):
        pass


async def connect_and_bridge(voice_channel: discord.VoiceChannel,
                              to_discord_source: FromLiveKitSource,
                              from_discord_mixer: RollingMixer) -> voice_recv.VoiceRecvClient:
    vc: voice_recv.VoiceRecvClient = await voice_channel.connect(cls=voice_recv.VoiceRecvClient)
    vc.listen(ToLiveKitSink(from_discord_mixer))
    vc.play(to_discord_source)
    return vc
