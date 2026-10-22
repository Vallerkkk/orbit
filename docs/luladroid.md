# LulaDroid — respostas com OpenRouter

O LulaDroid acompanha **somente a fala dos participantes que ativarem individualmente a escuta** em uma sala de voz, usando o reconhecimento de fala disponibilizado pelo navegador. O texto é enviado à API autenticada da Órbita. A frase **“Ei, LulaDroid”** aciona uma resposta contextual gerada pelo **OpenRouter**, reproduzida via `speechSynthesis` no **próprio aparelho** de quem ativou o assistente.

## Configuração no Render

Configure as variáveis **apenas no ambiente do servidor**:

```env
OPENROUTER_API_KEY=
OPENROUTER_LULADROID_MODEL=openrouter/auto
```

A chave não deve ficar no GitHub nem no JavaScript do navegador. Chaves enviadas em chats ou já divulgadas devem ser revogadas e substituídas. Em seguida, atualize o serviço do Render e verifique se `GET /api/ai/status` mostra `llm: "openrouter"`.

## Como usar

1. Entre em uma sala de voz na Órbita.
2. Abra o painel **LulaDroid** e permita a escuta **do seu microfone**.
3. Diga **“Ei, LulaDroid, o que foi combinado?”**. A pergunta é enviada ao OpenRouter e a resposta é reproduzida localmente.
4. Pare a escuta a qualquer momento pelo painel.

## Limites e privacidade

- A transcrição é feita pelo recurso `SpeechRecognition`/`webkitSpeechRecognition` do navegador, **não** pelo Whisper/OpenRouter. A disponibilidade varia entre navegadores e o fornecedor do navegador pode processar o áudio.
- O backend recebe texto transcrito, **não áudio bruto**, neste fluxo. O provedor OpenRouter processa a pergunta e, para administradores do site, o contexto recente da chamada. A API **não permite que participantes comuns vejam o histórico**, conforme o controle atual em `app.py`.
- Transcrições existentes são mantidas apenas na memória do processo do servidor e podem se perder ao reiniciar; por padrão expiram. O armazenamento persistente do pacote ZIP anterior **não foi mesclado** porque o repositório remoto possui mudanças mais recentes de schema e políticas que exigem revisão independente.
- A resposta por áudio é local, não transmitida como um participante LiveKit.
- Por segurança, não registre dados confidenciais. Não há teto de gasto integrado: configure limites de uso e créditos no OpenRouter.

## Operação e verificação

- `GET /api/ai/status` relata se o backend está configurado.
- `POST /api/ai/opinion` requer autenticação; a geração de respostas falha claramente se `OPENROUTER_API_KEY` estiver ausente, sem fingir que houve consulta ao modelo.
- Se o OpenRouter estiver indisponível ou sem créditos, a API responde com erro controlado, sem encaminhar corpos de erro do provedor.
- Depois de publicar, teste uma chamada real com um usuário consentindo na transcrição, a frase de ativação e a reprodução por voz.

A integração usa `POST https://openrouter.ai/api/v1/chat/completions` com Bearer token no backend. Documentação oficial: https://openrouter.ai/docs/quickstart
