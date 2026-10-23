# Configuração GitHub e Render

O repositório contém a configuração dos nomes das variáveis, **não os valores secretos**.

Configure no Render, em Environment:
- `FLATKEY_API_KEY`: chave da Flatkey
- `FLATKEY_MODEL`: `MiniMax-H3`
- `STT_API_KEY`: chave Groq para transcrição no PC/Electron
- `STT_MODEL`: `whisper-large-v3-turbo`
- `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET`: credenciais existentes do LiveKit
- `LIVEKIT_URL`, `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`: valores atuais do projeto

O arquivo `render.yaml` declara as variáveis necessárias para o deploy. Valores secretos devem ser preenchidos na plataforma, não no GitHub.

Após salvar as variáveis, inicie um novo deploy do serviço. Teste a escuta com permissão de microfone habilitada e confirme no navegador que a rota `/api/ai/status` identifica os serviços configurados.
