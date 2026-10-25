// Spotify: conexão em Configurações > Conexões e bloco "Ouvindo no Spotify" nos perfis.
const LOGO='<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#1ed760"/><path d="M6.5 9.6c3.7-1.1 8-.8 11.2 1M7.2 12.6c3-.8 6.4-.6 9.1.9M7.8 15.4c2.4-.6 4.9-.4 7 .7" stroke="#000" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>';
const mmss=ms=>{const s=Math.max(0,Math.floor(ms/1000));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
export function createSpotify({session,el,button,toast}){
  const api=async(path,opts={})=>{const s=session();if(!s)throw Error('Entre na sua conta.');const r=await fetch('/api/spotify/'+path,{...opts,headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token,...(opts.headers||{})}});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.detail||'Spotify indisponível.');return j;};
  function settingsCard(){const card=el('section','spotify-connect');card.innerHTML='<div class="sp-head">'+LOGO+'<div><strong>Spotify</strong><small>Mostre o que você está ouvindo no seu perfil, como no Discord.</small></div></div>';const body=el('div','sp-body',' Carregando…');card.append(body);
    const paint=async()=>{let st;try{st=await api('status');}catch{st={enabled:false};}body.replaceChildren();
      if(!st.enabled){const b=button('Em breve',()=>{},'sp-btn');b.disabled=true;body.append(b,el('small','muted','A integração com Spotify ainda está sendo configurada no servidor.'));return;}
      if(!st.connected){body.append(button('Conectar Spotify',async()=>{try{const {url}=await api('login',{method:'POST'});location.href=url;}catch(e){toast(e.message);}},'sp-btn'));return;}
      const who=el('span','sp-who','Conectado'+(st.displayName?' como '+st.displayName:''));const t=el('label','check-field st-toggle sp-toggle'),cb=el('input');cb.type='checkbox';cb.checked=st.showOnProfile;cb.onchange=async()=>{try{await api('settings',{method:'POST',body:JSON.stringify({showOnProfile:cb.checked})});toast(cb.checked?'Spotify visível no perfil.':'Spotify oculto do perfil.');}catch(e){cb.checked=!cb.checked;toast(e.message);}};t.append(cb,document.createTextNode(' Mostrar no perfil'));
      body.append(who,t,button('Desconectar',async()=>{try{await api('disconnect',{method:'POST'});toast('Spotify desconectado.');paint();}catch(e){toast(e.message);}},'sp-btn ghost'));};
    paint();return card;}
  // Bloco ao vivo: consulta a cada ~30 s só enquanto visível; barra de progresso anda localmente.
  function block(userId){const box=el('div','sp-now');box.hidden=true;let data=null,timer=0,tick=0,visible=false;
    const render=()=>{if(!data?.playing){box.hidden=true;return;}box.hidden=false;box.innerHTML='';const head=el('div','sp-now-h');head.innerHTML=LOGO;head.append(el('span','','Ouvindo no Spotify'));
      const row=el('div','sp-now-row'),art=el('img','sp-art');art.alt='';art.src=data.art||'';art.loading='lazy';const info=el('div','sp-info');info.append(el('strong','',data.track||''),el('small','',data.artist||''));
      const bar=el('div','sp-bar'),fill=el('i'),times=el('div','sp-times'),a=el('span'),b=el('span',"",mmss(data.durationMs));bar.append(fill);times.append(a,b);info.append(bar,times);row.append(art,info);
      const open=el('a','sp-open','Abrir no Spotify');open.href=data.url||'https://open.spotify.com';open.target='_blank';open.rel='noopener';box.append(head,row,open);
      const step=()=>{const p=Math.min(data.durationMs,data.progressMs+(Date.now()-data.seenAt));fill.style.width=(data.durationMs?p/data.durationMs*100:0)+'%';a.textContent=mmss(p);};clearInterval(tick);tick=setInterval(()=>{if(!box.isConnected)return stop();step();},1000);step();};
    const poll=async()=>{if(!box.isConnected)return stop();if(!visible||document.hidden)return;try{data=await api('now-playing/'+userId);data.seenAt=Date.now();}catch{data=null;}render();};
    const abort=new AbortController();
    const stop=()=>{clearInterval(timer);clearInterval(tick);io.disconnect();abort.abort();};
    const io=new IntersectionObserver(es=>{const v=es.some(e=>e.isIntersecting);if(v&&!visible){visible=true;poll();}visible=v;});
    requestAnimationFrame(()=>{io.observe(box.parentElement||box);});timer=setInterval(poll,30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&visible)poll();},{signal:abort.signal});return box;}
  return {settingsCard,block};
}
