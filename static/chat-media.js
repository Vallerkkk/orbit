// GIFs e figurinhas no chat. A mensagem guarda só um marcador em texto: [gif](url) ou [figurinha](url).
// Não precisa de coluna nova: respeita o check de conteúdo, valid_poll e as RLS atuais.
const HOSTS=/^https:\/\/(?:media\d*|i)\.giphy\.com\/[\w\-./]+$/;
const PATTERN=/^\[(gif|figurinha)(?::([^\]\n]{0,120}))?\]\((https:\/\/[^\s)]+)\)$/;
export function chatMedia(content){const m=PATTERN.exec((content||'').trim());if(!m||!HOSTS.test(m[3]))return null;return {kind:m[1]==='gif'?'gif':'sticker',title:m[2]||'',url:m[3]};}
export function mediaToken(kind,item){const title=(item.title||'').replace(/[\]\n()]/g,' ').trim().slice(0,80);return `[${kind==='gif'?'gif':'figurinha'}${title?':'+title:''}](${item.url})`;}
export function renderChatMedia(media){const box=document.createElement('figure');box.className='chat-media chat-media-'+media.kind;const img=document.createElement('img');img.src=media.url;img.loading='lazy';img.decoding='async';img.alt=(media.kind==='gif'?'GIF':'Figurinha')+(media.title?': '+media.title:'');img.referrerPolicy='no-referrer';img.onerror=()=>{box.classList.add('chat-media-broken');box.textContent=img.alt+' (não carregou)';};box.append(img);const via=document.createElement('figcaption');via.className='chat-media-via';via.textContent='via GIPHY';box.append(via);return box;}
