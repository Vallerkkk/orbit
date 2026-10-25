# Ponte de voz Órbita ↔ Discord

Bot que entra num canal de voz do Discord e, ao mesmo tempo, na sala LiveKit da
chamada de um canal de voz do Órbita, retransmitindo o áudio nos dois sentidos
em tempo real. Custo zero: bibliotecas open-source, roda em Docker na sua VPS
(ou no seu PC) e usa o LiveKit Cloud gratuito ou um LiveKit Server próprio.

## Fluxo de dados

```
            DISCORD                              PONTE (1 por servidor)                           ÓRBITA / LIVEKIT
 ┌────────────────────────┐                                                               ┌──────────────────────────┐
 │ usuário A ─┐           │  Opus+DAVE   ┌──────────────┐  PCM 48k  ┌──────────────────┐   │                          │
 │ usuário B ─┼─ canal de ├─────────────▶│ DaveRecvClient├──────────▶│ Mixer to_livekit │   │                          │
 │ usuário C ─┘   voz     │              │ (voice_recv)  │ por user  │ jitter/usuário   │   │                          │
 │                        │              └──────────────┘            └────────┬─────────┘   │                          │
 │                        │                                       20ms (relógio próprio)  │   track "discord-bridge" │
 │                        │                                                   └──────────▶├─▶ ouvida por todos       │
 │                        │                                                   AudioSource │                          │
 │                        │                                                               │                          │
 │  ouve 1 voz (a mistura)│◀─ Opus ── AudioPlayer ◀── 20ms ── Mixer to_discord ◀─ PCM 48k ─┤◀─ track de cada         │
 │                        │  (encode   lê direto     pull     jitter/track      AudioStream │   participante do site   │
 └────────────────────────┘  discord.py)                                     (stereo,20ms)└──────────────────────────┘
```

- Nos dois sentidos o áudio circula como PCM 16-bit, 48kHz, estéreo, em frames de
  20ms. O app do Órbita publica microfone mono a 48kHz (Opus/WebRTC); o SDK do
  LiveKit entrega já em estéreo, então **não há resample**, só soma de amostras.
- Cada falante tem seu jitter buffer adaptativo (`audio/jitter.py`): alvo de 1 a
  6 frames conforme o jitter medido, descarte do frame mais antigo quando os
  relógios dos dois lados derivam, teto rígido de 25 frames (backpressure).
- Cada lado reconecta sozinho com backoff exponencial; se um cair, o outro segue.

## Estrutura

```
discord_bridge/
  audio/          format.py (48k estéreo, bypass de resample) · jitter.py · mixer.py
  discord_side/   voice.py  entrar/sair, recepção (voice_recv + DAVE), reprodução, watchdog
  livekit_side/   link.py   entrar na sala, assinar tracks, publicar, reconexão
  bridge/         app.py (/bridge, startup/shutdown) · session.py · manager.py
                  config.py · health.py (/health, /metrics) · logs.py · backoff.py
  tests/          testes unitários (mixer, jitter buffer, backoff, config, sessão)
  scripts/        local_test.py + local-test (teste sem pessoas reais)
  Dockerfile · docker-compose.yml · livekit.yaml
```

Encode/decode Opus não tem módulo próprio de propósito: o discord.py faz o
encode do que tocamos e o voice_recv faz o decode do que recebemos.

## 1. Criar o bot no Discord

1. https://discord.com/developers/applications → **New Application**.
2. Aba **Bot** → **Reset Token** → copie para `DISCORD_TOKEN`.
   Nenhum *Privileged Gateway Intent* é necessário: a ponte usa só `Guilds` e
   `GuildVoiceStates`, que são intents padrão.
3. Aba **OAuth2 → URL Generator**:
   - scopes: `bot` e `applications.commands`;
   - permissões: `View Channels`, `Connect`, `Speak`, `Use Voice Activity`.
4. Abra a URL gerada e adicione o bot ao seu servidor.

Os comandos `/bridge` aparecem para todos por padrão. Para restringir, use
*Configurações do servidor → Integrações → seu bot*.

## 2. Escolher o LiveKit

A ponte precisa usar **o mesmo servidor LiveKit que o app do Órbita**; senão ela
entra numa sala vazia.

### (A) LiveKit Cloud, plano gratuito: o que o app já usa hoje

Use as mesmas `LIVEKIT_URL`, `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET` do app.

