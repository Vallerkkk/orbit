# Órbita — iOS nativo

Projeto novo em **SwiftUI**, baseado no código do site e do cliente Windows do arquivo `orbit-main(2).zip`. Não é um site dentro de uma WebView.

**Situação da entrega — 24/10/2026:** fontes, projeto Xcode, recursos e testes criados; verificações estruturais locais executadas. **Não houve compilação, execução no simulador, teste em iPhone nem medição de desempenho**, porque este ambiente é Windows e não dispõe de Xcode. Portanto, esta entrega não é um IPA assinado nem uma versão pronta para publicação.

## Abrir e experimentar

1. Em um **Mac**, abra `Orbita.xcodeproj` no **Xcode 16.3 ou posterior**. Use um Xcode compatível com a versão de iOS do seu aparelho.
2. Aguarde a resolução dos pacotes Swift.
3. Escolha o esquema **Orbita Demo** e um simulador iPhone para conhecer as telas sem conta ou rede.
4. Escolha o esquema **Orbita** para usar sua conta real. O aplicativo consulta a configuração pública do backend automaticamente.
5. Para um iPhone físico, selecione sua equipe em **Signing & Capabilities** e use um identificador de pacote disponível. Nenhuma equipe/certificado de outra instalação foi copiado.

**Mínimo do aplicativo: iOS 17.** O layout usa áreas seguras e controles do sistema, sem depender de notch, Dynamic Island ou uma altura fixa de aparelho. A matriz de validação cobre telas compactas, médias e grandes; não foi usada uma estatística de popularidade de modelos para fingir uma cobertura já testada.

## Implementado nas fontes

| Área | Integração |
|---|---|
| Entrada | E-mail/senha pelo Supabase Auth; sessão gerenciada pelo SDK; senha não persistida pelo app |
| Comunidades | Lista, seletor de comunidade, canais de texto e salas de voz sujeitos ao RLS existente |
| Conversas | Conversas existentes e abertura com amigos aceitos; par de UUIDs na ordem exigida pelo banco |
| Chat | Leitura, envio de texto, respostas, cópia e exclusão própria; Realtime e atualização manual |
| Anexos existentes | Imagens reduzidas, acesso privado assinado, Quick Look e compartilhamento de arquivo por ação explícita |
| Feed | Descobrir, Seguindo, Salvos, páginas de 25, texto, curtir/salvar, leitura de respostas |
| Perfil | Nome/bio, aparência clara/escura/sistema e saída com confirmação |
| Voz/vídeo | LiveKit nativo, câmera/microfone desligados ao entrar, grade de participantes e controles de mídia |
| Chamada persistente | Sala pertence à sessão, não à tela; minimizar/navegar não desconecta a chamada |
| Acessibilidade | Fontes semânticas, Dynamic Type, labels, ações nativas e respeito a Reduzir Movimento |

“Implementado” significa **conectado no código**, não que a integração ao backend de produção tenha sido executada ou aprovada.

## Escolhas para fluidez

- Navegação nativa com quatro abas; uma conversa por tela, em vez de quatro colunas do desktop.
- Histórico em páginas de 50; paginação composta por `created_at` e `id`, sem perder microssegundos. Até 500 mensagens carregadas por paginação na tela.
- `LazyVStack` e identidades estáveis; atualizações do Realtime reconciliadas com as respostas HTTP.
- A chegada de uma mensagem não rola a tela automaticamente quando você está lendo mais acima; há um botão de novas mensagens.
- Histórico HTTP e conexão do socket começam em paralelo.
- Consultas de perfis em lotes, evitando uma requisição por mensagem/avatar.
- Cache de imagens privado em memória com limite de custo, redução de resolução fora da thread principal e limpeza ao sair.
- Nada de animações decorativas contínuas, filtros caros ou camadas de vidro em toda a conversa.
- Redução de movimento respeitada; o design usa cores adaptativas e controles do sistema.
- Falhas de envio preservam texto. **Não há reenvio automático de mensagens** cujo resultado ficou incerto.

