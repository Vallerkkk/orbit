// Organiza o diálogo de Configurações em abas por categoria e troca listas de texto por controles visuais.
// Só reorganiza nós existentes (mesmos IDs e handlers); nada de backend novo.
const TABS=[
  ['perfil','Perfil','M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0'],
  ['aparencia','Aparência','M12 3a9 9 0 1 0 9 9c0-1-1-1.5-2-1.5h-2a2 2 0 0 1-2-2c0-1 .5-1.5.5-2.5S15 3 12 3Z'],
  ['voz','Voz e vídeo','M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0M12 19v2'],
  ['sons','Sons','M4 10v4h4l5 4V6L8 10H4Zm12-1a4 4 0 0 1 0 6'],
  ['avisos','Notificações','M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Zm4 4h4'],
  ['conta','Conta e ajuda','M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z'],
];
const RULES=[
  ['perfil',n=>n.matches('.profile-edit-card')],
  ['voz',n=>n.matches('.settings-audio-link')],
  ['voz',n=>/Entrada e saída de áudio|A redução de ruído|Manter a tela acesa|Big Picture/.test(n.textContent)],
  ['sons',n=>/Sons do aplicativo|Sons de avisos|Testar som/.test(n.textContent)],
  ['avisos',n=>/notificações|push|Instalar Órbita/i.test(n.textContent)],
  ['aparencia',n=>/^(Tema|Densidade|Aparência|Tamanho das mensagens|Reduzir animações|Conforto e acessibilidade)/.test(n.textContent.trim())],
];
const svgIcon=d=>{const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('aria-hidden','true');s.classList.add('st-ico');const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',d);s.append(p);return s;};
const DESC={perfil:'Como as pessoas veem você: identidade, foto, capa, cosméticos e insígnias. Tudo num só lugar.',aparencia:'Tema, densidade e conforto visual do aplicativo neste dispositivo.',voz:'Microfone, alto-falante, câmera e processamento de áudio das chamadas.',sons:'Sons do aplicativo e dos avisos.',avisos:'Notificações no navegador e instalação do app.',conta:'Sua conta, privacidade, atalhos e ajuda.'};
const tabFor=n=>{for(const [k,f] of RULES)try{if(f(n))return k;}catch{}return 'conta';};

function segment(select){
  if(select.dataset.stSeg||select.options.length<2||select.options.length>4||select.closest('.st-device'))return;
  select.dataset.stSeg='1';const seg=document.createElement('div');seg.className='st-seg';seg.setAttribute('role','radiogroup');
  const label=select.closest('label');if(label)seg.setAttribute('aria-label',label.firstChild?.textContent?.trim()||'Opção');
  const sync=()=>{for(const b of seg.children){const on=b.dataset.value===select.value;b.setAttribute('aria-checked',String(on));b.tabIndex=on?0:-1;}};
  for(const o of select.options){const b=document.createElement('button');b.type='button';b.setAttribute('role','radio');b.dataset.value=o.value;b.textContent=o.textContent.replace(/\s*·.*$/,'');b.title=o.textContent;
    b.onclick=()=>{select.value=o.value;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));sync();};seg.append(b);}
  seg.addEventListener('keydown',e=>{if(!/Arrow(Left|Right)/.test(e.key))return;const list=[...seg.children],i=list.findIndex(b=>b.getAttribute('aria-checked')==='true');const next=list[(i+(e.key==='ArrowRight'?1:-1)+list.length)%list.length];next.click();next.focus();e.preventDefault();});
  select.classList.add('st-native');select.tabIndex=-1;select.setAttribute('aria-hidden','true');select.after(seg);select.addEventListener('change',sync);sync();
}
function decorate(panel){
  for(const l of panel.querySelectorAll('label.check-field'))l.classList.add('st-toggle');
  for(const s of panel.querySelectorAll('select'))
    if(/Dispositivo de (entrada|saída)/.test(s.closest('label')?.textContent||'')){const l=s.closest('label');if(!l.classList.contains('st-device')){l.classList.add('st-device');l.prepend(svgIcon(/entrada/.test(l.textContent)?'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0M12 19v2':'M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H4zM17 14h3v6h-3z'));}}
    else segment(s);
  for(const r of panel.querySelectorAll('input[type=range]')){const f=()=>{const min=+r.min||0,max=+r.max||100;r.style.setProperty('--st-fill',((r.value-min)/(max-min)*100)+'%');};if(!r.dataset.stFill){r.dataset.stFill='1';r.addEventListener('input',f);}f();}
  for(const b of panel.querySelectorAll(':scope > button.soft-button, :scope > button.primary, :scope > button.danger'))b.classList.add('st-action');
}
function profileEditor(card){
  if(card.dataset.stDone)return;card.dataset.stDone='1';card.classList.add('st-profile');
  for(const input of card.querySelectorAll('input[type=file]')){const l=input.closest('label');if(!l)continue;l.classList.add('st-drop');const hint=document.createElement('span');hint.className='st-drop-hint';hint.append(svgIcon('M4 8h3l2-3h6l2 3h3v11H4z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8'),document.createTextNode(/banner/i.test(l.textContent)?'Arraste ou escolha a capa':'Arraste ou escolha a foto'));l.append(hint);
    l.addEventListener('dragover',e=>{e.preventDefault();l.classList.add('is-over');});l.addEventListener('dragleave',()=>l.classList.remove('is-over'));
    l.addEventListener('drop',e=>{e.preventDefault();l.classList.remove('is-over');if(!e.dataTransfer?.files?.length)return;input.files=e.dataTransfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));});
    input.addEventListener('change',()=>{const f=input.files?.[0];hint.lastChild.textContent=f?f.name:hint.lastChild.textContent;});}
  for(const c of card.querySelectorAll('input[type=color]')){if(c.dataset.stSw)continue;c.dataset.stSw='1';const row=document.createElement('div');row.className='st-swatches';row.setAttribute('role','group');row.setAttribute('aria-label','Cores sugeridas');
    for(const hex of ['#8b6cff','#5865f2','#e47fd0','#ff6fa8','#f59e0b','#22c55e','#06b6d4','#ef4444']){const b=document.createElement('button');b.type='button';b.className='st-swatch';b.style.background=hex;b.setAttribute('aria-label','Cor '+hex);b.onclick=()=>{c.value=hex;c.dispatchEvent(new Event('input',{bubbles:true}));c.dispatchEvent(new Event('change',{bubbles:true}));mark();};row.append(b);}
    const mark=()=>{for(const b of row.children)b.setAttribute('aria-pressed',String(b.getAttribute('aria-label').endsWith(c.value.toLowerCase())));};c.addEventListener('input',mark);mark();c.closest('label')?.append(row)||c.after(row);}
  const save=card.querySelector('button[type=submit]');if(save){save.closest('form,div')?.classList.add('st-has-sticky');save.classList.add('st-sticky-save');}
}
let applying=false;
function arrange(dialog){
  const body=dialog.querySelector('#dialog-content > .dialog-body');if(!body||applying)return;applying=true;
  try{
    let nav=body.querySelector(':scope > .st-nav'),wrap=body.querySelector(':scope > .st-panels');
    if(!nav){dialog.classList.add('st-dialog');body.classList.add('st-body');nav=document.createElement('nav');nav.className='st-nav';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Categorias');nav.setAttribute('aria-orientation','vertical');wrap=document.createElement('div');wrap.className='st-panels';
      const current=dialog.dataset.stStart||'perfil';delete dialog.dataset.stStart;
      for(const [key,label,icon] of TABS){const t=document.createElement('button');t.type='button';t.className='st-tab';t.id='st-tab-'+key;t.setAttribute('role','tab');t.setAttribute('aria-controls','st-panel-'+key);t.dataset.tab=key;t.append(svgIcon(icon),Object.assign(document.createElement('span'),{textContent:label}));nav.append(t);
        const p=document.createElement('section');p.className='st-panel';p.id='st-panel-'+key;p.setAttribute('role','tabpanel');p.setAttribute('aria-labelledby',t.id);const h=document.createElement('header');h.className='st-panel-title';const hi=document.createElement('span');hi.className='st-panel-ico';hi.append(svgIcon(icon));const ht=document.createElement('div');ht.append(Object.assign(document.createElement('h3'),{textContent:label}),Object.assign(document.createElement('p'),{textContent:DESC[key]||''}));h.append(hi,ht);p.append(h);wrap.append(p);}
      const select=key=>{for(const t of nav.children){const on=t.dataset.tab===key;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;wrap.querySelector('#st-panel-'+t.dataset.tab).hidden=!on;}wrap.scrollTop=0;};
      nav.addEventListener('click',e=>{const t=e.target.closest('.st-tab');if(t)select(t.dataset.tab);});
      nav.addEventListener('keydown',e=>{if(!/Arrow(Up|Down|Left|Right)/.test(e.key))return;const list=[...nav.children],i=list.indexOf(document.activeElement);if(i<0)return;const n=list[(i+(/Down|Right/.test(e.key)?1:-1)+list.length)%list.length];n.focus();n.click();e.preventDefault();});
      body.prepend(nav,wrap);select(TABS.some(t=>t[0]===current)?current:'perfil');}
    const content=body.parentElement;
    for(const n of [...body.children,...content.children]){if(n===nav||n===wrap||n===body)continue;if(n.tagName==='H3'&&/Conforto/.test(n.textContent)){n.remove();continue;}const k=tabFor(n);wrap.querySelector('#st-panel-'+k).append(n);}
    for(const p of wrap.children){decorate(p);const empty=p.children.length<=1;nav.querySelector(`[data-tab="${p.id.slice(9)}"]`).hidden=empty;}
    const card=wrap.querySelector('.profile-edit-card');if(card)profileEditor(card);
  }finally{applying=false;}
}
export function initSettingsLayout(){
  const dialog=document.getElementById('app-dialog');if(!dialog)return;let timer=0;
  const isSettings=()=>/^(Seu perfil e áudio|Configurações)$/.test((document.getElementById('dialog-title')?.textContent||'').trim());
  const run=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(dialog.open&&isSettings())arrange(dialog);else if(!isSettings()){dialog.classList.remove('st-dialog');if(dialog.open)for(const l of dialog.querySelectorAll('label.check-field:not(.st-toggle)'))l.classList.add('st-toggle','md-toggle');}},30);};
  new MutationObserver(run).observe(dialog,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
  // A janela "Editar perfil" fora das Configurações também ganha as zonas de arraste e as cores.
  new MutationObserver(()=>{for(const c of document.querySelectorAll('.profile-edit-card:not([data-st-done])'))profileEditor(c);}).observe(document.body,{childList:true,subtree:true});
}
