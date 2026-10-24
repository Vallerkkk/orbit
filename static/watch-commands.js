// Chat de comandos do Ouvir juntos: interpretação pura (sem DOM), testada em tests/watch-commands.test.mjs.
import {youtubeLink} from './media-utils.js';

export const QUEUE_LIMIT=200;
export const COMMANDS=[
  ['tocar','<link ou busca>','Toca agora um vídeo ou playlist. Link de vídeo dentro de playlist toca a playlist a partir dele; termine com “só” para tocar só o vídeo.'],
  ['playlist','<link>','Adiciona uma playlist inteira à fila (até 200 itens).'],
  ['pular','','Vai para o próximo da fila.'],
  ['pausar','','Pausa para todos.'],
  ['continuar','','Continua a reprodução para todos.'],
  ['voltar','','Volta para o vídeo anterior (ou reinicia o atual).'],
  ['fila','','Mostra os próximos da fila.'],
  ['remover','<n>','Remove o item n da fila.'],
  ['limpar','','Esvazia a fila.'],
  ['embaralhar','','Embaralha a fila.'],
  ['repetir','','Liga/desliga repetir o vídeo atual.'],
  ['volume','<0-100>','Ajusta o volume só para você.'],
  ['agora','','Mostra o que está tocando.'],
  ['ajuda','','Lista os comandos.'],
];
const NAMES=new Set(COMMANDS.map(c=>c[0]));
const ALIASES={play:'tocar',p:'tocar',skip:'pular',proximo:'pular',próximo:'pular',pause:'pausar',resume:'continuar',back:'voltar',anterior:'voltar',queue:'fila',remove:'remover',clear:'limpar',shuffle:'embaralhar',loop:'repetir',repeat:'repetir',vol:'volume',np:'agora',help:'ajuda','?':'ajuda'};

// Retorna {cmd,arg,link?} ou {error}. Links colados sem comando viram /tocar (ou /playlist se for playlist pura).
export function parseWatchInput(text){
  const raw=String(text||'').trim().slice(0,500);
  if(!raw)return {error:'Digite um comando. Use /ajuda para ver a lista.'};
  if(!raw.startsWith('/')){
    const link=youtubeLink(raw.split(/\s+/)[0]);
    if(link)return {cmd:link.list&&!link.video?'playlist':'tocar',arg:raw,link,queue:true};
    return {error:'Este canal só aceita comandos do Ouvir juntos. Ex.: /tocar <link>, /pular, /pausar. Use /ajuda.'};
  }
  const m=raw.slice(1).match(/^(\S+)\s*([\s\S]*)$/);const word=(m?.[1]||'').toLowerCase();const cmd=NAMES.has(word)?word:ALIASES[word];
  if(!cmd)return {error:`Comando “/${word}” não existe. Use /ajuda.`};
  const arg=(m[2]||'').trim();
  if(cmd==='tocar'){if(!arg)return {error:'Use /tocar <link ou busca>.'};const link=youtubeLink(arg.split(/\s+/)[0]);return link?{cmd,arg,link,only:/\s(s[óo]|video|vídeo)$/i.test(arg)}:{cmd,arg,search:arg.slice(0,100)};}
  if(cmd==='playlist'){const link=youtubeLink(arg.split(/\s+/)[0]);if(!link?.list)return {error:'Use /playlist <link de playlist do YouTube>.'};return {cmd,arg,link};}
  if(cmd==='remover'){const n=Number(arg);if(!Number.isInteger(n)||n<1)return {error:'Use /remover <número da fila>, ex.: /remover 2.'};return {cmd,n};}
  if(cmd==='volume'){if(!arg)return {cmd};const n=Number(arg.replace('%',''));if(!Number.isFinite(n)||n<0||n>100)return {error:'Use /volume <0 a 100>.'};return {cmd,n:Math.round(n)};}
  return {cmd};
}

// Itens da playlist a partir do vídeo do link (padrão: playlist inteira começando nele).
export function orderFrom(items,video){const i=video?items.findIndex(x=>x.v===video):-1;return i>0?items.slice(i):items.slice();}
export function removeAt(queue,n){if(n<1||n>queue.length)return null;return queue.filter((_,i)=>i!==n-1);}
export function shuffled(queue,random=Math.random){const a=queue.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
export function appendLimited(queue,items){const room=Math.max(0,QUEUE_LIMIT-queue.length);return {queue:[...queue,...items.slice(0,room)],added:Math.min(room,items.length),dropped:Math.max(0,items.length-room)};}
// Divide a fila em pedaços para caber no limite de mensagens do LiveKit.
export function chunk(items,size=25){const out=[];for(let i=0;i<items.length;i+=size)out.push(items.slice(i,i+size));return out.length?out:[[]];}
export function helpText(){return COMMANDS.map(([n,a,d])=>`/${n}${a?' '+a:''} — ${d}`).join('\n');}