Essas são decisões de arquitetura, **não uma promessa de 60/120 fps**. Siga `QA.md` para medir no aparelho.

## Backend e segurança

Origem configurada: `https://orbita-8nwu.onrender.com`.

O app usa o mesmo backend: `/api/config`, Supabase Auth/PostgREST/Realtime/Storage e `/api/channels/{id}/join` ou `/api/conversations/{id}/join`. As operações de banco usam o **JWT do usuário**, não `service_role`. O servidor continua verificando amizade, acesso e publicação em palcos. A preferência de status de um perfil não é exibida como prova de presença online.

Mensagens inserem somente as colunas autorizadas no ZIP. IDs e datas do chat vêm do servidor. O feed, que concede inserção de `id`, usa um UUID estável para evitar publicação duplicada em uma tentativa repetida.

Nenhuma senha, token de usuário, chave secreta ou certificado está embutido. O armazenamento de sessão padrão do SDK Auth para plataformas Apple usa Keychain. Os pedidos HTTP do cliente e as mídias do aplicativo usam sessões efêmeras. Arquivos abertos no Quick Look são temporários e protegidos; cópias explicitamente compartilhadas ficam sob controle do destino.

O projeto **não afirma criptografia ponta a ponta**. Não foram executados login, escrita em produção, migrações, alteração de servidor ou publicação.

## Escopo ainda não portado

- Envio de novas fotos/arquivos, gravação de áudio, enquetes, threads completas e reações do chat.
- Cadastro, recuperação e gerenciamento completo da conta: links para o site, sem reaproveitar credenciais de outra conversa.
- Responder ao feed, gestão de amizades e administração de comunidades: não há botões falsos para essas funções; os fluxos complementares direcionam à web.
- Notificações APNs, PushKit/CallKit e recepção de chamadas com o app fechado. O sinal de chamada direta existente é enviado ao backend após conectar; isso **não substitui** notificações nativas.
- Compartilhamento de tela/ReplayKit e extensão de transmissão.
- YouTube, ouvir-juntos, loja, badges/decorações avançadas, IA e ferramentas de administração do desktop.
- Moderação/denúncia/bloqueio nativos, exclusão de conta e política de privacidade publicada: **pendências de lançamento**, especialmente para distribuição de conteúdo gerado por usuários. Não publique sem concluir essa revisão.

O `PrivacyInfo.xcprivacy` declara o uso de UserDefaults para preferências e ausência de rastreamento pelo código deste cliente. Isso **não substitui** a avaliação das práticas do backend, dos SDKs e das respostas de privacidade na App Store.

## Dependências

- `supabase-swift`: **2.55.4** — produto `Supabase`.
- `client-sdk-swift`: **2.18.0** — produto `LiveKit`.

As versões diretas estão fixadas no projeto. **Não foi inventado um `Package.resolved`**: a resolução de dependências transitivas precisa ocorrer no Xcode, com acesso à rede. Depois de validar, guarde o arquivo de resolução gerado.

Referências de API: repositórios oficiais `supabase/supabase-swift` e `livekit/client-sdk-swift`, nas tags indicadas. Identidade visual reutilizada de `static/grafite.css` e `static/icons/icon-512.png` do ZIP. A origem web foi conferida em `desktop/policy.cjs`. Veja `PROVENANCE.json` para identificar o arquivo de entrada.

## Verificar

Verificação **estrutural**, sem compilar Swift:

```sh
python3 scripts/validate-local.py
```

Build e testes reais, **no Mac**:

```sh
xcrun simctl list devices available
# Troque o exemplo por um simulador efetivamente instalado:
DESTINATION='platform=iOS Simulator,name=iPhone 16' RUN_UI_TESTS=1 bash scripts/validate-macos.sh
```

O esquema `Orbita` inclui testes unitários de contratos/paginação e testes de navegação da demonstração. O script para se o build ou os testes falharem. Sem `DESTINATION`, o build é tentado, a lista de simuladores é exibida e os testes são explicitamente marcados como não executados.

Leia `VERIFICATION.json` para os resultados locais e `QA.md` para a validação funcional e de desempenho que permanece pendente.
