"""Lado Discord da ponte: entra no canal de voz, recebe o áudio de cada pessoa
(discord-ext-voice-recv) e toca nele o áudio mixado vindo do Órbita.

O discord.py faz o encode Opus do que tocamos (AudioSource com is_opus=False) e o
voice_recv faz o decode Opus do que recebemos; aqui só circula PCM 48k estéreo.

DAVE (criptografia ponta a ponta de voz do Discord): o discord.py 2.7 negocia o
DAVE e criptografa o que envia, mas o voice_recv 0.5.2 só remove a camada de
transporte do que recebe. `DaveRecvClient` completa a recepção decriptando cada
frame com a sessão DAVE do discord.py antes do decode Opus.
"""
import asyncio
import threading

import discord
import structlog
from discord.ext import voice_recv
from discord.ext.voice_recv.rtp import OPUS_SILENCE

from ..audio.mixer import Mixer
from ..bridge.backoff import Backoff

try:
    import davey
except ImportError:  # sem davey o discord.py também não consegue entrar em canais com E2EE
    davey = None

log = structlog.get_logger('bridge.discord')


class DaveRecvClient(voice_recv.VoiceRecvClient):
    def __init__(self, client, channel):
        super().__init__(client, channel)
        self.dave_failures = 0

    def listen(self, sink, *, after=None):
        super().listen(sink, after=after)
        transport_decrypt = self._reader.decryptor.decrypt_rtp

        def decrypt_rtp(packet):
            payload = transport_decrypt(packet)
            state = self._connection
            session = getattr(state, 'dave_session', None)
            if (davey is None or not getattr(state, 'dave_protocol_version', 0) or session is None
                    or not session.ready or payload == OPUS_SILENCE):
                return payload
            user_id = self._get_id_from_ssrc(packet.ssrc)
            if user_id is None:
                return OPUS_SILENCE
            try:
                return session.decrypt(user_id, davey.MediaType.audio, payload)
            except Exception:
                # frame de transição de chave ou corrompido: vira silêncio em vez de ruído
                self.dave_failures += 1
                return OPUS_SILENCE

        self._reader.decryptor.decrypt_rtp = decrypt_rtp


class MixerSource(discord.AudioSource):
    """O AudioPlayer do discord.py chama `read` a cada 20ms na thread dele; puxamos
    direto do mixer, sem fila intermediária (menos latência)."""

    def __init__(self, mixer: Mixer):
        self._mixer = mixer

    def read(self) -> bytes:
        return self._mixer.pull_frame()

    def is_opus(self) -> bool:
        return False


class MixerSink(voice_recv.AudioSink):
    """Recebe o PCM já decodificado de cada pessoa falando e escreve no mixer, uma fonte por stream.

    A fonte é identificada pelo SSRC (a stream de áudio de cada pessoa), não pelo
    objeto `user`: o voice_recv só preenche `user` se a pessoa estiver no cache de
    membros, que o bot não mantém completo (sem o intent privilegiado de membros).
    Depender dele fazia o áudio de algumas pessoas ser descartado em silêncio.
    """

    def __init__(self, mixer: Mixer):
        super().__init__()
        self._mixer = mixer

    def wants_opus(self) -> bool:
        return False

    def write(self, user, data: voice_recv.VoiceData) -> None:
        if not data.pcm:
            return
        self._mixer.push(('ssrc', data.packet.ssrc), bytes(data.pcm))

    @voice_recv.AudioSink.listener()
    def on_voice_member_disconnect(self, member, ssrc) -> None:
        if ssrc is not None:
            self._mixer.remove(('ssrc', ssrc))

    def cleanup(self) -> None:
        pass


