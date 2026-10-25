// Menu de contexto leve e único (estilo Discord): botão direito, toque longo ou clique. Fica dentro da tela,
// fecha com Esc/clique fora. Itens: {label,action,danger,checked} | {range:{label,min,max,step,value,format,input}} | {sep:true} | {heading}
let current=null;
export function closeMenu(){if(!current)return;current.remove();current=null;document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',onKey,true);window.removeEventListener('resize',closeMenu);window.removeEventListener('blur',closeMenu);}
function outside(e){if(current&&!current.contains(e.target))closeMenu();}
function onKey(e){if(e.key==='Escape'){e.preventDefault();closeMenu();}}
const mk=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
export function openMenu({x=0,y=0,items=[],header=null,card=false,label='Menu',noFocus=false}={}){
  closeMenu();const menu=mk('div','ux-context-menu orb-menu'+(card?' orb-card':''));menu.setAttribute('role','menu');menu.setAttribute('aria-label',label);
  if(header)menu.append(header);
  for(const item of items){if(!item)continue;
    if(item.sep){menu.append(mk('div','orb-menu-sep'));continue;}
    if(item.heading){menu.append(mk('div','orb-menu-heading',item.heading));continue;}
    if(item.range){const r=item.range,row=mk('label','orb-menu-range'),top=mk('span','orb-menu-range-top'),out=mk('output'),input=mk('input');
      input.type='range';input.min=r.min??0;input.max=r.max??1;input.step=r.step??0.01;input.value=r.value;input.setAttribute('aria-label',r.label);
      const fmt=r.format||(v=>Math.round(v*100)+'%');out.value=fmt(Number(input.value));input.oninput=()=>{out.value=fmt(Number(input.value));r.input?.(Number(input.value));};
      top.append(mk('span','',r.label),out);row.append(top,input);menu.append(row);continue;}
    const b=mk('button','orb-menu-item'+(item.danger?' danger':''));b.type='button';b.setAttribute('role',item.checked==null?'menuitem':'menuitemcheckbox');
    b.append(mk('span','',item.label));if(item.checked!=null){b.setAttribute('aria-checked',String(!!item.checked));b.append(mk('span','orb-menu-check'+(item.checked?' on':'')));}
    b.onclick=()=>{if(!item.keepOpen)closeMenu();item.action?.();};menu.append(b);}
  document.body.append(menu);current=menu;
  const sheet=matchMedia('(max-width: 640px) and (pointer: coarse)').matches;menu.classList.toggle('orb-sheet',sheet);
  if(!sheet){const w=menu.offsetWidth,h=menu.offsetHeight,vw=innerWidth,vh=innerHeight;
    menu.style.left=Math.max(8,Math.min(x,vw-w-8))+'px';menu.style.top=Math.max(8,Math.min(y,vh-h-8))+'px';}
  setTimeout(()=>{document.addEventListener('pointerdown',outside,true);},0);document.addEventListener('keydown',onKey,true);window.addEventListener('resize',closeMenu);window.addEventListener('blur',closeMenu);
  if(!noFocus)menu.querySelector('button,input')?.focus({preventScroll:true});return menu;}
// Toque longo (500 ms) dispara callback com as coordenadas; cancela se o dedo mexer.
export function onLongPress(root,selector,cb){let t=0,sx=0,sy=0;
  root.addEventListener('touchstart',e=>{const el=e.target instanceof Element?e.target:e.target?.parentElement,target=el?.closest(selector);if(!target)return;const p=e.touches[0];sx=p.clientX;sy=p.clientY;clearTimeout(t);t=setTimeout(()=>{t=0;cb(target,sx,sy);},500);},{passive:true});
  const cancel=()=>{clearTimeout(t);t=0;};root.addEventListener('touchend',cancel);root.addEventListener('touchcancel',cancel);
  root.addEventListener('touchmove',e=>{const p=e.touches[0];if(Math.abs(p.clientX-sx)+Math.abs(p.clientY-sy)>10)cancel();},{passive:true});}
