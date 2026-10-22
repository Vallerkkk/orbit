# LulaDroid — assistente de voz da chamada

O LulaDroid voltou como um painel opcional dentro da sala de voz.

## Como usar

1. Entre em uma chamada e abra **LulaDroid** no cabeçalho.
2. Clique em **Ativar escuta** e aceite o aviso.
3. Diga **“eai LulaDroid”** (também aceita “ei”, “e aí”, “oi” e “olá”) seguido da pergunta.
4. A resposta aparece no painel e é falada no aparelho de quem estiver com a voz ativa.

Cada participante ativa a própria escuta; o navegador transcreve a fala local. Não é uma gravação de áudio da sala e o microfone mutado pausa o envio. O texto é enviado ao backend autenticado.

## Onde fica o histórico

- O histórico por chamada é lido em **LulaDroid → Transcrições**, disponível somente para **admin/creator do site**.
- O backend valida o cargo no Supabase com o JWT do usuário; não confia em dados do cliente.
- As transcrições ficam em memória no processo do servidor, com limite de 200 falas por chamada e descarte após 30 minutos sem atividade. Reiniciar o servidor limpa o histórico em memória.

## Respostas reais com Gemini (opcional)

Sem chave, o backend usa respostas locais de demonstração. Para respostas reais, configure **somente no Render** (nunca no frontend/GitHub):

```
GEMINI_API_KEY=<chave válida do Google AI Studio>
GEMINI_MODEL=gemini-2.5-flash
```

O backend envia ao Gemini a pergunta e, quando quem pergunta é administrador, os trechos recentes da chamada. A resposta é curta, em português, e volta para o painel e para a voz do aparelho. Se a chave estiver inválida, o assistente cai nas respostas locais.

## Limitações

- O reconhecimento depende de `SpeechRecognition`/`webkitSpeechRecognition`; Chrome e Edge funcionam melhor. Brave, Electron e alguns celulares podem não oferecer o recurso.
- A voz usa `speechSynthesis` do aparelho; não há Puter nem áudio gravado pela Órbita.
- O navegador pode enviar áudio ao fornecedor dele para reconhecimento.
- Não use para dados confidenciais: a pergunta e o contexto podem ir ao provedor do modelo.
