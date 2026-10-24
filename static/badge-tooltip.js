// Tooltip próprio das insígnias: nome em negrito + uma linha curta, cor da raridade.
// Aparece no hover (com atraso), no foco e no toque; sempre dentro da tela.
import {badgeById,badgeDesc,badgeSvg,RARITIES,LEVELS} from './badges-catalog.js';
let tip,timer,current,shownAt=0,installed=false;
const SEL='[data-badge-tip]';
function info(node){const b=badgeById.get(node.dataset.badgeTip);if(!b)return null;const level=Number(node.dataset.badgeLevel||1),locked=node.dataset.badgeLocked==='1';
  if(locked&&b.secret)return {b,level:1,locked,name:'Insígnia secreta',desc:'Descubra usando a Órbita.',color:'#6b6f80',meta:'Secreta'};
  const rar=RARITIES[b.rarity];const meta=locked?'Bloqueada':(b.t.length>1&&LEVELS[level-1]?`Nível ${LEVELS[level-1].name} · ${rar.name}`:rar.name);
  return {b,level,locked,name:b.name,desc:badgeDesc(b.id)||b.unit,color:rar.color,meta};}
function ensure(){if(tip)return tip;tip=document.createElement('div');tip.id='badge-tip';tip.className='badge-tip';tip.setAttribute('role','tooltip');tip.hidden=true;document.body.append(tip);return tip;}
function place(node){const r=node.getBoundingClientRect(),t=tip.getBoundingClientRect(),m=8,vw=innerWidth,vh=innerHeight;
  let top=r.top-t.height-10,below=false;if(top<m){top=r.bottom+10;below=true;}if(top+t.height>vh-m)top=Math.max(m,vh-m-t.height);
  let left=r.left+r.width/2-t.width/2;left=Math.max(m,Math.min(left,vw-m-t.width));
  tip.style.left=left+'px';tip.style.top=top+'px';tip.dataset.side=below?'bottom':'top';}
export function showBadgeTip(node){const d=info(node);if(!d)return;ensure();current=node;
  // Diálogos modais ficam na top layer: o tooltip precisa morar dentro do diálogo aberto para não ficar atrás do perfil.
  const host=node.closest('dialog[open]')||document.body;if(tip.parentNode!==host)host.append(tip);
  tip.style.setProperty('--rc',d.color);tip.replaceChildren();
  const ico=document.createElement('span');ico.className='bt-ico';ico.innerHTML=badgeSvg(d.b,Math.max(1,d.level),{locked:d.locked,size:30});
  const body=document.createElement('span');body.className='bt-body';
  const name=document.createElement('b');name.textContent=d.name;const meta=document.createElement('small');meta.className='bt-meta';meta.textContent=d.meta;
  const desc=document.createElement('span');desc.className='bt-desc';desc.textContent=d.desc;
  body.append(name,meta,desc);tip.append(ico,body);tip.hidden=false;tip.classList.remove('on');place(node);requestAnimationFrame(()=>tip.classList.add('on'));
  node.setAttribute('aria-describedby','badge-tip');shownAt=Date.now();}
export function hideBadgeTip(){clearTimeout(timer);if(current)current.removeAttribute('aria-describedby');current=null;if(tip){tip.classList.remove('on');tip.hidden=true;}}
export function markBadge(node,id,{level=1,locked=false}={}){node.dataset.badgeTip=id;node.dataset.badgeLevel=String(level||1);if(locked)node.dataset.badgeLocked='1';else delete node.dataset.badgeLocked;
  node.removeAttribute('title');delete node.dataset.tip;if(!node.hasAttribute('tabindex')&&node.tagName!=='BUTTON')node.tabIndex=0;return node;}
export function installBadgeTooltips(root=document){if(installed)return;installed=true;
  root.addEventListener('pointerover',e=>{if(e.pointerType==='touch')return;const n=e.target.closest?.(SEL);if(!n||n===current)return;clearTimeout(timer);timer=setTimeout(()=>showBadgeTip(n),350);});
  root.addEventListener('pointerout',e=>{if(e.pointerType==='touch')return;const n=e.target.closest?.(SEL);if(!n||n.contains(e.relatedTarget))return;clearTimeout(timer);if(n===current)hideBadgeTip();});
  root.addEventListener('focusin',e=>{const n=e.target.closest?.(SEL);if(n&&n.matches(':focus-visible'))showBadgeTip(n);});
  root.addEventListener('focusout',e=>{if(e.target.closest?.(SEL)===current)hideBadgeTip();});
  root.addEventListener('pointerdown',e=>{const n=e.target.closest?.(SEL);if(e.pointerType==='touch'&&n){if(n===current)hideBadgeTip();else{clearTimeout(timer);showBadgeTip(n);}return;}if(!n)hideBadgeTip();},true);
  addEventListener('keydown',e=>{if(e.key==='Escape')hideBadgeTip();});addEventListener('scroll',()=>{if(Date.now()-shownAt>400)hideBadgeTip();},true);addEventListener('resize',()=>hideBadgeTip());}
