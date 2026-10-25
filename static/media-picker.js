// Seletor de mídia do chat: Emojis (Unicode completo, local, sob demanda), GIFs e Figurinhas (GIPHY via /api/media).
import {mediaToken} from './chat-media.js';
const GROUPS=[[0,'Carinhas','😀'],[1,'Pessoas','👋'],[3,'Animais e natureza','🐻'],[4,'Comidas','🍔'],[5,'Viagens e lugares','✈️'],[6,'Atividades','⚽'],[7,'Objetos','💡'],[8,'Símbolos','💜'],[9,'Bandeiras','🏳️']];
const TONES=['','🏻','🏼','🏽','🏾','🏿'],RECENT_KEY='orbita-emoji-recent',TONE_KEY='orbita-emoji-tone';
const norm=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function initMediaPicker({apiFetch,insert,send,anchor,toast}){
  const root=document.createElement('div');root.className='media-picker';root.id='media-picker';root.hidden=true;root.setAttribute('role','dialog');root.setAttribute('aria-label','Emojis, GIFs e figurinhas');
  const tabs=document.createElement('div');tabs.className='mp-tabs';tabs.setAttribute('role','tablist');
  const search=document.createElement('input');search.className='mp-search';search.type='search';search.id='media-picker-search';search.maxLength=50;search.autocomplete='off';
  const body=document.createElement('div');body.className='mp-body';const foot=document.createElement('div');foot.className='mp-foot';
  root.append(tabs,search,body,foot);(anchor.closest('.message-form-wrap')||document.body).append(root);
  let tab='emoji',data=null,tone=Number(localStorage.getItem(TONE_KEY)||0),timer,seq=0;
  const recents=()=>{try{return JSON.parse(localStorage.getItem(RECENT_KEY)||'[]').slice(0,24);}catch{return [];}};
  const remember=e=>localStorage.setItem(RECENT_KEY,JSON.stringify([e,...recents().filter(x=>x!==e)].slice(0,24)));
  const T={emoji:'Emojis',gifs:'GIFs',stickers:'Figurinhas'},buttons={};
  for(const k of Object.keys(T)){const b=document.createElement('button');b.type='button';b.className='mp-tab';b.textContent=T[k];b.id='mp-tab-'+k;b.setAttribute('role','tab');b.onclick=()=>select(k);tabs.append(b);buttons[k]=b;}
  const skin=(e,row)=>tone&&row[3]?row[3].split(',')[tone-1]||e:e;
  function emojiButton(e,label){const b=document.createElement('button');b.type='button';b.className='mp-emoji';b.textContent=e;b.title=label||e;b.setAttribute('aria-label',label||e);b.onclick=()=>{remember(e);insert(e);};return b;}
  function drawEmoji(){body.replaceChildren();if(!data){body.append(Object.assign(document.createElement('p'),{className:'mp-empty',textContent:'Carregando emojis…'}));import('./emoji-data.js').then(m=>{data=m.EMOJIS.map(r=>[...r,norm(r[2])]);if(tab==='emoji')drawEmoji();}).catch(()=>{body.textContent='Não foi possível carregar os emojis.';});return;}
    const q=norm(search.value.trim());const nav=document.createElement('div');nav.className='mp-cats';
    const section=(title,list,id)=>{const h=document.createElement('h4');h.textContent=title;h.id=id;const g=document.createElement('div');g.className='mp-grid';for(const [e,label]of list)g.append(emojiButton(e,label));body.append(h,g);};
    if(q){const found=data.filter(r=>r[4].includes(q)).slice(0,160).map(r=>[skin(r[0],r),r[2].split(' ')[0]]);if(!found.length)body.append(Object.assign(document.createElement('p'),{className:'mp-empty',textContent:'Nenhum emoji encontrado.'}));else section('Resultados',found,'mp-results');return;}
    const rec=recents();if(rec.length)section('Recentes',rec.map(e=>[e,e]),'mp-g-recent');
    for(const [g,name,icon]of GROUPS){const list=data.filter(r=>r[1]===g).map(r=>[skin(r[0],r),r[2].split(' ').slice(0,3).join(' ')]);section(name,list,'mp-g-'+g);const c=document.createElement('button');c.type='button';c.textContent=icon;c.title=name;c.setAttribute('aria-label',name);c.onclick=()=>document.getElementById('mp-g-'+g)?.scrollIntoView({block:'start'});nav.append(c);}
    const tones=document.createElement('div');tones.className='mp-tones';tones.setAttribute('aria-label','Tom de pele');for(const [i,t]of TONES.entries()){const b=document.createElement('button');b.type='button';b.textContent='👋'+t;b.setAttribute('aria-pressed',String(i===tone));b.title=i?'Tom '+i:'Padrão';b.onclick=()=>{tone=i;localStorage.setItem(TONE_KEY,String(i));drawEmoji();};tones.append(b);}
    foot.replaceChildren(nav,tones);}
  async function drawMedia(){const my=++seq,kind=tab,q=search.value.trim();body.replaceChildren(Object.assign(document.createElement('p'),{className:'mp-empty',textContent:'Carregando…'}));
    foot.replaceChildren(Object.assign(document.createElement('span'),{className:'mp-attrib',textContent:'Powered by GIPHY'}));
    try{const r=await apiFetch(q?`/api/media/search?type=${kind}&q=${encodeURIComponent(q)}`:`/api/media/trending?type=${kind}`);const j=await r.json();if(my!==seq)return;body.replaceChildren();
      if(!j.available){body.append(Object.assign(document.createElement('p'),{className:'mp-empty mp-unavailable',textContent:(kind==='gifs'?'GIFs':'Figurinhas')+' indisponíveis no momento. O servidor ainda não tem a chave do provedor configurada.'}));return;}
      if(!j.results.length){body.append(Object.assign(document.createElement('p'),{className:'mp-empty',textContent:'Nada encontrado.'}));return;}
      const g=document.createElement('div');g.className='mp-media-grid'+(kind==='stickers'?' mp-stickers':'');for(const item of j.results){const b=document.createElement('button');b.type='button';b.className='mp-media';b.setAttribute('aria-label',(kind==='gifs'?'Enviar GIF ':'Enviar figurinha ')+(item.title||''));const img=document.createElement('img');img.src=item.preview;img.loading='lazy';img.alt='';img.referrerPolicy='no-referrer';b.append(img);b.onclick=()=>{close();send(mediaToken(kind==='gifs'?'gif':'sticker',item));};g.append(b);}body.append(g);
    }catch(e){if(my===seq)body.replaceChildren(Object.assign(document.createElement('p'),{className:'mp-empty',textContent:e.message||'Não foi possível buscar agora.'}));}}
  function select(k){tab=k;for(const [n,b]of Object.entries(buttons)){b.setAttribute('aria-selected',String(n===k));b.classList.toggle('active',n===k);}search.value='';search.placeholder=k==='emoji'?'Buscar emoji (pt-BR ou inglês)':k==='gifs'?'Buscar GIFs no GIPHY':'Buscar figurinhas no GIPHY';search.setAttribute('aria-label',search.placeholder);foot.replaceChildren();k==='emoji'?drawEmoji():drawMedia();}
  search.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>tab==='emoji'?drawEmoji():drawMedia(),tab==='emoji'?60:350);};
  function close(){root.hidden=true;anchor.setAttribute('aria-expanded','false');}
  function open(){root.hidden=false;anchor.setAttribute('aria-expanded','true');select(tab);search.focus();}
  root.addEventListener('keydown',e=>{if(e.key==='Escape'){close();anchor.focus();}});
  document.addEventListener('pointerdown',e=>{if(!root.hidden&&!root.contains(e.target)&&!anchor.contains(e.target))close();});
  return {toggle:()=>root.hidden?open():close(),open,close,select};
}
// Windows (Segoe UI Emoji) não tem bandeiras nem emojis recentes e mostra caixas vazias: usa Noto Color Emoji
// (Google Fonts com unicode-range, baixa só os glifos usados) apenas no seletor e nas reações.
if(typeof navigator!=='undefined'&&/Windows/i.test(navigator.userAgent)&&!document.getElementById('emoji-font')){const l=document.createElement('link');l.id='emoji-font';l.rel='stylesheet';l.href='https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap';document.head.append(l);document.documentElement.classList.add('emoji-fallback');}