class DiscordLink:
    """Mantém o bot num canal de voz enquanto a ponte existir.

    Um watchdog a cada 2s confere conexão, reprodução e recepção; se algo caiu
    (queda de rede, bot removido do canal, erro no receptor), religa com backoff
    exponencial. O lado LiveKit segue vivo nesse meio tempo.
    """
    WATCHDOG_INTERVAL = 2.0

    def __init__(self, channel: discord.VoiceChannel | discord.StageChannel, *,
                 to_livekit: Mixer, to_discord: Mixer, backoff: Backoff | None = None):
        self.channel = channel
        self._to_livekit = to_livekit
        self._to_discord = to_discord
        self._backoff = backoff or Backoff()
        self._vc: DaveRecvClient | None = None
        self._watchdog: asyncio.Task | None = None
        self._connected_once = asyncio.Event()
        self._stopping = False
        self._log = log.bind(guild=channel.guild.id)
        self._receive_errors = 0

        self.reconnects = 0
        self.last_error: str | None = None

    @property
    def connected(self) -> bool:
        return self._vc is not None and self._vc.is_connected()

    @property
    def dave_failures(self) -> int:
        return self._vc.dave_failures if self._vc else 0

    async def start(self) -> None:
        self._watchdog = asyncio.create_task(self._supervise(), name=f'discord-{self.channel.guild.id}')

    async def wait_connected(self, timeout: float) -> bool:
        try:
            await asyncio.wait_for(self._connected_once.wait(), timeout)
            return True
        except asyncio.TimeoutError:
            return False

    async def stop(self) -> None:
        self._stopping = True
        if self._watchdog:
            self._watchdog.cancel()
            await asyncio.gather(self._watchdog, return_exceptions=True)
        vc, self._vc = self._vc, None
        if vc is not None:
            vc.stop()
            if vc.is_connected():
                await vc.disconnect(force=True)

    async def _supervise(self) -> None:
        while not self._stopping:
            try:
                await self._ensure()
                self._backoff.reset()
                await asyncio.sleep(self.WATCHDOG_INTERVAL)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.last_error = repr(exc)
                delay = self._backoff.next_delay()
                self.reconnects += 1
                self._log.warning('discord_voice_failed', error=self.last_error, retry_in_s=round(delay, 2))
                await asyncio.sleep(delay)

    async def _ensure(self) -> None:
        if not self.connected:
            await self._connect()
        vc = self._vc
        if vc.channel and vc.channel.id != self.channel.id:
            self._log.info('discord_moved', channel=vc.channel.id)
            self.channel = vc.channel
        if not vc.is_listening():
            vc.listen(MixerSink(self._to_livekit), after=self._after_listen)
        if not vc.is_playing():
            vc.play(MixerSource(self._to_discord), after=self._after_play)

    async def _connect(self) -> None:
        stale = self.channel.guild.voice_client
        if stale is not None:
            await stale.disconnect(force=True)
        # reconnect=True: o discord.py tenta sozinho em quedas curtas; o watchdog cobre o resto
        self._vc = await self.channel.connect(cls=DaveRecvClient, self_deaf=False, timeout=20.0, reconnect=True)
        self.last_error = None
        self._connected_once.set()
        self._log.info('discord_connected', channel=self.channel.id, channel_name=self.channel.name)

    def _after_listen(self, error: Exception | None) -> None:
        if error and not self._stopping:
            self._receive_errors += 1
            # a recepção de áudio é recurso não documentado da Discord; deixar claro no log
            self._log.error('discord_receive_failed', error=repr(error), thread=threading.current_thread().name,
                            hint='recepção de voz do Discord não é API oficial; o watchdog vai religar o receptor')

    def _after_play(self, error: Exception | None) -> None:
        if error and not self._stopping:
            self._log.error('discord_play_failed', error=repr(error))

    def status(self) -> dict:
        return {'connected': self.connected, 'channel': self.channel.id, 'channel_name': self.channel.name,
                'reconnects': self.reconnects, 'receive_errors': self._receive_errors,
                'dave_failures': self.dave_failures, 'last_error': self.last_error}
