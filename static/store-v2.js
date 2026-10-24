// Loja v3 (layout da v2 + antigo menu Decorações): vitrine com destaque em carrossel, abas, busca, filtros, seções por coleção,
// cartões com pré-visualização ao vivo e modal de detalhes. A validação real (itens de ADM) fica no banco.
import {ITEMS,ITEM_KINDS,packOf,cleanAppearance} from './cosmetics.js';
import {COLLECTIONS as NEW_COLS,CLASSICS,RARITY} from './store-collections.js';
import {styleName,frameAvatar,cardBorder,packVars} from './appearance-runtime.js';
import {mountFx,destroyFxIn} from './fx-engine.js';

const V2=ITEMS.filter(i=>i.v2);
const COLLECTIONS=[...NEW_COLS,...CLASSICS];
const RANK=Object.keys(RARITY);
const SORTS=[['col','Ordem da coleção'],['rar-desc','Raridade: maior primeiro'],['rar-asc','Raridade: menor primeiro'],['name','Nome (A–Z)']];
const TABS=[['destaques','Destaques'],['colecoes','Coleções'],['frame','Molduras'],['effect','Efeitos de perfil'],['card_border','Bordas de cartão'],['name_style','Estilos de nome'],['server','Temas de servidor'],['equipados','Equipados']];
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createStoreV2(o){
  // o: {el,button,sheet,ctx,me,mine,equip,renderFonts,renderPack,packCard,buildCard,toast}
  const {el,button}=o;
  const locked=item=>item.admin&&!o.me().isAdmin;
  const profile=()=>({...(o.me().profile||{}),id:o.me().session?.user.id});

  // Mini perfil com a aparência aplicada (usado nos cartões, no destaque e no detalhe).
  function miniProfile(a,{big=false,focus=''}={}){const p=profile(),mp=el('div','sv-mp'+(big?' big':'')+(focus?' f-'+focus:''));
    const e=a.effect&&packOf(a.effect);if(e?.v2){const l=el('span','sv-mp-fx');mp.append(l);mountFx(l,{preset:e.fx,colors:e.c,bg:e.bg,mode:'effect'});}
    const ban=el('div','sv-mp-banner');const th=packOf(a.card_border||a.frame||a.name_style||a.effect||a.server||'');if(th){ban.style.background=`linear-gradient(135deg,${th.c[0]}aa,${th.c[1]}55 60%,transparent)`;}mp.append(ban);
    const wrap=el('div','sv-mp-avwrap'),av=el('div','sv-mp-av');o.ctx.setAvatar?.(av,p);frameAvatar(av,a);wrap.append(av);
    const fr=a.frame&&packOf(a.frame);if(fr?.v2&&(big||focus==='frame')){const l=el('span','sv-frame-fx');wrap.append(l);mountFx(l,{preset:fr.fx,colors:fr.c,bg:fr.bg,mode:'frame'});}
    const name=el('strong','sv-mp-name',p.display_name||'Seu nome');styleName(name,a);const tag=el('small','sv-mp-tag','@'+(p.username||'voce'));
    const lines=el('div','sv-mp-lines');lines.append(el('i'),el('i'));mp.append(wrap,name,tag,lines);cardBorder(mp,a);return mp;}
  function serverMock(item){const p=packOf(item.pack),m=el('div','sv-server');packVars(m,p);m.style.setProperty('--c3',p.c[2]);const l=el('span','sv-server-fx');m.append(l);mountFx(l,{preset:p.fx,colors:p.c,bg:p.bg,mode:'effect'});
    const rail=el('div','sv-srail');for(let i=0;i<4;i++)rail.append(el('i'));const ch=el('div','sv-schan');ch.append(el('b','',p.name));for(const n of ['geral','memes','voz'])ch.append(el('span','','# '+n));const chat=el('div','sv-schat');chat.append(el('i'),el('i'),el('i'));m.append(rail,ch,chat);return m;}
  function preview(item,big){if(item.kind==='server')return serverMock(item);return miniProfile({...emptyA(),[item.kind]:item.id},{big,focus:item.kind});}
  const emptyA=()=>({frame:'',effect:'',card_border:'',name_style:'',border:'',plate:'',name_font:'',name_effect:''});

  function pills(item){const r=el('div','sv-pills');const rp=el('span','sv-rar',RARITY[item.rarity].name);rp.style.setProperty('--rc',RARITY[item.rarity].color);r.append(rp);
    for(const t of item.tags||[])r.append(el('span','sv-tag sv-tag-'+t.toLowerCase(),t));if(item.admin)r.append(el('span','sv-tag sv-tag-adm','ADM'));return r;}
  function tilt(card){if(reduced())return;card.addEventListener('pointermove',e=>{const r=card.getBoundingClientRect(),x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;card.style.setProperty('--rx',((.5-y)*10).toFixed(2)+'deg');card.style.setProperty('--ry',((x-.5)*12).toFixed(2)+'deg');card.style.setProperty('--mx',(x*100).toFixed(1)+'%');card.style.setProperty('--my',(y*100).toFixed(1)+'%');card.classList.add('tilting');});
    card.addEventListener('pointerleave',()=>{card.classList.remove('tilting');card.style.removeProperty('--rx');card.style.removeProperty('--ry');});}
  function itemCard(item,open){const p=packOf(item.pack),c=el('article','sv-card');c.tabIndex=0;c.setAttribute('role','button');c.dataset.item=item.id;c.setAttribute('aria-label',`${item.name}, ${ITEM_KINDS[item.kind]}, ${RARITY[item.rarity].name}`);packVars(c,p);c.style.setProperty('--rc',RARITY[item.rarity].color);
    const on=o.mine()[item.kind]===item.id;c.classList.toggle('equipped',on);c.classList.toggle('locked',locked(item));
    const pv=el('div','sv-prev');pv.append(preview(item));const shine=el('span','sv-shine');const meta=el('div','sv-meta');meta.append(pills(item),el('strong','sv-name',item.name),el('small','sv-kind',`${ITEM_KINDS[item.kind]} · ${p.name}`));
    const foot=el('div','sv-cfoot');foot.append(el('span','sv-price',on?'✓ Seu':locked(item)?'Exclusivo ADM':'Grátis'));
    const cta=button(item.kind==='server'?'Ver tema':on?'Equipado':'Aplicar',async e=>{e.stopPropagation();if(item.kind==='server'||locked(item))return open(item);cta.disabled=true;if(await o.equip({[item.kind]:on?'':item.id}))render();else cta.disabled=false;},'sv-cta'+(on?' on':''));cta.setAttribute('aria-label',(on?'Remover ':'Aplicar ')+item.name);if(locked(item))cta.disabled=true;foot.append(cta);meta.append(foot);
    if(on)c.append(el('span','sv-on','Equipado'));if(locked(item))c.append(el('span','sv-lock','🔒 Só ADM'));c.append(pv,meta,shine);tilt(c);
    c.onclick=()=>open(item);c.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(item);}};return c;}
  function skeletons(n=8){const g=el('div','sv-grid');for(let i=0;i<n;i++){const s=el('div','sv-card sv-skel');s.append(el('div','sv-prev'),el('i'),el('i'));g.append(s);}return g;}

  function open(start){
    const s=o.sheet('Loja da Órbita','Coleções animadas para o seu perfil — grátis','sv-overlay');s.box.classList.add('sv-sheet');s.body.classList.add('sv-body');
    const bar=el('div','sv-bar'),tabs=el('div','sv-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Seções da loja');
    const tools=el('div','sv-tools'),q=el('input','sv-search');q.type='search';q.placeholder='Buscar itens e coleções';q.setAttribute('aria-label','Buscar na loja');
    const rar=el('select','sv-select');rar.setAttribute('aria-label','Filtrar por raridade');rar.append(new Option('Todas as raridades',''));for(const [k,v] of Object.entries(RARITY))rar.append(new Option(v.name,k));
    const col=el('select','sv-select');col.setAttribute('aria-label','Filtrar por coleção');col.append(new Option('Todas as coleções',''));for(const [lab,list] of [['Novas',NEW_COLS],['Clássicas',CLASSICS]]){const g=document.createElement('optgroup');g.label=lab;for(const c of list)g.append(new Option(c.name+(c.admin?' (ADM)':''),c.id));col.append(g);}
    const sort=el('select','sv-select');sort.setAttribute('aria-label','Ordenar itens');for(const [k,v] of SORTS)sort.append(new Option(v,k));
    tools.append(q,rar,col,sort);bar.append(tabs,tools);s.head.after(bar);
    let current='destaques',timer;
    const match=i=>{const t=q.value.trim().toLowerCase(),p=packOf(i.pack);return (!rar.value||i.rarity===rar.value)&&(!col.value||i.pack===col.value)&&(!t||(i.name+' '+i.desc+' '+p.name+' '+ITEM_KINDS[i.kind]).toLowerCase().includes(t));};
    const filtering=()=>!!(q.value.trim()||rar.value||col.value);
    const order=list=>{const v=sort.value;if(v==='col')return list;const a=[...list];if(v==='name')a.sort((x,y)=>x.name.localeCompare(y.name,'pt-BR'));else{const d=v==='rar-desc'?-1:1;a.sort((x,y)=>d*(RANK.indexOf(x.rarity)-RANK.indexOf(y.rarity))||x.name.localeCompare(y.name,'pt-BR'));}return a;};
    const clear=()=>{clearInterval(timer);destroyFxIn(s.body);s.body.replaceChildren();s.body.scrollTop=0;};
    function section(c,items){const sec=el('section','sv-section');sec.id='sv-col-'+c.id;sec.dataset.collection=c.id;const ban=el('header','sv-banner');packVars(ban,c);ban.style.setProperty('--c3',c.c[2]);const l=el('span','sv-banner-fx');ban.append(l);mountFx(l,{preset:c.fx,colors:c.c,bg:c.bg,mode:'effect'});
      const txt=el('div','sv-banner-txt');const h=el('h3','',c.name);txt.append(h,el('p','',c.tagline));const side=el('div','sv-banner-side');for(const t of c.tags||[])side.append(el('span','sv-tag sv-tag-'+t.toLowerCase(),t));
      const all=button(c.admin&&!o.me().isAdmin?'Só ADM':'Equipar coleção',async()=>{const patch={};for(const i of V2.filter(i=>i.pack===c.id&&i.kind!=='server'))patch[i.kind]=i.id;if(await o.equip(patch))render();},'sv-btn ghost');if(c.admin&&!o.me().isAdmin)all.disabled=true;side.append(all);
      ban.append(txt,side);const g=el('div','sv-grid');for(const i of order(items))g.append(itemCard(i,detail));sec.append(ban,g);return sec;}
    function group(title,sub,list){let n=0;const items=[];for(const c of list){const it=V2.filter(i=>i.pack===c.id&&match(i));if(it.length){items.push(section(c,it));n++;}}if(!n)return 0;const h=el('div','sv-group');h.append(el('h3','sv-h',title),el('p','sv-sub',sub));s.body.append(h,...items);return n;}
    function hero(){const feat=COLLECTIONS.filter(c=>c.featured).sort((a,b)=>a.featured-b.featured).concat(COLLECTIONS.filter(c=>!c.featured&&!c.admin).slice(0,2));let k=0;
      const h=el('section','sv-hero');h.setAttribute('aria-roledescription','carrossel');h.setAttribute('aria-label','Coleções em destaque');const stage=el('div','sv-hero-stage');const dots=el('div','sv-dots');
      const show=i=>{k=(i+feat.length)%feat.length;const c=feat[k];destroyFxIn(stage);stage.replaceChildren();packVars(h,c);h.style.setProperty('--c3',c.c[2]);h.style.setProperty('--hbg',c.bg);
        const l=el('span','sv-hero-fx');stage.append(l);mountFx(l,{preset:c.fx,colors:c.c,bg:c.bg,mode:'hero'});
        const txt=el('div','sv-hero-txt');const kick=el('span','sv-kicker','Coleção em destaque');txt.append(kick,el('h2','',c.name),el('p','',c.desc));const meta=el('div','sv-hero-meta');meta.append(el('span','sv-chip','5 itens'),...(c.tags||[]).map(t=>el('span','sv-tag sv-tag-'+t.toLowerCase(),t)));
        const cta=button('Ver coleção',()=>{show2('colecoes',c.id);},'sv-btn');txt.append(meta,cta);
        const art=el('div','sv-hero-art');const a={...emptyA()};for(const i of V2.filter(i=>i.pack===c.id&&i.kind!=='server'))a[i.kind]=i.id;art.append(miniProfile(a,{big:true}));stage.append(txt,art);
        for(const [j,d] of [...dots.children].entries())d.setAttribute('aria-current',String(j===k));};
      feat.forEach((c,j)=>{const d=button('',()=>{show(j);restart();},'sv-dot');d.setAttribute('aria-label','Mostrar '+c.name);dots.append(d);});
      const prev=button('‹',()=>{show(k-1);restart();},'sv-arrow prev'),next=button('›',()=>{show(k+1);restart();},'sv-arrow next');prev.setAttribute('aria-label','Anterior');next.setAttribute('aria-label','Próxima');
      const restart=()=>{clearInterval(timer);if(!reduced())timer=setInterval(()=>{if(h.isConnected&&!document.hidden&&!h.matches(':hover'))show(k+1);},8000);};
      h.append(stage,prev,next,dots);show(0);restart();return h;}
    function kindGrid(kind,title,sub){const wrap=el('div','sv-kind');wrap.append(el('h3','sv-h',title),el('p','sv-sub',sub));const g=el('div','sv-grid');const items=order(V2.filter(i=>i.kind===kind&&match(i)&&(!i.admin||o.me().isAdmin)));for(const i of items)g.append(itemCard(i,detail));if(!items.length)g.append(el('p','sv-empty','Nada encontrado com esses filtros.'));wrap.append(g);return wrap;}
    function render(){const body=s.body;const keep=body.scrollTop;clear();
      if(current==='destaques'&&!filtering()){body.append(hero());const nov=el('h3','sv-h','Novidades e limitados');body.append(nov);const g=el('div','sv-grid');for(const i of V2.filter(i=>(i.tags||[]).length&&!i.admin&&i.kind==='card_border'))g.append(itemCard(i,detail));body.append(g);
        for(const c of COLLECTIONS.filter(c=>c.featured))body.append(section(c,V2.filter(i=>i.pack===c.id)));
        const cl=el('div','sv-group');cl.append(el('h3','sv-h','Clássicas refeitas'),el('p','sv-sub','Os pacotes de sempre, agora com animações novas.'));body.append(cl);const g2=el('div','sv-grid');for(const c of CLASSICS.filter(c=>!c.admin).slice(0,8))g2.append(itemCard(V2.find(i=>i.pack===c.id&&i.kind==='effect'),detail));body.append(g2);}
      else if(current==='colecoes'||current==='destaques'){let n=0;
        n+=group('Novas','Coleções da Loja v2, com animação própria e conjunto completo.',NEW_COLS.filter(c=>!c.admin));
        n+=group('Clássicas','Os pacotes da primeira loja e as antigas decorações de perfil, refeitos com animação nova.',CLASSICS.filter(c=>!c.admin));
        n+=group('Equipe Órbita ADM',o.me().isAdmin?'Você é administrador global: estes itens estão liberados para você.':'Exclusivos dos administradores globais. O servidor recusa o uso por outras contas.',COLLECTIONS.filter(c=>c.admin));
        if(!n)body.append(el('p','sv-empty','Nada encontrado com esses filtros.'));}
      else if(current==='equipados'){const mine=cleanAppearance(o.mine());const items=V2.filter(i=>mine[i.kind]===i.id);const wrap=el('div','sv-kind');wrap.append(el('h3','sv-h','Equipados'),el('p','sv-sub','O que você está usando agora. Toque num item para trocar ou remover.'));const g=el('div','sv-grid');for(const i of items)g.append(itemCard(i,detail));if(!items.length)g.append(el('p','sv-empty','Nada equipado ainda. Explore as coleções e equipe algo!'));wrap.append(g);
        if(items.some(i=>i.kind!=='server')){const off=button('Remover tudo do perfil',async()=>{if(await o.equip({frame:'',effect:'',card_border:'',name_style:'',border:'',plate:'',legacy_frame:'',legacy_effect:''}))render();},'sv-btn ghost');wrap.append(off);}body.append(wrap);}
      else if(current==='name_style'){body.append(kindGrid('name_style','Nomes animados','Estilos de nome com movimento — aparecem no chat, na lista de membros e no perfil.'));const f=el('section','sv-section');f.append(el('h3','sv-h','Fontes e efeitos clássicos'));o.renderFonts(f);body.append(f);}
      else{const T={frame:['Molduras','Molduras animadas em volta do seu avatar.'],effect:['Efeitos de perfil','Animações no fundo do seu cartão de perfil.'],card_border:['Bordas de cartão','Um contorno vivo em volta do cartão inteiro: popover, perfil e Novos membros.'],server:['Temas de servidor','Paletas e fundos para o seu servidor.']}[current];body.append(kindGrid(current,...T));}
      if(keep&&current===render.last)body.scrollTop=keep;render.last=current;}
    function show2(view,colId){current=view;for(const b of tabs.children)b.setAttribute('aria-selected',String(b.dataset.view===view));
      clear();s.body.append(skeletons());requestAnimationFrame(()=>{render();if(colId){const t=s.body.querySelector('#sv-col-'+colId);if(t)s.body.scrollTop+=t.getBoundingClientRect().top-s.body.getBoundingClientRect().top-8;}});}
    for(const [k,v] of TABS){if(k==='adm'&&!o.me().isAdmin&&false)continue;const b=button(v,()=>show2(k),'');b.dataset.view=k;b.setAttribute('role','tab');tabs.append(b);}
    let qt;q.oninput=()=>{clearTimeout(qt);qt=setTimeout(()=>{if(current==='destaques')current='colecoes',[...tabs.children].forEach(b=>b.setAttribute('aria-selected',String(b.dataset.view==='colecoes')));render();},180);};rar.onchange=col.onchange=sort.onchange=()=>q.oninput();
    s.back.addEventListener('ps-close',()=>{clearInterval(timer);destroyFxIn(s.box);});

    // ----- Detalhe -----
    function detail(item){s.box.querySelector('.sv-detail')?.remove();const p=packOf(item.pack),d=el('div','sv-detail');d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');d.setAttribute('aria-label',item.name);packVars(d,p);d.style.setProperty('--c3',p.c[2]);d.style.setProperty('--rc',RARITY[item.rarity].color);
      const panel=el('div','sv-dpanel'),close=button('×',()=>shut(),'ps-close sv-dclose');close.setAttribute('aria-label','Fechar detalhes');
      const left=el('div','sv-dprev'),right=el('div','sv-dinfo');const a={...cleanAppearance(o.mine())};if(item.kind!=='server')a[item.kind]=item.id;
      const av=miniProfile({...emptyA(),frame:a.frame,name_style:a.name_style},{big:true,focus:'frame'});av.classList.add('sv-only-av');
      if(item.kind==='server')left.append(serverMock(item));else{const card=o.buildCard({...profile()},a,{preview:true});card.classList.add('sv-dcard');left.append(card);}
      const chat=el('div','sv-chat');chat.append(el('h6','','No chat'));const msg=(t,mine)=>{const m=el('div','sv-msg');const ma=el('div','sv-msg-av');if(mine){o.ctx.setAvatar?.(ma,profile());frameAvatar(ma,a);}else{ma.textContent='L';}const c=el('div');const n=el('strong','',mine?(profile().display_name||'Você'):'Luna');if(mine)styleName(n,a);c.append(n,el('p','',t));m.append(ma,c);return m;};
      chat.append(msg('Olha meu perfil novo! ✨',true),msg('Ficou incrível, onde você pegou?',false),msg('Na Loja, coleção '+p.name+'.',true));left.append(av,chat);
      right.append(pills(item),el('span','sv-kicker',ITEM_KINDS[item.kind]+' · '+p.name),el('h2','',item.name),el('p','sv-desc',item.desc));
      const actions=el('div','sv-dactions');const on=()=>o.mine()[item.kind]===item.id;const eq=button('',async()=>{eq.disabled=true;if(await o.equip({[item.kind]:on()?'':item.id})){paint();render();}eq.disabled=false;},'sv-btn');const paint=()=>{eq.textContent=on()?'Remover':'Equipar';eq.classList.toggle('ghost',on());};paint();
      if(locked(item)){eq.disabled=true;eq.textContent='Exclusivo ADM';eq.title='O servidor só libera este item para administradores globais.';}actions.append(eq);
      if(item.kind==='server'){const st=o.ctx?.serverTheme,c=st?.community?.();const applied=()=>st?.community?.()?.theme===item.id;const ap=button('',async()=>{ap.disabled=true;try{await st.apply(applied()?null:item.id);o.toast?.(applied()?'Tema aplicado ao servidor '+c.name+' para todos.':'Tema removido do servidor.');}catch(e){o.toast?.(e.message||'Não foi possível aplicar o tema.');}paintAp();},'sv-btn');
        const paintAp=()=>{const can=!!(c&&st.canApply());ap.disabled=!can||locked(item);ap.textContent=!c?'Abra um servidor para aplicar':!can?'Só dono/ADM do servidor aplica':applied()?'Remover do servidor':'Aplicar em '+c.name;ap.classList.toggle('ghost',applied());};paintAp();actions.prepend(ap);eq.hidden=true;if(st?.setPersonal){const mine=button('',()=>{const on=st.personal()===item.id;st.setPersonal(on?null:item.id);o.toast?.(on?'Tema pessoal removido.':'Tema aplicado ao seu Órbita (só para você, quando o servidor não tem tema).');paintMine();},'sv-btn ghost');const paintMine=()=>{mine.textContent=st.personal()===item.id?'Remover do meu Órbita':'Usar no meu Órbita';};paintMine();if(locked(item))mine.disabled=true;ap.after(mine);}}
      const all=button('Equipar coleção completa',async()=>{const patch={};for(const i of V2.filter(i=>i.pack===p.id&&i.kind!=='server'))patch[i.kind]=i.id;if(await o.equip(patch)){paint();render();}},'sv-btn ghost');if(locked(item))all.disabled=true;actions.append(all);right.append(actions);
      right.append(el('h5','','Itens deste pacote'));const list=el('div','sv-plist');for(const i of V2.filter(i=>i.pack===p.id)){const b=button('',()=>detail(i),'sv-pitem'+(i.id===item.id?' current':''));const r=el('span','sv-dotr');r.style.background=RARITY[i.rarity].color;b.append(r,el('strong','',i.name),el('small','',ITEM_KINDS[i.kind]));list.append(b);}right.append(list,el('p','sv-sub','Ao equipar, todo mundo vê a mudança. A validação acontece no servidor.'));
      panel.append(close,left,right);d.append(panel);s.box.append(d);
      const key=e=>{if(e.key==='Escape'){e.stopImmediatePropagation();shut();}};window.addEventListener('keydown',key,true);d.addEventListener('click',e=>{if(e.target===d)shut();});
      function shut(){destroyFxIn(d);d.remove();window.removeEventListener('keydown',key,true);}setTimeout(()=>eq.focus({preventScroll:true}),0);}
    open.detail=detail;
    const startItem=V2.find(i=>i.id===start);const startCol=COLLECTIONS.find(c=>c.id===start);
    if(start==='fontes')show2('name_style');else if(start==='adm'||start==='decoracoes')show2(start==='adm'?'colecoes':'frame');else if(startCol)show2('colecoes',startCol.id);else if(TABS.some(t=>t[0]===start))show2(start);else show2('destaques');
    if(startItem)setTimeout(()=>detail(startItem),50);
    return s;}
  return {open};
}
