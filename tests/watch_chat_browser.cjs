const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,USER,OTHER,VOICE}=require('./fixtures/supabase_fixture.cjs');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const tmp=path.resolve(__dirname,'../work/browser-temp');fs.mkdirSync(tmp,{recursive:true});process.env.TEMP=tmp;process.env.TMP=tmp;
const base=process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/';const shots=process.env.ORBITA_SHOTS_DIR||null;let browser;
function fakeYouTube(){
 window.__qaYTPlayers=[];
 window.YT={Player:class{
  constructor(id,options){this.options=options;this.position=options.playerVars?.start||0;this.status=5;this.video=options.videoId||'';const placeholder=document.getElementById(id),frame=document.createElement('iframe');frame.id=id;frame.width='100%';frame.height='210';placeholder.replaceWith(frame);this.frame=frame;window.__qaYT=this;window.__qaYTPlayers.push(this);setTimeout(()=>{this.ready=true;options.events.onReady({target:this});},800);}
  cueVideoById(value,start=0){this.video=typeof value==='string'?value:value.videoId;this.position=typeof value==='string'?start:value.startSeconds||0;this.status=5;this.options.events.onStateChange({target:this,data:5});}
  getCurrentTime(){return this.position;}getPlayerState(){return this.status;}getIframe(){return this.frame;}
  seekTo(value){this.position=value;}playVideo(){this.status=1;this.options.events.onStateChange({target:this,data:1});}pauseVideo(){this.status=2;this.options.events.onStateChange({target:this,data:2});}
  unMute(){this.unmuted=true;}mute(){this.unmuted=false;}setVolume(value){this.volume=value;}destroy(){this.destroyed=true;this.frame.remove();}
 }};
}
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});const report=[];
 for(const mobile of [false,true]){
  const contexts=[],pages=[],errors=[];
  for(const identity of [USER,OTHER]){
   const context=await browser.newContext({viewport:{width:mobile?390:1440,height:mobile?844:1000},isMobile:mobile,hasTouch:mobile});contexts.push(context);await context.addInitScript(fakeYouTube);
   const session=identity===OTHER?`window.__qaSession={user:{id:'${OTHER}',user_metadata:{display_name:'Outra pessoa'}},access_token:'other'};`:'';
   const livekit=fs.readFileSync(path.join(__dirname,'fixtures/livekit_stub.mjs'),'utf8');
   await context.route('**/*',route=>{const url=route.request().url();if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub+session});if(url.includes('livekit-client'))return route.fulfill({contentType:'application/javascript',body:livekit});if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public-qa',callsConfigured:true,storageConfigured:true,pushConfigured:false}});if(url.endsWith('/join'))return route.fulfill({json:{url:'wss://fake.invalid',token:'fake',canPublish:true}});if(url.includes('/api/youtube/playlist')){const u=new URL(url);if(u.searchParams.get('id')==='PLnokey12345')return route.fulfill({status:503,json:{detail:'O YouTube ainda não foi configurado neste servidor (falta a YOUTUBE_API_KEY).'}});const start=Number(u.searchParams.get('page')||0),end=Math.min(60,start+24);return route.fulfill({json:{playlist:{id:'PLqa1234567',title:'Lista QA'},items:Array.from({length:end-start},(_,k)=>({id:'qa'+String(start+k).padStart(9,'0'),title:'Faixa '+(start+k+1)})),next:end<60?String(end):''}});}return route.continue();});
   const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));const response=await page.goto(base,{waitUntil:'networkidle'});assert.equal(response.headers()['referrer-policy'],'strict-origin-when-cross-origin');await page.locator('#message-list .message').first().waitFor();
   if(mobile)await page.locator('#mobile-menu-btn').click();await page.locator(`[data-channel-id="${VOICE}"]`).first().click();await page.locator('#join-call').click();await page.waitForFunction(()=>window.__qaRoom?.state==='connected');await page.waitForTimeout(100);
   await page.evaluate(({identity,USER,OTHER})=>{const r=window.__qaRoom,remote=[...r.remoteParticipants.values()][0];r.localParticipant.identity=identity;remote.identity=identity===USER?OTHER:USER;r.remoteParticipants=new Map([[remote.identity,remote]]);},{identity,USER,OTHER});
  }
  const [host,follower]=pages;
  for(let index=0;index<2;index++){
   const from=pages[index],to=pages[1-index],sender=index?OTHER:USER;
   await from.exposeFunction('__qaBridge',async(bytes,topic)=>to.evaluate(({bytes,topic,sender})=>{const r=window.__qaRoom,p=r?.remoteParticipants.get(sender);if(p)r.emit('DataReceived',new Uint8Array(bytes),p,undefined,topic);},{bytes,topic,sender}));
   await from.evaluate(()=>{const participant=window.__qaRoom.localParticipant,original=participant.publishData.bind(participant);participant.publishData=async(bytes,options)=>{await original(bytes,options);await window.__qaBridge([...bytes],options.topic);};});
  }
  async function panel(page){if(await page.locator('#watch-panel:not([hidden])').count()===0)await page.locator('#voice-view').getByRole('button',{name:'Ouvir juntos',exact:true}).click();await page.locator('#watch-panel').waitFor();}
  const say=async(page,text)=>{await page.locator('#watch-chat-input').fill(text);await page.locator('#watch-chat-input').press('Enter');};
  await panel(host);
  await host.locator('.wp-chat-card').getByText('Chat de comandos').waitFor();assert.equal(await host.locator('.wp-chat-cmds li').count(),14);
  await say(host,'oi pessoal');await host.locator('#watch-chat-log').getByText(/só aceita comandos/).waitFor();
  await say(host,'https://www.youtube.com/playlist?list=PLqa1234567');
  await host.waitForFunction(()=>window.__qaYT?.ready&&window.__qaYT.video==='qa000000000');
  await follower.locator('#watch-queue .wp-q-item').nth(58).waitFor();assert.equal(await follower.locator('#watch-queue .wp-q-item').count(),59);
  await follower.locator('#watch-chat-log').getByText(/Lista QA/).waitFor();
  await panel(follower);await say(follower,'/pular');await host.waitForFunction(()=>window.__qaYT.video==='qa000000001');await host.locator('#watch-chat-log').getByText('/pular',{exact:true}).waitFor();await host.locator('#watch-now').getByText('Faixa 2').waitFor();
  await say(follower,'/remover 1');await host.waitForFunction(()=>document.querySelectorAll('#watch-queue .wp-q-item').length===57);
  await say(host,'/voltar');await follower.waitForFunction(()=>window.__qaYT.video==='qa000000000');
  await say(host,'https://youtu.be/dQw4w9WgXcQ?list=PLqa1234567');await host.getByRole('button',{name:'Só este vídeo'}).click();
  await host.waitForFunction(()=>[...document.querySelectorAll('#watch-queue .wp-q-text strong')].some(n=>n.textContent.includes('Vídeo do YouTube')||n.textContent.includes('Never')),null,{timeout:15000}).catch(()=>{});
  await say(host,'https://www.youtube.com/playlist?list=PLnokey12345');await host.locator('#watch-chat-log').getByText(/YOUTUBE_API_KEY/).waitFor();await say(host,'/embaralhar');await say(host,'/repetir');await follower.locator('#watch-chat-log').getByText(/ligou repetir/).waitFor();
  await say(host,'/volume 30');await host.locator('#watch-chat-log').getByText(/30% \(só para você\)/).waitFor();
  await say(host,'/fila');await say(host,'/agora');await host.locator('#watch-chat-log').getByText(/^Tocando: Faixa 1 /).waitFor();
  if(shots){await host.evaluate(()=>window.scrollTo(0,0));await host.screenshot({path:path.join(shots,mobile?'ouvir-chat-mobile-tela.png':'ouvir-chat-tela.png')});await host.locator('#watch-panel').screenshot({path:path.join(shots,mobile?'ouvir-chat-mobile.png':'ouvir-chat-desktop.png')});await host.locator('.wp-chat').screenshot({path:path.join(shots,mobile?'ouvir-chat-mobile-detalhe.png':'ouvir-chat-detalhe.png')});}
  assert.deepEqual(errors,[]);report.push({mobile,playlist:59,sync:true,commands:true});
  await Promise.all(contexts.map(c=>c.close()));
 }
 console.log(JSON.stringify(report));await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
