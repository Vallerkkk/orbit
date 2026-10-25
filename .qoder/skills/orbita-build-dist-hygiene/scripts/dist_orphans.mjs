#!/usr/bin/env node
// Lista (e opcionalmente remove) assets órfãos em static/dist de um repositório Órbita.
import { readFileSync, readdirSync, rmSync, existsSync as exists } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const showAll = argv.includes('--all');
const root = path.resolve(argv.find((a) => !a.startsWith('--')) || '.');
const distDir = path.join(root, 'static', 'dist');
const controls = new Set(['index.html', 'manifest.json', 'meta.json']);
const MAX = 40;

const die = (msg, code = 2) => { console.log('ERRO: ' + msg); process.exit(code); };

let manifest;
try {
  manifest = JSON.parse(readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
} catch { die(`sem ${distDir}/manifest.json — rode o build primeiro`); }

const listed = new Set((manifest.files || []).map((u) => path.basename(u)));
if (manifest.entry) listed.add(path.basename(manifest.entry));

let html = '';
try { html = readFileSync(path.join(distDir, 'index.html'), 'utf8'); } catch {}
const htmlRefs = new Set([...html.matchAll(/\/static\/dist\/([A-Za-z0-9._-]+\.(?:js|css))/g)].map((m) => m[1]));

let disk = [];
try { disk = readdirSync(distDir).filter((f) => !controls.has(f)); } catch (e) { die('dist ilegível: ' + e.message); }

let tracked = new Set();
try {
  tracked = new Set(execFileSync('git', ['ls-files', '--', 'static/dist'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(Boolean).map((p) => path.basename(p)));
} catch { console.log('aviso: git ls-files falhou — assumindo nada rastreado'); }

// Alcance transitivo a partir da entrada real do build.
const knownJs = new Set(disk.filter((f) => f.endsWith('.js')));
const entry = manifest.entry ? path.basename(manifest.entry) : null;
const reachable = new Set();
const queue = entry && knownJs.has(entry) ? [entry] : [];
while (queue.length) {
  const file = queue.shift();
  if (reachable.has(file)) continue;
  reachable.add(file);
  let src = '';
  try { src = readFileSync(path.join(distDir, file), 'utf8'); } catch { continue; }
  for (const m of src.matchAll(/["'`]\.?\/?([A-Za-z0-9._-]+\.js)["'`]/g)) {
    const ref = m[1];
    if (knownJs.has(ref) && !reachable.has(ref)) queue.push(ref);
  }
}

const orphans = disk.filter((f) => !listed.has(f) && !htmlRefs.has(f));
const trackedOrphans = orphans.filter((f) => tracked.has(f));
const untrackedOrphans = orphans.filter((f) => !tracked.has(f));
const dead = [...listed].filter((f) => f.endsWith('.js') && disk.includes(f) && !reachable.has(f) && !htmlRefs.has(f));
const missing = [...listed].filter((f) => !disk.includes(f));

const bytes = (f) => { try { return readFileSync(path.join(distDir, f)).length; } catch { return 0; } };
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
const dump = (label, items) => {
  if (!items.length) return;
  const shown = showAll ? items : items.slice(0, MAX);
  console.log(`\n${label} (${items.length})`);
  for (const f of shown) console.log('  ' + f);
  if (shown.length < items.length) console.log(`  … +${items.length - shown.length} (use --all)`);
};

console.log(`repo: ${root}`);
console.log(`dist: ${disk.length} arquivos | manifest: ${listed.size} | alcançáveis via BFS: ${reachable.size}`);
console.log(`órfãos: ${orphans.length} (${mb(orphans.reduce((a, f) => a + bytes(f), 0))})`);
dump('ORPHAN-TRACKED — git rm', trackedOrphans);
dump('ORPHAN-UNTRACKED — rm', untrackedOrphans);
dump('DEAD-IN-MANIFEST — NÃO apagar (check_build.py hashia cada arquivo do manifest)', dead);
dump('MISSING — no manifest mas ausente no disco (rebuild)', missing);

if (!orphans.length && !missing.length) console.log('\nOK: nenhum órfão. dist limpo.');

if (!apply) {
  console.log('\ndry-run: nada foi removido. Repita com --apply para remover só os órfãos.');
  process.exit(missing.length ? 2 : 0);
}

let removedTracked = 0, removedUntracked = 0;
for (const f of untrackedOrphans) {
  try { rmSync(path.join(distDir, f)); removedUntracked++; } catch (e) { console.log(`falha ao remover ${f}: ${e.message}`); }
}
if (trackedOrphans.length) {
  const rels = trackedOrphans.map((f) => 'static/dist/' + f);
  try {
    execFileSync('git', ['rm', '--quiet', '--', ...rels], { cwd: root, stdio: 'pipe' });
    removedTracked = trackedOrphans.length;
  } catch {
    console.log('git rm em lote recusou; tentando arquivo por arquivo');
    for (const f of trackedOrphans) {
      const rel = 'static/dist/' + f;
      // git rm recusa arquivo recém-staged (precisa de -f) ou já sumido do disco (precisa de --cached).
      const attempts = exists(path.join(distDir, f))
        ? [['rm', '--quiet', '-f', '--', rel]]
        : [['rm', '--quiet', '--cached', '--', rel]];
      let ok = false;
      for (const args of attempts) {
        try { execFileSync('git', args, { cwd: root, stdio: 'pipe' }); ok = true; break; } catch {}
      }
      if (ok) removedTracked++; else console.log(`falha no git rm de ${f} — remova à mão`);
    }
  }
}
console.log(`\nremovidos: ${removedUntracked} untracked + ${removedTracked} rastreados (git rm).`);
console.log('próximo passo: python scripts/check_build.py');
if (missing.length) process.exit(2);
