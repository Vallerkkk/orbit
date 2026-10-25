# Astro na Órbita

Esta atualização integra o Astro às calls existentes, usando Groq para transcrever e responder. Ele inicia automaticamente quando um participante entra, sem botão para adicionar um bot.

## Usar

1. Execute o app como antes. As configurações de Supabase e LiveKit existentes continuam necessárias.
2. A chave fornecida já está no arquivo privado `.env.astro`, lido pelo servidor e ignorado pelo Git. Guarde esse arquivo; não o envie manualmente ao GitHub nem o copie para `static/`.
3. No servidor hospedado, defina `GROQ_API_KEY` nas variáveis de ambiente com a mesma chave. O arquivo ignorado pelo Git não acompanha um deploy feito pelo repositório. Reinicie o serviço depois de definir a variável.
4. Entre numa call. Abra **✦ Astro · Transcrição** para ver as abas **Transcrição** e **Respostas do Astro**.
5. Diga, por exemplo: **“Ei Astro, o que combinamos sobre o lançamento?”**. Também pode falar “Ei Astro”, fazer uma breve pausa e perguntar em seguida (até 20 segundos depois).
6. Se o navegador bloquear som, toque em **Ativar voz**. A voz usada é a voz pt-BR disponível no dispositivo.

O envio do próprio microfone pode ser pausado com **Pausar meu áudio**. Microfones fechados, áudio de tela e câmera não são enviados. O painel avisa que o áudio é processado pela Groq. O mesmo funcionamento vale para calls privadas e canais de voz.

## Como funciona

- Cada navegador captura somente o microfone que já está publicado na call. Não abre outro microfone.
- Os trechos são WAV mono PCM16 a 16 kHz, enviados após pausa de fala ou a cada 8 segundos de fala contínua. A transcrição é quase em tempo real, não palavra por palavra instantaneamente.
- A transcrição usa `whisper-large-v3-turbo` com `language=pt`. O nome do participante vem do LiveKit, não de texto informado pelo cliente.
- A resposta usa `openai/gpt-oss-20b` com as transcrições dos últimos 15 minutos daquela sala. O modelo analisa esse contexto quando chamado; não treina nem cria memória pessoal permanente.
- A aba de transcrição mostra só as falas; as respostas aparecem na outra aba. O histórico desta versão também é limitado aos últimos 15 minutos.
- A resposta chega em texto a todos os participantes com o app atualizado; cada dispositivo reproduz a fala localmente. Não há um participante de áudio autônomo no servidor, nem uma voz sendo publicada como trilha no LiveKit. Aparelhos podem ter vozes ou tempos ligeiramente diferentes.
- Durante a fala do Astro, o envio do microfone é suspenso brevemente para evitar que a IA responda ao próprio áudio. Isso também pode omitir falas sobrepostas à resposta.
- O servidor confere a presença real na sala no LiveKit antes de ler o histórico ou aceitar áudio. Só participantes autorizados a publicar podem enviar áudio.
- Não há nova tabela ou migração de banco. O contexto fica na memória de um único processo e se perde ao reiniciar. Execute com **um worker e uma instância**; múltiplos processos exigem um armazenamento compartilhado antes de escalar.

## Limites práticos

Todos os participantes precisam carregar esta versão para que os respectivos microfones sejam transcritos. O recurso depende de HTTPS (ou localhost), AudioWorklet, permissão de microfone, conexão e cota disponível na Groq. Uma aba suspensa pelo sistema, especialmente no celular em segundo plano, pode interromper a captura. Falas muito baixas, ruído ou cortes de trechos podem causar erros. Em rede lenta a fila é limitada e trechos podem ser descartados, com aviso no painel.

O plano da Groq pode ter limites e custos. O descarte de silêncio reduz pedidos, mas não garante funcionamento gratuito e ilimitado. Não há busca na internet nesta versão.

Configure modelos alternativos no servidor usando `ASTRO_STT_MODEL` e `ASTRO_LLM_MODEL`.

## Validação

Testes automatizados cobrem a janela temporal, isolamento de salas e participantes, ativação dividida em trechos, autorização de presença/publicação, WAV inválido, silêncio, duplicação de pedidos e recuperação de erros. O áudio PCM e o limite dos trechos têm testes de unidade em JavaScript. O pacote inclui o build atualizado.

Validação nesta integração: 125 testes Python (incluindo `tests/test_astro.py`), 117 testes de JavaScript (incluindo `tests/astro.test.mjs`) e o teste de interface `tests/astro_panel_browser.cjs` passaram contra o build atual. A chave da Groq usada pelo autor no pacote original respondeu HTTP 200; aqui nenhuma call real com vários dispositivos foi testada, porque isso depende de microfone, HTTPS e cota da Groq.

## Origem dos arquivos

O recurso chegou como cópia do projeto cujo ZIP estava truncado em `static/vendor/rnnoise-0.4.1/rnnoise.wasm`; os arquivos ausentes foram recompostos de um ZIP anterior. A integração aqui aproveitou somente os arquivos do Astro (`astro_call.py`, `static/astro-call.js`, `static/astro-recorder.js`, testes e este documento) e a fiação mínima em `app.py`, `static/app.js`, `static/private-call-menu.js`, `static/call-layout.css` e `.env.example`. O restante daquela cópia era mais antigo que o repositório e foi descartado, inclusive a tela de carregamento antiga e um botão de emoji duplicado. Alterações exclusivas da parte perdida do ZIP podem não existir.

Documentação consultada:
- https://console.groq.com/docs/overview
- https://console.groq.com/docs/speech-to-text
- https://console.groq.com/docs/models
