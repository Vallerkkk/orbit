// Botão de canais e conversas: no computador recolhe/expande a barra lateral (estado salvo);
// em telas de gaveta (≤780px) abre e fecha a gaveta. Toque fora fecha (tratado em app.js).
const KEY='orbita-sidebar-collapsed',drawer=matchMedia('(max-width:780px)');
const SEL='.mobile-nav-btn,#mobile-menu-btn,#call-navigation';
let collapsed=localStorage.getItem(KEY)==='1';
function layout(){
  const app=document.querySelector('.app'),side=app?.querySelector(':scope>.sidebar');if(!app||!side)return;
  app.style.removeProperty('grid-template-columns');
  const on=collapsed&&!drawer.matches;document.body.classList.toggle('sidebar-collapsed',on);
  if(!on)return;
  // Remove a trilha da barra lateral do grid atual e entrega o espaço ao conteúdo principal.
  document.body.classList.remove('sidebar-collapsed');
  const tracks=getComputedStyle(app).gridTemplateColumns.split(' ');
  const flow=[...app.children].filter(n=>{const s=getComputedStyle(n);return s.display!=='none'&&s.position!=='fixed'&&s.position!=='absolute';});
  const i=flow.indexOf(side);document.body.classList.add('sidebar-collapsed');
  if(i<0||tracks.length<=i+1)return;tracks.splice(i,2,'minmax(0,1fr)');app.style.gridTemplateColumns=tracks.join(' ');
}
export function syncSidebarButtons(){
  const mobileOpen=document.body.classList.contains('mobile-menu-open');
  for(const b of document.querySelectorAll(SEL)){
    let open,label;
    if(drawer.matches){open=mobileOpen;label=open?'Fechar canais e conversas':'Abrir canais e conversas';}
    else{open=!collapsed;label=open?'Ocultar canais e conversas':'Mostrar canais e conversas';}
    b.setAttribute('aria-expanded',String(open));b.classList.toggle('sidebar-shown',open);
    if(b.getAttribute('aria-label')!==label){b.title=label;b.dataset.tip=label;b.setAttribute('aria-label',label);}
  }
}
export function setSidebarCollapsed(value){collapsed=!!value;localStorage.setItem(KEY,collapsed?'1':'0');layout();syncSidebarButtons();}
export function initSidebarToggle(){
  document.addEventListener('click',e=>{const b=e.target instanceof Element&&e.target.closest(SEL);if(!b||drawer.matches)return;
    e.preventDefault();e.stopImmediatePropagation();setSidebarCollapsed(!collapsed);},true);
  document.addEventListener('click',()=>requestAnimationFrame(syncSidebarButtons));
  drawer.addEventListener('change',()=>{if(!drawer.matches)document.body.classList.remove('mobile-menu-open');layout();syncSidebarButtons();});
  let busy=false;new MutationObserver(()=>{if(busy)return;busy=true;requestAnimationFrame(()=>{busy=false;syncSidebarButtons();});}).observe(document.body,{attributes:true,attributeFilter:['class'],childList:true,subtree:true});
  addEventListener('resize',()=>{if(collapsed)layout();});
  layout();syncSidebarButtons();
}
