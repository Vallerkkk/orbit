// YouTube no Órbita com backend mockado: trilho, Início, busca, página do vídeo, mini player sobre o chat,
// cartão leve no chat, conta Google conectada (Inscrições) e mobile. Gera screenshots em /workspace/redesign-shots.
const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub}=require('./fixtures/supabase_fixture.cjs');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const shots='/workspace/redesign-shots';fs.mkdirSync(shots,{recursive:true});
const base=process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/';
const COLORS=['#7a4fb0','#2f7f8f','#b0823a','#3a5fb0','#4f8f3a','#b03a55','#5a4fb0','#2f8f6a','#b06a3a','#8f3a8f'];
const titles=['Construí um sintetizador modular com sucata de rádio antigo','Lo-fi para programar até de madrugada — mix de 3 horas','Speedrun de “Cavernas de Âmbar” em 41 minutos','Por que as cidades flutuantes de Vênus fazem sentido','Receita: pão de fermentação natural em 24h, sem drama','Ao vivo: Festival Maré Alta — palco principal','Teclados mecânicos baratos testados por 6 meses','Resumo da semana: rede elétrica solar chega ao interior','Montei um jardim vertical na varanda do apê','Guitarra em 30 dias: dia 12 — pestana sem dor','O mistério do farol que acende sozinho','Testei o patinete mais estranho da feira de tecnologia'];
const chans=['Oficina Ruído Branco','Estação Nebulosa','Pixel Ligeiro','Astronomia de Bolso','Cozinha do Teo','Maré Alta TV','Bancada Digital','Jornal Órbita Sul','Verde em Casa','Acorde Livre','Contos da Costa','Bancada Digital'];
const id=i=>('vid'+String(i).padStart(2,'0')+'abcdefgh').slice(0,11);
const vid=i=>({id:id(i),title:titles[i%12],channelId:'UC'+String(i%12).padStart(22,'x'),channelTitle:chans[i%12],thumb:`https://i.ytimg.com/vi/${id(i)}/hqdefault.jpg`,published:new Date(Date.now()-(i+1)*3.6e6*7).toISOString(),description:'Vênus é um inferno na superfície, mas a 50 km de altura a pressão e a temperatura são parecidas com as da Terra.\nNeste vídeo exploramos como seria viver lá.',duration:[1102,10931,2467,1335,870,0,1673,669,588,980,1984,757][i%12],views:[2100,812000,356000,1400000,98000,12000,640000,211000,45000,77000,2900000,503000][i%12],likes:48000,comments:2318,live:i%12===5});
const VIDS=Array.from({length:12},(_,i)=>vid(i));
function api(url,state){const u=new URL(url),p=u.pathname;
 if(p.endsWith('/status'))return {available:true,oauth:true,message:''};
 if(p.endsWith('/me'))return state.connected?{oauth:true,connected:true,profile:{name:'Kalil G.',email:'kalil@exemplo.com',picture:''}}:{oauth:true,connected:false};
 if(p.endsWith('/trending'))return {items:VIDS,next:''};
 if(p.endsWith('/search'))return {videos:VIDS.slice(0,6),channels:[{id:'UC'+'3'.padStart(22,'x'),title:'Astronomia de Bolso',thumb:'',description:'Ciência do espaço em linguagem simples.',subscribers:1200000,videos:210,handle:'@astrobolso',uploads:''}],playlists:[{id:'PLabcdefghij',title:'Planetas em 10 minutos',channelTitle:'Astronomia de Bolso',thumb:VIDS[3].thumb,count:12,description:''}],next:''};
 if(p.endsWith('/videos')){const ids=(u.searchParams.get('id')||'').split(',');return {items:VIDS.filter(v=>ids.includes(v.id))};}
 if(p.endsWith('/comments'))return {items:[{id:'c1',author:'Lia Moraes',avatar:'',text:'A parte das estufas nas nuvens é sensacional!',likes:320,published:new Date(Date.now()-2*864e5).toISOString(),replies:4},{id:'c2',author:'Bruno T.',avatar:'',text:'Faltou falar do ácido sulfúrico, mas adorei.',likes:41,published:new Date(Date.now()-864e5).toISOString(),replies:0}],next:''};
 if(p.endsWith('/channel'))return {channel:{id:u.searchParams.get('id'),title:'Astronomia de Bolso',thumb:'',description:'Ciência do espaço.',subscribers:1200000,videos:210,handle:'@astrobolso',uploads:'UU1'},items:VIDS.slice(2,8),next:''};
 if(p.endsWith('/playlist'))return {playlist:{id:'PLabcdefghij',title:'Planetas',channelTitle:'Astronomia de Bolso',count:6},items:VIDS.slice(0,6),next:''};
 if(p.endsWith('/mine/subscriptions'))return {channels:chans.slice(0,5).map((t,i)=>({id:'UC'+String(i).padStart(22,'x'),title:t,thumb:''})),items:VIDS.slice(3,11)};
 if(p.endsWith('/oauth/start'))return {url:base+'?youtube=conectado'};
 if(p.endsWith('/oauth/finish')){state.connected=true;return {connected:true,profile:{email:'kalil@exemplo.com'}};}
 if(p.endsWith('/oauth/logout')){state.connected=false;state.logouts++;return {connected:false};}
 return {items:[]};}
