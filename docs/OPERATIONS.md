# Compilação, banco e serviços opcionais

## Publicar a interface

Use Node 24: `npm ci` e `npm run build`. Commitar os fontes, o lockfile e os arquivos apontados por `static/dist/manifest.json`, além de `static/dist/index.html`. O build do Render executa esse mesmo `npm ci && npm run build` antes de reiniciar o Python; o processo em execução só serve os arquivos compilados e não depende de Node. `python scripts/check_build.py` verifica a integridade dos artefatos. Arquivos JS/CSS com hash recebem cache imutável por um ano; HTML, versão e APIs são revalidados ou não armazenados. Não apague arquivos com hash de uma versão publicada enquanto clientes antigos puderem solicitá-los.

O build usa esbuild com divisão de código e Lightning CSS. Feed, estilos do feed, temas extras, busca, aparência do perfil, administração e SDK de telemetria carregam sob demanda. Uma preferência de tema salva é carregada na entrada para respeitar a escolha da pessoa. LiveKit continua sendo importado ao entrar na chamada.

`app.js` continua coordenando a sessão e o chat; ele não foi inteiramente reescrito. Busca, administração, feed, aparência, paletas, atualização e compartilhamento têm módulos próprios. Essa divisão gradual preserva os controles de áudio, chamadas e políticas existentes.

## Publicação e disponibilidade

- `render.yaml` define `autoDeploy: true` e `healthCheckPath: /healthz`: um push na branch publicada já dispara o deploy, e o Render troca o tráfego só depois que `/healthz` responde 200.
- Gate de CI: para impedir publicação com teste quebrado, marque o workflow **Qualidade da Órbita** como obrigatório para `main` (GitHub → Settings → Branches → Branch protection) e escolha **After CI Checks Pass** em Auto-Deploy no painel do Render. Sem essas duas configurações, o deploy continua saindo direto no push.
- `/healthz` responde apenas que o processo Python está vivo (é o que o Render usa). `/readyz` confere também o login do Supabase e devolve 503 quando ele não responde; monitores externos devem usar `/readyz`.
- O token do LiveKit vale 2 minutos a partir da emissão. Quem entra na chamada depois desse prazo já recebeu um token novo; uma pessoa removida não consegue reconectar com o token antigo. Reconexões automáticas pedem outro token à API.

## Uma fonte de verdade para o banco

Edite somente `supabase/migrations/*.sql`. O baseline congela o esquema anterior ao feed; os arquivos seguintes acrescentam feed, atividade, administradores e denúncias. Os antigos patches da pasta `migrations/` estão preservados no histórico Git e no backup local, e foram incorporados no baseline.

Execute `python scripts/database.py --write` após alterar uma migração para gerar `supabase.sql`. A CI rejeita divergência entre o SQL gerado e a cadeia canônica. Não edite o arquivo gerado à mão.

- Projeto novo: executar o `supabase.sql` gerado uma única vez, ou aplicar a cadeia canônica em ordem.
- Projeto existente: aplicar somente a migração nova ainda não aplicada, depois de conferir o histórico remoto. Nunca executar o baseline ou o SQL completo em cima da produção. O projeto atual já tinha feed e administradores; recebeu somente a nova migração de denúncias.
- A consolidação de arquivos não reescreve o histórico interno do Supabase. Antes de adotar `supabase db push` em uma instalação antiga, reconcilie o baseline com o histórico remoto usando o procedimento oficial de migration repair e confirme que o esquema corresponde. Não automatizar repair, reset ou reaplicar patches em produção.

## Verificações automáticas

O workflow `quality.yml` roda em todo push e pull request, inclusive em repositório privado: testes Python, testes unitários JS, grupos de navegação, chamadas, mídia e qualidade no Chromium, verificação dos artefatos e testes do desktop. Nenhuma credencial Supabase/LiveKit é usada: as contas e mídias de navegador são simuladas. A verificação de acesso SQL foi executada separadamente, com transação revertida, no projeto conectado. Testes históricos de layouts dos ZIPs Jesus 7/8 continuam como referência; a suíte mantida cobre o layout atual.

Para rodar localmente: iniciar `python -m uvicorn app:app --port 8766` e executar `npm run test:browser`. `CHROME_PATH` permite usar um Chrome instalado; sem a variável, instalar o navegador de teste com `npx playwright install chromium`. `accessibility_browser.cjs` usa axe-core e mede as 12 paletas nos modos claro e escuro. Isso ajuda a prevenir regressões e não substitui testes com pessoas ou leitores de tela.

## Sentry e estatísticas (opcionais, desligados por padrão)

