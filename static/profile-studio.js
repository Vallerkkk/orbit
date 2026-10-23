// Estúdio de perfil: Loja (pacotes), fontes do nome, modal "Suas insígnias" e editor de perfil completo.
// Tudo que é público fica em profiles.appearance; o banco valida itens exclusivos de ADM e calcula insígnias.
import {PACKS,ITEMS,ITEM_KINDS,NAME_FONTS,NAME_EFFECTS,cleanAppearance,packOf,loadNameFont,itemById} from './cosmetics.js';
import {BADGES,LEVELS,RARITIES,CATEGORIES,badgeById,badgeSvg} from './badges-catalog.js';
import {packVars,fxLayer,styleName,frameAvatar,dressCard} from './appearance-runtime.js';

export function initProfileStudio(ctx){
  const {el,button,toast,errorText}=ctx;
  const html=(tag,cls,markup)=>{const n=el(tag,cls);n.innerHTML=markup;return n;};
  const badgeCache=new Map();
  let overlay;
  function sheet(title,sub,cls=''){
    overlay?.remove();const back=el('div','ps-overlay '+cls),box=el('section','ps-sheet');box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label',title);
    const head=el('header','ps-head'),h=el('h2','',title);if(sub)h.append(el('span','ps-sub',sub));const close=button('×',()=>shut(),'ps-close');close.setAttribute('aria-label','Fechar');head.append(h,close);
    const body=el('div','ps-body');box.append(head,body);back.append(box);document.body.append(back);overlay=back;
    const key=e=>{if(e.key==='Escape'){e.stopPropagation();shut();}};const shut=()=>{back.remove();document.removeEventListener('keydown',key,true);if(overlay===back)overlay=null;back.dispatchEvent(new Event('ps-close'));};
    document.addEventListener('keydown',key,true);back.addEventListener('click',e=>{if(e.target===back)shut();});setTimeout(()=>close.focus(),0);
    return {back,box,head,body,shut};
  }
  const me=()=>ctx.state();
  const mine=()=>cleanAppearance(ctx.appearanceOf(me().session?.user.id));
  async function equip(patch,{quiet}={}){try{await ctx.saveAppearance({...mine(),...patch});if(!quiet)toast('Perfil atualizado. Todo mundo já vê a mudança.');return true;}catch(error){toast(errorText(error));return false;}}

  // ===== Loja =====
  function packCard(p,onOpen){const b=button('',onOpen,'ps-pack');packVars(b,p);b.append(fxLayer(p),el('span','ps-pack-av'));
    const meta=el('span','ps-pack-meta');meta.append(el('strong','',p.name),el('small','',p.tagline));b.append(meta);
    if(p.admin)b.append(el('span','ps-pill','Exclusivo ADM'));else b.append(el('span','ps-pill','5 itens · grátis'));b.dataset.pack=p.id;b.setAttribute('aria-label','Abrir pacote '+p.name);return b;}
  function itemPreview(item){const p=packOf(item.pack),prev=el('div','ps-item-prev');packVars(prev,p);
    if(item.kind==='frame'){const av=el('span','ps-mini-av');frameAvatar(av,{frame:item.id});prev.append(av);}
    else if(item.kind==='border'){const c=el('span','ps-mini-card');dressCard(c,{border:item.id});prev.append(c);}
    else if(item.kind==='effect'||item.kind==='server'){prev.append(fxLayer(p));if(item.kind==='server')prev.append(el('span','ps-mini-card'));}
    else prev.append(el('span','ps-mini-plate',me().profile?.display_name||'Seu nome'));return prev;}
  function itemCard(item,refresh){const p=packOf(item.pack),card=el('article','ps-item');packVars(card,p);const on=mine()[item.kind]===item.id;card.classList.toggle('equipped',on);
    const prev=itemPreview(item);if(item.admin&&!me().isAdmin)prev.classList.add('ps-lock');const meta=el('div','ps-item-meta'),txt=el('div');txt.append(el('strong','',ITEM_KINDS[item.kind]),el('small','',p.name));
    const act=button(on?'Remover':'Usar',async()=>{act.disabled=true;if(await equip({[item.kind]:on?'':item.id}))refresh();act.disabled=false;},on?'ps-btn ghost':'ps-btn');
    if(item.admin&&!me().isAdmin){act.disabled=true;act.textContent='Só ADM';act.title='O servidor só libera este item para administradores globais.';}
    meta.append(txt,act);card.append(prev,meta);card.dataset.item=item.id;return card;}
  function openStore(start){
    const s=sheet('Loja da Órbita','Pacotes temáticos, molduras, bordas e fontes — grátis');const tabs=el('div','ps-tabs');tabs.setAttribute('role','tablist');s.head.after(tabs);
    const views={pacotes:'Pacotes',fontes:'Fontes do nome'};let current='pacotes';
    const show=(view,pack)=>{current=view;for(const b of tabs.children)b.setAttribute('aria-selected',String(b.dataset.view===view));s.body.replaceChildren();s.body.scrollTop=0;
      if(view==='fontes')return renderFonts(s.body);
      if(pack)return renderPack(s.body,packOf(pack),()=>show('pacotes'));
      const hero=el('div','ps-hero');packVars(hero,PACKS[2]);hero.append(fxLayer(PACKS[2]),el('h3','','Deixe seu perfil com a sua cara'),el('p','','Cada pacote traz tema, animação exclusiva, moldura, borda do perfil, placa e tema de servidor.'));
      const grid=el('div','ps-pack-grid');for(const p of PACKS)grid.append(packCard(p,()=>show('pacotes',p.id)));s.body.append(hero,grid);};
    for(const [k,v] of Object.entries(views)){const b=button(v,()=>show(k),'');b.dataset.view=k;b.setAttribute('role','tab');tabs.append(b);}
    show(start==='fontes'?'fontes':'pacotes',PACKS.some(p=>p.id===start)?start:null);return s;
  }
  function renderPack(body,p,back){const hero=el('div','ps-hero');packVars(hero,p);hero.append(fxLayer(p),el('h3','',p.name),el('p','',p.tagline+(p.admin?' · só administradores globais podem equipar (validado no servidor)':'')));
    const top=el('div','ps-chip-row');top.append(button('← Todos os pacotes',back,'ps-chip'));
    const grid=el('div','ps-item-grid');const refresh=()=>grid.replaceChildren(...ITEMS.filter(i=>i.pack===p.id).map(i=>itemCard(i,refresh)));refresh();
    const all=button('Usar pacote completo',async()=>{const patch={};for(const i of ITEMS.filter(i=>i.pack===p.id&&i.kind!=='server'))patch[i.kind]=i.id;if(await equip(patch))refresh();},'ps-btn');if(p.admin&&!me().isAdmin)all.disabled=true;top.append(all);
    body.append(top,hero,grid);}
  function renderFonts(body){const a=mine(),preview=el('h3','rp-name',me().profile?.display_name||'Seu nome');preview.style.fontSize='2rem';preview.style.margin='4px 0 12px';
    const refreshPreview=()=>styleName(preview,mine());refreshPreview();
    const effects=el('div','ps-chip-row');const fx=[{id:'',name:'Sem efeito'},...NAME_EFFECTS];
    const paintFx=()=>{for(const c of effects.children)c.setAttribute('aria-pressed',String(c.dataset.id===mine().name_effect));};
    for(const e of fx){const c=button(e.name+(e.admin?' (ADM)':''),async()=>{if(await equip({name_effect:e.id},{quiet:true})){paintFx();refreshPreview();}},'ps-chip');c.dataset.id=e.id;if(e.admin&&!me().isAdmin)c.disabled=true;effects.append(c);}paintFx();
    const grid=el('div','ps-font-grid');const paint=()=>{for(const c of grid.children)c.classList.toggle('selected',c.dataset.id===mine().name_font);};
    for(const f of [{id:'',name:'Padrão da Órbita',family:''},...NAME_FONTS]){if(f.id)loadNameFont(f.id);const b=button('',async()=>{if(await equip({name_font:f.id},{quiet:true})){paint();refreshPreview();}},'ps-font');b.dataset.id=f.id;const sample=el('span',f.id?'nf-'+f.id:'',me().profile?.display_name||'Órbita');b.append(sample,el('small','',f.name));grid.append(b);}paint();
    body.append(el('p','muted','Fontes do Google carregadas sob demanda. O estilo aparece para todos no chat, membros, chamadas e perfil.'),preview,el('h4','','Efeito'),effects,el('h4','','Fonte'),grid);}

  // ===== Insígnias =====
  const badgeFlight=new Map();
  function badgeState(id,force){if(!force&&badgeCache.has(id))return Promise.resolve(badgeCache.get(id));if(!force&&badgeFlight.has(id))return badgeFlight.get(id);const task=loadBadgeState(id).finally(()=>badgeFlight.delete(id));badgeFlight.set(id,task);return task;}
  async function loadBadgeState(id){
    let state;try{state=await (await ctx.apiFetch('/api/badges/'+id)).json();}catch(error){state={error:errorText(error),badges:[],showcase:[]};}
    const byId=new Map((state.badges||[]).map(b=>[b.id,b]));state.map=byId;if(!state.error)badgeCache.set(id,state);return state;}
  const levelOf=(state,b)=>state.map.get(b.id)?.level||0;
  function badgeButton(b,level,opts={}){const btn=button('',opts.onClick,'');btn.innerHTML=badgeSvg(b,Math.max(1,level),{locked:!level,size:opts.size||44});btn.setAttribute('aria-label',(level||!b.secret?b.name:'Insígnia secreta')+(level?` — nível ${LEVELS[level-1].name}`:' — bloqueada'));const tip=level?`${b.name} · ${b.t.length>1?'Nível '+LEVELS[level-1].name:'Desbloqueada'} · ${RARITIES[b.rarity].name}`:(b.secret?'Insígnia secreta':b.name+' · bloqueada');btn.dataset.tip=tip;btn.removeAttribute('title');
    if(level&&b.t.length>1)btn.append(el('span','lv',String(level)));btn.dataset.badge=b.id;return btn;}
  function detail(panel,b,state){const level=levelOf(state,b),row=state.map.get(b.id)||{},rar=RARITIES[b.rarity],secret=b.secret&&!level;panel.style.setProperty('--rc',level?(b.t.length>1?LEVELS[level-1].color:rar.color):'#6b6f80');panel.replaceChildren();
    const big=el('div','ps-badge-big');big.innerHTML=badgeSvg(b,Math.max(1,level),{locked:!level,size:150});
    const tags=el('div','ps-badge-tags'),pill=el('span','ps-pill',rar.name);pill.style.background=rar.color+'33';pill.style.color=rar.color;tags.append(pill,el('span','ps-pill',CATEGORIES[b.cat]));if(row.permanent)tags.append(el('span','ps-owner-mark','Fixada para sempre'));
    panel.append(big,el('h3','ps-badge-name',secret?'???':b.name),el('p','ps-badge-sub',secret?'Insígnia secreta: descubra usando a Órbita.':b.t.length>1?`Alcance ${b.t[0].toLocaleString('pt-BR')} ${b.unit} para começar.`:b.unit),tags);
    if(row.unlocked_at||level)panel.append(el('p','ps-badge-sub',level?(row.unlocked_at?'Desbloqueada em '+new Date(row.unlocked_at).toLocaleDateString('pt-BR',{day:'numeric',month:'long',year:'numeric'}):'Desbloqueada'):''));
    if(!b.exclusive){const prog=el('div','ps-progress'),value=Number(row.value||0),max=b.t[b.t.length-1],next=b.t[level]??null,prevT=level?b.t[level-1]:0,pct=next==null?100:Math.min(100,Math.round((value-prevT)/(next-prevT)*100));
      const bar=el('div','ps-bar'),fill=el('i');fill.style.width=Math.max(3,pct)+'%';bar.append(fill);
      prog.append(el('b','','Seu progresso'),bar,el('small','',next==null?(level?`Nível máximo! ${value.toLocaleString('pt-BR')} ${b.unit}.`:''):secret?'Continue explorando…':`${value.toLocaleString('pt-BR')} / ${next.toLocaleString('pt-BR')} — mais ${(next-value).toLocaleString('pt-BR')} ${b.unit}`));panel.append(prog);void max;}
    if(b.t.length>1){panel.append(el('h4','','Níveis'));const grid=el('div','ps-levels');b.t.forEach((t,i)=>{const lv=LEVELS[i],cell=el('div','ps-level'+(level>i?'':' locked')+(level===i+1?' current':''));cell.style.setProperty('--lc',lv.color);cell.innerHTML=badgeSvg(b,i+1,{locked:level<=i,size:40});cell.append(el('strong','',lv.name),el('small','',secret?'???':t.toLocaleString('pt-BR')+' '+b.unit));grid.append(cell);});panel.append(grid);}
  }
  async function openBadges(userId,focus){const own=userId===me().session?.user.id;const s=sheet(own?'Suas insígnias':'Insígnias de '+(ctx.person(userId)?.display_name||'participante'));s.body.style.padding='0';
    const wrap=el('div','ps-badges'),left=el('div','ps-badges-left'),right=el('aside','ps-badges-right');wrap.append(left,right);s.body.append(wrap);left.append(el('p','muted','Carregando insígnias…'));
    const state=await badgeState(userId,true);let pinMode=false,pins=[...(state.showcase||[])];let selected;
    const seenKey='orbita-badges-seen:'+userId,seen=new Set(JSON.parse(localStorage.getItem(seenKey)||'[]'));
    const draw=()=>{left.replaceChildren();if(state.error)left.append(el('p','muted',state.error+' As insígnias aparecem assim que a migration for aplicada.'));
      const unlocked=BADGES.filter(b=>levelOf(state,b)>0),locked=BADGES.filter(b=>!levelOf(state,b)&&!(b.exclusive&&b.exclusive!=='admin'&&!own));
      const head=el('div','ps-chip-row');head.append(el('span','ps-pill',`${unlocked.length} de ${BADGES.length} desbloqueadas`));if(state.admin)head.append(el('span','ps-pill','ADM global: tudo no nível máximo'));
      if(own)head.append(button(pinMode?'Salvar vitrine':'Personalize suas insígnias',async()=>{if(!pinMode){pinMode=true;draw();return;}const permanent=(state.badges||[]).filter(x=>x.permanent).map(x=>x.id);
        if(await equip({badges:pins.filter(x=>!permanent.includes(x)).slice(0,3)},{quiet:true})){toast('Vitrine salva.');pinMode=false;const fresh=await badgeState(userId,true);Object.assign(state,fresh);pins=[...(state.showcase||[])];draw();}},'ps-btn'));
      left.append(head);if(pinMode)left.append(el('p','muted','Escolha até 3 insígnias para fixar no perfil. A de Dono fica fixada permanentemente.'));
      const grid=(list,lockedGrid)=>{const g=el('div','ps-badge-grid');for(const b of list){const lv=levelOf(state,b);const btn=badgeButton(b,lv,{onClick:()=>{if(pinMode&&lv){const perm=state.map.get(b.id)?.permanent;if(perm)return toast('Esta insígnia é fixa.');pins=pins.includes(b.id)?pins.filter(x=>x!==b.id):[...pins,b.id].slice(-3);draw();return;}selected=b;seen.add(b.id);localStorage.setItem(seenKey,JSON.stringify([...seen]));draw();}});
        if(lockedGrid){btn.classList.add('locked');if(!seen.has(b.id))btn.classList.add('new');}if(pins.includes(b.id))btn.classList.add('pinned');if(selected?.id===b.id)btn.classList.add('selected');g.append(btn);}return g;};
      left.append(el('h4','',own?'Suas insígnias':'Insígnias'),unlocked.length?grid(unlocked):el('p','muted','Nenhuma ainda.'));
      if(own||locked.length){left.append(el('h4','','Disponível para desbloquear'),grid(locked,true));}
      detail(right,selected||unlocked[0]||BADGES[0],state);};
    selected=focus?badgeById.get(focus):BADGES.find(b=>(state.showcase||[])[0]===b.id);draw();return s;}
  // Vitrine fixada: Dono sempre primeiro (concedida pelo servidor), depois até 3 escolhidas.
  function pinnedOf(state,extra=[]){const own=[...(state.showcase||[]),...extra].filter(id=>{const b=badgeById.get(id);return b&&levelOf(state,b)>0;});const perm=(state.badges||[]).filter(x=>x.permanent).map(x=>x.id);
    return [...new Set([...perm.filter(id=>id==='dono'),...perm,...own])].slice(0,perm.includes('dono')?4:3);}
  async function badgeRow(userId,container,extra=[]){const state=await badgeState(userId);container.querySelectorAll('[data-badge],.rp-link').forEach(n=>n.remove());const pill=container.querySelector('.ps-badge-pill')||container.appendChild(el('div','ps-badge-pill'));pill.replaceChildren();
    for(const id of pinnedOf(state,extra)){const b=badgeById.get(id);const btn=badgeButton(b,levelOf(state,b),{size:22,onClick:()=>openBadges(userId,id)});if(id==='dono')btn.classList.add('is-owner');pill.append(btn);}
    if(!pill.children.length){pill.remove();if(userId===me().session?.user.id)container.append(button('Escolher insígnias',()=>openBadges(userId),'rp-link'));}}
  // Mini insígnia principal ao lado do nome nas mensagens (não altera a altura da linha).
  async function pinnedBadges(node,userId,max=4){if(!node||!userId)return;try{const state=await badgeState(userId);node.replaceChildren();for(const id of pinnedOf(state).slice(0,max)){const b=badgeById.get(id),lv=levelOf(state,b);const s=el('span','nm-badge');s.innerHTML=badgeSvg(b,lv,{size:26});s.dataset.tip=`${b.name} · ${RARITIES[b.rarity].name}`;s.setAttribute('role','img');s.setAttribute('aria-label','Insígnia: '+b.name);node.append(s);}}catch{}}
  async function miniBadge(node,userId){if(!node||!userId)return;try{const state=await badgeState(userId);const id=pinnedOf(state)[0];node.replaceChildren();if(!id)return;const b=badgeById.get(id),lv=levelOf(state,b);node.innerHTML=badgeSvg(b,lv,{size:16});node.dataset.tip=`${b.name} · ${RARITIES[b.rarity].name}`;node.setAttribute('aria-label','Insígnia: '+b.name);node.setAttribute('role','img');}catch{}}

  // ===== Cartão compartilhado =====
  function decorateCard(panel,p){const a=cleanAppearance(ctx.appearanceOf(p.id));dressCard(panel,a);panel.dataset.dressed='1';styleName(panel.querySelector('.rp-name'),a);frameAvatar(panel.querySelector('.rp-avatar'),a);
    const nameRow=panel.querySelector('.rp-name-row');if(nameRow&&!panel.querySelector('.ps-badge-row')){const row=el('div','ps-badge-row');row.setAttribute('aria-label','Insígnias fixadas');nameRow.after(row);badgeRow(p.id,row).catch(()=>{});
      if(p.pronouns){const pr=el('div','rp-username',p.pronouns);row.after(pr);}
      if(a.plate){const plate=el('span','ps-plate',packOf(a.plate).name);packVars(plate,packOf(a.plate));plate.prepend(fxLayer(a.plate));row.after(plate);}const role=ctx.roleOf?.(p.id);if(role){const tag=el('span','ps-pill',role.name);tag.style.background=role.color+'33';tag.style.color=role.color;row.prepend(tag);}}
    if(p.id!==me().session?.user.id&&!panel.querySelector('.ps-note'))noteBox(p.id,panel.querySelector('.rp-actions'));}
  function noteBox(target,before){if(!before)return;const label=el('div','ps-note-label');label.append(el('span','','Nota pessoal'),el('span','','só você vê'));const area=el('textarea','ps-note');area.maxLength=256;area.placeholder='Clique para adicionar uma nota';area.setAttribute('aria-label','Nota pessoal (só você vê)');before.before(label,area);
    const {db,session}=me();const localKey='orbita-note:'+session.user.id+':'+target;
    db.from('profile_notes').select('note').eq('owner_id',session.user.id).eq('target_id',target).maybeSingle().then(({data,error})=>{area.value=error?localStorage.getItem(localKey)||'':data?.note||'';area.dataset.local=error?'1':'';}).catch(()=>{});
    let t;area.oninput=()=>{clearTimeout(t);t=setTimeout(async()=>{if(area.dataset.local){localStorage.setItem(localKey,area.value);return;}const {error}=await db.from('profile_notes').upsert({owner_id:session.user.id,target_id:target,note:area.value,updated_at:new Date().toISOString()});if(error){area.dataset.local='1';localStorage.setItem(localKey,area.value);}},600);};}
  function buildCard(p,a,{preview}={}){const card=el('article','rich-profile pv2 ps-card');card.dataset.userId=p.id;const banner=el('div','rp-banner');
    if(p.banner_src)banner.style.backgroundImage=`url("${String(p.banner_src).replaceAll('"','%22')}")`;else banner.style.background=a.theme?`linear-gradient(135deg,${a.theme[0]},${a.theme[1]})`:`linear-gradient(135deg,${p.avatar_color||'#7b5cff'},#2a1f3d)`;
    const wrap=el('div','rp-avatar-wrap'),av=el('div','rp-avatar');ctx.setAvatar(av,p);const st=el('span','rp-status');st.dataset.status=p.presence_status||'online';wrap.append(av,st);
    const actions=el('div','ps-card-actions');actions.append(button('Mensagem',()=>{},''),button('⋯',()=>{},''));if(preview)for(const b of actions.children)b.disabled=true;
    const body=el('div','rp-body'),row=el('div','rp-name-row');row.append(el('h3','rp-name',p.display_name||'Participante'),el('span','rp-tag','@'+(p.username||'user')));body.append(row);
    const role=ctx.roleOf?.(p.id);const badges=el('div','ps-badge-row');badges.setAttribute('aria-label','Insígnias fixadas');if(role){const tag=el('span','ps-pill',role.name);tag.style.background=role.color+'33';tag.style.color=role.color;badges.append(tag);}body.append(badges);
    if(a.plate){const plate=el('span','ps-plate',packOf(a.plate).name);packVars(plate,packOf(a.plate));plate.prepend(fxLayer(a.plate));body.append(plate);}
    if(p.pronouns)body.append(el('div','rp-username',p.pronouns));
    badgeRow(p.id,badges,preview?(a.badges||[]):[]).catch(()=>{});
    body.append(el('h5','','Sobre você'),el('p','rp-bio',p.bio||'Explorando a Órbita.'));if(p.created_at)body.append(el('h5','','Membro desde'),el('p','rp-username',new Date(p.created_at).toLocaleDateString('pt-BR',{day:'numeric',month:'short',year:'numeric'})));
    if(preview){body.append(el('h5','','Nota pessoal'),el('p','muted','Só você vê as notas que escreve nos perfis dos outros.'));}
    banner.append(actions);card.append(banner,wrap,body);dressCard(card,a);styleName(row.firstChild,a);frameAvatar(av,a);return card;}

  // ===== Editor de perfil =====
  const ICONS={"plate": "<path d=\"M3 7h18v10H3z\" rx=\"2\"/><path d=\"M7 12h6\"/>", "frame": "<circle cx=\"12\" cy=\"12\" r=\"8\"/><circle cx=\"12\" cy=\"10\" r=\"3\"/><path d=\"M7 17c1.5-2 3-3 5-3s3.5 1 5 3\"/>", "name": "<path d=\"M4 18 9 6l5 12M6 14h6\"/><path d=\"M15 18c0-2 1.5-3 3-3s2 .8 2 2v1m0-2.5c-2.5 0-5 .5-5 2.5\"/>", "theme": "<path d=\"M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-1-.8-1.4-.8-2.4s.8-1.5 1.8-1.5H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5z\"/><circle cx=\"7.5\" cy=\"11\" r=\"1\"/><circle cx=\"10\" cy=\"7\" r=\"1\"/><circle cx=\"15\" cy=\"7.5\" r=\"1\"/>", "border": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"4\"/><path d=\"M12 7l1.3 3.2L16.5 11l-2.6 2 .9 3.3L12 14.6 9.2 16.3l.9-3.3-2.6-2 3.2-.8z\"/>", "info": "<path d=\"M4 20h4L19 9l-4-4L4 16z\"/><path d=\"M13.5 6.5l4 4\"/>"};
  const icon=(t,k)=>{t.classList.add('ps-thumb-icon');t.innerHTML=`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;};

  function openEditor(){const {profile,session}=me();if(!profile)return;const original=mine();let draft={...original},info={bio:profile.bio||'',pronouns:profile.pronouns||''};
    const s=sheet('Editar perfil','Perfil principal');s.body.style.padding='0';const ed=el('div','ps-editor'),left=el('div','ps-ed-left'),center=el('div','ps-ed-center'),right=el('aside','ps-ed-right');ed.append(left,center,right);s.body.append(ed);
    const foot=el('footer','ps-ed-foot'),status=el('span','','Sem alterações');const cancel=button('Cancelar',()=>s.shut(),'ps-btn ghost');const save=button('Salvar alterações',async()=>{save.disabled=true;try{await ctx.saveProfile({bio:info.bio.trim().slice(0,160),pronouns:info.pronouns.trim().slice(0,32)});await ctx.saveAppearance(draft);badgeCache.delete(session.user.id);toast('Perfil salvo. É assim que todo mundo vê.');s.shut();}catch(error){toast(errorText(error));save.disabled=false;}},'ps-btn');foot.append(status,cancel,save);s.box.append(foot);
    const dirty=()=>{status.textContent=JSON.stringify(draft)!==JSON.stringify(original)||info.bio!==(profile.bio||'')||info.pronouns!==(profile.pronouns||'')?'Você tem alterações não salvas':'Sem alterações';};
    const renderPreview=()=>{const stage=el('div','ps-ed-stage');stage.append(el('div','ps-ed-stage-label','Pré-visualização · é assim que todos veem'),buildCard({...profile,...info,id:session.user.id},draft,{preview:true}));center.replaceChildren(stage);dirty();};
    const sel=el('label','ps-ed-field','Perfil principal');const scope=el('select');scope.append(new Option('Perfil global (todos os servidores)','global'));const per=new Option('Por servidor — precisa de outra migration','server');per.disabled=true;scope.append(per);sel.append(scope);left.append(sel);
    const section=(title,sub,thumb,fill)=>{const card=el('div','ps-ed-card'),head=button('',()=>{card.classList.toggle('open');head.setAttribute('aria-expanded',String(card.classList.contains('open')));},'');head.setAttribute('aria-expanded','false');const t=el('span','ps-thumb');thumb(t);const txt=el('span');txt.append(el('strong','',title),el('small','',sub));const chev=el('span','ps-ed-chev');chev.setAttribute('aria-hidden','true');head.append(t,txt,chev);const panel=el('div','ps-ed-panel');fill(panel,()=>{t.replaceChildren();thumb(t);card.classList.toggle('has-value',!t.classList.contains('ps-thumb-icon'));});card.classList.toggle('has-value',!t.classList.contains('ps-thumb-icon'));card.append(head,panel);left.append(card);return card;};
    const options=(panel,kind,update)=>{const grid=el('div','ps-ed-options');const paint=()=>{for(const b of grid.children)b.setAttribute('aria-pressed',String((draft[kind]||'')===b.dataset.id));};
      const none=button('Nenhum',()=>{draft[kind]='';paint();update();renderPreview();},'');none.dataset.id='';grid.append(none);
      for(const item of ITEMS.filter(i=>i.kind===kind)){const p=packOf(item.pack),b=button('',()=>{if(item.admin&&!me().isAdmin)return toast('Exclusivo dos administradores globais.');draft[kind]=item.id;paint();update();renderPreview();},'');b.dataset.id=item.id;packVars(b,p);b.title=p.name;b.setAttribute('aria-label',ITEM_KINDS[kind]+' '+p.name);b.append(fxLayer(p),el('span','',p.name));if(item.admin&&!me().isAdmin)b.classList.add('ps-lock');grid.append(b);}paint();panel.append(grid);};
    const thumbPack=(kind,ic)=>t=>{t.classList.remove('ps-thumb-icon');t.removeAttribute('style');const p=draft[kind]&&packOf(draft[kind]);if(p){packVars(t,p);t.append(fxLayer(p));}else icon(t,ic);};
    section('Placa de identificação','Uma faixa com o tema do pacote',thumbPack('plate','plate'),(p,u)=>options(p,'plate',u));
    section('Avatar e decorações','Avatar e moldura animada',t=>{t.classList.remove('ps-thumb-icon');if(!draft.frame)return icon(t,'frame');const av=el('span','ps-mini-av');av.style.cssText='width:30px;height:30px';ctx.setAvatar?.(av,profile);frameAvatar(av,draft);t.append(av);},(panel,u)=>{panel.append(button('Trocar foto de avatar',()=>{s.shut();ctx.openSettings?.();},'rp-link'));options(panel,'frame',u);});
    section('Estilo do nome','Fonte e efeito, visíveis para todos',t=>{t.classList.remove('ps-thumb-icon');if(!draft.name_font&&!draft.name_effect)return icon(t,'name');const n=el('span','','Aa');styleName(n,draft);t.append(n);},(panel,u)=>{const f=el('label','ps-ed-field','Fonte');const fs=el('select');fs.append(new Option('Padrão da Órbita',''));for(const x of NAME_FONTS)fs.append(new Option(x.name,x.id));fs.value=draft.name_font;fs.onchange=()=>{draft.name_font=fs.value;loadNameFont(fs.value);u();renderPreview();};f.append(fs);
      const e=el('label','ps-ed-field','Efeito');const es=el('select');es.append(new Option('Sem efeito',''));for(const x of NAME_EFFECTS){const o=new Option(x.name+(x.admin?' (ADM)':''),x.id);if(x.admin&&!me().isAdmin)o.disabled=true;es.append(o);}es.value=draft.name_effect;es.onchange=()=>{draft.name_effect=es.value;u();renderPreview();};e.append(es);panel.append(f,e,button('Ver todas as fontes na Loja',()=>{s.shut();openStore('fontes');},'rp-link'));});
    section('Tema e faixa','Gradiente de duas cores do cartão',t=>{t.classList.remove('ps-thumb-icon');if(draft.theme)t.style.background=`linear-gradient(135deg,${draft.theme[0]},${draft.theme[1]})`;else{t.style.background='';icon(t,'theme');}},(panel,u)=>{const row=el('div','ps-colors'),c1=el('input'),c2=el('input');c1.type=c2.type='color';[c1.value,c2.value]=draft.theme||['#b69cff','#3b2a66'];c1.setAttribute('aria-label','Cor principal');c2.setAttribute('aria-label','Cor de destaque');const apply=()=>{draft.theme=[c1.value,c2.value];u();renderPreview();};c1.oninput=c2.oninput=apply;row.append(c1,c2,button('Sem tema',()=>{draft.theme=null;u();renderPreview();},'ps-chip'));panel.append(row,button('Trocar faixa (banner)',()=>{s.shut();ctx.openSettings?.();},'rp-link'));});
    section('Efeitos de perfil e molduras','Borda animada e efeito do cartão',thumbPack('border','border'),(panel,u)=>{panel.append(el('div','ps-ed-field','Borda do perfil'));options(panel,'border',u);panel.append(el('div','ps-ed-field','Efeito de perfil'));options(panel,'effect',u);});
    section('Insígnias','Até 3 fixadas no perfil',t=>{t.classList.add('ps-thumb-icon');t.innerHTML=badgeSvg('boas-vindas',1,{size:30});},panel=>{panel.append(button('Abrir Suas insígnias',()=>openBadges(session.user.id),'ps-btn'));});
    const infoCard=section('Sobre você','Bio e pronomes',t=>icon(t,'info'),panel=>{const b=el('label','ps-ed-field','Sobre você'),ta=el('textarea');ta.maxLength=160;ta.value=info.bio;ta.oninput=()=>{info.bio=ta.value;renderPreview();};b.append(ta);const pr=el('label','ps-ed-field','Pronomes'),pi=el('input');pi.maxLength=32;pi.value=info.pronouns;pi.oninput=()=>{info.pronouns=pi.value;renderPreview();};pr.append(pi);panel.append(b,pr);});infoCard.classList.add('open');
    // Coluna direita: Mural, Atividade, Insígnias (só dados reais).
    const tabs=el('div','ps-tabs ps-ed-tabs');tabs.setAttribute('role','tablist');const pane=el('div','ps-ed-pane');right.append(tabs,pane);
    const tabFns={Mural:async()=>{pane.replaceChildren();const act=profile.custom_status||profile.presence_activity;if(act)pane.append(Object.assign(el('div','ps-mural-item'),{textContent:act}));
        try{const {data}=await me().db.from('social_posts').select('id,content,created_at').eq('author_id',session.user.id).eq('is_reply',false).order('created_at',{ascending:false}).limit(3);for(const post of data||[]){const item=el('div','ps-mural-item',post.content.slice(0,180));item.append(el('small','',new Date(post.created_at).toLocaleDateString('pt-BR')));pane.append(item);}if(!(data||[]).length&&!act)pane.append(el('p','muted','Nada no mural ainda. Publique no Feed!'));}catch{pane.append(el('p','muted','Não foi possível carregar o Feed agora.'));}},
      Atividade:()=>{pane.replaceChildren();const inCall=ctx.inCall?.();pane.append(Object.assign(el('div','ps-mural-item'),{textContent:inCall?'Em chamada: '+inCall:'Fora de chamadas no momento'}));if(profile.presence_activity)pane.append(Object.assign(el('div','ps-mural-item'),{textContent:profile.presence_activity}));},
      Insígnias:async()=>{pane.replaceChildren(el('p','muted','Carregando…'));const uid=session.user.id,state=await badgeState(uid),got=BADGES.filter(b=>levelOf(state,b)>0),pct=Math.round(got.length/BADGES.length*100);
        const head=el('div','ps-vitrine-head'),bar=el('div','ps-bar'),fill=el('i');fill.style.width=Math.max(3,pct)+'%';bar.append(fill);head.append(el('b','',`${got.length} de ${BADGES.length} desbloqueadas`),el('span','ps-pill',pct+'%'),bar);
        const vit=el('div','ps-vitrine');for(const id of pinnedOf(state)){const b=badgeById.get(id),cell=el('div','ps-vitrine-slot');const btn=badgeButton(b,levelOf(state,b),{size:64,onClick:()=>openBadges(uid,id)});cell.append(btn,el('small','',b.name));vit.append(cell);}
        for(let k=vit.children.length;k<3;k++){const c=el('div','ps-vitrine-slot empty');c.append(button('+',()=>openBadges(uid),''),el('small','','Fixar'));vit.append(c);}
        const cats=el('div','ps-vitrine-cats');for(const [cat,name] of Object.entries(CATEGORIES)){const list=BADGES.filter(b=>b.cat===cat&&!(b.exclusive&&b.exclusive!=='admin'&&!levelOf(state,b)));if(!list.length)continue;const n=list.filter(b=>levelOf(state,b)>0).length;const sec=el('section','ps-vitrine-cat');sec.append(el('h6','',`${name} · ${n}/${list.length}`));const g=el('div','ps-badge-grid mini');for(const b of list){const lv=levelOf(state,b),btn=badgeButton(b,lv,{size:34,onClick:()=>openBadges(uid,b.id)});if(!lv)btn.classList.add('locked');g.append(btn);}sec.append(g);cats.append(sec);}
        pane.replaceChildren(head,el('h5','','Vitrine fixada'),vit,cats,button('Abrir coleção completa',()=>openBadges(uid),'ps-btn'));}};
    for(const name of Object.keys(tabFns)){const b=button(name,()=>{for(const x of tabs.children)x.setAttribute('aria-selected',String(x===b));tabFns[name]();},'');b.setAttribute('role','tab');tabs.append(b);}tabs.firstChild.click();
    renderPreview();return s;}
  return {openStore,openBadges,openEditor,decorateCard,buildCard,badgeState,miniBadge,pinnedBadges,invalidate:id=>badgeCache.delete(id)};
}
