# Lula — NVIDIA NIM / Nemotron 3 Ultra

O Lula utiliza a API **NVIDIA NIM** com o modelo `nvidia/nemotron-3-ultra-550b-a55b` para responder perguntas curtas em português brasileiro, com base nas transcrições disponíveis da sala de voz.

**Escuta e transcrição continuam locais ao navegador**, mediante consentimento individual, utilizando `SpeechRecognition` / `webkitSpeechRecognition`. A resposta de texto da NVIDIA é reproduzida como voz por `speechSynthesis` **somente no próprio dispositivo** de quem ativou o assistente. Não há participante automatizado LiveKit nem transcrição por NVIDIA.

## Render.com: configurar sem expor segredos

Defina as variáveis no painel do serviço de backend (`Environment`):

```dotenv
NVIDIA_API_KEY=<sua chave NVIDIA NIM>
NVIDIA_NIM_MODEL=nvidia/nemotron-3-ultra-550b-a55b
```

Nunca adicione a chave ao repositório, JavaScript ou `.env.example`. Se uma chave foi compartilhada em um chat, revogue-a e gere outra antes de uso continuado.

A NVIDIA disponibiliza o endpoint compatível com OpenAI:

- `POST https://integrate.api.nvidia.com/v1/chat/completions`
- `model: "nvidia/nemotron-3-ultra-550b-a55b"`
- `Authorization: Bearer <chave>`

O prefixo `nvidia_nim/` é uma convenção de integração do LiteLLM, **não** parte do ID do modelo na API direta. O código também normaliza esse prefixo caso venha configurado na variável.

Configuração para respostas rápidas de voz: `reasoning_effort: "none"`, `stream: false`, `max_tokens: 400`. Sem a chave, o serviço responde 503 (não inventa que executou a IA).

## Como utilizar

1. Abra uma chamada de voz na Órbita e o painel Lula.
2. Autorize a escuta individual do microfone e a transcrição.
3. Diga **"Ei, Lula, o que foi combinado?"**.
4. O backend solicita resposta ao Nemotron; o navegador fala o resultado localmente.

## Privacidade e limitações atuais

- O áudio não é enviado à NVIDIA por esta integração. A NVIDIA recebe **texto** com a pergunta e o contexto recente, quando o backend permite. A transcrição de voz do navegador pode usar serviços do fornecedor do navegador.
- Conforme o código atual da Órbita, apenas **administradores/creators** enviam o contexto da chamada ao modelo; usuários comuns podem fazer perguntas sem esse histórico. Histórico por chamada permanece em memória no servidor e é temporário.
- Sem acesso à conversa, o modelo deve informar que não há dados suficientes, sem inventar fatos.
- O assistente não fala na sala LiveKit para todos: `speechSynthesis` reproduz no dispositivo de origem.
- A API pode aplicar limites, custos ou disponibilidade conforme o plano NVIDIA; monitore o consumo e ajuste cotas.

## Operação e verificação

- `GET /api/ai/status`: retorna `llm: "nvidia-nim"` somente quando `NVIDIA_API_KEY` está definida (não confirma que a chave é válida).
- `POST /api/ai/opinion`: requer login Supabase e retorna resposta ou erro controlado.
- Execute `python -m unittest tests.test_nvidia_nim_ai` para testes isolados, sem créditos de API.
- Após publicar, teste uma chamada real com consentimento, "Ei, Lula" e reprodução falada.

Documentação oficial: https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b e https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-ultra-550b-a55b-infer
