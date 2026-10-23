# Novidades da Órbita (automáticas)

O card "Novidades da Órbita" do feed e o "Ver tudo" leem `static/release-notes.json`.

- **Geração:** `npm run build` (que o Render executa) roda `scripts/release-notes.mjs`, que lê o `git log`, agrupa os commits por dia (fuso de São Paulo) e cria uma versão `AAAA.MM.DD+sha` por dia. Commits técnicos (chore, test, refactor, dist, cache, service worker, merge, migrations não aplicadas) são ignorados. Cada assunto vira um destaque curto, com ícone pela área (chamada, feed, loja, perfil, ADM, áudio, chat, visual, correções). O card mostra 4 destaques; o "Ver tudo" mostra o histórico completo.
- **Texto curado vence:** (1) `static/changelog-overrides.json` por data (`"2026.10.23": {"highlights": [[categoria, texto]], "items": {...}}`); (2) trailer `Novidade: texto` no corpo do commit.
- **Sem histórico no Render (clone raso):** com menos de 5 commits visíveis, o build mantém o `static/release-notes.json` commitado. Por isso rode `npm run release-notes` (ou `npm run build`) antes de cada commit e inclua o JSON.
- **Aviso de nova versão:** quem ainda não viu a versão atual vê "Novo" e um ponto no card (`localStorage` `orbita-changelog-seen`); some ao abrir o "Ver tudo".
