# Órbita Desktop para Windows

A página `/instalar` oferece o aplicativo nativo `.NET 10 + WPF + WebView2` (`desktop-native/`) como opção principal. São 70 MB em um arquivo único, sem Chromium nem Node.js embarcados: a interface web é hospedada pelo runtime WebView2 que já vem no Windows, em janela e diálogos nativos, com bandeja e seletor nativo de telas/janelas. A versão web/PWA continua como alternativa para navegador e celulares.

Não há instalador nem atualização automática nesta versão. O programa é o próprio arquivo: baixe, abra, use. Sessão e permissões ficam em `%LOCALAPPDATA%\OrbitaNative`, separadas do navegador.

## Downloads

- `/baixar/Orbita-Setup.exe` redireciona ao `Orbita.exe` da release oficial.
- `/baixar/Orbita-Windows.zip` redireciona ao `Orbita-2.0.0-win-x64.zip`, que embrulha o mesmo executável e o `LEIA-ME.txt`.
- Versão: https://github.com/Vallerkkk/orbit/releases/tag/v2.0.0
- Hashes em `SHA256SUMS.txt` nos anexos da release e em `work/release/SHA256SUMS.txt` na máquina de build.

Os dois arquivos publicados têm o conteúdo conferido por hash nesta máquina. O `Orbita.exe` tem SHA-256 `eff59588fafd86195c4df9a3eb8c2142c4244c0bf404166c7dae38e428b48988` e `desktop-native/build.ps1` reproduz exatamente esses bytes com o SDK 10.0.403 — ver a seção "Compilar" em `desktop-native/README.md`.

O executável não possui assinatura Authenticode comercial. SmartScreen e outros antivírus podem mostrar avisos; não se garante ausência de bloqueios. Não desative proteções. Nenhuma técnica de evasão, alteração de antivírus ou exceção de certificado foi usada.

## Código e validação

Código nativo e instruções de compilação em `desktop-native/README.md`, com os requisitos (Windows 10 1809+ x64, WebView2 Evergreen, .NET 10 SDK) e a lista do que foi e do que não foi testado. Os binários ficam nos anexos das Releases, sem pacotes grandes no Git nem no servidor Render. A página e os dois redirecionamentos são públicos e apontam somente para arquivos de versão fixa do repositório oficial; `tests/test_launcher.py` trava as URLs exatas.

O funil da página é validado em navegador real nos 1440, 390 e 320 px (`tests/install_browser.cjs`). O download em si é verificado por hash, não por instalação no perfil pessoal de quem testa. Matriz de monitores e escalas DPI, Windows sem WebView2, ARM64, login OAuth dentro do aplicativo e reputação SmartScreen continuam sem validação manual.

## Legado Electron

`desktop/` guarda o wrapper Electron 1.0.2 que foi a opção principal antes da versão nativa. Ele não é mais oferecido pela página: nenhum link em `/instalar` aponta para ele. O workflow `.github/workflows/desktop-release.yml` ainda publica o instalador Electron em qualquer tag `v*`, então criar uma tag de versão do site sem querer publica um instalador concorrente com o app nativo. Enquanto `desktop/` existir, use `native-v*` (`.github/workflows/native-release.yml`) para o aplicativo nativo e trate `v*` como decisão explícita.
