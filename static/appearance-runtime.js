// Aplica a aparência pública (profiles.appearance) de QUALQUER pessoa: fonte/efeito do nome,
// moldura de pacote no avatar e borda/efeito/tema no cartão de perfil. Só usa ids do catálogo.
import {mountFx,destroyFxIn} from './fx-engine.js';
import {PACKS,NAME_FONTS,NAME_EFFECTS,cleanAppearance,packOf,loadNameFont} from './cosmetics.js';
const NS_CLASSES=PACKS.filter(p=>p.v2).map(p=>'ns-'+p.fx);
const FONT_CLASSES=NAME_FONTS.map(f=>'nf-'+f.id),EFFECT_CLASSES=NAME_EFFECTS.map(e=>'ne-'+e.id);
export function packVars(node,pack){const p=typeof pack==='string'?packOf(pack):pack;if(!node||!p)return node;node.style.setProperty('--c1',p.c[0]);node.style.setProperty('--c2',p.c[1]);node.style.setProperty('--bg',p.bg);return node;}
export function fxLayer(pack){const p=typeof pack==='string'?packOf(pack):pack;const s=document.createElement('span');s.className='pk-fx pk-anim-'+(p?.anim||'stars');s.setAttribute('aria-hidden','true');packVars(s,p);return s;}
export function styleName(node,a){if(!node)return;const ap=cleanAppearance(a);node.classList.remove('ns',...NS_CLASSES,...FONT_CLASSES,...EFFECT_CLASSES);
  const ns=ap.name_style&&packOf(ap.name_style);if(ns?.v2){node.classList.add('ns','ns-'+ns.fx);node.style.setProperty('--nc1',ns.c[0]);node.style.setProperty('--nc2',ns.c[1]);node.style.setProperty('--nc3',ns.c[2]);return;}
  if(ap.name_font){loadNameFont(ap.name_font);node.classList.add('nf-'+ap.name_font);}
  if(ap.name_effect){node.classList.add('ne-'+ap.name_effect);const accent=packOf(ap.border||ap.frame||ap.plate||'')?.c[0]||ap.theme?.[0]||'#c9a7ff',c1=ap.name_effect==='gradient'?'#ffffff':accent,c2=ap.name_effect==='gradient'?accent:(packOf(ap.border||ap.frame||'')?.c[1]||'#7bdcff');node.style.setProperty('--nc1',c1);node.style.setProperty('--nc2',c2);}}
// Coroa de Espinhos (coleção exclusiva Graça Divina): anel SVG de ramos entrelaçados com espinhos, marfim + ouro.
let crownSvg='';
function buildCrown(){if(crownSvg)return crownSvg;const C=50,R=41,N=360,TAU=Math.PI*2,pt=(a,r)=>[(C+Math.cos(a)*r).toFixed(2),(C+Math.sin(a)*r).toFixed(2)];
  const strand=(ph,amp,waves)=>{let d='';for(let i=0;i<=N;i++){const a=i/N*TAU,r=R+Math.sin(a*waves+ph)*amp;const [x,y]=pt(a,r);d+=(i?'L':'M')+x+' '+y;}return d+'Z';};
  const strands=[[0,2.6,9],[2.1,2.4,9],[4.2,2.2,9],[1.0,1.4,14]].map(([ph,amp,w])=>strand(ph,amp,w));
  let thorns='';for(let i=0;i<42;i++){const a=i/42*TAU+((i*7)%5)*.012,out=i%2===0,r0=R+(out?2.4:-2.4),len=3.6+((i*13)%7)*.36,tilt=(i%3-1)*.22;
    const [bx1,by1]=pt(a-.022,r0),[bx2,by2]=pt(a+.022,r0),[tx,ty]=pt(a+tilt*.05,r0+(out?len:-len));thorns+=`M${bx1} ${by1}L${tx} ${ty}L${bx2} ${by2}Z`;}
  let motes='';for(let i=0;i<9;i++){const a=i/9*TAU+.3,[x,y]=pt(a,R+(i%2?6:-6));motes+=`<circle class="cr-mote" cx="${x}" cy="${y}" r="${(0.7+(i%3)*.25).toFixed(2)}" style="animation-delay:${(-i*.7).toFixed(1)}s"/>`;}
  crownSvg=`<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><defs>
  <linearGradient id="cr-ivory" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffdf6"/><stop offset=".5" stop-color="#efe6d2"/><stop offset="1" stop-color="#fffaf0"/></linearGradient>
  <linearGradient id="cr-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".5" stop-color="#e3b94f"/><stop offset="1" stop-color="#fff0b8"/></linearGradient>
  <filter id="cr-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
  <circle cx="50" cy="50" r="${R}" fill="none" stroke="#fff6dc" stroke-opacity=".12" stroke-width="6" filter="url(#cr-glow)" class="cr-halo"/>
  <g filter="url(#cr-glow)" fill="none" stroke-linejoin="round" stroke-linecap="round">${strands.slice(0,3).map(d=>`<path d="${d}" stroke="#6e5530" stroke-opacity=".55" stroke-width="2.6"/>`).join('')}${strands.map((d,i)=>`<path d="${d}" stroke="${i===3?'url(#cr-gold)':'url(#cr-ivory)'}" stroke-width="${i===3?.9:1.7}" stroke-opacity="${i===3?.85:1}"/>`).join('')}
  <path d="${thorns}" fill="url(#cr-ivory)" stroke="#8a6a2c" stroke-width=".35" stroke-opacity=".8"/>
  <path class="cr-shine" d="${strands[0]}" stroke="#fff7d6" stroke-width="1.3" pathLength="100" stroke-dasharray="6 44"/></g>${motes}</svg>`;return crownSvg;}
