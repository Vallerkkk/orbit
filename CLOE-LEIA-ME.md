# Cloe na Órbita

Esta atualização integra a Cloe às calls existentes, usando Groq para transcrever e responder. Ela aparece automaticamente quando um participante entra, sem botão para adicionar um bot. Para chamar, toque em **Falar com a Cloe** no painel; o nome **“Ei Cloe”** é opcional depois do toque. A interface, as respostas e a voz usam somente o nome Cloe.

## Usar

1. Execute o app como antes. As configurações de Supabase e LiveKit existentes continuam necessárias.
2. A chave fornecida já está no arquivo privado `.env.astro`, lido pelo servidor e ignorado pelo Git. Guarde esse arquivo; não o envie manualmente ao GitHub nem o copie para `static/`.
3. No servidor hospedado, defina `GROQ_API_KEY` nas variáveis de ambiente com a mesma chave. O arquivo ignorado pelo Git não acompanha um deploy feito pelo repositório. Reinicie o serviço depois de definir a variável.
4. Entre numa call. Abra **✦ Cloe · Transcrição** para ver as abas **Transcrição** e **Respostas da Cloe**.
5. Toque em **Falar com a Cloe** e diga, por exemplo: **“o que combinamos sobre o lançamento?”**. Um toque grava um trecho; espere a resposta antes de tocar de novo. Também pode escrever no campo de texto abaixo.
6. Para interromper a fala, toque em **Parar fala** ou toque em **Falar com a Cloe** e comece a falar — o novo pedido interrompe a resposta. Fones de ouvido ou o cancelamento de eco ligado ajudam a voz da própria Cloe não voltar pelo microfone.
7. Se o navegador bloquear som, toque em **Testar voz**. A voz padrão é a **Thalita**, uma voz neural feminina gerada no servidor; no painel também é possível escolher **Francisca** ou a voz do aparelho. A Cloe usa **somente** a voz escolhida: se ela não estiver disponível, o painel avisa e a resposta aparece apenas em texto, sem trocar de voz sozinha.
8. No **Ouvir juntos**, toque em **Falar com a Cloe** e diga o comando, ou escreva por texto: “próxima música”, “pausa a música”, “continua”, “limpar a fila”, “limpar a lista de reprodução”, “remove a segunda da fila”, “embaralha a fila”, “que música está tocando”, “volume 60” e “toque Wonderwall”. O nome pode vir no fim (“próxima música, Cloe”) e a lista de reprodução também é chamada de fila ou playlist. Quem pede executa no próprio navegador; o player sincroniza a mudança para a call inteira. Para escolher uma música específica é preciso estar numa call de voz e ter a chave `YOUTUBE_API_KEY` configurada no servidor; links completos funcionam sem a chave.

9. **Pesquisa na internet:** toque em **Falar com a Cloe** e peça de forma explícita, como **“pesquisa na internet sobre a tarifa do metrô”** ou **“quais são as últimas notícias de tecnologia?”**. A Cloe busca no Brave, lê até três páginas e responde em voz curta; os links aparecem na aba **Respostas da Cloe** para abrir no navegador. Ela não lê endereços em voz alta e não obedece instruções escritas dentro das páginas. Sem `BRAVE_API_KEY`, o painel avisa que a pesquisa não está configurada.
10. **Administração pela Cloe:** só a conta definida em `CLOE_OWNER_ID` pode dar ordens administrativas, e só dentro de uma call de canal do servidor. Toque em **Falar com a Cloe** e diga, por exemplo: “silencia o João”, “expulsa o João da call”, “bane o João”, “suspende a conta do João por 24 horas”, “apaga a última mensagem do canal geral”, “cria um canal de voz chamado música”, “cria um cargo Moderador na cor azul com a permissão de gerenciar mensagens”, “muda o nome do servidor para Órbita”. A Cloe primeiro **descreve** o que vai fazer e espera a frase de confirmação falada (padrão **“Eu Kalil Confirmo”**), também dita depois de tocar no botão. A frase nunca aparece na transcrição, nas respostas nem no contexto do modelo. Escrever a frase no campo de texto **não** executa nada: a confirmação precisa ser falada no microfone. Três tentativas erradas ou 90 segundos sem confirmar cancelam o pedido. Diga “cancela” para desistir. Excluir canais, excluir servidores, excluir cargos e transferir a posse continuam **fora** do alcance da Cloe.

