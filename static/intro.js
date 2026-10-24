// Abertura do app: logo da Órbita + "Uma criação de / Valler & Kalil". Uma vez por sessão, ~1,5 s, pula com clique.
(()=>{try{if(sessionStorage.getItem('orbita-intro')||new URLSearchParams(location.search).has('nointro'))return;sessionStorage.setItem('orbita-intro','1');}catch{return;}
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches,o=document.createElement('div');o.className='orbita-intro'+(reduce?' reduce':'');o.setAttribute('role','presentation');
  o.innerHTML='<div class="oi-inner"><img src="/static/icons/icon.svg" alt="" width="76" height="76"><span class="oi-name">Órbita</span><small>Uma criação de</small><strong>Valler &amp; Kalil</strong></div>';
  let done=false;const close=()=>{if(done)return;done=true;o.classList.add('out');setTimeout(()=>o.remove(),reduce?0:320);};
  o.addEventListener('pointerdown',close);addEventListener('keydown',close,{once:true});(document.body||document.documentElement).append(o);setTimeout(close,reduce?700:1500);})();
