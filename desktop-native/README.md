# Órbita Desktop Native 2.0.0 — Windows x64

Cliente nativo do Órbita para Windows, escrito em **.NET 10 + WPF + WebView2**. Ele substitui o wrapper Electron de `desktop/` mantendo a mesma conta, os mesmos serviços e a mesma interface web, com janela e diálogos nativos.

O foco desta versão é **fluidez da interface e baixo consumo de RAM/CPU**: não há Chromium nem Node.js embarcados; a página usa o runtime do WebView2 já instalado no Windows, em um único processo de interface.

> Há também um cliente WinForms mais enxuto em [`native/`](../native/README.md), com a mesma base .NET + WebView2. Os dois podem ficar instalados ao mesmo tempo: este guarda dados em `%LOCALAPPDATA%\OrbitaNative`, separado do outro.

## Requisitos

- Windows 10 (1809 ou superior) ou Windows 11, x64.
- Microsoft Edge WebView2 Runtime (Evergreen). Ele acompanha o Edge atualizado; se faltar, o aplicativo mostra uma tela de aviso com o link oficial de instalação.
- Para compilar: .NET 10 SDK e PowerShell 5.1 ou superior.

## Baixar e executar

O pacote é gerado por `build.ps1` (veja abaixo). Quando houver uma release publicada em <https://github.com/Vallerkkk/orbit/releases>, baixe o ZIP `Orbita-2.0.0-win-x64.zip`, extraia a pasta completa e abra `Orbita.exe`. Mantenha as DLLs e a pasta `runtimes/` junto do executável.

A versão publicada do site é atualizada automaticamente pelo Render; o executável nativo é versionado separadamente. Não há instalador nem atualização automática nesta versão. Para atualizar, encerre o aplicativo pela bandeja, substitua a pasta do programa e abra novamente. A sessão e as permissões ficam em `%LOCALAPPDATA%\OrbitaNative` e são preservadas.

## Compilar

```powershell
cd desktop-native
.\build.ps1
```

O script localiza o SDK do .NET (inclusive uma instalação local em `%USERPROFILE%\.dotnet-local`), publica `Release` autocontido para `win-x64` com ReadyToRun e gera:

- `out/Orbita-2.0.0-win-x64/` — pasta pronta para uso;
- `out/Orbita-2.0.0-win-x64.zip` — pacote para distribuir;
- `out/SHA256SUMS.txt` — hash SHA-256 do ZIP.

Use `.\build.ps1 -NoZip` para gerar somente a pasta. A primeira compilação baixa o pacote do WebView2 e os runtime packs do .NET.

## Funcionalidades

- Janela WPF nativa com barra de título escura do Windows 11/10, cantos arredondados e Dimensionamento por monitor (PerMonitorV2).
- Bandeja do Windows com abrir, recarregar, redefinir permissões, abrir pasta de dados, ver atualizações no GitHub e encerrar.
- Fechar a janela pergunta entre continuar na bandeja ou encerrar; a escolha pode ser lembrada.
- Instância única: abrir o executável de novo traz a janela existente para a frente.
- Geometria da janela, estado maximizado e comportamento de fechamento são restaurados na próxima abertura.
- Diálogos nativos escuros para permissões, links externos e confirmação de fechamento.
- Pedidos simultâneos de microfone e câmera são enfileirados e confirmados um por vez (um não nega o outro).
- Compartilhamento de tela pelo seletor nativo do WebView2, liberado somente para a origem do Órbita.
- Tela cheia de vídeo integrada à janela (sem barras do sistema durante a reprodução).
- Downloads acompanhados por balão da bandeja; falhas de processo do WebView2 mostram uma tela de recuperação com recarregar ou abrir no navegador.
- Tela de carregamento própria, aviso de primeira abertura demorada, tela de erro de conexão com nova tentativa e tela específica para WebView2 ausente.
- Log local em `%LOCALAPPDATA%\OrbitaNative\logs\app.log` (rotação em 1 MB).

### Ponte com a página