function crownLayer(node,on){node.querySelectorAll(':scope>.cr-ring').forEach(x=>x.remove());node.classList.toggle('pk-crown',on);if(!on)return;const l=document.createElement('span');l.className='cr-ring';l.setAttribute('aria-hidden','true');l.innerHTML=buildCrown();node.append(l);}
export function frameAvatar(node,a){if(!node)return;const ap=cleanAppearance(a),p=ap.frame&&packOf(ap.frame);
  node.classList.remove('pk-frame',...PACKS.map(x=>'pk-frame-'+x.id));const crown=ap.frame==='coroa-espinhos-frame';crownLayer(node,crown);if(crown){delete node.dataset.fx;return;}if(p){node.classList.add('pk-frame','pk-frame-'+p.id);packVars(node,p);node.style.setProperty('--c3',p.c[2]||p.c[0]);if(p.v2)node.dataset.fx=p.fx;else delete node.dataset.fx;}else delete node.dataset.fx;}
// Borda de cartão (Loja v2): anel conic-gradient animado + brilho + cantos ornamentados + partículas que correm pelo contorno.
export function cardBorder(card,a){if(!card)return;const ap=cleanAppearance(a),p=ap.card_border&&packOf(ap.card_border);
  card.querySelectorAll(':scope>.cb-layer').forEach(x=>{destroyFxIn(x);x.remove();});card.classList.remove('cb');delete card.dataset.cb;if(!p?.v2)return;
  card.classList.add('cb');card.dataset.cb=p.fx;packVars(card,p);card.style.setProperty('--c3',p.c[2]);
  const L=document.createElement('span');L.className='cb-layer';L.setAttribute('aria-hidden','true');L.innerHTML='<span class="cb-ring"></span><span class="cb-glow"></span><i class="cb-corner tl"></i><i class="cb-corner tr"></i><i class="cb-corner bl"></i><i class="cb-corner br"></i>';
  card.append(L);mountFx(L,{preset:p.fx,colors:p.c,bg:p.bg,mode:'border'});}

export function dressCard(card,a){if(!card)return;const ap=cleanAppearance(a);
  card.classList.remove('pk-border','ps-themed');card.querySelectorAll(':scope>.pk-fx').forEach(x=>{destroyFxIn(x);x.remove();});delete card.dataset.pack;
  const b=ap.border&&packOf(ap.border);if(b){card.classList.add('pk-border');card.dataset.pack=b.id;packVars(card,b);}
  const e=ap.effect&&packOf(ap.effect);if(e&&ap.effect.endsWith('-effect')){if(e.v2){const l=document.createElement('span');l.className='pk-fx pk-fx-v2';l.setAttribute('aria-hidden','true');card.prepend(l);mountFx(l,{preset:e.fx,colors:e.c,bg:e.bg,mode:'effect'});}else card.prepend(fxLayer(e));}
  cardBorder(card,ap);
  if(ap.theme){card.classList.add('ps-themed');card.style.setProperty('--pt1',ap.theme[0]);card.style.setProperty('--pt2',ap.theme[1]);}else{card.style.removeProperty('--pt1');card.style.removeProperty('--pt2');}}
const NAMES='.message-meta strong, .up-name, .participant-name, .member-name, .member strong, .rp-name, .vt-name, .sf-name, .dm-name, .dm-head-name, .thread-message>strong, .search-result>strong, .voice-chat-message>strong, .friend-info strong, .orb-card-head strong, .sf-notification strong';
const AVATARS='.rp-avatar, #voice-view .participant .avatar, #user-avatar, .voice-tree-person .avatar';
const CARDS='.rich-profile[data-user-id]';
export function applyAppearanceEverywhere(root,ownerOf,appearanceOf){
  if(!root?.querySelectorAll)return;
  // Só reestiliza quando a aparência mudou: evita recalcular o estilo de centenas de nomes do chat a cada mutação.
  const keys=new Map(),keyOf=id=>{if(!keys.has(id))keys.set(id,id+'|'+JSON.stringify(appearanceOf(id)||{}));return keys.get(id);};
  const each=(selector,apply)=>{root.querySelectorAll(selector).forEach(apply);if(root.matches?.(selector))apply(root);};
  each(NAMES,n=>{const id=ownerOf(n);if(!id)return;const k=keyOf(id);if(n.__apKey===k)return;n.__apKey=k;styleName(n,appearanceOf(id));});
  each(AVATARS,av=>{const id=ownerOf(av);if(!id)return;const k=keyOf(id);if(av.__apKey===k)return;av.__apKey=k;frameAvatar(av,appearanceOf(id));});
  // O cartão é reaplicado quando a aparência muda (a carga da pessoa pode chegar depois dele).
  each(CARDS,c=>{const id=c.dataset.userId;if(!id)return;const k=keyOf(id);c.dataset.dressed='1';if(c.__apKey===k)return;c.__apKey=k;dressCard(c,appearanceOf(id));});
}
