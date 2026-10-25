"""Bot Discord da ponte de voz Órbita <-> Discord.

    python -m discord_bridge

Comandos (no servidor do Discord):
    /bridge enter canal_id:<uuid do canal de voz do Órbita> [canal_discord:<canal de voz>]
    /bridge leave
    /bridge status
"""
import asyncio
import signal
import sys

import discord
import structlog
from discord import app_commands

from ..audio.mixer import Mixer
from ..discord_side.voice import DiscordLink
from ..livekit_side.link import LiveKitLink
from . import config as config_mod
from .health import HealthServer
from .logs import setup_logging
from .manager import BridgeError, BridgeManager
from .session import BridgeSession

log = structlog.get_logger('bridge.app')

VoiceChannel = discord.VoiceChannel | discord.StageChannel


class BridgeBot(discord.Client):
    def __init__(self, cfg: config_mod.Config):
        intents = discord.Intents.none()
        intents.guilds = True
        intents.voice_states = True
        super().__init__(intents=intents)
        self.cfg = cfg
        self.tree = app_commands.CommandTree(self)
        self.manager = BridgeManager(cfg.max_bridges)
        self.health = HealthServer(self.manager, self.is_ready, cfg.health_host, cfg.health_port)
        self.tree.add_command(build_commands(self))

    async def setup_hook(self) -> None:
        await self.health.start()
        await self.tree.sync()
        log.info('health_listening', host=self.cfg.health_host, port=self.cfg.health_port)

    async def on_ready(self) -> None:
        log.info('discord_ready', user=str(self.user), guilds=len(self.guilds))

    def make_session(self, guild: discord.Guild, voice_channel: VoiceChannel, room_name: str) -> BridgeSession:
        cfg = self.cfg
        mixer_kwargs = dict(min_frames=cfg.jitter_min_frames, max_frames=cfg.jitter_max_frames)
        to_livekit = Mixer('discord->livekit', **mixer_kwargs)
        to_discord = Mixer('livekit->discord', **mixer_kwargs)
        livekit = LiveKitLink(cfg.livekit, room_name, identity=f'discord-bridge-{guild.id}',
                              display_name=f'Discord · {guild.name}'[:64],
                              to_discord=to_discord, from_discord=to_livekit)
        discord_link = DiscordLink(voice_channel, to_livekit=to_livekit, to_discord=to_discord)
        return BridgeSession(guild.id, room_name=room_name, to_livekit=to_livekit, to_discord=to_discord,
                             livekit=livekit, discord=discord_link, stats_interval=cfg.stats_interval)

    async def shutdown(self) -> None:
        await self.manager.stop_all()
        await self.health.stop()
        if not self.is_closed():
            await self.close()


def _describe(connected: dict) -> str:
    def side(ok: bool) -> str:
        return 'conectado' if ok else 'ainda tentando (reconexão automática)'
    return f"Discord: {side(connected['discord'])} · Órbita/LiveKit: {side(connected['livekit'])}"


def build_commands(bot: BridgeBot) -> app_commands.Group:
    group = app_commands.Group(name='bridge', description='Ponte de voz entre este servidor e o Órbita',
                               guild_only=True)

    @group.command(name='enter', description='Liga um canal de voz do Discord à chamada de um canal do Órbita')
    @app_commands.describe(canal_id='UUID do canal de voz do Órbita',
                           canal_discord='Canal de voz do Discord (padrão: o canal em que você está)')
    async def enter(interaction: discord.Interaction, canal_id: str | None = None,
                    canal_discord: VoiceChannel | None = None):
        await interaction.response.defer(ephemeral=True, thinking=True)
        voice_state = getattr(interaction.user, 'voice', None)
        channel = canal_discord or (voice_state.channel if voice_state else None)
        if channel is None:
            await interaction.followup.send('Entre num canal de voz ou informe `canal_discord`.')
            return
        try:
            room_name = bot.cfg.room_for(canal_id)
            _, connected = await bot.manager.enter(
                interaction.guild.id, lambda: bot.make_session(interaction.guild, channel, room_name))
        except (config_mod.ConfigError, BridgeError) as exc:
            await interaction.followup.send(str(exc))
            return
        except Exception:
            log.exception('bridge_enter_failed', guild=interaction.guild.id)
            await interaction.followup.send('Falha inesperada ao abrir a ponte. Veja os logs do bot.')
            return
        await interaction.followup.send(f'Ponte ativa em **{channel.name}** ↔ `{room_name}`.\n{_describe(connected)}')

    @group.command(name='leave', description='Desliga a ponte de voz deste servidor')
    async def leave(interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True, thinking=True)
        if await bot.manager.leave(interaction.guild.id):
            await interaction.followup.send('Ponte desligada.')
        else:
            await interaction.followup.send('Não há ponte ativa neste servidor.')

    @group.command(name='status', description='Mostra o estado da ponte deste servidor')
    async def status(interaction: discord.Interaction):
        session = bot.manager.sessions.get(interaction.guild.id)
        if session is None:
            await interaction.response.send_message('Não há ponte ativa neste servidor.', ephemeral=True)
            return
        s = session.status()
        audio = s['audio']
        await interaction.response.send_message(
            f"Sala `{s['room']}` · ativa há {s['uptime_s']}s\n"
            f"{_describe({'discord': s['discord']['connected'], 'livekit': s['livekit']['connected']})}\n"
            f"Discord→Órbita: {audio['discord_to_livekit']['speakers']} falando, "
            f"buffer {audio['discord_to_livekit']['buffer_ms']:.0f}ms\n"
            f"Órbita→Discord: {audio['livekit_to_discord']['speakers']} falando, "
            f"buffer {audio['livekit_to_discord']['buffer_ms']:.0f}ms",
            ephemeral=True)

    return group


async def watch_loop_lag(interval: float = 0.5, threshold: float = 0.25) -> None:
    """Avisa quando o event loop atrasa: um loop travado derruba o heartbeat do
    gateway do Discord ("stopped responding") e atrasa a publicação no LiveKit."""
    loop = asyncio.get_running_loop()
    while True:
        started = loop.time()
        await asyncio.sleep(interval)
        late = loop.time() - started - interval
        if late > threshold:
            log.warning('event_loop_lag', lag_ms=round(late * 1000))


async def run(cfg: config_mod.Config) -> None:
    bot = BridgeBot(cfg)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    if sys.platform != 'win32':
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, stop.set)

    runner = asyncio.create_task(bot.start(cfg.discord_token), name='discord-client')
    waiter = asyncio.create_task(stop.wait(), name='stop-signal')
    lag = asyncio.create_task(watch_loop_lag(), name='loop-lag')
    try:
        done, _ = await asyncio.wait({runner, waiter}, return_when=asyncio.FIRST_COMPLETED)
        if runner in done:
            runner.result()  # propaga erro de login/token
    finally:
        log.info('shutting_down')
        waiter.cancel()
        lag.cancel()
        await bot.shutdown()
        await asyncio.gather(runner, return_exceptions=True)


def main() -> None:
    try:
        cfg = config_mod.from_env()
    except config_mod.ConfigError as exc:
        raise SystemExit(f'Configuração inválida: {exc}')
    setup_logging(cfg.log_level, cfg.log_format)
    try:
        asyncio.run(run(cfg))
    except KeyboardInterrupt:  # Windows: Ctrl+C cai aqui depois do shutdown do finally
        pass
    except discord.LoginFailure:
        raise SystemExit('DISCORD_TOKEN inválido.')
