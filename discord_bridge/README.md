# Ponte de voz Órbita ↔ Discord

Um bot Discord que entra num canal de voz do Discord e, ao mesmo tempo, entra na
sala LiveKit da chamada de voz correspondente no Órbita. Ele mixa e retransmite
o áudio nos dois sentidos: quem fala no Discord é ouvido no Órbita, e quem fala
no Órbita é ouvido no Discord — como uma live de áudio compartilhada entre as
duas plataformas.

Isso é uma integração via bot, não uma "chamada direta" entre um usuário do
Discord e um usuário do Órbita: o bot é sempre o participante do meio nos dois
lados.

## O que você precisa fazer manualmente (contas de terceiros, não posso fazer por você)

1. **Criar a aplicação do bot** em https://discord.com/developers/applications
   → *New Application* → aba **Bot** → **Reset Token** e copie o token.
   Em **Privileged Gateway Intents** não é necessário ligar nada extra (a ponte
   usa apenas `guilds` e `voice_states`, que são intents padrão).
2. **Convidar o bot para o seu servidor**: aba **OAuth2 → URL Generator**,
   marque o scope `bot` e as permissões `Connect`, `Speak`, `Use Voice Activity`
   e `Use Application Commands`. Abra a URL gerada e escolha seu servidor.
3. Guarde o **UUID do canal de voz do Órbita** que você quer bridgear (é o
   `id` da linha em `channels` no Supabase, o mesmo usado na URL
   `channel-<uuid>` da sala LiveKit).

## Configuração

No arquivo `.env` do projeto (mesmo arquivo que já tem `LIVEKIT_URL`,
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`), adicione:

```
DISCORD_BOT_TOKEN=<token do passo 1>
```

Instale as dependências da ponte (ambiente separado do app principal, para não
engordar o deploy web com libs de áudio/voz):

```bash
python -m venv .venv-bridge
# Windows:
.venv-bridge\Scripts\activate
# depois:
pip install -r discord_bridge/requirements.txt
```

`discord.py[voice]` precisa da biblioteca nativa **libopus**. No Windows o pip
já traz os binários; no Linux instale `apt-get install libopus0`.

## Rodando

```bash
python -m discord_bridge.bot
```

No Discord, dentro de um canal de voz, use o comando:

```
/orbita_conectar canal_id: <uuid do canal de voz do Órbita>
```

O bot entra no mesmo canal de voz e a ponte fica ativa. Para desligar:

```
/orbita_desconectar
```

## render.yaml

Já adicionei um serviço `orbita-discord-bridge` (`type: worker`) no `render.yaml`
da raiz do projeto. Duas coisas para conferir antes de fazer deploy:

- O **plano free do Render não mantém workers ligados 24h** — por isso o
  serviço está como `plan: starter` (pago). Se preferir não pagar, remova
  esse bloco do `render.yaml` e rode o bot em outro lugar (seu PC, uma VPS
  grátis) como descrito abaixo.
- `discord.py[voice]` depende da biblioteca nativa **libopus**, que o
  `pip install` não traz em Linux. A imagem padrão do runtime Python do
  Render pode não ter `libopus0` instalado; se o bot falhar ao conectar na
  voz com erro de opus, será necessário trocar esse serviço para um
  `Dockerfile` próprio que rode `apt-get install -y libopus0` antes do
  `pip install`.
- Depois de configurar as variáveis de ambiente (`DISCORD_BOT_TOKEN` e as
  três `LIVEKIT_*`, marcadas `sync: false`) no painel do Render, é preciso
  um deploy do Blueprint para o novo serviço ser criado.

## Hospedagem (ficar online 24h)

Esse processo (`python -m discord_bridge.bot`) precisa ficar rodando
continuamente, separado do servidor web do Órbita (`uvicorn app:app`) — são
dois processos diferentes.

- **Grátis, mais simples**: deixar rodando no seu próprio PC enquanto usar.
- **Render**: o plano *free* de Render é só para Web Services e Static Sites;
  um "Background Worker" que fica sempre ligado normalmente exige um plano
  pago (a partir de ~US$7/mês) lá. Se quiser 24h sem custo, vale olhar um
  free tier de VPS (ex.: Oracle Cloud Always Free) ou um Raspberry Pi/PC de
  casa ligado.
- Não recomendo rodar o bot no mesmo `web: uvicorn app:app` do Render — voz do
  Discord usa um processo de longa duração com estado de conexão persistente,
  diferente do request/response HTTP do FastAPI.

## Limitações conhecidas

- O bot é sempre o "meio de campo": não é uma chamada 1:1 direta entre uma
  pessoa do Discord e uma do Órbita, e sim um áudio compartilhado como se
  fosse uma live.
- Se várias pessoas falarem ao mesmo tempo nos dois lados, o áudio é somado
  (mixado), não tem seleção de quem fala.
- Qualidade/latência dependem da rede do host onde a ponte roda — teste local
  antes de decidir onde hospedar.
- Testado o desenho e a integração com os formatos de áudio do Discord
  (Opus/PCM 48kHz estéreo) e do LiveKit (mesmas taxas), mas uma chamada real
  de ponta a ponta entre as duas plataformas ainda precisa ser validada por
  você com o seu token do bot e suas credenciais LiveKit, que eu não tenho e
  não devo manipular.
