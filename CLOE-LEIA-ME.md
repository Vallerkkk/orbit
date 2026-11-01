# Cloe na Órbita

Esta atualização integra a Cloe às calls existentes, usando Groq para transcrever e responder. Ela inicia automaticamente quando um participante entra, sem botão para adicionar um bot. O comando é **“Ei Cloe”** — a interface, as respostas e a voz usam somente esse nome.

## Usar

1. Execute o app como antes. As configurações de Supabase e LiveKit existentes continuam necessárias.
2. A chave fornecida já está no arquivo privado `.env.astro`, lido pelo servidor e ignorado pelo Git. Guarde esse arquivo; não o envie manualmente ao GitHub nem o copie para `static/`.
3. No servidor hospedado, defina `GROQ_API_KEY` nas variáveis de ambiente com a mesma chave. O arquivo ignorado pelo Git não acompanha um deploy feito pelo repositório. Reinicie o serviço depois de definir a variável.
4. Entre numa call. Abra **✦ Cloe · Transcrição** para ver as abas **Transcrição** e **Respostas da Cloe**.
5. Diga, por exemplo: **“Ei Cloe, o que combinamos sobre o lançamento?”**. Também pode falar “Ei Cloe”, fazer uma breve pausa e perguntar em seguida (até 20 segundos depois).
6. Para interromper a fala, toque em **Parar fala** ou diga **“para de falar”** — “pare”, “parar de falar” e “pode parar” também funcionam, com ou sem o nome. Enquanto a Cloe fala, o microfone continua aberto só para ouvir essa ordem: o restante do áudio é descartado e não entra na transcrição. Fones de ouvido ou o cancelamento de eco ligado ajudam a voz da própria Cloe não voltar pelo microfone.
7. Se o navegador bloquear som, toque em **Testar voz**. A voz padrão é a **Thalita**, uma voz neural feminina gerada no servidor; no painel também é possível escolher **Francisca** ou a voz do aparelho. Se a conexão com o serviço de voz falhar, a Cloe volta sozinha para a voz do aparelho.
8. No **Ouvir juntos**, a Cloe controla o player por voz ou por texto: “Ei Cloe, próxima música”, “Ei Cloe, pausa a música”, “Ei Cloe, continua”, “Ei Cloe, limpar a fila”, “Ei Cloe, limpar a lista de reprodução”, “Ei Cloe, remove a segunda da fila”, “Ei Cloe, embaralha a fila”, “Ei Cloe, que música está tocando”, “Ei Cloe, volume 60” e “Ei Cloe, toque Wonderwall”. O nome pode vir no fim (“próxima música, Cloe”) e a lista de reprodução também é chamada de fila ou playlist. Quem pede executa no próprio navegador; o player sincroniza a mudança para a call inteira. Para escolher uma música específica é preciso estar numa call de voz e ter a chave `YOUTUBE_API_KEY` configurada no servidor; links completos funcionam sem a chave.

O envio do próprio microfone pode ser pausado com **Pausar meu áudio**. Microfones fechados, áudio de tela e câmera não são enviados. O painel avisa que o áudio é processado pela Groq. O mesmo funcionamento vale para calls privadas e canais de voz.

## Como funciona

- Cada navegador captura somente o microfone que já está publicado na call. Não abre outro microfone.
- Os trechos são WAV mono PCM16 a 16 kHz, enviados após pausa de fala ou a cada 8 segundos de fala contínua. A transcrição é quase em tempo real, não palavra por palavra instantaneamente.
- A transcrição usa `whisper-large-v3-turbo` com `language=pt`. O nome do participante vem do LiveKit, não de texto informado pelo cliente.
- A resposta usa `openai/gpt-oss-20b` com as transcrições dos últimos 15 minutos daquela sala. O modelo analisa esse contexto quando chamado; não treina nem cria memória pessoal permanente.
- A aba de transcrição mostra só as falas; as respostas aparecem na outra aba. O histórico desta versão também é limitado aos últimos 15 minutos.
- A resposta chega em texto a todos os participantes com o app atualizado; cada dispositivo reproduz a fala localmente. Não há um participante de áudio autônomo no servidor, nem uma voz sendo publicada como trilha no LiveKit. Aparelhos podem ter vozes ou tempos ligeiramente diferentes.
- A voz natural usa o mesmo motor neural do "Ler em voz alta" do Microsoft Edge, sem chave de API. O texto da resposta é enviado a esse serviço para gerar o MP3; ele não é gravado no projeto. Falas repetidas ficam em cache por alguns minutos. Essa voz depende da internet e pode levar de 1 a 4 segundos para começar; o microfone fica pausado durante a geração para a Cloe não ouvir a si mesma.
- Durante a fala da Cloe, o microfone continua aberto apenas para reconhecer a ordem de parar; o restante do áudio é descartado e não entra na transcrição nem aciona o modelo.
- O servidor confere a presença real na sala no LiveKit antes de ler o histórico ou aceitar áudio. Só participantes autorizados a publicar podem enviar áudio.
- Não há nova tabela ou migração de banco. O contexto fica na memória de um único processo e se perde ao reiniciar. Execute com **um worker e uma instância**; múltiplos processos exigem um armazenamento compartilhado antes de escalar.

