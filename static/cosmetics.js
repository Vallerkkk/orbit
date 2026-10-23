import {COLLECTIONS,CLASSICS,LEGACY_DECOR,KIND_V2} from './store-collections.js';
// Pacotes temáticos da Loja da Órbita: tema + animação exclusiva por pacote, molduras de avatar,
// bordas do perfil completo, temas de servidor. scripts/badges-sql.mjs copia os ids para a validação no banco.
// Os pacotes clássicos agora são coleções completas (store-collections.js > CLASSICS).
export const PACKS=[];
// Itens derivados de cada pacote: moldura de avatar, borda do perfil, efeito de perfil, tema de servidor e placa.
export const ITEM_KINDS={frame:'Moldura do avatar',border:'Borda do perfil',effect:'Efeito de perfil',server:'Tema de servidor',plate:'Placa de identificação'};
Object.assign(ITEM_KINDS,KIND_V2);
// Ids antigos de borda do perfil (-border) e placa (-plate) seguem válidos como apelidos de
// borda de cartão e estilo de nome da mesma coleção clássica.
const LEGACY_ITEMS=CLASSICS.flatMap(p=>[['border','card_border'],['plate','name_style']].map(([kind,to])=>({id:`${p.id}-${kind}`,pack:p.id,kind,alias:`${p.id}-${to}`,name:p.items[to][0],admin:!!p.admin})));
// Loja v2: coleções com 5 itens cada (nome, descrição e raridade próprios).
const V2_KINDS=['frame','effect','card_border','name_style','server'];
const V2_ITEMS=[...COLLECTIONS,...CLASSICS].flatMap(p=>V2_KINDS.map((kind,i)=>({id:`${p.id}-${kind}`,pack:p.id,kind,name:p.items[kind][0],desc:p.items[kind][1],rarity:p.rarity[i],admin:!!p.admin,v2:true,classic:!!p.classic,tags:p.tags||[]})));
PACKS.push(...COLLECTIONS,...CLASSICS);
export const ITEMS=[...LEGACY_ITEMS,...V2_ITEMS];
export const itemById=new Map(ITEMS.map(i=>[i.id,i]));
export const NAME_FONTS=[
  {id:'orbitron',name:'Orbitron',family:'Orbitron',w:'700'},{id:'pressstart',name:'Press Start 2P',family:'Press Start 2P',w:'400',scale:.7},
  {id:'pacifico',name:'Pacifico',family:'Pacifico',w:'400'},{id:'bungee',name:'Bungee',family:'Bungee',w:'400'},
  {id:'monoton',name:'Monoton',family:'Monoton',w:'400'},{id:'creepster',name:'Creepster',family:'Creepster',w:'400'},
  {id:'righteous',name:'Righteous',family:'Righteous',w:'400'},{id:'audiowide',name:'Audiowide',family:'Audiowide',w:'400'},
  {id:'caveat',name:'Caveat',family:'Caveat',w:'700',scale:1.2},{id:'cinzel',name:'Cinzel',family:'Cinzel',w:'700'},
  {id:'silkscreen',name:'Silkscreen',family:'Silkscreen',w:'400'},{id:'lobster',name:'Lobster',family:'Lobster',w:'400'},
  {id:'spacemono',name:'Space Mono',family:'Space Mono',w:'700'},{id:'shrikhand',name:'Shrikhand',family:'Shrikhand',w:'400'},
];
export const NAME_EFFECTS=[{id:'gradient',name:'Gradiente'},{id:'neon',name:'Neon'},{id:'glitch',name:'Glitch'},{id:'shine',name:'Brilho'},{id:'rainbow',name:'Arco-íris'},{id:'fire',name:'Chamas'},{id:'staff',name:'Halo da equipe',admin:true}];
export const ADMIN_ONLY=[...ITEMS.filter(i=>i.admin).map(i=>i.id),...NAME_EFFECTS.filter(e=>e.admin).map(e=>'name:'+e.id)];
const loaded=new Set();
export function loadNameFont(id){const f=NAME_FONTS.find(f=>f.id===id);if(!f||loaded.has(id))return;loaded.add(id);const l=document.createElement('link');l.rel='stylesheet';l.href=`https://fonts.googleapis.com/css2?family=${f.family.replace(/ /g,'+')}:wght@${f.w}&display=swap`;document.head.append(l);}
// Normaliza a aparência salva no banco (profiles.appearance); qualquer coisa fora do catálogo é descartada.
const HEX=/^#[0-9a-f]{6}$/i;
export function cleanAppearance(raw){const a=raw&&typeof raw==='object'?raw:{};const pick=(k,kind)=>{const i=itemById.get(a[k]);return i&&i.kind===kind?i.id:'';};
  const legacy=k=>/^[a-z0-9-]{1,48}$/.test(a[k]||'')?a[k]:'';
  const alias=(k,kind)=>{const i=itemById.get(a[k]);return i&&i.kind===k&&i.alias?i.alias:'';};
  const decor=(k,kind)=>{const p=LEGACY_DECOR[kind][a[k]];return p?`${p}-${kind}`:'';};
  return {frame:pick('frame','frame')||decor('legacy_frame','frame'),legacy_frame:legacy('legacy_frame'),legacy_effect:legacy('legacy_effect'),banner_style:legacy('banner_style'),border:'',card_border:pick('card_border','card_border')||alias('border'),name_style:pick('name_style','name_style')||alias('plate'),effect:pick('effect','effect')||decor('legacy_effect','effect'),server:pick('server','server'),plate:'',
    name_font:NAME_FONTS.some(f=>f.id===a.name_font)?a.name_font:'',name_effect:NAME_EFFECTS.some(e=>e.id===a.name_effect)?a.name_effect:'',
    theme:Array.isArray(a.theme)&&a.theme.length===2&&a.theme.every(c=>HEX.test(c))?a.theme:null,
    badges:Array.isArray(a.badges)?a.badges.filter(x=>typeof x==='string').slice(0,3):[]};}
export function packOf(id){return PACKS.find(p=>p.id===(itemById.get(id)?.pack||id));}
export function compactAppearance(a){const c=cleanAppearance(a),out={};for(const [k,v] of Object.entries(c))if(Array.isArray(v)?v.length:v)out[k]=v;return out;}
export function stripAdminOnly(a){const c=cleanAppearance(a);for(const k of ['frame','border','effect','server','plate','card_border','name_style'])if(ADMIN_ONLY.includes(c[k]))c[k]='';if(ADMIN_ONLY.includes('name:'+c.name_effect))c.name_effect='';return c;}
