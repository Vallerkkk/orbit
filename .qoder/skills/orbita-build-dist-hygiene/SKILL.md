---
name: orbita-build-dist-hygiene
description: Rotina pós-rebuild do Órbita — reconstruir static/dist com GIT_DIR, validar integridade e remover assets órfãos de builds anteriores sem quebrar o check_build nem o commit. Usar depois de qualquer mudança em static/*.js ou static/*.css, quando o dist acumular bundles hashados antigos, ao podar assets não referenciados, ou quando um rebuild deixar arquivos órfãos rastreados (git rm) e não rastreados.
---

# Órbita: rebuild e higiene do `static/dist`

## Overview

`static/dist/` é commitado no repositório (não é gitignored). Cada rebuild muda os hashes, então bundles antigos ficam para trás e viram lixo versionado. Este skill padroniza: build → verificação → poda de órfãos → ordem de staging.

## Quando usar

- Depois de editar qualquer `static/*.js` ou `static/*.css`.
- Quando `git status static/dist` mostrar `??` ou `M` sobrando após um build.
- Antes de um commit que toca frontend, para não levar asset morto junto.

## Rotina

1. **Build** a partir da raiz do repositório, sempre com o `GIT_DIR` falso:
   ```
   GIT_DIR=/nonexistent/orbita.git node scripts/build.mjs
   ```
   `build.mjs` executa o gerador de release-notes e reescreveria `static/release-notes.json` a cada build local; o `GIT_DIR` inexistente impede isso.
2. **Verificar integridade**: `python scripts/check_build.py` → deve imprimir `Built assets verified: N`.
3. **Listar órfãos em dry-run** (não apaga nada):
   ```
   node ~/.qoder/skills/orbita-build-dist-hygiene/scripts/dist_orphans.mjs .
   ```
4. **Aplicar a poda** só depois de ler o dry-run:
   ```
   node ~/.qoder/skills/orbita-build-dist-hygiene/scripts/dist_orphans.mjs . --apply
   ```
5. **Reverificar**: `python scripts/check_build.py` outra vez, então `npm run test:unit`.
6. **Commitar** o bundle novo e as remoções na mesma série de commits.

## Regras de classificação

- **Órfão = arquivo em `static/dist` que não está em `manifest.json` → `files`** (excluindo os controles `index.html`, `manifest.json`, `meta.json`). Nunca use "está untracked?" como critério: a saída do build vigente é untracked até você commitar, e apagar por esse critério destrói o bundle em uso.
- **Untracked** → `rm`. **Rastreado/staged** → `git rm` (o script tenta em lote e, se o git recusar, arquivo por arquivo com `-f`, ou `--cached` quando já sumiu do disco).
- **`DEAD-IN-MANIFEST`** (o build atual gerou, mas nada importa) → **reportar, não apagar**. `check_build.py` hashia cada chave de `integrity`, então remover um arquivo do manifest quebra a verificação. Se quiser eliminá-lo, remova a importação na fonte e reconstrua.
- **`MISSING`** (no manifest, ausente do disco) → sinal de build interrompido; rode o build de novo antes de podar. O script sai com código 2 nesse caso.
- O `meta.json` do esbuild é gitignored e não deve ser staged nunca; espere vê-lo como modificado após todo build.

## Armadilha de git

Não divida commits com `git commit -- <paths>`. Esse caminho copia o conteúdo da *working tree* daqueles paths e sobrescreve silenciosamente um `git rm --cached` já staged — foi assim que um commit "para de rastrear meta.json" deixou o arquivo rastreado e puxou duas remoções de dist que a mensagem não citava. Use `git commit` simples com staging por etapas: adicione o que pertence ao commit, commit, depois prepare o próximo conjunto.

## Resources

- `scripts/dist_orphans.mjs` — Node puro, sem dependências. Argumentos: `<raiz-do-repo>` (padrão `.`), `--apply` (remove; sem a flag é dry-run), `--all` (mostra além do corte de 40 nomes). Imprime contagens, grupos `ORPHAN-TRACKED` / `ORPHAN-UNTRACKED` / `DEAD-IN-MANIFEST` / `MISSING` e o MB recuperado. Calcula o alcance transitivo a partir de `manifest.entry` por BFS sobre os nomes `.js` citados dentro de cada bundle.
