# Órbita iOS — Correções v2.1

Testado no simulador do iPhone (iPhone 17, iOS 26.5) com a conta real.

## Bugs corrigidos

### 1. Impossível entrar em chamadas (causa raiz de "não abre webcam / não compartilha tela")
O botão **"Entrar na sala"** (e o botão de ligar nas DMs) estava **permanentemente desativado**
por uma verificação errada: checava `videochamadaConfigured`, que é a flag de um recurso
*opcional e separado* (link de chamada de terceiros), não das salas de voz LiveKit.
Como esse backend não tem esse extra configurado, ninguém conseguia entrar em nenhuma chamada —
e por isso câmera e compartilhamento de tela nunca eram alcançáveis.
- `Orbita/Features/CommunitiesView.swift` — removida a condição `videochamadaConfigured == false`.
- `Orbita/Features/ChatView.swift` — mesma correção no botão de ligar das DMs.

### 2. Compartilhamento de tela não existia
Não havia botão de compartilhar tela na interface da chamada.
- `Orbita/Services/CallCoordinator.swift` — novo `screenShare()` + estado `screenShareEnabled`,
  usando `localParticipant.setScreenShare(enabled:)` do SDK do LiveKit.
- `Orbita/Features/CallView.swift` — novo botão **"Tela"** na barra de controles; os tiles de
  participante agora priorizam o vídeo de tela compartilhada sobre a câmera (como no site).
- Novo target **BroadcastExtension** (Broadcast Upload Extension, bundle `app.orbita.ios.broadcast`)
  com App Group `group.app.orbita.ios` e `SampleHandler` herdando de `LKSampleHandler`, para
  captura da tela do sistema inteiro. **Observação:** o compartilhamento de tela só funciona de
  verdade em **iPhone físico** — o simulador não roda o seletor de broadcast do ReplayKit.

### 3. Três erros de compilação (o projeto não compilava)
Em blocos `catch { }`, o código atribuía uma `String` a `error`, mas ali `error` é o próprio
erro capturado, não a propriedade `var error: String?`. Corrigido para `self.error =`:
- `Orbita/Services/CallCoordinator.swift`, `Orbita/Services/ChatStore.swift`, `Orbita/Services/AppSession.swift`.

## Melhorias de interface

- **Animação de entrada** (`Orbita/Core/Theme.swift` → `LaunchView`): o logo surge com mola,
  um anel orbital gira ao redor e a frase aparece em sequência, em vez de logo + spinner estático.
- **Transições entre telas** (`Orbita/App/OrbitaApp.swift`): fade + leve escala ao passar de
  carregando → login → app; respeita "Reduzir Movimento".
- **Barra de chamada flutuante** entra/sai deslizando do topo com mola.
- **Haptics** (`Haptic` em `Theme.swift`) ao entrar na chamada (sucesso) e em falha de conexão.

## Verificado no simulador
- Login com conta real, comunidade e canais reais carregados.
- Entrar na sala de voz → conecta no LiveKit ("1 na sala · conexão ativa").
- Botão de câmera responde (no simulador reporta "sem câmera", no aparelho abre a câmera).
- Botão de tela responde e trata o erro com elegância (no aparelho abre o seletor do sistema).
- Feed, Conversas e abas navegando normalmente.
