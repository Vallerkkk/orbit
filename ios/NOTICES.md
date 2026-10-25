# Origem e dependências

- Interface e cliente SwiftUI novos neste projeto, criados a pedido do usuário.
- Nome, marca e logo Órbita reutilizados dos arquivos fornecidos pelo usuário.
- Paleta baseada em `static/grafite.css`; ícone baseado em `static/icons/icon-512.png`.
- Ícones da interface: SF Symbols do sistema Apple; nenhum pacote de ícones web.
- Os SDKs Supabase e LiveKit não estão copiados para este ZIP. São referências Swift Package Manager aos repositórios oficiais, nas versões fixadas no projeto.
- Ao resolver/distribuir o aplicativo, preserve e revise as licenças e avisos dos SDKs e de suas dependências transitivas, incluindo os componentes WebRTC baixados pelo gerenciador.

O cliente não inclui código de servidor, cópia de banco, credenciais, certificados ou arquivos de usuários da instalação de produção. Os dados de demonstração são fictícios.
