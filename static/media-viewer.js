// Mídia de chat (imagens/vídeos): mostra inline e abre num visualizador ampliado ao clicar.
// Leve: um <dialog> reaproveitado; fecha com Esc ou clique fora; botão de baixar dentro.
let viewer;
function ensureViewer(){
  if(viewer)return viewer;
  viewer=document.createElement('dialog');viewer.className='media-viewer';viewer.setAttribute('aria-label','Mídia ampliada');
  viewer.innerHTML='<div class="mv-bar"><span class="mv-name"></span><button type="button" class="mv-download">↓ Baixar</button><button type="button" class="mv-close" aria-label="Fechar">×</button></div><div class="mv-stage"></div>';
  viewer.addEventListener('click',e=>{if(e.target===viewer||e.target.classList.contains('mv-stage'))viewer.close();});
  viewer.querySelector('.mv-close').onclick=()=>viewer.close();
  viewer.addEventListener('close',()=>{const v=viewer.querySelector('video');if(v)v.pause();viewer.querySelector('.mv-stage').replaceChildren();});
  document.body.append(viewer);return viewer;
}
export function openMediaViewer({url,name='',kind='image',onDownload}){
  const d=ensureViewer(),stage=d.querySelector('.mv-stage');
  d.querySelector('.mv-name').textContent=name;
  const dl=d.querySelector('.mv-download');dl.hidden=!onDownload;dl.onclick=()=>onDownload?.();
  const media=document.createElement(kind==='video'?'video':'img');media.src=url;
  if(kind==='video'){media.controls=true;media.autoplay=true;media.playsInline=true;}else media.alt=name;
  stage.replaceChildren(media);if(!d.open)d.showModal();d.querySelector('.mv-close').focus();
}
// Resolve a URL da mídia (URL assinada; se falhar, baixa o blob) e devolve o elemento inline.
export function attachmentMedia(a,{resolve,download,makeVideo=v=>v}){
  const video=a.mime_type?.startsWith('video/');
  // Vídeos enviados já têm controles e botão de ampliar próprios (uploaded-video.js).
  const node=video?makeVideo(document.createElement('video')):document.createElement('img');
  if(video)node.setAttribute('aria-label','Vídeo: '+a.name);
  else{node.className='attachment-preview';node.alt=a.name;node.loading='lazy';node.decoding='async';node.width=480;node.height=320;node.tabIndex=0;node.setAttribute('role','button');node.title='Clique para ampliar';}
  // URL assinada; se falhar, usa o mesmo download autenticado do botão de baixar.
  const ready=Promise.resolve().then(()=>resolve(a)).catch(()=>download(a,true)).then(u=>{node.src=u;return u;}).catch(()=>{node.remove();return null;});
  if(!video){const open=e=>{e?.preventDefault();ready.then(u=>{if(u)openMediaViewer({url:u,name:a.name,kind:'image',onDownload:()=>download(a)});});};
    node.addEventListener('click',open);node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')open(e);});}
  return node;
}
