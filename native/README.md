# Órbita Nativo para Windows

Aplicativo Windows nativo da Órbita, escrito em C# (.NET 10 + WinForms) usando o **Microsoft Edge WebView2** que já vem no Windows. Substitui o desktop Electron (`../desktop/`) com o mesmo comportamento, mas sem empacotar um Chromium próprio.

| | Electron (`desktop/`) | Nativo (`native/`) |
|---|---|---|
| Download | ~110 MB | **~2 MB** (ou ~50 MB autocontido) |
| Motor web | Chromium embutido, atualizado só com o app | WebView2 do sistema, atualizado pelo Windows |
| Abertura | carrega o Chromium inteiro | janela imediata; o motor web sobe em paralelo |

## Otimizações

- **Abertura rápida:** o processo do WebView2 começa a subir antes da janela ser criada; a janela aparece na hora, com fundo escuro (sem flash branco) e a tela "Conectando…" até a primeira página ser pintada.
- **ReadyToRun + TieredPGO:** o código .NET já sai pré-compilado; GC de estação de trabalho não concorrente para usar menos memória e threads.
- **Em segundo plano:** minimizado, o WebView2 para de compor quadros; na bandeja e fora de chamada, o app pede ao WebView2 para reduzir o uso de memória (`MemoryUsageTargetLevel.Low`) e devolve ao Windows a memória ociosa do processo. Em chamada, nada é reduzido.
- **Tempo real:** timers e renderização não são estrangulados em segundo plano, então chamadas e presença continuam na bandeja (igual ao Electron).
- **Offline sem travar:** se a conexão cair, mostra a tela de reconexão e volta sozinho quando a internet retorna (teste leve `HEAD` antes de recarregar, sem piscar a tela).
- Executável único, sem instalador, sem serviço e sem privilégio de administrador.

## Recursos

- Janela com barra de título escura, posição/tamanho/zoom lembrados, F11 para tela cheia e F5 para recarregar.
- Bandeja do Windows: fechar a janela pergunta se continua na bandeja (com "Lembrar minha escolha").
- Uma instância só: abrir de novo traz a janela existente para frente.
- O título da janela e da bandeja acompanha o título da página (ex.: mensagens não lidas).
- Aviso de nova versão: consulta as releases com tag `native-vX.Y.Z` e abre a página de download no navegador. Nada é baixado ou executado automaticamente.

## Segurança

Mesmas regras de `desktop/policy.cjs`:

- A janela só navega na origem HTTPS exata da Órbita. Outros links abrem no navegador após confirmação; protocolos não HTTPS, URLs com credenciais ou porta diferente são recusados.
- Microfone, câmera e notificações pedem confirmação em diálogo nativo. A escolha fica salva e pode ser desfeita pela bandeja → *Redefinir permissões*. Outras permissões são negadas.
- Compartilhamento de tela usa o seletor do próprio WebView2 e só é aceito pela página principal da Órbita (iframes são recusados).
- Nenhuma API nativa é exposta à página. O único canal é um `postMessage` com dois nomes fixos (F11/F5).
- DevTools, atalhos do navegador, autopreenchimento e salvamento de senhas ficam desativados na versão Release.
- Dados ficam em `%LOCALAPPDATA%\Orbita` (sessão do WebView2 e `settings.json`), separados do navegador e do app Electron.

## Requisitos

- Windows 10 ou 11, x64.
- [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (já incluso no Windows 11 e na maioria dos Windows 10; o app avisa e oferece o download se faltar).
- Para o `Orbita.exe` pequeno: [.NET 10 Desktop Runtime](https://dotnet.microsoft.com/download/dotnet/10.0). A versão autocontida não precisa dele.

## Compilar

Na pasta `native/`, com o .NET 10 SDK:

```
dotnet test --project Orbita.Native.Tests
dotnet publish Orbita.Native -c Release -o ../work/native
```

Versão autocontida (não exige o .NET instalado):

```
dotnet publish Orbita.Native -c Release -p:SelfContained=true -o ../work/native-sc
```

## Publicar versões

Atualize `<Version>` em `Orbita.Native/Orbita.Native.csproj` e crie a tag `native-vX.Y.Z` com o mesmo número. O workflow `.github/workflows/native-release.yml` testa, compila as duas variantes e publica a release com `SHA256SUMS.txt`. Assim como o workflow do Electron, ele só roda enquanto o repositório for público.

O executável não tem assinatura Authenticode; o SmartScreen pode mostrar aviso de aplicativo desconhecido.
