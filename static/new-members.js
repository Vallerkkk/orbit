// Feed "Novos membros": timeline de cadastros (RPC new_members, só campos públicos) e boas-vindas 👋.
// Toda regra de acesso é do banco (RLS em member_welcomes; RPCs só para authenticated).
import {cleanAppearance} from './cosmetics.js';
import {styleName,frameAvatar} from './appearance-runtime.js';
import {badgeSvg} from './badges-catalog.js';

const DAY=86400000;
const tz='America/Sao_Paulo';
const dayKey=d=>new Intl.DateTimeFormat('en-CA',{timeZone:tz}).format(new Date(d));
function dayLabel(iso){const k=dayKey(iso),today=dayKey(Date.now()),yest=dayKey(Date.now()-DAY);
  if(k===today)return 'Hoje';if(k===yest)return 'Ontem';
  return new Intl.DateTimeFormat('pt-BR',{timeZone:tz,weekday:'long',day:'numeric',month:'long'}).format(new Date(iso)).replace(/^./,c=>c.toUpperCase());}
const fullDate=iso=>new Intl.DateTimeFormat('pt-BR',{timeZone:tz,day:'numeric',month:'long',year:'numeric'}).format(new Date(iso));

export function createNewMembers(api){
  // api: {el,b,svg,avatar,rpc,db,uid,toast,signed,profile,studio,alive,openFeed}
  const {el,b,svg}=api;let rows=[],cursor=null,more=true,loading=false,host,list,status,hero,lastDay=null,lastGroup=null;
  const ids=new Set();
  function heroBox(stats,recent){const box=el('section','nm-hero');box.setAttribute('aria-label','Boas-vindas aos novos membros');
    const glow=el('div','nm-hero-glow');glow.setAttribute('aria-hidden','true');
    const copy=el('div','nm-hero-copy');copy.append(el('p','nm-eyebrow','Comunidade'),el('h2','','Bem-vindos à Órbita'),el('p','nm-sub','Cada pessoa que chega deixa a Órbita maior. Dê boas-vindas, siga e puxe conversa.'));
    const stack=el('div','nm-stack');for(const p of recent.slice(0,6)){const a=api.avatar(p);a.classList.add('nm-stack-av');a.tabIndex=-1;a.dataset.tip=p.display_name;stack.append(a);}
    if(stats.total>6)stack.append(el('span','nm-stack-more','+'+(stats.total-6)));
    const metrics=el('div','nm-metrics');for(const [n,l] of [[stats.total,'membros'],[stats.week,'nesta semana'],[stats.today,'hoje']]){const m=el('div','nm-metric');m.append(el('strong','',String(n??0)),el('small','',l));metrics.append(m);}
    copy.append(stack);box.append(glow,copy,metrics);return box;}
  function welcomeBtn(p,count){const btn=b('',async()=>{const me=api.uid;const was=p.welcomed;btn.setAttribute('aria-pressed',String(!was));p.welcomed=!was;p.welcomes=Number(p.welcomes)+(was?-1:1);paint();
      try{const q=was?api.db.from('member_welcomes').delete().eq('member_id',p.id).eq('user_id',me):api.db.from('member_welcomes').insert({member_id:p.id});const {error}=await q;if(error&&error.code!=='23505')throw error;}
      catch(e){p.welcomed=was;p.welcomes=Number(p.welcomes)+(was?1:-1);paint();throw e;}},'sf-button nm-act nm-wave');
    const paint=()=>{btn.replaceChildren(el('span','nm-emoji','👋'),el('span','',p.welcomed?'Boas-vindas dadas':'Dar boas-vindas'),el('span','nm-count',String(p.welcomes||0)));btn.setAttribute('aria-pressed',String(!!p.welcomed));btn.setAttribute('aria-label',(p.welcomed?'Remover boas-vindas para ':'Dar boas-vindas a ')+p.display_name+' ('+(p.welcomes||0)+')');btn.classList.toggle('active',!!p.welcomed);};
    paint();if(p.id===api.uid){btn.disabled=true;btn.dataset.tip='Suas boas-vindas aparecem aqui';}return btn;}
  function followBtn(p){const btn=b(p.following?'Seguindo':'Seguir',async()=>{const me=api.uid;
      if(p.following){const {error}=await api.db.from('social_follows').delete().eq('follower_id',me).eq('following_id',p.id);if(error)throw error;p.following=false;}
      else{let {error}=await api.db.from('social_follows').insert({follower_id:me,following_id:p.id});if(error&&error.code!=='23505'){const r=await api.db.from('social_follow_requests').insert({follower_id:me,following_id:p.id});if(r.error&&r.error.code!=='23505')throw r.error;btn.textContent='Solicitado';return;}p.following=true;}
      btn.textContent=p.following?'Seguindo':'Seguir';btn.setAttribute('aria-pressed',String(p.following));},'sf-button nm-act nm-follow');btn.setAttribute('aria-pressed',String(!!p.following));return btn;}
  function card(p){const a=cleanAppearance(p.appearance||{});const art=el('article','nm-card');art.dataset.userId=p.id;
    const banner=el('div','nm-banner');const t=a.theme||[];if(t[0])banner.style.setProperty('--nm1',t[0]);if(t[1])banner.style.setProperty('--nm2',t[1]);
    if(p.banner_url)api.signed(p.banner_url,'orbita-files').then(src=>{if(src&&banner.isConnected){const img=el('img');img.src=src;img.alt='';img.loading='lazy';banner.append(img);}});
    const num=el('span','nm-number','#'+p.member_number);num.dataset.tip='Membro número '+p.member_number;banner.append(num);
    const body=el('div','nm-body');const av=el('div','nm-avatar');const inner=api.avatar(p);av.append(inner);frameAvatar(av,a);
    const id=el('div','nm-id');const name=b(p.display_name||'Participante',()=>api.profile(p),'sf-name nm-name');styleName(name,a);
    const handle=el('p','nm-handle','@'+(p.username||'participante'));if(p.pronouns)handle.append(el('span','nm-pron',p.pronouns));
    id.append(name,handle);const badges=el('div','nm-badges');badges.setAttribute('aria-label','Insígnias fixadas');api.studio().then(st=>st.pinnedBadges?.(badges,p.id,4)).catch(()=>{});
    const head=el('div','nm-head');head.append(av,id,badges);body.append(head);
    if(p.bio){const about=el('div','nm-about');about.append(el('small','nm-label','Sobre'),el('p','',p.bio));body.append(about);}
    const joined=el('p','nm-joined');joined.append(svg('sparkle'),el('span','','Entrou em '+fullDate(p.joined_at)));body.append(joined);
    const acts=el('div','nm-actions');acts.append(welcomeBtn(p));if(p.id!==api.uid)acts.append(followBtn(p));acts.append(b('Ver perfil',()=>api.profile(p),'sf-button nm-act nm-view'));body.append(acts);
    art.append(banner,body);return art;}
  function place(p,{prepend=false}={}){if(ids.has(p.id))return;ids.add(p.id);const key=dayKey(p.joined_at);
    const item=el('li','nm-item');const node=el('span','nm-node');node.setAttribute('aria-hidden','true');item.append(node,card(p));
    if(prepend){let first=list.querySelector('.nm-day');if(!first||first.dataset.day!==key){first=group(key,p.joined_at);list.prepend(first);}first.querySelector('ol').prepend(item);item.classList.add('nm-fresh');return;}
    if(lastDay!==key){lastGroup=group(key,p.joined_at);list.append(lastGroup);lastDay=key;}lastGroup.querySelector('ol').append(item);}
  function group(key,iso){const g=el('section','nm-day');g.dataset.day=key;const h=el('h3','nm-day-label');h.append(el('span','',dayLabel(iso)));g.append(h,el('ol','nm-list'));return g;}
  async function page(){if(loading||!more)return;loading=true;status.textContent='Carregando…';status.disabled=true;
    try{const res=await api.rpc('new_members',{before_at:cursor?.joined_at||null,before_id:cursor?.id||null,page_size:20});if(!api.alive())return;
      for(const p of res){rows.push(p);place(p);}cursor=res.at(-1)||cursor;more=res.length===20;
      status.textContent=more?'Carregar mais':rows.length?'Você chegou ao começo da Órbita.':'Ninguém por aqui ainda.';status.disabled=!more;}
    catch(e){if(api.alive()){status.textContent='Não foi possível carregar. Tentar novamente';status.disabled=false;api.toast(e.message);}}finally{loading=false;}}
  async function refreshHero(){try{const [stats,recent]=await Promise.all([api.rpc('new_members_stats',{}),api.rpc('new_members',{page_size:6})]);if(!api.alive())return;const fresh=heroBox(stats||{},recent||[]);hero.replaceWith(fresh);hero=fresh;return recent;}catch{}}
  async function mount(container,statusBtn){host=container;status=statusBtn;hero=el('section','nm-hero nm-hero-loading');list=el('div','nm-timeline');list.setAttribute('role','feed');list.setAttribute('aria-label','Novos membros');
    host.append(hero,list);status.onclick=()=>page();refreshHero();await page();}
  async function arrived(){const recent=await refreshHero();for(const p of [...(recent||[])].reverse())if(!ids.has(p.id)){rows.unshift(p);place(p,{prepend:true});}}
  return {mount,page,arrived,get more(){return more;},get loading(){return loading;}};
}