A página detecta o aplicativo por `window.orbitaDesktop`, mas a ponte expõe somente metadados congelados (`isDesktop`, `nativeChrome`, `platform`, `version`). Não existem métodos de minimizar/fechar, mensagens, objetos hospedados ou acesso ao sistema a partir do conteúdo remoto. A interface web deixa de desenhar seus próprios botões de janela quando `nativeChrome` está presente.

## Segurança

- Navegação restrita à origem HTTPS exata do Órbita (`orbita-8nwu.onrender.com`). Qualquer outro documento é recusado e links HTTPS externos só abrem no navegador após confirmação; URLs com credenciais e protocolos executáveis são bloqueados.
- Sem `AreHostObjectsAllowed`, sem WebMessage e sem bridge executável; DevTools desligado por padrão.
- Permissões de câmera, microfone e notificações são concedidas apenas para a origem do aplicativo, mediante diálogo, e **não são gravadas no perfil do WebView2** (`SavesInProfile = false`). A escolha fica em `settings.json` e pode ser redefinida pela bandeja.
- Captura de tela só é permitida para frames da origem do Órbita; outras origens são canceladas e registradas.
- O aplicativo roda sem privilégios de administrador, não altera antivírus/firewall e não ignora erros de certificado.
- Variáveis de desenvolvimento são restritas: `ORBITA_DESKTOP_URL` só aceita loopback (`http`/`https`), `ORBITA_DESKTOP_DEVTOOLS=1` e `ORBITA_DESKTOP_DEBUG_PORT` habilitam depuração apenas quando definidas explicitamente.

## Dados locais e remoção

- `%LOCALAPPDATA%\OrbitaNative\WebView2` — perfil, cookies e cache da sessão.
- `%LOCALAPPDATA%\OrbitaNative\settings.json` — geometria, fechamento e permissões.
- `%LOCALAPPDATA%\OrbitaNative\logs\app.log` — diagnóstico.

Para remover tudo, encerre o aplicativo pela bandeja, apague a pasta do programa e `%LOCALAPPDATA%\OrbitaNative`.

## Variáveis de desenvolvimento

| Variável | Efeito |
| --- | --- |
| `ORBITA_DESKTOP_URL` | Abre outra origem **somente loopback** (ex.: `http://127.0.0.1:8000/`). |
| `ORBITA_DESKTOP_DEVTOOLS=1` | Habilita DevTools na janela. |
| `ORBITA_DESKTOP_DEBUG_PORT=9334` | Abre CDP em `127.0.0.1` para automação de testes. |

## Validação

Verificado nesta máquina com o build de depuração contra o servidor de produção: inicialização e carregamento da interface real, barra de título escura, ponte congelada detectada pela página, login, chamada real com câmera, microfone e compartilhamento de tela, diálogos nativos de permissão (notificações, microfone e câmera), seletor de compartilhamento do WebView2, dimensionamento 1280×820 em escala 100% e ausência de erros no log. O build **Release autocontido** também foi iniciado contra uma página local de teste (loopback), com carregamento e ponte congelada confirmados via CDP.

Não foram executados nesta entrega: matriz de múltiplos monitores e escalas DPI, Windows sem WebView2 instalado, ARM64, encerramento pelo Windows, fluxo de login OAuth externo, nem teste automatizado da fila de permissões simultâneas e do bloqueio de Ctrl+R (essas duas últimas mudanças compilam, mas foram feitas após a sessão de teste manual). O pacote também não possui assinatura Authenticode.

## Limitações

- Somente Windows x64. Não há build ARM64 nem instalador/assinação nesta versão.
- Sem atualização automática; a distribuição é manual pelo ZIP.
- Login por provedores externos (Google, Spotify e semelhantes) que exige navegar para fora do Órbita não conclui dentro do aplicativo. Use e-mail/senha ou o site no navegador.
- Notificações dependem das permissões e das configurações de notificação do Windows.
- O aplicativo não inicia junto com o Windows e não registra protocolos ou associações de arquivo.
- A primeira abertura do servidor no plano gratuito do Render pode demorar; a tela de carregamento mostra um aviso após alguns segundos.
