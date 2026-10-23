// Aplica a aparência pública (profiles.appearance) de QUALQUER pessoa: fonte/efeito do nome,
// moldura de pacote no avatar e borda/efeito/tema no cartão de perfil. Só usa ids do catálogo.
import {PACKS,NAME_FONTS,NAME_EFFECTS,cleanAppearance,packOf,loadNameFont} from './cosmetics.js';
const FONT_CLASSES=NAME_FONTS.map(f=>'nf-'+f.id),EFFECT_CLASSES=NAME_EFFECTS.map(e=>'ne-'+e.id);
export function packVars(node,pack){const p=typeof pack==='string'?packOf(pack):pack;if(!node||!p)return node;node.style.setProperty('--c1',p.c[0]);node.style.setProperty('--c2',p.c[1]);node.style.setProperty('--bg',p.bg);return node;}
export function fxLayer(pack){const p=typeof pack==='string'?packOf(pack):pack;const s=document.createElement('span');s.className='pk-fx pk-anim-'+(p?.anim||'stars');s.setAttribute('aria-hidden','true');packVars(s,p);return s;}
export function styleName(node,a){if(!node)return;const ap=cleanAppearance(a);node.classList.remove(...FONT_CLASSES,...EFFECT_CLASSES);
  if(ap.name_font){loadNameFont(ap.name_font);node.classList.add('nf-'+ap.name_font);}
  if(ap.name_effect){node.classList.add('ne-'+ap.name_effect);const accent=packOf(ap.border||ap.frame||ap.plate||'')?.c[0]||ap.theme?.[0]||'#c9a7ff',c1=ap.name_effect==='gradient'?'#ffffff':accent,c2=ap.name_effect==='gradient'?accent:(packOf(ap.border||ap.frame||'')?.c[1]||'#7bdcff');node.style.setProperty('--nc1',c1);node.style.setProperty('--nc2',c2);}}
export function frameAvatar(node,a){if(!node)return;const ap=cleanAppearance(a),p=ap.frame&&packOf(ap.frame);
  node.classList.remove('pk-frame',...PACKS.map(x=>'pk-frame-'+x.id));if(p){node.classList.add('pk-frame','pk-frame-'+p.id);packVars(node,p);}}
export function dressCard(card,a){if(!card)return;const ap=cleanAppearance(a);
  card.classList.remove('pk-border','ps-themed');card.querySelectorAll(':scope>.pk-fx').forEach(x=>x.remove());delete card.dataset.pack;
  const b=ap.border&&packOf(ap.border);if(b){card.classList.add('pk-border');card.dataset.pack=b.id;packVars(card,b);}
  const e=ap.effect&&packOf(ap.effect);if(e&&ap.effect.endsWith('-effect'))card.prepend(fxLayer(e));
  if(ap.theme){card.classList.add('ps-themed');card.style.setProperty('--pt1',ap.theme[0]);card.style.setProperty('--pt2',ap.theme[1]);}else{card.style.removeProperty('--pt1');card.style.removeProperty('--pt2');}}
const NAMES='.message-meta strong, .up-name, .participant-name, .member-name, .member strong, .rp-name, .vt-name, .sf-name';
export function applyAppearanceEverywhere(root,ownerOf,appearanceOf){
  root.querySelectorAll(NAMES).forEach(n=>{const id=ownerOf(n);if(id)styleName(n,appearanceOf(id));});
  root.querySelectorAll('.rp-avatar, #voice-view .participant .avatar, #user-avatar').forEach(av=>{const id=ownerOf(av);if(id)frameAvatar(av,appearanceOf(id));});
  root.querySelectorAll('.rich-profile[data-user-id]').forEach(c=>{if(!c.dataset.dressed){c.dataset.dressed='1';dressCard(c,appearanceOf(c.dataset.userId));}});
}
