export function initAppUpdates(ctx){
  const desktop=!!window.orbitaDesktop||/Electron\/|OrbitaNative\//.test(navigator.userAgent);
  let current=document.querySelector('meta[name="orbita-version"]')?.content,checking=false,latest,notice,dismissed='';
  async function check(){if(checking||document.hidden||!navigator.onLine)return;checking=true;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);try{const response=await fetch('/api/version',{cache:'no-store',signal:controller.signal});if(!response.ok)return;const value=(await response.json()).version;if(typeof value!=='string'||value.length>80)return;if(!current){current=value;return;}if(value===current||value===latest)return;latest=value;if(value!==dismissed)show();}catch{}finally{clearTimeout(timeout);checking=false;}}
  // Recarregar sem ativar o worker que está esperando entregaria a casca antiga de novo:
  // ele só assume o controle quando a última aba fecha.
  async function applyUpdate(){const registration=await navigator.serviceWorker?.getRegistration?.().catch(()=>null);const waiting=registration?.waiting;
    if(waiting)await new Promise(resolve=>{navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true});waiting.postMessage({type:'SKIP_WAITING'});setTimeout(resolve,1500);});
    ctx.beforeReload();location.reload();}
  function reloadApp(){if(ctx.room()&&!confirm('Atualizar vai encerrar sua chamada. Deseja continuar?'))return;if(ctx.dirty()&&!confirm('Você tem conteúdo não enviado. Deseja atualizar mesmo assim?'))return;applyUpdate();}
  // "Mais tarde" precisa valer alguma coisa: sem registrar a recusa, a próxima vez que a
  // pessoa voltasse para a aba o app recarregava sozinho, perdendo rolagem e painéis.
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&latest&&latest!==dismissed&&!ctx.room()&&!ctx.dirty())applyUpdate();});
  window.addEventListener('keydown',event=>{if(desktop&&latest&&event.ctrlKey&&!event.altKey&&event.key.toLowerCase()==='r'){event.preventDefault();reloadApp();}});
  function show(){if(!notice||!notice.isConnected){notice=document.createElement('aside');notice.className='update-notice';notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');document.body.append(notice);}notice.replaceChildren();const text=document.createElement('p');text.textContent='Uma nova versão da Órbita está disponível. '+(desktop?'Pressione Ctrl + R para atualizar o aplicativo.':'Atualize a página para receber as melhorias.');const reload=document.createElement('button');reload.textContent='Atualizar agora';reload.onclick=reloadApp;const later=document.createElement('button');later.textContent='Mais tarde';later.onclick=()=>{dismissed=latest;notice.remove();};notice.append(text,reload,later);}
  let timer;const start=()=>{clearInterval(timer);timer=setInterval(check,5*60*1000);check();};document.addEventListener('visibilitychange',check);window.addEventListener('online',check);window.addEventListener('pagehide',()=>clearInterval(timer));window.addEventListener('pageshow',start);start();return {check};
}
