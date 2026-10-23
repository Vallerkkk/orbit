// Acabamento Grafite: tooltip próprio (substitui title nativo) e select em pílula com menu próprio.
export function installGrafiteUi(root=document){
  const tip=document.createElement('div');tip.className='gx-tip';tip.setAttribute('role','tooltip');tip.hidden=true;document.body.append(tip);
  let owner=null,timer=0;
  const adopt=node=>{const t=node.getAttribute('title');if(t){node.dataset.tip=t;node.removeAttribute('title');if(!node.getAttribute('aria-label')&&!node.textContent.trim())node.setAttribute('aria-label',t);}return node.dataset.tip;};
  const place=()=>{if(!owner)return;const r=owner.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight;let top=r.top-h-8,below=false;if(top<6){top=r.bottom+8;below=true;}const left=Math.max(6,Math.min(innerWidth-w-6,r.left+r.width/2-w/2));tip.style.transform=`translate(${Math.round(left)}px,${Math.round(top)}px)`;tip.classList.toggle('below',below);};
  const show=node=>{const text=adopt(node);if(!text)return;owner=node;tip.textContent=text;tip.hidden=false;tip.classList.remove('on');place();requestAnimationFrame(()=>tip.classList.add('on'));};
  const hide=()=>{clearTimeout(timer);owner=null;tip.classList.remove('on');tip.hidden=true;};
  const over=e=>{const n=e.target.closest?.('[title],[data-tip]');if(n===owner)return;hide();if(!n||n.closest('.gx-tip'))return;adopt(n);timer=setTimeout(()=>{if(n.isConnected)show(n);},e.type==='focusin'?0:350);};
  root.addEventListener('pointerover',over,true);root.addEventListener('focusin',over,true);
  root.addEventListener('pointerout',e=>{if(owner&&!owner.contains(e.relatedTarget))hide();},true);root.addEventListener('focusout',hide,true);
  addEventListener('scroll',hide,true);root.addEventListener('pointerdown',hide,true);root.addEventListener('keydown',e=>{if(e.key==='Escape')hide();},true);
  const enhance=()=>root.querySelectorAll('select[data-pill]:not([data-pilled])').forEach(pillSelect);enhance();
  new MutationObserver(enhance).observe(document.body,{childList:true,subtree:true});
}
export function pillSelect(select){select.dataset.pilled='1';select.classList.add('gx-native');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
  const wrap=document.createElement('span');wrap.className='gx-pill-select';const btn=document.createElement('button');btn.type='button';btn.className='gx-pill';btn.setAttribute('aria-haspopup','listbox');btn.setAttribute('aria-expanded','false');btn.setAttribute('aria-label',select.getAttribute('aria-label')||'Escolher');
  const label=document.createElement('span'),chev=document.createElement('span');chev.className='gx-chev';chev.setAttribute('aria-hidden','true');btn.append(label,chev);
  const sync=()=>{label.textContent=select.selectedOptions[0]?.textContent||'';};select.after(wrap);wrap.append(btn,select);sync();select.addEventListener('change',sync);
  let menu=null;const close=()=>{menu?.remove();menu=null;btn.setAttribute('aria-expanded','false');document.removeEventListener('pointerdown',outside,true);};
  const outside=e=>{if(!wrap.contains(e.target))close();};
  const choose=v=>{select.value=v;select.dispatchEvent(new Event('change',{bubbles:true}));sync();close();btn.focus();};
  btn.onclick=()=>{if(menu)return close();menu=document.createElement('div');menu.className='gx-menu';menu.setAttribute('role','listbox');
    for(const o of select.options){const it=document.createElement('button');it.type='button';it.setAttribute('role','option');it.setAttribute('aria-selected',String(o.value===select.value));it.textContent=o.textContent;it.onclick=()=>choose(o.value);menu.append(it);}
    menu.onkeydown=e=>{const items=[...menu.children],i=items.indexOf(document.activeElement);if(e.key==='ArrowDown'){e.preventDefault();items[(i+1)%items.length].focus();}else if(e.key==='ArrowUp'){e.preventDefault();items[(i-1+items.length)%items.length].focus();}else if(e.key==='Escape'){close();btn.focus();}};
    wrap.append(menu);btn.setAttribute('aria-expanded','true');(menu.querySelector('[aria-selected=true]')||menu.firstChild)?.focus();document.addEventListener('pointerdown',outside,true);};
  new MutationObserver(sync).observe(select,{childList:true});}