Limites do plano gratuito (*Build*). Confira os valores atuais em
https://livekit.io/pricing:
- cota mensal de minutos de participante WebRTC (~5.000) e de agente (~1.000);
- **cap rígido**: ao esgotar, a conexão para de funcionar até o mês virar. Não
  gera cobrança, mas para;
- a cota é da conta: projetos gratuitos compartilham o mesmo saldo;
- **a ponte consome minutos**: o bot é um participante enquanto a ponte estiver
  ligada. Uma ponte aberta 24h gasta ~1.440 min/dia, ou seja, a cota acaba em
  ~3 dias. Use `/bridge leave` quando ninguém estiver falando, ou vá de self-hosted.

### (B) LiveKit Server self-hosted (custo zero de verdade)

```bash
docker compose --profile selfhost up -d --build
```

Sobe o `livekit/livekit-server` (Apache 2.0) na rede do host junto com a ponte.
Para o **app** (navegador) também usar esse servidor, você precisa de:
- um domínio apontando para a VPS e um proxy TLS (ex.: Caddy:
  `livekit.seudominio.com { reverse_proxy localhost:7880 }`), porque navegador
  exige `wss://`;
- firewall liberando `443/tcp`, `7881/tcp` e `7882/udp`;
- trocar `LIVEKIT_URL/KEY/SECRET` do app (`.env` da raiz / Render) para o
  servidor novo.

## 3. Configurar o `.env`

Crie `discord_bridge/.env`. Se ele não existir, a ponte também lê o `.env` da
raiz. Nunca commite esse arquivo: o `.gitignore` já ignora `.env` e `.env.*`.

```dotenv
DISCORD_TOKEN=                           # DISCORD_BOT_TOKEN também é aceito

# (A) LiveKit Cloud: os mesmos valores do app
LIVEKIT_URL=wss://SEU-PROJETO.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=

# (B) Self-hosted (docker compose --profile selfhost). Comente o bloco (A).
# LIVEKIT_URL=ws://host.docker.internal:7880
# LIVEKIT_API_KEY=orbita
# LIVEKIT_API_SECRET=troque-por-um-segredo-longo-e-aleatorio

LIVEKIT_ROOM_NAME=channel-{channel_id}   # {channel_id} = UUID do canal do Órbita; sem ele, sala fixa
HEALTH_HOST=127.0.0.1                    # o compose usa 0.0.0.0 dentro do container
HEALTH_PORT=8080
LOG_LEVEL=INFO
LOG_FORMAT=json                          # json | console
STATS_LOG_INTERVAL=30                    # segundos entre logs de latência/perda/drift (0 desliga)
MAX_BRIDGES=10                           # pontes simultâneas (uma por servidor do Discord)
JITTER_MIN_FRAMES=1                      # jitter buffer em frames de 20ms
JITTER_MAX_FRAMES=6
```

## 4. Rodar

Docker (VPS ou local; precisa do Docker Compose 2.24 ou mais novo):

```bash
cd discord_bridge
docker compose up -d --build
docker compose logs -f bridge
```

Sem Docker:

```bash
python -m venv .venv-bridge
.venv-bridge/Scripts/activate        # Linux: source .venv-bridge/bin/activate
pip install -r discord_bridge/requirements.txt
python -m discord_bridge
```

No Linux sem Docker, instale `libopus0` (`apt-get install libopus0`).

No Discord:

```
/bridge enter canal_id:<uuid do canal de voz do Órbita> [canal_discord:<canal>]
/bridge status
/bridge leave
```

Sem `canal_discord`, a ponte usa o canal de voz em que você está.

### Como pegar o ID do canal de voz do Órbita

**Pelo botão (jeito normal):** abra o canal de voz no Órbita e clique no ícone
**#** no canto superior direito, ao lado de "Voltar ao chat". A janela mostra o
ID e o comando `/bridge enter` pronto, com botões para copiar. O ícone só
aparece para os ADMs globais do Órbita (`site_roles` creator/admin).

**Pelas ferramentas de desenvolvedor (se o botão não estiver disponível):**
toda vez que alguém entra numa call, o navegador chama
`/api/channels/<ID>/join`, e o ID aparece na aba Rede. Funciona no computador
(Firefox, Chrome, Edge), não no celular.

1. Abra o Órbita no navegador e faça login.
2. Pressione **F12** para abrir as ferramentas de desenvolvedor e vá na aba
   **Rede** (*Network*).
