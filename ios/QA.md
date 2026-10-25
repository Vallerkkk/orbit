# Validação no Mac e no iPhone — pendente

Esta lista é um roteiro de aceitação, **não um relatório de testes aprovados**.

## Matriz de layout

| Porte | Exemplo de área lógica | Validar |
|---|---|---|
| Compacto | 375 × 667 pt | Teclado, nome longo, campo multilinha, modais e botões da chamada |
| Médio | 390 × 844 / 393 × 852 pt | Áreas seguras, voltar por gesto, barra da chamada, abas |
| Grande | 430 × 932 pt ou maior | Comprimento de linha, grade de vídeo, reaproveitamento do espaço |
| Acessível | Todos, maior Dynamic Type | Refluxo do texto, ações alcançáveis, ausência de clipping |

Testar claro/escuro/sistema, paisagem, VoiceOver, contraste, Reduzir Movimento e conteúdo com emoji, acentos e texto RTL. Nas telas compactas, não diminuir fontes para esconder problemas: corrigir o refluxo.

## Build e dependências

- [ ] Abrir o `.xcodeproj` sem reparação manual e resolver os pacotes.
- [ ] Registrar a versão exata do Xcode/SDK, os logs e o `Package.resolved`.
- [ ] Compilar Debug para simulador e aparelho; executar os testes unitários.
- [ ] Executar os dois testes UI e inspecionar os screenshots anexados ao `.xcresult`.
- [ ] Compilar Release e abrir pelo ícone, fora do depurador.
- [ ] Conferir avisos de concorrência e manifestos de privacidade dos pacotes transitivos.

## Conta e isolamento

- [ ] Credenciais inválidas, sessão expirada, atualização de token e indisponibilidade de `/api/config`.
- [ ] Reiniciar e confirmar a restauração da sessão.
- [ ] Alternar entre duas contas e confirmar que mensagens, imagens, modais e rascunhos anteriores não reaparecem.
- [ ] Sair durante leitura, envio e conexão de chamada; nenhuma ação atrasada deve abrir dados de outra conta.
- [ ] Permissões RLS negadas devem apresentar erro, não dados de cache pertencentes a outro usuário.
- [ ] A demonstração deve funcionar em modo avião e não fazer chamadas ou escritas.

## Chat e feed

- [ ] Enviar entre iOS e web/Windows; verificar autoria, data e ausência de duplicações.
- [ ] Histórico com datas iguais e microssegundos diferentes; 50, 51, 500 e mais mensagens.
- [ ] Carregar mais sem pular o ponto de leitura; receber mensagem enquanto lê no topo.
- [ ] Perder rede após o servidor aceitar um envio: manter rascunho, não repetir automaticamente.
- [ ] Reconectar após receber mais de uma página offline; não esconder lacunas do histórico.
- [ ] Editar/excluir no cliente web e conferir sincronização/reconciliação no iOS.
- [ ] Responder, excluir mensagem própria e tentar excluir mensagem alheia.
- [ ] Baixar anexos privados válidos/negados/expirados; fechar Quick Look durante download.
- [ ] Verificar limpeza dos temporários e caches ao sair.
- [ ] Feed de 25/26/50 itens; alternância rápida entre Descobrir/Seguindo/Salvos com rede lenta.
- [ ] Curtir/salvar duas vezes rapidamente; publicação com timeout seguida de nova tentativa.

## Voz e vídeo — aparelho físico

- [ ] Usar ao menos dois dispositivos; testar também com o cliente web.
- [ ] Entrar sem transmitir microfone/câmera; conferir permissões negadas ou revogadas.
- [ ] `canPublish=false` não deve habilitar transmissão.
- [ ] Minimizar a chamada, abrir outra aba/conversa e voltar sem criar outra sala.
- [ ] Sair durante conexão pendente; nenhuma sala antiga deve sobreviver.
- [ ] Testar Wi-Fi/celular, Bluetooth, fones, alto-falante e interrupção por chamada telefônica.
- [ ] Colocar em segundo plano e bloquear o aparelho: verificar pausa do vídeo e comportamento real do áudio.
- [ ] Verificar câmera pausada também quando a chamada estiver minimizada.
- [ ] Rede instável, reconexão e desconexão definitiva: UI deve refletir o estado real.

Não há CallKit/APNs nesta entrega. Não interpretar ausência de toque com app fechado como um recurso já implementado.

## Desempenho — medir, não presumir

- [ ] Instruments: Time Profiler, Animation Hitches, Allocations, Leaks e Energy Log.
- [ ] Medir cold start e tempo até o primeiro conteúdo com backend frio e quente.
- [ ] Rolar repetidamente 500 mensagens com mídia, feed longo e nomes extensos.
- [ ] Comparar memória antes/depois de alternar canais e abrir/fechar anexos.
- [ ] Chamada de 20 minutos com 4 participantes: CPU, memória, bateria e temperatura.
- [ ] Conferir se decodificação de imagens e acesso à rede não bloqueiam a main thread.
- [ ] Registrar tempos/hitches reais em aparelho compacto e intermediário; corrigir gargalos antes de anunciar fluidez.

## Antes de distribuir

- [ ] Completar moderação/denúncia/bloqueio e fluxo de exclusão de conta.
- [ ] Publicar política de privacidade e revisar consentimentos/coleta do backend e LiveKit.
- [ ] Conferir requisitos atuais de SDK, privacidade e publicação da Apple.
- [ ] Configurar identificador, equipe, certificados, TestFlight e suporte ao usuário.
- [ ] Auditar dependências transitivas e avisos do Archive.
- [ ] Não reaproveitar credenciais, contas de teste ou dados reais dentro dos binários.