O envio do próprio microfone pode ser pausado com **Pausar meu áudio**. Microfones fechados, áudio de tela e câmera não são enviados. A Cloe só recebe áudio quando você toca em **Falar com a Cloe**; o resto da conversa não é transcrito nem guardado. O painel avisa que o trecho enviado é processado pela Groq. O mesmo funcionamento vale para calls privadas e canais de voz.

## Como funciona

- Cada navegador usa uma cópia do microfone que já está publicado na call. Não abre outro microfone.
- O worklet fica desligado até o toque em **Falar com a Cloe**. Ao tocar, o trecho é gravado até uma pausa de fala (ou até 8 segundos) e enviado como WAV mono PCM16 a 16 kHz. Um toque grava um trecho; não há transcrição contínua.
- A transcrição usa `whisper-large-v3-turbo` com `language=pt`. O nome do participante vem do LiveKit, não de texto informado pelo cliente.
- A resposta usa `openai/gpt-oss-20b` com o histórico das perguntas dirigidas à Cloe naquela sala (últimos 15 minutos), limitado a cerca de 8 mil caracteres para responder mais rápido. O modelo não recebe a conversa geral; não treina nem cria memória pessoal permanente.
- A resposta volta na mesma requisição do áudio ou da pergunta escrita: o painel mostra e fala sem esperar a próxima consulta. Perguntas feitas juntas entram numa fila curta em vez de serem recusadas; a repetição do mesmo pedido em até 3 segundos é ignorada.
- A aba de transcrição mostra só os trechos enviados à Cloe; as respostas aparecem na outra aba. O histórico desta versão também é limitado aos últimos 15 minutos.
- A resposta chega em texto a todos os participantes com o app atualizado; cada dispositivo reproduz a fala localmente. Não há um participante de áudio autônomo no servidor, nem uma voz sendo publicada como trilha no LiveKit. Aparelhos podem ter vozes ou tempos ligeiramente diferentes.
- A voz natural usa o mesmo motor neural do "Ler em voz alta" do Microsoft Edge, sem chave de API. O texto da resposta é enviado a esse serviço para gerar o MP3; ele não é gravado no projeto. Falas repetidas ficam em cache por alguns minutos. Essa voz depende da internet e pode levar de 1 a 4 segundos para começar; tocar em **Falar com a Cloe** interrompe a fala antes de gravar o novo pedido.
- Enquanto a Cloe fala, nenhum áudio é capturado. Use **Parar fala** ou toque em **Falar com a Cloe** para interromper.
- O servidor confere a presença real na sala no LiveKit antes de ler o histórico ou aceitar áudio. Só participantes autorizados a publicar podem enviar áudio.
- A pesquisa usa a API do Brave (`BRAVE_API_KEY`) e só é acionada por pedido explícito ou por assunto que muda o tempo todo (notícias, cotação, placar, previsão). O servidor recusa endereços internos, segue no máximo três redirecionamentos, limita tamanho e tempo de cada página e guarda o resultado por 10 minutos. O texto das páginas é marcado como **dado não confiável** no pedido ao modelo.
- As ações administrativas usam a sessão do próprio dono no Supabase: as regras de permissão do banco continuam valendo. Moderação de membros, mensagens e calls passa pelas funções auditadas já existentes; criação e edição de canais, cargos e dados do servidor são registradas no log do servidor. O dono precisa ter cargo de administrador ou criador no site para as ações de moderação.
- O painel só mostra o rótulo **Fontes** para links `http`/`https` públicos; endereços internos, `javascript:` e duplicados são descartados. A resposta falada nunca inclui URLs.
- Não há nova tabela ou migração de banco. O contexto fica na memória de um único processo e se perde ao reiniciar. Execute com **um worker e uma instância**; múltiplos processos exigem um armazenamento compartilhado antes de escalar.

## Limites práticos

Todos os participantes precisam carregar esta versão para falar com a Cloe pelo botão. O recurso depende de HTTPS (ou localhost), AudioWorklet, permissão de microfone, conexão e cota disponível na Groq. Uma aba suspensa pelo sistema, especialmente no celular em segundo plano, pode interromper a captura. Falas muito baixas, ruído ou cortes de trechos podem causar erros. Em rede lenta a fila é limitada e trechos podem ser descartados, com aviso no painel.

