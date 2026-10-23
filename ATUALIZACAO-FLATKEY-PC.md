# Lula: Flatkey + transcrição no computador

A IA do Lula utiliza `https://router.flatkey.ai/v1/chat/completions` com o modelo `MiniMax-H3`.

## Render
Configure `FLATKEY_API_KEY` como variável secreta. O modelo pode ser informado em `FLATKEY_MODEL` (padrão: `MiniMax-H3`).

O reconhecimento de áudio do Chrome/Edge pode funcionar diretamente pelo navegador. Em Electron ou quando a Web Speech API não funciona, o Lula utiliza o microfone e envia segmentos para `POST /api/ai/transcribe-audio`.

Para habilitar essa alternativa, configure uma chave Groq em `STT_API_KEY`. O padrão de `STT_MODEL` é `whisper-large-v3-turbo`. A chave Flatkey não substitui uma chave de transcrição.

O áudio processado não é armazenado pela aplicação; ele é encaminhado ao provedor de transcrição durante o processamento. O usuário deve consentir antes da captura.

## Segurança
Nunca inclua chaves reais em arquivos do repositório. Cadastre-as no painel de variáveis do Render e faça a rotação de credenciais anteriormente expostas.