Nenhuma conta foi criada e nenhum serviço foi contratado. Para ativar depois, escolher um projeto/plano gratuito e preencher apenas no Render:

- `SENTRY_PUBLIC_DSN`: DSN público do projeto Browser JavaScript. O SDK só é importado quando há configuração. A integração não grava sessões, não cria traces e remove usuário, requisição, breadcrumbs, texto de erro e parâmetros de URLs dos eventos enviados; preserva o tipo do erro e os quadros da pilha.
- `UMAMI_SCRIPT_URL` e `UMAMI_WEBSITE_ID`: endereço HTTPS e ID do site de uma instância Umami que você já tenha. Não foi provisionado servidor ou plano. A integração respeita Do Not Track e envia somente eventos genéricos de tela (`text`, `voice`, `feed`, `friends`), sem IDs, nomes, texto das mensagens ou URLs das conversas.

Não inserir tokens secretos de gerenciamento no frontend. Deixar essas variáveis vazias mantém as integrações desligadas e sem solicitações externas. Plausible não foi adicionado em paralelo para evitar coleta duplicada.

## Monitoramento externo

Quando houver conta UptimeRobot, criar monitor HTTP(s) GET para `https://orbita-8nwu.onrender.com/readyz`, intervalo de 5 minutos e resposta esperada HTTP 200. `/readyz` devolve 503 se o Supabase não responder, então o alerta cobre também a indisponibilidade do banco. O monitor ainda não foi criado porque não há conta conectada. Monitoramento detecta falhas, mas não garante disponibilidade nem remove as cotas ou as regras de suspensão do Render Free. Consulte https://render.com/docs/free.

## Backup e restauração (Supabase)

O plano gratuito do Supabase não deve ser tratado como backup de longo prazo. Antes de aplicar migrações e pelo menos uma vez por mês:

1. Exporte o banco pela conexão direta do projeto (Supabase → Project Settings → Database → Connection string → URI):
   `pg_dump "postgresql://postgres:SENHA@db.PROJETO.supabase.co:5432/postgres" --schema=public --no-owner --no-privileges > backup-AAAA-MM-DD.sql`
2. Baixe os arquivos do Storage (Supabase → Storage) para uma pasta no seu computador ou nuvem pessoal. O dump do banco não inclui os arquivos enviados.
3. Guarde os dois fora do repositório e do Render; eles contêm dados pessoais e nunca devem ser commitados.
4. Para restaurar, crie um projeto Supabase novo, execute `supabase.sql` (esquema) e depois o dump `public`; reenvie os arquivos do Storage.

O dump não transporta usuários do Supabase Auth (senhas e tokens). Em uma restauração real, as pessoas precisam entrar novamente ou ser recriadas pelo painel; mantenha a lista de e-mails dos membros em local seguro.

## Nuvem de IA (Cloe) e cotas

A Cloe usa Groq. As cotas diárias por pessoa ficam em memória e são ajustáveis no Render (valores em 0 desligam a cota):

- `CLOE_DAILY_STT_SECONDS` (padrão 7200): segundos de áudio transcrito por dia.
- `CLOE_DAILY_ASKS` (padrão 200): perguntas respondidas pelo modelo por dia.
- `CLOE_DAILY_TTS_CHARS` (padrão 100000): caracteres de voz neural por dia.
- `CLOE_DAILY_WEB_SEARCHES` (padrão 50): pesquisas na internet por dia.

Desempenho e concorrência também são ajustáveis sem mexer no código:

- `CLOE_CONTEXT_CHARS` (padrão 8000): tamanho do histórico de perguntas enviado ao modelo; menor responde mais rápido.
- `CLOE_MAX_ANSWER_TOKENS` (padrão 500): teto da resposta falada; respostas longas demoram mais.
- `CLOE_REASONING_EFFORT` (padrão `low`): esforço de raciocínio do `gpt-oss`; `low` prioriza velocidade.
- `CLOE_ANSWER_QUEUE` (padrão 3): perguntas simultâneas aguardando resposta na mesma call.
- `CLOE_MEMBER_CACHE_SECONDS` (padrão 5): tempo do cache da checagem de presença no LiveKit. Presença negativa nunca é cacheada.

A voz natural (Thalita ou Francisca) é a única reproduzida quando escolhida. Se o serviço da Microsoft falhar, a Cloe não substitui a voz: o painel avisa e a resposta fica em texto até a voz voltar.

### Escuta sob demanda

