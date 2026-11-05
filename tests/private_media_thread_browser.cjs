// Executa o renderer servido (fonte ou build), com Supabase e fullscreen nos limites.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub:baseStub,USER,OTHER,TEXT,TEXT2}=require('./fixtures/supabase_fixture.cjs');
const base=process.env.ORBITA_TEST_URL||process.argv.find(v=>/^https?:\/\//.test(v))||'http://127.0.0.1:9001/static/index.html';
const ROOT='aaaaaaaa-aaaa-4aaa-8aaa-000000000001',ROOT2='aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const DM='dddddddd-dddd-4ddd-8ddd-000000000001';
const fixture=baseStub+`;
data.messages[0].id='${ROOT}';data.messages[0].content='Raiz privada um';
data.messages[1].id='${ROOT2}';data.messages[1].content='Raiz privada dois';
for(const [i,root] of ['${ROOT}','${ROOT2}'].entries())data.messages.push({...data.messages.at(-1),id:'eeeeeeee-eeee-4eee-8eee-'+String(i+1).padStart(12,'0'),content:'Resposta privada '+(i+1),thread_root:root,attachments:null});
const video={...data.messages[2],id:'ffffffff-ffff-4fff-8fff-000000000001',created_at:new Date().toISOString(),content:'Vídeo privado',attachments:{id:'ffffffff-ffff-4fff-8fff-000000000002',owner_id:'${USER}',channel_id:'${TEXT}',conversation_id:null,storage_path:'channels/${TEXT}/${USER}/video.webm',name:'video.webm',mime_type:'video/webm',size:4096}};
data.messages.push(video);data.attachments.push(video.attachments);
data.conversations.push({id:'${DM}',user_a:'${USER}',user_b:'${OTHER}',created_at:new Date().toISOString()});
data.direct_messages=[{...data.messages[0],channel_id:null,conversation_id:'${DM}'},{...data.messages.at(-3),channel_id:null,conversation_id:'${DM}'}];
const originalCreateClient=createClient;
createClient=function(...args){const client=originalCreateClient(...args),from=client.from.bind(client),remove=client.removeChannel.bind(client),storage=client.storage.from.bind(client.storage);
 client.from=table=>{const q=from(table),eq=q.eq.bind(q),then=q.then.bind(q);let root;
  q.eq=(column,value)=>{if(column==='id'&&['${ROOT}','${ROOT2}'].includes(value))root=value;return eq(column,value);};
  q.then=(resolve,reject)=>then(async result=>{if(root&&window.__qaHoldRoot){window.__qaHoldRoot=false;await new Promise(done=>window.__qaReleaseRoot=()=>{delete window.__qaReleaseRoot;done();});}return result;}).then(resolve,reject);return q;};
 client.removeChannel=channel=>{if(!window.__qaHoldCleanup)return remove(channel);return new Promise(resolve=>{(window.__qaCleanupTasks||=[]).push(()=>remove(channel).then(resolve));});};
 client.storage.from=bucket=>{const api=storage(bucket);api.createSignedUrl=async()=>({data:{signedUrl:'/qa-private-video.webm'},error:null});return api;};return client;};`;
let browser,movie;
before(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 const page=await browser.newPage();
 const encoded=await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
  const ctx=canvas.getContext('2d'),stream=canvas.captureStream(10),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),parts=[];
  recorder.ondataavailable=e=>parts.push(e.data);const done=new Promise(resolve=>recorder.onstop=resolve);recorder.start(100);
  let frame=0;const timer=setInterval(()=>{ctx.fillStyle=frame++%2?'#754bdf':'#18a58c';ctx.fillRect(0,0,320,180);},80);
  await new Promise(resolve=>setTimeout(resolve,1000));recorder.stop();await done;clearInterval(timer);stream.getTracks().forEach(track=>track.stop());
  const reader=new FileReader();return new Promise(resolve=>{reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(new Blob(parts,{type:'video/webm'}));});
 });movie=Buffer.from(encoded,'base64');await page.close();
});
after(async()=>{await browser?.close();});
async function open(t){
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});t.after(()=>context.close());
 await context.addInitScript(()=>{
  // Só a API de fullscreen é simulada; reprodução/pausa/clone/dialog são reais.
  HTMLVideoElement.prototype.requestFullscreen=function(){
   if(window.__qaFullscreenMode==='native'){window.__qaFullscreenElement=this;return Promise.resolve();}
   if(window.__qaFullscreenMode==='pending')return new Promise((resolve,reject)=>{window.__qaRejectFullscreen=()=>{delete window.__qaRejectFullscreen;reject(new DOMException('Negado','NotAllowedError'));};window.__qaResolveFullscreen=()=>{window.__qaFullscreenElement=this;delete window.__qaResolveFullscreen;resolve();};});
   return Promise.reject(new DOMException('Negado','NotAllowedError'));
  };
  HTMLVideoElement.prototype.webkitEnterFullscreen=undefined;
  Object.defineProperty(document,'fullscreenElement',{get:()=>window.__qaFullscreenElement||null});
  document.exitFullscreen=async()=>{window.__qaFullscreenElement=null;};
 });
 await context.route('**/*',route=>{const url=route.request().url();
  if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:fixture});
  if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public-qa',callsConfigured:false,storageConfigured:true,pushConfigured:false}});
  if(url.endsWith('/qa-private-video.webm'))return route.fulfill({contentType:'video/webm',body:movie});
  if(!url.startsWith(new URL(base).origin+'/'))return route.abort();return route.continue();
 });
 const page=await context.newPage(),errors=[],scripts=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(/\/static\/(?:dist\/)?app[^/]*\.js/.test(r.url()))scripts.push(r.url());});
 await page.goto(base,{waitUntil:'networkidle'});await ready(page);
 const entry=await page.locator('script[type="module"][src]').evaluate(n=>n.src);assert(scripts.includes(entry),'Usar a entrada real do HTML, sem importar outra instância');
 return {page,errors};
}
async function ready(page){await page.waitForFunction(()=>!document.querySelector('#app-view').hidden&&document.querySelector('#message-list').getAttribute('aria-busy')==='false'&&document.querySelectorAll('#message-list .message').length>0&&window.__qaSubscriptions?.some(s=>s.name.startsWith('user:')&&!s.removed));}
async function settle(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));}
async function search(page){await page.locator('#search-messages').fill('Resposta privada');await page.locator('#search-messages').press('Enter');await page.locator('.search-result').first().waitFor();}
async function pendingRoot(page){await search(page);await page.evaluate(()=>window.__qaHoldRoot=true);await page.locator('.search-result').filter({hasText:'Resposta privada 1'}).getByRole('button',{name:'Abrir thread',exact:true}).click();await page.waitForFunction(()=>!!window.__qaReleaseRoot);}
async function releaseRoot(page){await page.evaluate(()=>window.__qaReleaseRoot());await settle(page);}
async function auth(page,id){await page.evaluate(id=>{const next=id?{user:{id,user_metadata:{display_name:id===window.__qaData.profiles[0].id?'Pessoa de teste':'Outra pessoa'}},access_token:'qa-next'}:null;window.__qaSession=next;window.__qaAuthCallback(id?'SIGNED_IN':'SIGNED_OUT',next);},id);}
async function switchChannel(page,id){await page.locator('[data-channel-id="'+id+'"]').first().click();await page.waitForFunction(id=>document.querySelector('[data-channel-id="'+id+'"].active')&&document.querySelector('#message-list').getAttribute('aria-busy')==='false',id);}
async function assertNoThread(page,errors){assert.equal(await page.locator('.feature-panel[aria-label="Thread"]').count(),0,'Resposta atrasada não pode abrir uma thread privada');assert.deepEqual(errors,[]);}
for(const mode of ['logout','conta A→B','canal A→B','canal A→B→A','logout/login mesma conta','conta A→B→A','fechar painel','abrir novo painel'])test('raiz em await é invalidada por '+mode,async t=>{
 const {page,errors}=await open(t);await pendingRoot(page);
 if(mode==='logout'){await auth(page,null);await page.locator('#auth-view').waitFor({state:'visible'});}
 if(mode==='conta A→B'){await auth(page,OTHER);await ready(page);await page.waitForFunction(()=>document.querySelector('#user-name').textContent==='Outra pessoa');}
 if(mode==='canal A→B'||mode==='canal A→B→A'){await switchChannel(page,TEXT2);if(mode.endsWith('→A'))await switchChannel(page,TEXT);}
 if(mode==='logout/login mesma conta'){await auth(page,null);await page.locator('#auth-view').waitFor({state:'visible'});await auth(page,USER);await ready(page);}
 if(mode==='conta A→B→A'){await auth(page,OTHER);await page.waitForFunction(()=>document.querySelector('#user-name').textContent==='Outra pessoa'&&!document.querySelector('#app-view').hidden);await ready(page);await auth(page,USER);await page.waitForFunction(()=>document.querySelector('#user-name').textContent==='Pessoa de teste'&&!document.querySelector('#app-view').hidden);await ready(page);}
 if(mode==='fechar painel')await page.getByRole('button',{name:'Fechar Buscar mensagens',exact:true}).click();
 if(mode==='abrir novo painel'){await page.locator('#search-messages').fill('Mensagem de teste');await page.locator('#search-messages').press('Enter');await page.locator('.search-result').filter({hasText:'Mensagem de teste'}).first().waitFor();}
 await releaseRoot(page);await assertNoThread(page,errors);
 if(mode==='abrir novo painel')assert.equal(await page.locator('.feature-panel[aria-label="Buscar mensagens"]').count(),1,'Painel novo não deve ser substituído');
});
test('thread normal abre raiz/respostas com leitura limitada ao canal e fecha',async t=>{
 const {page,errors}=await open(t);await search(page);await page.locator('.search-result').filter({hasText:'Resposta privada 1'}).getByRole('button',{name:'Abrir thread',exact:true}).click();
 await page.locator('.thread-message').filter({hasText:'Raiz privada um'}).waitFor();await page.locator('.thread-replies').getByText('Resposta privada 1',{exact:true}).waitFor();
 const reads=await page.evaluate(ROOT=>window.__qaQueries.filter(q=>q.table==='messages'&&q.filters.some(([k,c,v])=>k==='eq'&&c==='id'&&v===ROOT)),ROOT);
 assert(reads.some(q=>q.filters.some(([k,c,v])=>k==='eq'&&c==='channel_id'&&v===TEXT)),'Root deve ser lido apenas no canal selecionado');
 await page.getByRole('button',{name:'Fechar Thread',exact:true}).click();await assertNoThread(page,errors);
});
test('thread normal em DM limita leitura à conversa',async t=>{
 const {page,errors}=await open(t);await page.locator('#friends-nav').click();await switchChannel(page,DM);await search(page);await page.getByRole('button',{name:'Abrir thread',exact:true}).click();await page.locator('.thread-message').filter({hasText:'Raiz privada um'}).waitFor();
 const reads=await page.evaluate(ROOT=>window.__qaQueries.filter(q=>q.table==='direct_messages'&&q.filters.some(([k,c,v])=>k==='eq'&&c==='id'&&v===ROOT)),ROOT);
 assert(reads.some(q=>q.filters.some(([k,c,v])=>k==='eq'&&c==='conversation_id'&&v===DM)),'Root deve ser lido apenas na DM selecionada');assert.deepEqual(errors,[]);
});
test('request antigo não substitui uma thread mais recente',async t=>{
 const {page,errors}=await open(t);await pendingRoot(page);await page.locator('.search-result').filter({hasText:'Resposta privada 2'}).getByRole('button',{name:'Abrir thread',exact:true}).click();await page.locator('.thread-message').filter({hasText:'Raiz privada dois'}).waitFor();
 await releaseRoot(page);assert.equal(await page.locator('.thread-message').filter({hasText:'Raiz privada um'}).count(),0);assert.equal(await page.locator('.thread-message').filter({hasText:'Raiz privada dois'}).count(),1);assert.deepEqual(errors,[]);
});
async function video(page){
 const v=page.locator('#message-list video.uploaded-video');await v.waitFor();await v.evaluate(v=>{v.loop=true;v.scrollIntoView({block:'center'});});
 await page.waitForFunction(()=>{const v=document.querySelector('#message-list video.uploaded-video');return v.readyState>=2&&!v.paused&&v.currentTime>0;});
 await page.locator('#message-list .video-enlarge').waitFor();return v.elementHandle();
}
async function lightbox(page){await page.locator('#message-list .video-enlarge').click();await page.locator('dialog.video-lightbox[open] video').waitFor();const large=await page.locator('dialog.video-lightbox video').elementHandle();await large.evaluate(v=>v.loop=true);await page.waitForFunction(()=>{const v=document.querySelector('dialog.video-lightbox video');return v.readyState>=2&&!v.paused&&v.currentTime>0;});return large;}
async function assertReleased(handle,label){assert.deepEqual(await handle.evaluate(v=>({connected:v.isConnected,paused:v.paused,src:v.getAttribute('src')})),{connected:false,paused:true,src:null},label);}
for(const id of [null,OTHER])test('lightbox privado é limpo antes de await no auth '+(id?'A→B':'logout'),async t=>{
 const {page,errors}=await open(t),original=await video(page),large=await lightbox(page);
 await page.evaluate(()=>window.__qaHoldCleanup=true);await auth(page,id);await page.waitForFunction(()=>document.querySelector('#app-view').hidden);
 assert.equal(await page.locator('dialog.video-lightbox').count(),0,'Clone privado não pode permanecer no body durante limpeza assíncrona');await assertReleased(large,'Clone deve parar e perder a fonte');await assertReleased(original,'Original também deve ser descartado');
 await page.evaluate(()=>{window.__qaHoldCleanup=false;for(const task of window.__qaCleanupTasks||[])task();});await settle(page);await assertReleased(original,'Evento close antigo não deve reiniciar vídeo');assert.deepEqual(errors,[]);
});
for(const outcome of ['reject','resolve'])test('fullscreen pendente '+outcome+' após logout não revive vídeo/fallback',async t=>{
 const {page,errors}=await open(t),original=await video(page);await page.evaluate(()=>window.__qaFullscreenMode='pending');await page.locator('#message-list .video-enlarge').click();await page.waitForFunction(()=>!!window.__qaRejectFullscreen);
 await auth(page,null);await page.locator('#auth-view').waitFor({state:'visible'});await page.evaluate(outcome=>outcome==='reject'?window.__qaRejectFullscreen():window.__qaResolveFullscreen(),outcome);await settle(page);
 assert.equal(await page.locator('dialog.video-lightbox').count(),0,'Fullscreen antigo não deve criar fallback após logout');assert.equal(await page.evaluate(()=>!!document.fullscreenElement),false,'Fullscreen concluído tarde deve ser encerrado');await assertReleased(original,'Vídeo antigo descartado');assert.deepEqual(errors,[]);
});
test('fallback normal fecha e retoma só o vídeo que tocava',async t=>{
 const {page,errors}=await open(t),original=await video(page),large=await lightbox(page);
 await large.evaluate(v=>v.pause());await page.getByRole('button',{name:'Fechar vídeo',exact:true}).click();await settle(page);
 assert.equal(await page.locator('dialog.video-lightbox').count(),0);assert(await original.evaluate(v=>v.isConnected&&!v.paused),'Fechamento normal deve retomar o original');assert.equal(await large.evaluate(v=>v.paused&&!v.isConnected),true);
 await original.evaluate(v=>v.pause());await page.locator('#message-list .video-enlarge').click();await page.locator('dialog.video-lightbox[open]').waitFor();assert.equal(await page.locator('dialog.video-lightbox video').evaluate(v=>v.paused),true);
 await page.getByRole('button',{name:'Fechar vídeo',exact:true}).click();await settle(page);assert.equal(await original.evaluate(v=>v.paused),true,'Fechar não deve retomar vídeo que já estava pausado');assert.deepEqual(errors,[]);
});
test('fullscreen normal usa navegador sem abrir clone',async t=>{
 const {page,errors}=await open(t),original=await video(page);await page.evaluate(()=>window.__qaFullscreenMode='native');await page.locator('#message-list .video-enlarge').click();await settle(page);
 assert.equal(await original.evaluate(v=>document.fullscreenElement===v),true);assert.equal(await page.locator('dialog.video-lightbox').count(),0);await page.evaluate(()=>document.exitFullscreen());assert(await original.evaluate(v=>!v.paused));assert.deepEqual(errors,[]);
});
