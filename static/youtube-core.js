// Utilitários puros do YouTube no Órbita (sem DOM): formatação pt-BR, rotas e fila do mini player.
export const YT_ID=/^[A-Za-z0-9_-]{11}$/;
export const CATEGORIES=[['','Tudo'],['musica','Música'],['games','Games'],['noticias','Notícias'],['ciencia','Ciência'],['esportes','Esportes'],['humor','Humor'],['filmes','Filmes']];
export function formatCount(n,unit=''){if(n==null||!Number.isFinite(+n))return '';n=+n;const f=(v,s)=>(v>=100?Math.round(v):Math.round(v*10)/10).toLocaleString('pt-BR')+' '+s;
  const t=n>=1e9?f(n/1e9,'bi'):n>=1e6?f(n/1e6,'mi'):n>=1e3?f(n/1e3,'mil'):n.toLocaleString('pt-BR');return unit?t+' '+unit:t;}
export function formatDuration(s){s=Math.max(0,Math.floor(+s||0));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return (h?h+':'+String(m).padStart(2,'0'):String(m))+':'+String(x).padStart(2,'0');}
export function ago(iso,now=Date.now()){const t=Date.parse(iso);if(!Number.isFinite(t))return '';const s=Math.max(0,(now-t)/1000);
  for(const [lim,div,one,many] of [[60,1,'segundo','segundos'],[3600,60,'minuto','minutos'],[86400,3600,'hora','horas'],[604800,86400,'dia','dias'],[2629800,604800,'semana','semanas'],[31557600,2629800,'mês','meses'],[Infinity,31557600,'ano','anos']])
    if(s<lim){const v=Math.max(1,Math.floor(s/div));return 'há '+v+' '+(v===1?one:many);}return '';}
export function videoMeta(v){return [v.live?'ao vivo':v.views!=null?formatCount(v.views,'visualizações'):'',ago(v.published)].filter(Boolean).join(' • ');}
export function initials(text){return String(text||'?').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()||'?';}
// Fila do mini player: avança para o próximo vídeo diferente do atual.
export function nextInQueue(queue,current){const list=(queue||[]).filter(v=>v&&YT_ID.test(v.id));if(!list.length)return null;const i=list.findIndex(v=>v.id===current);for(let k=1;k<=list.length;k++){const c=list[(i+k+list.length)%list.length];if(c.id!==current)return c;}return null;}
export function shareText(v){return (v.title?v.title+' ':'')+'https://youtu.be/'+v.id;}
export async function apiJson(fetcher,path){const r=await fetcher(path);let body={};try{body=await r.json();}catch{}if(!r.ok){const e=Error(typeof body.detail==='string'?body.detail:'Não foi possível carregar o YouTube agora.');e.status=r.status;throw e;}return body;}
export function libraryRow(v,kind){return {kind,video_id:v.id,title:String(v.title||'').slice(0,300),channel_title:String(v.channelTitle||'').slice(0,200),channel_id:String(v.channelId||'').slice(0,64),duration:v.duration?formatDuration(v.duration):'',updated_at:new Date().toISOString()};}
export function fromLibrary(r){return {id:r.video_id,title:r.title,channelTitle:r.channel_title,channelId:r.channel_id,thumb:'https://i.ytimg.com/vi/'+r.video_id+'/hqdefault.jpg',durationText:r.duration,position:r.position_seconds,watched:r.updated_at};}
