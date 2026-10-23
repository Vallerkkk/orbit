// Pacotes temáticos da Loja da Órbita: tema + animação exclusiva por pacote, molduras de avatar,
// bordas do perfil completo, temas de servidor. scripts/badges-sql.mjs copia os ids para a validação no banco.
export const PACKS=[
  {id:'cyberpunk',name:'Cyberpunk',tagline:'Neon, chuva e falhas de sinal',anim:'neonrain',c:['#ff2bd6','#00e5ff'],bg:'#120a24'},
  {id:'anime',name:'Anime',tagline:'Pétalas e brilho de abertura',anim:'petals',c:['#ff8fb7','#ffd1e3'],bg:'#2a1424'},
  {id:'espaco',name:'Espaço',tagline:'Poeira estelar em órbita',anim:'stars',c:['#7b5cff','#2ec4ff'],bg:'#0b0d26'},
  {id:'natureza',name:'Natureza',tagline:'Aurora sobre a floresta',anim:'aurora',c:['#2fbf71','#b6f36a'],bg:'#0c1f17'},
  {id:'halloween',name:'Halloween',tagline:'Chamas de abóbora',anim:'flames',c:['#ff7a1a','#8a2be2'],bg:'#1d0d06'},
  {id:'lofi',name:'Lo-fi',tagline:'Partículas lentas, fim de tarde',anim:'particles',c:['#f5a97f','#8aadf4'],bg:'#1f1a2e'},
  {id:'retro',name:'Pixel/Retrô',tagline:'Pixels de fliperama',anim:'pixels',c:['#ffd166','#06d6a0'],bg:'#101820'},
  {id:'oceano',name:'Oceano',tagline:'Bolhas no azul profundo',anim:'bubbles',c:['#1fa2ff','#12d8fa'],bg:'#06192e'},
  {id:'glitch',name:'Sinal perdido',tagline:'Glitch em RGB',anim:'glitch',c:['#ff0055','#00ffd5'],bg:'#0d0d12'},
  {id:'orbita-staff',name:'Equipe Órbita',tagline:'Exclusivo dos administradores globais',anim:'halo',c:['#c9a7ff','#ffffff'],bg:'#1a1033',admin:true},
];
// Itens derivados de cada pacote: moldura de avatar, borda do perfil, efeito de perfil, tema de servidor e placa.
export const ITEM_KINDS={frame:'Moldura do avatar',border:'Borda do perfil',effect:'Efeito de perfil',server:'Tema de servidor',plate:'Placa de identificação'};
export const ITEMS=PACKS.flatMap(p=>Object.keys(ITEM_KINDS).map(kind=>({id:`${p.id}-${kind}`,pack:p.id,kind,name:`${ITEM_KINDS[kind]} ${p.name}`,admin:!!p.admin})));
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
  return {frame:pick('frame','frame'),legacy_frame:legacy('legacy_frame'),legacy_effect:legacy('legacy_effect'),banner_style:legacy('banner_style'),border:pick('border','border'),effect:pick('effect','effect'),server:pick('server','server'),plate:pick('plate','plate'),
    name_font:NAME_FONTS.some(f=>f.id===a.name_font)?a.name_font:'',name_effect:NAME_EFFECTS.some(e=>e.id===a.name_effect)?a.name_effect:'',
    theme:Array.isArray(a.theme)&&a.theme.length===2&&a.theme.every(c=>HEX.test(c))?a.theme:null,
    badges:Array.isArray(a.badges)?a.badges.filter(x=>typeof x==='string').slice(0,3):[]};}
export function packOf(id){return PACKS.find(p=>p.id===(itemById.get(id)?.pack||id));}
export function compactAppearance(a){const c=cleanAppearance(a),out={};for(const [k,v] of Object.entries(c))if(Array.isArray(v)?v.length:v)out[k]=v;return out;}
export function stripAdminOnly(a){const c=cleanAppearance(a);for(const k of ['frame','border','effect','server','plate'])if(ADMIN_ONLY.includes(c[k]))c[k]='';if(ADMIN_ONLY.includes('name:'+c.name_effect))c.name_effect='';return c;}
