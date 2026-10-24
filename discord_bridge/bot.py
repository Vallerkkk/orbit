"""Bot Discord que faz a ponte de voz, em tempo real e nos dois sentidos, entre um
canal de voz do Discord e a sala de chamada (LiveKit) de um canal de voz do Órbita.

Uso (depois de configurado, veja discord_bridge/README.md):
  python -m discord_bridge.bot

Comandos no Discord (entre num canal de voz antes de usar):
  /orbita_conectar canal_id:<uuid do canal de voz do Órbita>
  /orbita_desconectar
"""
import asyncio
import logging
import os
import re
from pathlib import Path

import discord
from discord import app_commands
from dotenv import load_dotenv

from .audio_mixer import RollingMixer, SAMPLES_PER_FRAME, SAMPLE_RATE
from .discord_side import FromLiveKitSource, connect_and_bridge
from .livekit_side import LiveKitSide

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / '.env')

logging.basicConfig(level=logging.INFO)
log = logging.getLogger('orbita.bridge')

CHANNEL_ID_RE = re.compile(r'^[0-9a-fA-F-]{36}$')

intents = discord.Intents.default()
intents.voice_states = True
intents.guilds = True

client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)


class ActiveBridge:
    def __init__(self, voice_client, livekit_side: LiveKitSide, pump_task: asyncio.Task):
        self.voice_client = voice_client
        self.livekit_side = livekit_side
        self.pump_task = pump_task

    async def stop(self):
        self.pump_task.cancel()
        await self.livekit_side.disconnect()
        if self.voice_client.is_connected():
            await self.voice_client.disconnect(force=True)


bridges: dict[int, ActiveBridge] = {}  # guild_id -> ponte ativa


def env(name: str) -> str:
    return os.getenv(name, '').strip()


async def pump_livekit_to_discord(to_discord_mixer: RollingMixer, to_discord_source: FromLiveKitSource):
    frame_interval = SAMPLES_PER_FRAME / SAMPLE_RATE
    loop = asyncio.get_event_loop()
    next_tick = loop.time()
    while True:
        to_discord_source.push(to_discord_mixer.pull_frame())
        next_tick += frame_interval
        await asyncio.sleep(max(0.0, next_tick - loop.time()))


@tree.command(name='orbita_conectar', description='Liga este canal de voz do Discord à chamada do Órbita')
@app_commands.describe(canal_id='ID (UUID) do canal de voz do Órbita, visível no painel do canal')
async def orbita_conectar(interaction: discord.Interaction, canal_id: str):
    await interaction.response.defer(ephemeral=True, thinking=True)

    if interaction.guild is None or interaction.user.voice is None or interaction.user.voice.channel is None:
        await interaction.followup.send('Entre em um canal de voz do Discord antes de usar este comando.')
        return
    if not CHANNEL_ID_RE.match(canal_id.strip()):
        await interaction.followup.send('ID de canal inválido. Copie o UUID do canal de voz no Órbita.')
        return
    if interaction.guild.id in bridges:
        await interaction.followup.send('Já existe uma ponte ativa neste servidor. Use /orbita_desconectar primeiro.')
        return

    livekit_url, api_key, api_secret = env('LIVEKIT_URL'), env('LIVEKIT_API_KEY'), env('LIVEKIT_API_SECRET')
    if not (livekit_url and api_key and api_secret):
        await interaction.followup.send('Configure LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET no .env do bot.')
        return

    room_name = f'channel-{canal_id.strip()}'
    to_discord_mixer = RollingMixer()
    from_discord_mixer = RollingMixer()
    to_discord_source = FromLiveKitSource()

    livekit_side = LiveKitSide(livekit_url, api_key, api_secret, room_name,
                                identity=f'discord-bridge-{interaction.guild.id}', to_discord=to_discord_mixer)
    livekit_side.set_from_discord_mixer(from_discord_mixer)
    try:
        await livekit_side.connect()
    except Exception:
        log.exception('Falha ao conectar na sala LiveKit %s', room_name)
        await interaction.followup.send('Não consegui conectar à sala do Órbita. Verifique o ID do canal e as credenciais LiveKit.')
        return

    voice_client = await connect_and_bridge(interaction.user.voice.channel, to_discord_source, from_discord_mixer)
    pump_task = asyncio.create_task(pump_livekit_to_discord(to_discord_mixer, to_discord_source))
    bridges[interaction.guild.id] = ActiveBridge(voice_client, livekit_side, pump_task)

    await interaction.followup.send(
        f'Ponte ativa: áudio de **{interaction.user.voice.channel.name}** agora flui nos dois sentidos com a chamada do Órbita.')


@tree.command(name='orbita_desconectar', description='Desliga a ponte de voz com o Órbita neste servidor')
async def orbita_desconectar(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True, thinking=True)
    bridge = bridges.pop(interaction.guild.id, None) if interaction.guild else None
    if bridge is None:
        await interaction.followup.send('Não há ponte ativa neste servidor.')
        return
    await bridge.stop()
    await interaction.followup.send('Ponte desligada.')


@client.event
async def on_ready():
    await tree.sync()
    log.info('Bot conectado como %s', client.user)


def main():
    token = env('DISCORD_BOT_TOKEN')
    if not token:
        raise SystemExit('Defina DISCORD_BOT_TOKEN no .env antes de rodar o bot.')
    client.run(token)


if __name__ == '__main__':
    main()