3. No campo **Filtrar URLs** (*Filter*), digite `join`.
4. Entre no canal de voz que você quer ligar ao Discord. Se já estava nele,
   saia e entre de novo, porque a lista só registra o que acontece com ela aberta.
5. Aparece uma linha `POST` para um endereço como:
   ```
   /api/channels/43c196dd-eba3-4bda-a724-e3fd74263936/join
   ```
   O ID é o trecho entre `channels/` e `/join`: 36 caracteres, com 4 hífens.
6. Clique com o botão direito na linha → **Copiar** → **Copiar URL**, cole num
   bloco de notas e apague o resto do endereço, deixando só o ID.
7. No Discord, entre num canal de voz e rode:
   ```
   /bridge enter canal_id:43c196dd-eba3-4bda-a724-e3fd74263936
   ```

O ID é fixo: cada canal de voz do Órbita tem sempre o mesmo. Basta pegar uma
vez e guardar.

Para quem roda a ponte, há outro caminho: as calls abertas aparecem como salas
`channel-<ID>` no painel do LiveKit Cloud (*Sessions*), com o nome de quem está
dentro.

## Saúde e métricas

- `GET /health` → `200` com o estado de cada ponte quando o bot está no gateway,
  `503` enquanto inicia.
- `GET /metrics` → formato Prometheus: `bridge_side_connected`,
  `bridge_reconnects_total`, `bridge_latency_ms` (atraso que a ponte adiciona:
  buffer + 1 frame, sem contar a rede), `bridge_jitter_ms`, `bridge_buffer_ms`,
  `bridge_underruns_total`, `bridge_drift_drops_total`,
  `bridge_overflow_drops_total`, `bridge_loss_ratio` e
  `bridge_dave_decrypt_failures_total`.
- Logs JSON (structlog). A cada `STATS_LOG_INTERVAL` sai um evento
  `bridge_stats` com latência, perda e drift por direção.

## Testes

```bash
pip install -r discord_bridge/requirements-dev.txt
python -m pytest discord_bridge/tests
```

Teste ponta a ponta sem duas pessoas: sobe um LiveKit local e simula um usuário
do Discord e um participante do Órbita falando em rajadas, medindo a latência
de cada sentido (alvo: mediana < 250ms):

```bash
discord_bridge/scripts/local-test                 # precisa de Docker
python -m discord_bridge.scripts.local_test       # contra o LiveKit do seu .env
```

O "Discord" desse teste é simulado no próprio processo. O caminho real do
Discord (gateway, DAVE, voice_recv) só é exercitado com o bot num servidor de
verdade.

## Limitações

- **Uma voz por lado.** Um bot tem uma única conexão de voz por servidor, então
  o Discord ouve todo mundo do Órbita como uma voz só (a mistura), e o Órbita
  ouve o Discord como um participante só. Para vozes separadas seria preciso um
  bot (token, aplicação e conexão) por participante, com o custo e a
  complexidade multiplicados. Não está implementado.
- **Recepção de áudio no Discord não é API oficial.** O `discord-ext-voice-recv`
  funciona, mas a Discord pode mudar o protocolo sem aviso. Falhas aparecem no
  log como `discord_receive_failed`, e o watchdog religa o receptor.
- **DAVE (criptografia ponta a ponta de voz).** O `voice_recv` 0.5.2 não
  decripta DAVE. `DaveRecvClient` faz essa etapa com a sessão DAVE do
  discord.py. Isso foi escrito contra as APIs das bibliotecas, mas ainda não foi
  validado num canal real. Se aparecer `bridge_dave_decrypt_failures_total`
  subindo, ou só silêncio vindo do Discord, é aqui.
- **Uma ponte por servidor do Discord, várias por instância.** Dois servidores
  podem ligar no mesmo canal do Órbita: cada um ouve o outro pela sala LiveKit.
- **Latência.** A ponte adiciona ~20–140ms (buffer adaptativo + 1 frame). O
  resto é rede (VPS ↔ Discord e VPS ↔ LiveKit) mais o jitter buffer do
  WebRTC/Discord nos clientes. Hospede a ponte perto dos dois, por exemplo na
  mesma região do LiveKit.
- **Hospedagem.** A ponte é um processo de longa duração, separado do site. Ela
  não entra no `render.yaml`, porque no Render um *worker* sempre ligado é pago.
  Rode no seu PC ou numa VPS com Docker.