// Primeira visita depois do cadastro: mensagem + mini-tour + insígnia de boas-vindas (já no catálogo).
export async function maybeWelcome(api){
  const {el,uid}=api;if(!uid)return false;const key='orbita-welcome-seen:'+uid;if(localStorage.getItem(key)&&!api.force)return false;
  let stats;try{const {data,error}=await api.db.rpc('new_members_stats');if(error)throw error;stats=data;}catch{return false;}
  if(!api.force&&(!stats?.me_joined||Date.now()-new Date(stats.me_joined).getTime()>3*DAY)){localStorage.setItem(key,'1');return false;}
  localStorage.setItem(key,'1');api.db.rpc('sync_my_badges').then(()=>{},()=>{});
  api.showDialog('Bem-vindo(a) à Órbita',box=>{box.classList.add('nm-welcome');
    const top=el('div','nm-welcome-top');const art=el('div','nm-welcome-badge');art.innerHTML=badgeSvg('boas-vindas',1,{size:96});art.setAttribute('role','img');art.setAttribute('aria-label','Insígnia Boas-vindas');
    const copy=el('div');copy.append(el('p','nm-eyebrow','Insígnia desbloqueada · Boas-vindas'),el('h3','',stats?.me_number?'Você é o membro #'+stats.me_number+'!':'Que bom ter você aqui!'),el('p','nm-sub','Sua chegada já aparece em Novos membros. Quatro passos para começar com o pé direito:'));top.append(art,copy);
    const ol=el('ol','nm-tour');const steps=[['user','Complete seu perfil','Foto, banner, pronomes e “Sobre você”.',api.editProfile],['compass','Entre em um servidor','Encontre comunidades com a sua cara.',api.explore],['home','Explore o feed','Publique, siga pessoas e reaja.',api.feed],['sparkle','Conheça as insígnias','Veja o que dá para desbloquear.',api.badges]];
    steps.forEach(([ic,t,d,go],i)=>{const li=el('li','nm-step');const n=el('span','nm-step-n',String(i+1));const c=el('div');c.append(el('strong','',t),el('small','',d));const btn=el('button','sf-button nm-step-go','Ir');btn.type='button';btn.onclick=()=>{document.querySelector('#app-dialog')?.close();go?.();};li.append(n,c,btn);ol.append(li);});
    const done=el('button','primary nm-welcome-done','Começar');done.type='button';done.onclick=()=>document.querySelector('#app-dialog')?.close();box.append(top,ol,done);});
  return true;
}
