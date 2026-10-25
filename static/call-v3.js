// Call v3: estados mudo/ensurdecido no painel, duplo clique para entrar na voz, botão de entrar centralizado.
const $=id=>document.getElementById(id);
export function installCallV3(){
  const pairs=[['mic','up-mic-btn',b=>b.getAttribute('aria-pressed')==='false'],['deafen','up-deafen-btn',b=>b.getAttribute('aria-pressed')==='true']];
  for(const [src,dst,isOff] of pairs){const s=$(src),d=$(dst);if(!s||!d)continue;
    const sync=()=>{const off=isOff(s),was=d.classList.contains('muted');d.classList.toggle('muted',off);d.setAttribute('aria-pressed',String(off));if(off!==was){d.classList.remove('up-pop');void d.offsetWidth;d.classList.add('up-pop');}};
    new MutationObserver(sync).observe(s,{attributes:true,attributeFilter:['aria-pressed']});sync();d.addEventListener('animationend',()=>d.classList.remove('up-pop'));}
  document.addEventListener('dblclick',e=>{const n=e.target.closest?.('.channel[data-channel-id]');if(!n||n.classList.contains('dm-item'))return;const id=n.dataset.channelId;e.preventDefault();window.orbitaJoinVoice?.(id);});
  if(window.orbitaDesktop&&!$('desk-ctl')){const box=document.createElement('div');box.id='desk-ctl';box.className='desk-ctl';
    for(const [k,label,d] of [['minimize','Minimizar','M5 12h14'],['close','Fechar','M6 6l12 12M18 6L6 18']]){const b=document.createElement('button');b.type='button';b.className='desk-'+k;b.title=label;b.setAttribute('aria-label',label);b.innerHTML=`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="${d}"/></svg>`;b.onclick=()=>window.orbitaDesktop[k]();box.append(b);}
    document.body.append(box);}
  const wrap=document.querySelector('#voice-view .join-wrap'),card=$('empty-call');
  if(wrap&&card){card.append(wrap);wrap.classList.add('join-centered');}
}