A Cloe não transcreve a conversa. O microfone só é capturado quando alguém toca em **Falar com a Cloe**; nesse momento o navegador grava um único trecho curto e o envia como pergunta. O servidor trata esse trecho como dirigido a ela mesmo sem “Ei Cloe” (parâmetro `direct=1`) e guarda apenas as perguntas feitas à Cloe, que formam o contexto de 15 minutos do modelo. Falas fora do botão não são transcritas nem armazenadas.

Como consequência, não há mais detecção contínua do nome nem interrupção por voz (“para de falar”); a fala é interrompida pelo botão **Parar fala** ou por um novo toque em **Falar com a Cloe**. A Cloe também não resume a call inteira: ela conhece somente o que foi perguntado a ela. O trecho é enviado após pausa de fala ou após 8 segundos, com limite de 12 segundos de espera no botão antes de avisar que não ouviu nada.

### Administração pela Cloe

A administração só existe para a conta definida em `CLOE_OWNER_ID` (UUID do Supabase). Sem essa variável, o modo fica desligado e a Cloe avisa. Outros usuários — inclusive outros administradores do site — recebem recusa. Cada pedido vira uma proposta e só executa após a frase `CLOE_CONFIRM_PHRASE` (padrão `Eu Kalil Confirmo`) ser falada no microfone pelo dono autenticado na call — toque em **Falar com a Cloe** e diga a frase. A frase é removida do histórico do modelo e nunca é revelada; confirmação por texto é recusada. `CLOE_OWNER_ACTION_SECONDS` (padrão 90) expira a proposta e `CLOE_OWNER_ATTEMPTS` (padrão 3) limita as tentativas erradas.

Moderação (banir, remover, suspender, apagar mensagem, encerrar call, expulsar) passa pelas funções SQL auditadas já existentes e exige que o dono seja administrador/criador do site. Canais, cargos e dados do servidor são gravados com a sessão do próprio dono no PostgREST, então as políticas RLS valem; essas alterações ficam no log do servidor. Excluir canais, servidores ou cargos e transferir posse continuam bloqueados.

### Pesquisa na internet

Defina `BRAVE_API_KEY` (plano gratuito do Brave: 2.000 consultas/mês) para ligar a pesquisa. A Cloe só busca por pedido explícito ou assunto temporal (notícias, cotação, placar, previsão), lê até três páginas e mostra os links no painel. O servidor valida DNS e IP públicos, recusa endereços internos e portas fora de 80/443, segue no máximo três redirecionamentos, limita cada página a 600 KB/8 s e guarda o resultado por 10 minutos. O conteúdo é marcado como não confiável no prompt; a resposta falada não lê URLs. As pesquisas contam em `CLOE_DAILY_WEB_SEARCHES` e a cota global gratuita é compartilhada por todos.

Como o contador é de um único processo, reiniciar o serviço zera o dia e não há compartilhamento entre instâncias. O limite do YouTube também é por conta (20 buscas novas e 60 chamadas à API por 10 minutos), mas protege uma cota compartilhada; veja `README.md`.

## PWA, mídia e atualização

O manifest contém categorias, screenshots e recebimento de links/imagens. O compartilhamento exige navegador com suporte a Web Share Target e PWA instalada; o aplicativo Windows Electron não passa a registrar o menu de compartilhamento do Windows por causa do manifest. Imagens recebidas ficam no IndexedDB local, com limite de 5 arquivos/25 MB e validade de 30 minutos. Um novo compartilhamento substitui o anterior. A pessoa escolhe o destino e confirma antes do envio; o texto fica como rascunho. Não há upload intermediário para Render.

Vídeos enviados continuam reproduzindo sem som somente quando visíveis. O feed usa um quadro do vídeo como capa após carregar metadados, com CORS anônimo para permitir a captura em canvas. Não foram criadas cópias extras no Storage. Vídeos privados continuam usando URLs assinadas.

O aplicativo consulta `/api/version` ao voltar para a janela, recuperar conexão e a cada 5 minutos enquanto visível. Uma versão diferente mostra aviso: Ctrl + R no Windows ou atualizar a página no navegador. Não há recarga automática durante uma chamada. O botão pede confirmação se houver chamada ou texto não enviado. Rascunhos em memória não sobrevivem à recarga; a confirmação avisa sobre conteúdo pendente. A versão instalada do launcher continua válida.

Busca global usa as políticas atuais do Supabase, com filtros de canal/DM, autor e datas. Denúncias de mensagens só podem referenciar mensagens acessíveis ao denunciante. Administradores podem resolver denúncias; a denúncia não concede acesso ao conteúdo de DMs. Threads, status personalizado, moderação e auditoria existentes foram preservados.