## Limites práticos

Todos os participantes precisam carregar esta versão para que os respectivos microfones sejam transcritos. O recurso depende de HTTPS (ou localhost), AudioWorklet, permissão de microfone, conexão e cota disponível na Groq. Uma aba suspensa pelo sistema, especialmente no celular em segundo plano, pode interromper a captura. Falas muito baixas, ruído ou cortes de trechos podem causar erros. Em rede lenta a fila é limitada e trechos podem ser descartados, com aviso no painel.

O plano da Groq pode ter limites e custos. O descarte de silêncio reduz pedidos, mas não garante funcionamento gratuito e ilimitado. A Cloe não faz pesquisa na web para responder perguntas; a busca do YouTube é usada somente para pedidos de música no Ouvir juntos. A voz neural gratuita depende de um serviço externo da Microsoft: se ele mudar ou ficar fora do ar, a Cloe continua falando com a voz do aparelho.

Configure modelos alternativos no servidor usando `CLOE_STT_MODEL` e `CLOE_LLM_MODEL`.

### Limites diários por pessoa

Para o uso de uma conta não consumir a cota paga de todo mundo, o servidor guarda um contador por pessoa e por dia:

- `CLOE_DAILY_STT_SECONDS` (padrão 7200): segundos de áudio transcrito.
- `CLOE_DAILY_ASKS` (padrão 200): perguntas respondidas pelo modelo.
- `CLOE_DAILY_TTS_CHARS` (padrão 100000): caracteres de voz neural.

Ao passar do limite, a Cloe responde HTTP 429 com aviso em português e volta no dia seguinte. Defina `0` para desligar uma cota. O contador é em memória: reiniciar o serviço zera o dia e não vale entre instâncias — o Render Free roda um processo só.

## Validação

Testes automatizados cobrem a janela temporal, isolamento de salas e participantes, ativação dividida em trechos, autorização de presença/publicação, WAV inválido, silêncio, duplicação de pedidos e recuperação de erros. O áudio PCM e o limite dos trechos têm testes de unidade em JavaScript. O pacote inclui o build atualizado.

Validação nesta integração: 125 testes Python (incluindo `tests/test_astro.py`), 117 testes de JavaScript (incluindo `tests/astro.test.mjs`) e o teste de interface `tests/astro_panel_browser.cjs` passaram contra o build atual. A chave da Groq usada pelo autor no pacote original respondeu HTTP 200; aqui nenhuma call real com vários dispositivos foi testada, porque isso depende de microfone, HTTPS e cota da Groq.

## Origem dos arquivos

O recurso chegou como cópia do projeto cujo ZIP estava truncado em `static/vendor/rnnoise-0.4.1/rnnoise.wasm`; os arquivos ausentes foram recompostos de um ZIP anterior. A integração aqui aproveitou somente os arquivos da assistente (`astro_call.py`, `static/astro-call.js`, `static/astro-recorder.js`, testes e este documento) e a fiação mínima em `app.py`, `static/app.js`, `static/private-call-menu.js`, `static/call-layout.css` e `.env.example`. O restante daquela cópia era mais antigo que o repositório e foi descartado, inclusive a tela de carregamento antiga e um botão de emoji duplicado. Alterações exclusivas da parte perdida do ZIP podem não existir.

Documentação consultada:
- https://console.groq.com/docs/overview
- https://console.groq.com/docs/speech-to-text
- https://console.groq.com/docs/models
- https://github.com/rany2/edge-tts
- https://learn.microsoft.com/azure/ai-services/speech-service/language-support