O plano da Groq pode ter limites e custos. O envio só no toque reduz o consumo, mas não garante funcionamento gratuito e ilimitado. A pesquisa na internet depende da cota gratuita do Brave (2.000 consultas/mês por padrão) e de páginas que aceitem leitura automática; sem chave, ela fica desligada e avisa. A busca do YouTube continua separada e é usada somente para pedidos de música no Ouvir juntos. A voz neural gratuita depende de um serviço externo da Microsoft: se ele mudar ou ficar fora do ar, a Cloe **não troca de voz** — o painel avisa e a resposta fica em texto até a voz escolhida voltar.

Configure modelos e desempenho no servidor usando `CLOE_STT_MODEL`, `CLOE_LLM_MODEL`, `CLOE_CONTEXT_CHARS` (padrão 8000), `CLOE_MAX_ANSWER_TOKENS` (padrão 500), `CLOE_REASONING_EFFORT` (padrão `low`), `CLOE_ANSWER_QUEUE` (padrão 3) e `CLOE_MEMBER_CACHE_SECONDS` (padrão 5).

Administração e pesquisa usam `CLOE_OWNER_ID` (UUID da **sua** conta no Supabase; vazio desliga a administração), `CLOE_CONFIRM_PHRASE` (padrão `Eu Kalil Confirmo`), `CLOE_OWNER_ACTION_SECONDS` (padrão 90), `CLOE_OWNER_ATTEMPTS` (padrão 3) e `BRAVE_API_KEY`. Nenhuma migração de banco é necessária: as permissões existentes são reaproveitadas.

### Limites diários por pessoa

Para o uso de uma conta não consumir a cota paga de todo mundo, o servidor guarda um contador por pessoa e por dia:

- `CLOE_DAILY_STT_SECONDS` (padrão 7200): segundos de áudio transcrito.
- `CLOE_DAILY_ASKS` (padrão 200): perguntas respondidas pelo modelo.
- `CLOE_DAILY_TTS_CHARS` (padrão 100000): caracteres de voz neural.
- `CLOE_DAILY_WEB_SEARCHES` (padrão 50): pesquisas na internet.

Ao passar do limite, a Cloe responde HTTP 429 com aviso em português e volta no dia seguinte. Defina `0` para desligar uma cota. O contador é em memória: reiniciar o serviço zera o dia e não vale entre instâncias — o Render Free roda um processo só.

## Validação

Testes automatizados cobrem a janela temporal, isolamento de salas e participantes, ativação dividida em trechos, autorização de presença/publicação, WAV inválido, silêncio, duplicação de pedidos, recuperação de erros, o portão do dono, expiração e tentativas de confirmação, redação da frase, bloqueio de comandos proibidos, cada ação administrativa, detecção de pesquisa, bloqueio de endereços internos, extração de páginas, cache e cotas. O áudio PCM e o limite dos trechos têm testes de unidade em JavaScript. O pacote inclui o build atualizado.

Validação nesta integração: 187 testes Python (incluindo `test_astro.py`, `test_cloe_admin.py` e `test_cloe_web.py`), 125 testes de JavaScript (incluindo `tests/astro.test.mjs`) e os testes de navegador da Cloe (painel com o botão “Falar com a Cloe”, pedido por texto com o Ouvir juntos, resposta imediata e voz estrita) passaram contra o build atual. A chave da Groq usada pelo autor no pacote original respondeu HTTP 200; aqui nenhuma call real com vários dispositivos foi testada, porque isso depende de microfone, HTTPS e cota da Groq.

## Origem dos arquivos

O recurso chegou como cópia do projeto cujo ZIP estava truncado em `static/vendor/rnnoise-0.4.1/rnnoise.wasm`; os arquivos ausentes foram recompostos de um ZIP anterior. A integração aqui aproveitou somente os arquivos da assistente (`astro_call.py`, `static/astro-call.js`, `static/astro-recorder.js`, testes e este documento) e a fiação mínima em `app.py`, `static/app.js`, `static/private-call-menu.js`, `static/call-layout.css` e `.env.example`. O restante daquela cópia era mais antigo que o repositório e foi descartado, inclusive a tela de carregamento antiga e um botão de emoji duplicado. Alterações exclusivas da parte perdida do ZIP podem não existir.

Documentação consultada:
- https://console.groq.com/docs/overview
- https://console.groq.com/docs/speech-to-text
- https://console.groq.com/docs/models
- https://github.com/rany2/edge-tts
- https://learn.microsoft.com/azure/ai-services/speech-service/language-support
