// Gera static/release-notes.json (Novidades da Órbita) a partir do histórico do git.
// Uso: `npm run release-notes` (também roda no `npm run build`, que o Render executa).
// Sem histórico (clone raso), mantém o JSON já commitado. Texto curado vence:
// 1) static/changelog-overrides.json  2) trailer "Novidade: ..." no corpo do commit  3) assunto do commit.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const MONTHS=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
export const SKIP=/^(chore|test|tests|refactor|ci|build|docs|style)(\(|:|\b)|^merge\b|^rebuild\b|\bbuild final\b|\bdist\b|service ?worker|\bSW v\d|\bcache\b|deployment instructions|api key|secrets?\b|^testes?\b|^set requested|^document\b|^configure\b|\(n[ãa]o aplicada\)/i;
export const AREAS=[
  ['chamadas',/\b(chamada|call|v[íi]deo|livekit|tile|ouvir juntos|tela)\b/i],
  ['loja',/\b(loja|store|cosm[ée]tic|cole[çc][õo]es|pacote)/i],
  ['adm',/\b(adm|admin|modera[çc][ãa]o|administra)/i],
  ['feed',/\b(feed|novos membros|publica[çc]|trilho|novidades)/i],
  ['perfil',/\b(perfil|ins[íi]gnia|avatar|nome|handle|profile)/i],
  ['audio',/\b(áudio|audio|microfone|ru[íi]do|som|sons)\b/i],
  ['chat',/\b(chat|mensage|dm|canal|canais)\b/i],
  ['visual',/\b(visual|tema|paleta|redesign|configura[çc]|layout|grafite)/i]
];
export const FIX=/^(fix|corrige|corre[çc][ãa]o|conserta)\b|\bfix(es)?\b|\bcorrige\b/i;
export function classify(text){if(FIX.test(text))return 'correcoes';const head=/^[^:]{2,40}:/.test(text)?text.split(':')[0]:'';for(const part of [head,text])if(part)for(const [key,re] of AREAS)if(re.test(part))return key;return 'visual';}
export function humanize(subject){
  let s=String(subject||'').trim().replace(/^(feat|fix|perf|ux)(\([^)]*\))?!?:\s*/i,'');
  const m=s.match(/^([^:]{2,40}):\s+(.+)$/);if(m)s=m[2].length>12?`${m[1]}: ${m[2]}`:s;
  s=s.split(/;\s|\s—\s|\s\(/)[0].replace(/\s+/g,' ').replace(/[.;,\s]+$/,'');
  if(s.length>96)s=s.slice(0,93).replace(/\s+\S*$/,'')+'…';
  return s.charAt(0).toUpperCase()+s.slice(1);
}
export function trailer(body){const m=String(body||'').match(/^Novidade:\s*(.+)$/mi);return m?m[1].trim():'';}
export function dayOf(iso){return iso.slice(0,10);} // iso já no fuso de São Paulo
export function buildNotes(commits,overrides={},{perCard=4}={}){
  const days=new Map();
  for(const c of commits){ // mais recentes primeiro
    const curated=trailer(c.body);if(!curated&&SKIP.test(c.subject))continue;
    const day=dayOf(c.date);if(!days.has(day))days.set(day,{day,sha:c.sha.slice(0,7),list:[]});
    const text=curated||humanize(c.subject);const cat=classify(curated?c.subject+' '+curated:c.subject);
    const list=days.get(day).list;if(!list.some(x=>x.text===text))list.push({cat,text,curated:!!curated});
  }
  for(const key of Object.keys(overrides))if(!days.has(key.replaceAll('.','-')))days.set(key.replaceAll('.','-'),{day:key.replaceAll('.','-'),sha:'',list:[]});
  const releases=[...days.values()].sort((a,b)=>b.day.localeCompare(a.day)).map(({day,sha,list})=>{
    const [y,mo,d]=day.split('-');const id=`${y}.${mo}.${d}`;const o=overrides[id]||{};
    const items={};for(const it of list)(items[it.cat]||=[]).push(it.text);
    if(o.items)for(const [k,v] of Object.entries(o.items))items[k]=[...v,...(items[k]||[]).filter(t=>!v.includes(t))];
    const ranked=[...list].sort((a,b)=>(b.curated-a.curated)||(a.cat==='correcoes')-(b.cat==='correcoes'));
    const highlights=(o.highlights||ranked.map(it=>[it.cat,it.text])).slice(0,perCard);
    return {version:sha?`${id}+${sha}`:id,date:`${+d} ${MONTHS[+mo-1]} ${y}`,highlights,items};
  }).filter(r=>r.highlights.length||Object.keys(r.items).length);
  return {generated:true,releases};
}
export function readGit(cwd,limit=400){
  const out=execFileSync('git',['log','--no-merges',`-${limit}`,'--date=format-local:%Y-%m-%dT%H:%M','--format=%H%x1f%ad%x1f%s%x1f%b%x1e'],{cwd,encoding:'utf8',env:{...process.env,TZ:'America/Sao_Paulo'},stdio:['ignore','pipe','ignore']});
  return out.split('\x1e').map(r=>r.trim()).filter(Boolean).map(r=>{const [sha,date,subject,body]=r.split('\x1f');return {sha,date,subject,body};});
}
export function generate(root){
  const out=path.join(root,'static','release-notes.json'),ovf=path.join(root,'static','changelog-overrides.json');
  const overrides=existsSync(ovf)?JSON.parse(readFileSync(ovf,'utf8')):{};
  let commits=[];try{commits=readGit(root);}catch{}
  if(commits.length<5&&existsSync(out))return {skipped:true,file:out}; // clone raso: usa o JSON commitado
  const notes=buildNotes(commits,overrides);const json=JSON.stringify(notes,null,1)+'\n';
  if(!existsSync(out)||readFileSync(out,'utf8')!==json)writeFileSync(out,json);
  return {skipped:false,file:out,releases:notes.releases.length};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))console.log(JSON.stringify(generate(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'))));
