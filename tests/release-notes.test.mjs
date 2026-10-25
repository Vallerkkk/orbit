import test from 'node:test';import assert from 'node:assert/strict';
import {buildNotes,classify,humanize,trailer,SKIP,mergeHistory} from '../scripts/release-notes.mjs';
const c=(sha,date,subject,body='')=>({sha:sha.padEnd(40,'0'),date,subject,body});
test('skips technical commits',()=>{for(const s of ['chore: deps','Rebuild dist após merge','Build final do dist e service worker v36','test: x','Merge branch a','refactor(app): y','Migration X (não aplicada)'])assert.ok(SKIP.test(s),s);assert.ok(!SKIP.test('Feed: novo composer'));});
test('humanizes subjects',()=>{assert.equal(humanize('feat(feed): novo composer; remove stories'),'Novo composer');assert.equal(humanize('Loja v2: coleções animadas (SW v44)'),'Loja v2: coleções animadas');assert.ok(humanize('x '.repeat(80)).length<=97);});
test('classifies by area',()=>{assert.equal(classify('Chamada: nomes legíveis'),'chamadas');assert.equal(classify('Loja v2: coleções'),'loja');assert.equal(classify('ADM: excluir servidor'),'adm');assert.equal(classify('Corrige vídeo borrado'),'correcoes');assert.equal(classify('Configurações v2: Perfil embutido'),'visual');});
test('groups by day with version = date + sha, top 4 highlights',()=>{const n=buildNotes([c('bbb1111','2026-10-23T02:00','Feed: a'),c('bbb2222','2026-10-23T01:00','Loja: b'),c('bbb3333','2026-10-23T00:30','Chamada: c'),c('bbb4444','2026-10-23T00:10','Perfil: d'),c('bbb5555','2026-10-23T00:05','ADM: e'),c('aaa1111','2026-10-22T10:00','chore: x'),c('aaa2222','2026-10-22T09:00','Chat: f')]);
  assert.equal(n.releases.length,2);assert.equal(n.releases[0].version,'2026.10.23+bbb1111');assert.equal(n.releases[0].date,'23 out 2026');assert.equal(n.releases[0].highlights.length,4);assert.deepEqual(n.releases[1].items,{chat:['Chat: f']});});
test('curated text wins: trailer and overrides',()=>{assert.equal(trailer('x\n\nNovidade: Texto bonito'),'Texto bonito');
  const n=buildNotes([c('ccc1','2026-10-23T01:00','chore: interno','Novidade: Algo legal no feed'),c('ccc2','2026-10-23T00:00','Loja: z')],{'2026.10.23':{highlights:[['loja','Curado']]},'2026.10.20':{highlights:[['feed','Antiga']]}});
  assert.deepEqual(n.releases[0].highlights,[['loja','Curado']]);assert.ok(Object.values(n.releases[0].items).flat().includes('Algo legal no feed'));assert.equal(n.releases.at(-1).version,'2026.10.20');});
test('um git mais curto que o histórico publicado não apaga novidades antigas',()=>{
  const fresh=buildNotes([c('ddd1111','2026-10-25T10:00','Feed: novo'),c('ddd2222','2026-10-23T10:00','chore: interno')],{'2026.10.23':{items:{feed:['Curado antigo']}}});
  const previous={releases:[{version:'2026.10.24+eee2222',date:'24 out 2026',highlights:[['loja','Loja nova']],items:{loja:['Loja nova']}},
    {version:'2026.10.23+bbb3333',date:'23 out 2026',highlights:[['chamadas','Chamada x']],items:{chamadas:['Chamada x']}}]};
  const n=mergeHistory(fresh,previous);
  assert.deepEqual(n.releases.map(r=>r.version),['2026.10.25+ddd1111','2026.10.24+eee2222','2026.10.23+bbb3333']);
  assert.deepEqual(n.releases[2].items,{feed:['Curado antigo'],chamadas:['Chamada x']});
  assert.deepEqual(mergeHistory(fresh,null).releases.length,2);});
test('plural entra na área certa e a mesma novidade não se repete em duas categorias',()=>{
  assert.equal(classify('Integra o Astro às calls'),'chamadas');
  assert.equal(classify('Remove a tela de carregamento antiga'),'chamadas');
  assert.ok(SKIP.test('Deixa de rastrear o meta.json do build, que já estava no .gitignore'));
  const n=mergeHistory(buildNotes([c('fff1111','2026-10-25T10:00','Loja: capas novas')]),
    {releases:[{version:'2026.10.25+eee0000',date:'25 out 2026',highlights:[],items:{visual:['Loja: capas novas']}}]});
  assert.deepEqual(n.releases[0].items,{loja:['Loja: capas novas']});assert.equal(n.releases[0].version,'2026.10.25+fff1111');});
