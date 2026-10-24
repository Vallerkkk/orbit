// Transmissões de tela são opt-in (como no Discord): a faixa só é assinada quando a pessoa escolhe assistir.
export const SCREEN_SOURCES=new Set(['screen_share','screen_share_audio']);
export const AUTO_WATCH_KEY='orbita-screen-autowatch';
export function readAutoWatch(storage=globalThis.localStorage){try{return storage?.getItem(AUTO_WATCH_KEY)==='true';}catch{return false;}}
export function writeAutoWatch(value,storage=globalThis.localStorage){try{storage?.setItem(AUTO_WATCH_KEY,String(!!value));}catch{}}
// watching: quem a pessoa escolheu assistir; declined: quem ela parou de assistir (vence o automático).
export function wantsTrack(source,identity,{watching,declined,auto}){if(!SCREEN_SOURCES.has(source))return true;if(watching.has(identity))return true;return !!auto&&!declined.has(identity);}

export function initScreenWatch(ctx){
  const watching=new Set(),declined=new Set(),placeholders=new Map();let wanted='';const MAX_SCREENS=2;
  const opts=()=>({watching,declined,auto:readAutoWatch()});
  const nameOf=identity=>ctx.name(identity)||'Alguém';
  const pubs=p=>p?.trackPublications?[...p.trackPublications.values()]:[...(p?.videoTrackPublications?.values?.()||[]),...(p?.audioTrackPublications?.values?.()||[])];
  function placeholder(identity){let tile=placeholders.get(identity);if(tile?.isConnected)return tile;
    tile=document.createElement('figure');tile.className='media-tile media-screen screen-placeholder';tile.dataset.participantId=identity;tile.dataset.screenPlaceholder='true';
    const box=document.createElement('div');box.className='sp-body';const icon=document.createElement('span');icon.className='sp-icon';icon.setAttribute('aria-hidden','true');icon.textContent='▭';
    const text=document.createElement('p');text.className='sp-text';const strong=document.createElement('strong');strong.textContent=nameOf(identity);text.append(strong,document.createTextNode(' está compartilhando a tela'));
    const btn=document.createElement('button');btn.type='button';btn.className='sp-watch';btn.textContent='Assistir';btn.setAttribute('aria-label','Assistir à tela de '+nameOf(identity));btn.onclick=()=>watch(identity);
    box.append(icon,text,btn);tile.append(box);tile.addEventListener('click',e=>{if(!e.target.closest('button'))watch(identity);});placeholders.set(identity,tile);document.getElementById('media-grid')?.append(tile);ctx.changed();return tile;}
  function dropPlaceholder(identity){const tile=placeholders.get(identity);if(tile){tile.remove();placeholders.delete(identity);ctx.changed();}}
  function isScreenVideo(publication){return publication?.source==='screen_share'&&(publication.kind==='video'||!publication.kind);}
  // Decide assinar ou não; chamada em TrackPublished, ao entrar e quando a preferência muda.
  function apply(publication,participant){if(!publication||!participant||participant.isLocal)return;const want=wantsTrack(publication.source,participant.identity,opts());
    if(publication.isSubscribed!==want)try{publication.setSubscribed?.(want);}catch{}
    if(isScreenVideo(publication)&&!want){const tile=placeholder(participant.identity);tile.classList.remove('sp-loading');const b=tile.querySelector('.sp-watch');if(b)b.textContent='Assistir';}}
  function scan(room){for(const participant of room?.remoteParticipants?.values?.()||[])for(const publication of pubs(participant))apply(publication,participant);}
  // TrackSubscribed: devolve false quando a faixa de tela não foi pedida (e cancela a assinatura).
  function accept(track,publication,participant){const source=publication?.source||track?.source;if(participant?.isLocal||!SCREEN_SOURCES.has(source))return true;
    if(!wantsTrack(source,participant.identity,opts())){try{publication?.setSubscribed?.(false);}catch{}if(source==='screen_share')placeholder(participant.identity);return false;}
    if(source==='screen_share')dropPlaceholder(participant.identity);return true;}
  function unpublished(publication,participant){if(publication?.source==='screen_share'&&participant)dropPlaceholder(participant.identity);}
  function left(participant){if(participant){dropPlaceholder(participant.identity);watching.delete(participant.identity);declined.delete(participant.identity);}}
  function watch(identity){wanted=identity;watching.delete(identity);watching.add(identity);declined.delete(identity);for(const old of [...watching])if(watching.size>MAX_SCREENS&&old!==identity){watching.delete(old);const p=ctx.room()?.remoteParticipants?.get(old);for(const publication of pubs(p))if(SCREEN_SOURCES.has(publication.source))try{publication.setSubscribed?.(false);}catch{}ctx.drop(old);placeholder(old);}const p=ctx.room()?.remoteParticipants?.get(identity);const tile=placeholders.get(identity);if(tile){tile.classList.add('sp-loading');const b=tile.querySelector('.sp-watch');if(b)b.textContent='Conectando…';}for(const publication of pubs(p))apply(publication,p);ctx.watched?.(identity);}
  function stop(identity){watching.delete(identity);declined.add(identity);const p=ctx.room()?.remoteParticipants?.get(identity);for(const publication of pubs(p))if(SCREEN_SOURCES.has(publication.source))try{publication.setSubscribed?.(false);}catch{}ctx.drop(identity);placeholder(identity);}
  function decorate(figure,participant){if(!participant.isLocal&&wanted===participant.identity){wanted='';queueMicrotask(()=>document.dispatchEvent(new CustomEvent('orbita-focus-tile',{detail:figure})));}if(participant.isLocal||figure.querySelector('.sp-stop'))return;const b=document.createElement('button');b.type='button';b.className='sp-stop';b.textContent='Parar de assistir';b.setAttribute('aria-label','Parar de assistir à tela de '+nameOf(participant.identity));b.onclick=e=>{e.stopPropagation();stop(participant.identity);};(figure.querySelector('figcaption')||figure).append(b);}
  function setAuto(value){writeAutoWatch(value);if(value)declined.clear();scan(ctx.room());}
  function reset(){for(const id of [...placeholders.keys()])dropPlaceholder(id);watching.clear();declined.clear();}
  return {apply,scan,accept,unpublished,left,watch,stop,decorate,setAuto,reset,watching,declined};
}
