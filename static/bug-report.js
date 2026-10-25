// Reportar bug: modal para todos os usuários + lista para ADMs globais.
const MAX=25*1024*1024, EXT={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov'};
const STATUS=['aberto','em análise','resolvido','descartado'];
export function createBugReports({db,session,isAdmin,showDialog,el,button,toast}){
  const fmt=d=>new Date(d).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const platform=()=>{const u=navigator.userAgent;return /android/i.test(u)?'Android':/iphone|ipad/i.test(u)?'iOS':matchMedia('(display-mode: standalone)').matches?'PWA':'Web';};
  function open(){showDialog('Reportar bug',box=>{box.classList.add('bug-modal');const files=[];
    const now=el('p','bug-when','📅 '+fmt(Date.now())+' · enviado com versão, plataforma e tela atual');
    const ta=el('textarea');ta.maxLength=4000;ta.rows=5;ta.placeholder='O que aconteceu? O que você esperava? Como reproduzir?';ta.setAttribute('aria-label','Descrição do bug');
    const list=el('div','bug-files'),pick=el('input');pick.type='file';pick.accept=Object.keys(EXT).join(',');pick.multiple=true;pick.hidden=true;
    const urls=new Map();
    // Uma URL de objecto por arquivo: repaints (remover/colar/anexar) recriavam todas elas
    // e cada uma prendia o buffer original do arquivo até fechar a aba.
    const freeUrls=()=>{for(const u of urls.values())URL.revokeObjectURL(u);urls.clear();};
    document.getElementById('app-dialog')?.addEventListener('close',freeUrls,{once:true});
    const paint=()=>{for(const [f,u]of urls)if(!files.includes(f)){URL.revokeObjectURL(u);urls.delete(f);}list.replaceChildren(...files.map((f,i)=>{const t=el('div','bug-thumb');let u=urls.get(f);if(!u){u=URL.createObjectURL(f);urls.set(f,u);}const m=f.type.startsWith('video')?el('video'):el('img');m.src=u;if(m.tagName==='VIDEO'){m.muted=true;m.controls=true;}t.append(m,button('×',()=>{files.splice(i,1);paint();},'bug-x'));t.lastChild.setAttribute('aria-label','Remover anexo');return t;}));};
    pick.onchange=()=>{for(const f of pick.files){if(!EXT[f.type]){toast('Só imagens ou vídeos.');continue;}if(f.size>MAX){toast(f.name+' passa de 25 MB.');continue;}if(files.length<6)files.push(f);}pick.value='';paint();};
    const add=button('📎 Anexar imagem ou vídeo',()=>pick.click(),'bug-add');
    const send=button('Enviar relatório',async()=>{const text=ta.value.trim();if(text.length<3)return toast('Descreva o bug em poucas palavras.');send.disabled=true;send.textContent='Enviando…';
      try{const uid=session().user.id,paths=[];for(const f of files){const path=`bug-reports/${uid}/${crypto.randomUUID()}.${EXT[f.type]}`;const {error}=await db.storage.from('orbita-files').upload(path,f,{contentType:f.type,upsert:false});if(error)throw error;paths.push(path);}
        const version=await fetch('/api/version').then(r=>r.json()).then(j=>j.version).catch(()=>'');
        const {data,error}=await db.from('bug_reports').insert({description:text,attachments:paths,app_version:String(version).slice(0,64),platform:platform(),user_agent:navigator.userAgent.slice(0,512),route:(location.pathname+location.hash).slice(0,256)}).select('code,created_at').single();if(error)throw error;
        box.replaceChildren(el('div','bug-done'));box.firstChild.append(el('strong','','Relatório '+data.code+' enviado'),el('p','muted','Recebido em '+fmt(data.created_at)+'. Obrigado! A equipe vai analisar.'));toast('Relatório '+data.code+' enviado');}
      catch(e){toast(e.message||'Não foi possível enviar.');send.disabled=false;send.textContent='Enviar relatório';}},'primary');
    const row=el('div','bug-actions');row.append(add,send);box.append(now,ta,pick,list,row);
    // Ctrl+V para colar prints
    ta.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if(!items) return;
      for(const item of items){
        if(item.type.startsWith('image/')){
          e.preventDefault();
          const file = item.getAsFile();
          if(file && files.length < 6){
            files.push(file);
            paint();
            toast('Print colado');
          }
        }
      }
    });
    ta.placeholder = 'O que aconteceu? O que você esperava? Como reproduzir?\n\nDica: use Ctrl+V para colar prints.';
    setTimeout(()=>ta.focus());});}
  function admin(){showDialog('Relatórios de bug',async box=>{box.classList.add('bug-modal','bug-admin');box.append(el('p','muted','Carregando…'));
    const {data,error}=await db.from('bug_reports').select('*').order('created_at',{ascending:false}).limit(100);box.replaceChildren();if(error)return box.append(el('p','muted',error.message));if(!data.length)return box.append(el('p','muted','Nenhum relatório ainda.'));
    const ids=[...new Set(data.map(r=>r.reporter_id))],{data:ps}=await db.from('profiles').select('id,username,display_name').in('id',ids);const who=id=>ps?.find(p=>p.id===id);
    for(const r of data){const it=el('article','bug-item'),h=el('header');const p=who(r.reporter_id);h.append(el('strong','',r.code),el('small','muted',fmt(r.created_at)+' · @'+(p?.username||'?')+' · '+(r.platform||'')+' '+(r.app_version||'').slice(0,8)));
      const st=el('select');st.setAttribute('aria-label','Status de '+r.code);for(const s of STATUS)st.append(new Option(s,s));st.value=r.status;st.dataset.status=r.status;st.onchange=async()=>{const {error}=await db.from('bug_reports').update({status:st.value}).eq('id',r.id);if(error){toast(error.message);st.value=r.status;}else{r.status=st.value;st.dataset.status=st.value;toast(r.code+': '+st.value);}};h.append(st);
      it.append(h,el('p','bug-desc',r.description));if(r.route)it.append(el('small','muted','Tela: '+r.route));
      if(r.attachments?.length){const g=el('div','bug-files');it.append(g);for(const path of r.attachments){db.storage.from('orbita-files').createSignedUrl(path,3600).then(({data:s})=>{if(!s)return;const m=/\.(mp4|webm|mov)$/.test(path)?el('video'):el('img');m.src=s.signedUrl;if(m.tagName==='VIDEO')m.controls=true;else m.loading='lazy';const a=el('a','bug-thumb');a.href=s.signedUrl;a.target='_blank';a.rel='noopener';a.append(m);g.append(a);});}}
      box.append(it);}});}
  return {open,admin,isAdmin};
}
