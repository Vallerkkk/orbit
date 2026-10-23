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
export function frameAvatar(node,a){if(!node)return;const ap=cleanAppearance(a),p=ap.frame&&packOf(ap.frame);
  node.classList.remove('pk-frame',...PACKS.map(x=>'pk-frame-'+x.id));if(p){node.classList.add('pk-frame','pk-frame-'+p.id);packVars(node,p);node.style.setProperty('--c3',p.c[2]||p.c[0]);if(p.v2)node.dataset.fx=p.fx;else delete node.dataset.fx;}else delete node.dataset.fx;}
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
const NAMES='.message-meta strong, .up-name, .participant-name, .member-name, .member strong, .rp-name, .vt-name, .sf-name, .dm-name, .dm-head-name';
export function applyAppearanceEverywhere(root,ownerOf,appearanceOf){
  // Só reestiliza quando a aparência mudou: evita recalcular o estilo de centenas de nomes do chat a cada mutação.
  const keys=new Map(),keyOf=id=>{if(!keys.has(id))keys.set(id,id+'|'+JSON.stringify(appearanceOf(id)||{}));return keys.get(id);};
  root.querySelectorAll(NAMES).forEach(n=>{const id=ownerOf(n);if(!id)return;const k=keyOf(id);if(n.__apKey===k)return;n.__apKey=k;styleName(n,appearanceOf(id));});
  root.querySelectorAll('.rp-avatar, #voice-view .participant .avatar, #user-avatar').forEach(av=>{const id=ownerOf(av);if(!id)return;const k=keyOf(id);if(av.__apKey===k)return;av.__apKey=k;frameAvatar(av,appearanceOf(id));});
  root.querySelectorAll('.rich-profile[data-user-id]').forEach(c=>{if(!c.dataset.dressed){c.dataset.dressed='1';dressCard(c,appearanceOf(c.dataset.userId));}});
}
