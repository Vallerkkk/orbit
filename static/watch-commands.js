// Chat de comandos do Ouvir juntos: interpretação pura (sem DOM), testada em tests/watch-commands.test.mjs.
import {youtubeLink} from './media-utils.js';

export const QUEUE_LIMIT=200;
export const COMMANDS=[
  ['tocar','<link ou busca>','Toca se nada estiver tocando; senão entra no fim da fila. Use /tocar agora <link> para interromper. Link de vídeo dentro de playlist traz a playlist a partir dele; termine com “só” para só o vídeo.'],
  ['adicionar','<link ou busca>','Adiciona ao fim da fila sem interromper a música atual (atalhos: /add, /fila+).'],
  ['proxima','<link ou busca>','Coloca como a próxima da fila, sem interromper a atual.'],
  ['playlist','<link>','Adiciona uma playlist inteira à fila (até 200 itens); só começa a tocar se nada estiver tocando.'],
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
const ALIASES={add:'adicionar','fila+':'adicionar',adiciona:'adicionar','próxima':'proxima',next:'proxima',playnext:'proxima',play:'tocar',p:'tocar',skip:'pular',proximo:'pular',próximo:'pular',pause:'pausar',resume:'continuar',back:'voltar',anterior:'voltar',queue:'fila',remove:'remover',clear:'limpar',shuffle:'embaralhar',loop:'repetir',repeat:'repetir',vol:'volume',np:'agora',help:'ajuda','?':'ajuda'};

// Retorna {cmd,arg,link?,mode} ou {error}. mode: 'now' interrompe, 'queue' vai para o fim, 'next' entra como próxima.
// Links colados sem comando entram na fila (só tocam na hora se nada estiver tocando).
export function parseWatchInput(text){
  const raw=String(text||'').trim().slice(0,500);
  if(!raw)return {error:'Digite um comando. Use /ajuda para ver a lista.'};
  if(!raw.startsWith('/')){
    const link=youtubeLink(raw.split(/\s+/)[0]);
    if(link)return {cmd:link.list&&!link.video?'playlist':'tocar',arg:raw,link,queue:true,mode:'queue',only:/\s(s[óo]|video|vídeo)$/i.test(raw)};
    return {error:'Este canal só aceita comandos do Ouvir juntos. Ex.: /tocar <link>, /pular, /pausar. Use /ajuda.'};
  }
  const m=raw.slice(1).match(/^(\S+)\s*([\s\S]*)$/);const word=(m?.[1]||'').toLowerCase();const cmd=NAMES.has(word)?word:ALIASES[word];
  if(!cmd)return {error:`Comando “/${word}” não existe. Use /ajuda.`};
  const arg=(m[2]||'').trim();
  if(cmd==='tocar'||cmd==='adicionar'||cmd==='proxima'){let rest=arg,mode=cmd==='proxima'?'next':'queue';
    if(cmd==='tocar'){const now=rest.match(/^agora\b\s*([\s\S]*)$/i);if(now){mode='now';rest=now[1].trim();}}
    if(!rest)return {error:`Use /${cmd}${mode==='now'?' agora':''} <link ou busca>.`};
    const link=youtubeLink(rest.split(/\s+/)[0]);
    return link?{cmd:'tocar',arg:rest,link,mode,only:/\s(s[óo]|video|vídeo)$/i.test(rest)}:{cmd:'tocar',arg:rest,search:rest.slice(0,100),mode};}
  if(cmd==='playlist'){const link=youtubeLink(arg.split(/\s+/)[0]);if(!link?.list)return {error:'Use /playlist <link de playlist do YouTube>.'};return {cmd,arg,link,mode:'queue'};}
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

// Fim de vídeo no Ouvir juntos: o que fazer e quanto cada participante espera antes de agir.
export function endAction({loop=false,queueLength=0}={}){return loop?'repeat':queueLength>0?'next':'stop';}
export function endDelay(rank){return rank<=0?0:2500+(rank-1)*1000;}
// Insere itens no fim ('queue') ou como próximos ('next'), respeitando o limite da fila.
export function placeItems(queue,items,mode='queue'){const room=Math.max(0,QUEUE_LIMIT-queue.length),take=items.slice(0,room);return {queue:mode==='next'?[...take,...queue]:[...queue,...take],added:take.length,dropped:items.length-take.length};}
