// Abertura: anel da órbita se desenha, um ponto orbita uma vez, o logo assenta e "Órbita" revela. ~1,8 s, uma vez por sessão.
(()=>{try{if(sessionStorage.getItem('orbita-intro')||new URLSearchParams(location.search).has('nointro'))return;sessionStorage.setItem('orbita-intro','1');}catch{return;}
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches,o=document.createElement('div');o.className='orbita-intro'+(reduce?' reduce':'');o.setAttribute('role','presentation');
  o.innerHTML='<div class="oi-stage"><svg class="oi-logo" viewBox="0 0 64 64" width="104" height="104" aria-hidden="true"><defs><linearGradient id="oiG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9a8cff"/><stop offset="1" stop-color="#5b3df5"/></linearGradient></defs>'
   +'<rect class="oi-tile" width="64" height="64" rx="18" fill="url(#oiG)"/><g transform="rotate(-28 32 32)" fill="none" stroke-linecap="round"><circle class="oi-planet" cx="32" cy="32" r="10.5" fill="#fff"/>'
   +'<ellipse class="oi-ring" cx="32" cy="32" rx="24" ry="9" stroke="#fff" stroke-width="3.2" pathLength="100"/><circle class="oi-dot" r="3.6" fill="#ff7a59"/></g></svg>'
   +'<div class="oi-word">Órbita</div></div><div class="oi-sign">Valler × Kalil</div>';
  let done=false;const close=()=>{if(done)return;done=true;o.classList.add('out');setTimeout(()=>o.remove(),reduce?0:420);};
  o.addEventListener('pointerdown',close);addEventListener('keydown',close,{once:true});(document.body||document.documentElement).append(o);setTimeout(close,reduce?700:1800);})();