const svgFor=url=>{const n=[...url].reduce((a,c)=>a+c.charCodeAt(0),0),c=COLORS[n%COLORS.length];return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><defs><radialGradient id="g" cx="35%" cy="40%"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="#14151b"/></radialGradient></defs><rect width="480" height="270" fill="url(#g)"/><circle cx="330" cy="120" r="70" fill="${c}" opacity=".55"/></svg>`;};
function fakeYT(){window.YT={Player:class{constructor(el,o){const slot=document.getElementById(el),f=document.createElement('iframe');f.id=el;f.src='https://www.youtube.com/embed/'+o.videoId;slot.replaceWith(f);this.f=f;this.t=0;this.s=-1;window.__yt=this;window.__ytVideo=o.videoId;this.o=o;setTimeout(()=>{o.events.onReady({target:this});},50);}
 playVideo(){this.s=1;this.o.events.onStateChange({data:1});}pauseVideo(){this.s=2;this.o.events.onStateChange({data:2});}loadVideoById(x){window.__ytVideo=x.videoId;this.playVideo();}getCurrentTime(){return 504;}getDuration(){return 1335;}getPlayerState(){return this.s;}destroy(){this.f.remove();}}};}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});const report={};
 for(const [label,width,height,mobile] of [['desktop',1440,900,false],['mobile',390,844,true]]){
  const state={connected:false,logouts:0},ctx=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});
  await ctx.addInitScript(fakeYT);
  const myStub=stub.replace('"Mensagem de teste 69"','"olha esse que eu falei https://youtu.be/'+id(3)+'"');
  await ctx.route('**/*',route=>{const url=route.request().url();
   if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:myStub});
   if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'anon'}});
   if(url.includes('/api/youtube/'))return route.fulfill({json:api(url,state)});
   if(url.startsWith('https://i.ytimg.com/'))return route.fulfill({contentType:'image/svg+xml',body:svgFor(url)});
   if(url.startsWith('https://www.youtube.com/'))return route.fulfill({contentType:'text/html',body:'<html><body style="margin:0;height:100vh;background:radial-gradient(circle at 62% 42%,#e0a845 0 16%,transparent 17%),radial-gradient(circle at 25% 35%,#3c4fa0,#14162a 55%,#090a10)"></body></html>'});
   return route.continue();});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'networkidle'});await page.locator('#message-list .message').first().waitFor();
  const profileBefore=await page.evaluate(()=>JSON.stringify(window.__qaData.profiles[0]));
  // Cartão leve no chat: só miniatura, sem iframe até o clique
  const chatCard=page.locator('.yt-chat-card').first();await chatCard.waitFor();await chatCard.scrollIntoViewIfNeeded();
  await page.locator('.yt-chat-card .ytc-title',{hasText:'Vênus'}).waitFor();assert.equal(await chatCard.locator('iframe').count(),0);
  if(label==='desktop')await page.screenshot({path:path.join(shots,'full-youtube-chat-card.png')});
  if(label==='desktop'){await page.locator('#server-rail').screenshot({path:path.join(shots,'full-rail-novos-membros-icon.png')});
   const icons=await page.evaluate(()=>({members:document.querySelector('#members-nav svg').innerHTML,friends:document.querySelector('#friends-nav').innerHTML}));assert(!icons.members.includes('M19 3v4'),'ícone antigo (pessoa+) removido');}
  // Trilho → YouTube
  if(mobile){await page.evaluate(()=>document.querySelector('#youtube-nav').click());}else await page.locator('#youtube-nav').click();
  await page.locator('#youtube-view:not([hidden]) .yt-card').first().waitFor();assert.equal(await page.locator('#members-sidebar').isVisible(),false);
  assert.equal(await page.locator('#youtube-nav').getAttribute('aria-current'),'page');
  await page.waitForTimeout(200);await page.screenshot({path:path.join(shots,label==='desktop'?'full-youtube-home.png':'full-youtube-mobile.png')});
  // Busca
  await page.locator('.yt-search input').fill('vênus');await page.locator('.yt-search input').press('Enter');await page.locator('.yt-chan-row').waitFor();
  assert.equal(await page.locator('.yt-results .yt-rel').count(),7);if(label==='desktop')await page.screenshot({path:path.join(shots,'full-youtube-search.png')});
  // Página do vídeo
  await page.locator('.yt-results .yt-rel:not(.yt-pl-row)').nth(3).click();await page.locator('.yt-w-title',{hasText:'Vênus'}).waitFor();await page.locator('.yt-cmt').first().waitFor();await page.locator('.yt-w-side .yt-rel').first().waitFor();
  assert.equal(await page.evaluate(()=>window.__ytVideo),id(3));assert(await page.locator('.yt-dock.docked').isVisible());
  await page.waitForTimeout(200);if(label==='desktop')await page.screenshot({path:path.join(shots,'full-youtube-watch.png')});else await page.screenshot({path:path.join(shots,'full-youtube-mobile-watch.png')});
  // Assistir depois (Supabase com RLS) e histórico gravados
  await page.locator('.yt-w-actions button',{hasText:'Assistir depois'}).click();await page.waitForTimeout(100);
  const lib=await page.evaluate(()=>window.__qaData.youtube_library||[]);assert(lib.some(r=>r.kind==='later'&&r.video_id==='vid03abcdef'));assert(lib.some(r=>r.kind==='history'));
  // Mini player continua tocando ao voltar para o chat
  if(mobile)await page.evaluate(()=>document.querySelector('#rail-servers-list .server-icon')?.click());
  else await page.locator('#rail-servers-list .server-icon').first().click();
  await page.locator('#message-list .message').first().waitFor();await page.locator('.yt-dock.mini').waitFor();
  assert.equal(await page.evaluate(()=>!!document.querySelector('.yt-dock iframe')&&window.__yt.s),1);
  await page.waitForTimeout(150);await page.screenshot({path:path.join(shots,label==='desktop'?'full-youtube-miniplayer.png':'full-youtube-mobile-miniplayer.png')});
  await page.locator('.yt-dock button[aria-label="Pausar"]').click();assert.equal(await page.evaluate(()=>window.__yt.s),2);
  await page.locator('.yt-dock button[aria-label="Próximo vídeo"]').click();await page.waitForTimeout(50);assert.notEqual(await page.evaluate(()=>window.__ytVideo),id(3));
  await page.locator('.yt-dock button[aria-label="Expandir"]').click();await page.locator('.yt-dock.docked').waitFor();
  await page.locator('.yt-dock button[aria-label="Fechar player"]').evaluate(b=>b.click());await page.waitForTimeout(50);assert.equal(await page.locator('.yt-dock').isVisible(),false);
  // 'Assistir aqui' no cartão do chat abre o mini player
  if(label==='desktop'){await page.locator('#rail-servers-list .server-icon').first().click();await page.locator('.yt-chat-card .ytc-btn',{hasText:'Assistir aqui'}).first().click();await page.locator('.yt-dock.mini').waitFor();
   await page.locator('.yt-chat-card .ytc-media').first().click();assert.equal(await page.locator('.yt-chat-card iframe.ytc-frame').count(),1);
   // Conectar Google (fluxo mockado) e Inscrições; desconectar não toca o perfil do Órbita
   await page.locator('#youtube-nav').click();await page.locator('.yt-google').click();await page.waitForURL(/youtube=conectado|\/$/);await page.locator('#message-list .message, #youtube-view .yt-card').first().waitFor();
   await page.locator('#youtube-view:not([hidden]) .yt-h',{hasText:'Inscrições'}).waitFor();await page.locator('.yt-sub').first().waitFor();
   assert.equal(await page.evaluate(()=>new URL(location.href).searchParams.has('youtube')),false);
   await page.waitForTimeout(200);await page.screenshot({path:path.join(shots,'full-youtube-subscriptions.png')});
   await page.locator('.yt-acct summary').click();await page.locator('.yt-acct-menu button',{hasText:'Sair da conta Google'}).click();await page.locator('.yt-google').waitFor();assert.equal(state.logouts,1);
   assert.equal(await page.evaluate(()=>JSON.stringify(window.__qaData.profiles[0])),profileBefore,'perfil do Órbita intacto');}
  assert.deepEqual(errors,[]);report[label]='ok';await ctx.close();
 }
 console.log(JSON.stringify(report));await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
