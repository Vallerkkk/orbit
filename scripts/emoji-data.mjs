// Gera static/emoji-data.js (Unicode completo, nomes pt-BR + en) a partir de emojibase-data.
// Rodar: node scripts/emoji-data.mjs  — o módulo é carregado sob demanda pelo seletor.
import {readFile,writeFile} from 'node:fs/promises';
const load=l=>readFile(new URL(`../node_modules/emojibase-data/${l}/compact.json`,import.meta.url),'utf8').then(JSON.parse);
const [pt,en]=await Promise.all([load('pt'),load('en')]);const enBy=new Map(en.map(e=>[e.hexcode,e]));
const rows=pt.filter(e=>e.group!==undefined&&e.group!==2).sort((a,b)=>a.order-b.order).map(e=>{const x=enBy.get(e.hexcode)||{};const skins=(e.skins||[]).filter(s=>!s.hexcode.includes('-1F3F',s.hexcode.indexOf('1F3F')+1)).slice(0,5).map(s=>s.unicode);
  return [e.unicode,e.group,[e.label,...(e.tags||[]),x.label||'',...(x.tags||[])].join(' ').toLowerCase(),skins.length===5?skins.join(','):''];});
const version=JSON.parse(await readFile(new URL('../node_modules/emojibase-data/package.json',import.meta.url),'utf8')).version;
await writeFile(new URL('../static/emoji-data.js',import.meta.url),`// Gerado por scripts/emoji-data.mjs (emojibase-data ${version}, MIT). Não editar à mão.\nexport const EMOJI_VERSION=${JSON.stringify(version)};\nexport const EMOJIS=${JSON.stringify(rows)};\n`);
console.log(rows.length,'emojis');
