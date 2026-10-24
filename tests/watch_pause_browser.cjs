const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,USER,OTHER,VOICE}=require('./fixtures/supabase_fixture.cjs');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const tmp=path.resolve(__dirname,'../work/browser-temp');fs.mkdirSync(tmp,{recursive:true});process.env.TEMP=tmp;process.env.TMP=tmp;
const base=process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/';const shots=process.env.ORBITA_SHOTS_DIR||null;let browser;
const MUSIC='88888888-8888-4888-8888-888888888888',musicStub=stub.replace('{"id":"77777777-7777-4777-8777-777777777777"','{"id":"'+MUSIC+'","name":"ouvir-juntos","kind":"text","is_music":true,"community_id":"00000000-0000-4000-8000-000000000001","position":3,"created_by":"11111111-1111-4111-8111-111111111111"},{"id":"77777777-7777-4777-8777-777777777777"');
assert.notEqual(musicStub,stub);
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
   await context.route('**/*',route=>{const url=route.request().url();if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:musicStub+session});if(url.includes('livekit-client'))return route.fulfill({contentType:'application/javascript',body:livekit});if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public-qa',callsConfigured:true,storageConfigured:true,pushConfigured:false}});if(url.endsWith('/join'))return route.fulfill({json:{url:'wss://fake.invalid',token:'fake',canPublish:true}});if(url.includes('/api/youtube/playlist')){const u=new URL(url);if(u.searchParams.get('id')==='PLnokey12345')return route.fulfill({status:503,json:{detail:'O YouTube ainda não foi configurado neste servidor (falta a YOUTUBE_API_KEY).'}});const start=Number(u.searchParams.get('page')||0),end=Math.min(60,start+24);return route.fulfill({json:{playlist:{id:'PLqa1234567',title:'Lista QA'},items:Array.from({length:end-start},(_,k)=>({id:'qa'+String(start+k).padStart(9,'0'),title:'Faixa '+(start+k+1)})),next:end<60?String(end):''}});}return route.continue();});
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
  const st=p=>p.evaluate(()=>window.__qaYT?.status),vid=p=>p.evaluate(()=>window.__qaYT?.video),emit=(p,data)=>p.evaluate(d=>{const y=window.__qaYT;y.status=d;y.options.events.onStateChange({target:y,data:d});},data);
  await panel(host);await host.getByLabel('Link do vídeo no YouTube').fill('https://youtu.be/M7lc1UVf-VE');await host.getByRole('button',{name:'Colocar vídeo',exact:true}).click();
  await host.waitForFunction(()=>window.__qaYT?.ready&&window.__qaYT.video==='M7lc1UVf-VE');await host.locator('#watch-play').click();await host.waitForFunction(()=>window.__qaYT.status===1);
  await follower.waitForFunction(()=>window.__qaYT?.ready&&window.__qaYT.video==='M7lc1UVf-VE');assert.equal(await follower.locator('#watch-panel').isVisible(),false);
  // 1) Painel oculto / aba em segundo plano: o player do outro pausa sozinho → a sessão segue tocando e ele se recupera.
  await emit(follower,2);await host.waitForTimeout(400);assert.equal(await st(host),1);await follower.waitForFunction(()=>window.__qaYT.status===1,null,{timeout:4000});
  // 2) Painel visível: buffering, não iniciado, cued e pausa do player (autoplay bloqueado) não se propagam.
  await panel(follower);for(const d of [3,-1,5,2]){await emit(follower,d);await host.waitForTimeout(250);assert.equal(await st(host),1,'estado '+d);}
  await follower.evaluate(()=>window.__qaYT.options.events.onAutoplayBlocked({target:window.__qaYT}));await host.waitForTimeout(250);assert.equal(await st(host),1);
  // 3) Recém-chegado: player carregando emite pausado → nada muda para os outros.
  await follower.evaluate(()=>window.__qaRoom.emit('ParticipantConnected',{identity:'ninguem'}));await emit(follower,2);await host.waitForTimeout(300);assert.equal(await st(host),1);
  // 4) Fim "falso" do vídeo anterior durante a troca: ENDED com o player ainda no vídeo antigo não pula nem pausa.
  await follower.evaluate(()=>{const y=window.__qaYT;y.getVideoData=()=>({video_id:'oldoldoldol'});});await emit(follower,0);await host.waitForTimeout(3800);assert.equal(await vid(host),'M7lc1UVf-VE');assert.equal(await st(host),1);await follower.evaluate(()=>{delete window.__qaYT.getVideoData;});
  // 5) Pausa explícita (botão) ainda vale para todos; continuar também.
  await follower.locator('#watch-pause').click();await host.waitForFunction(()=>window.__qaYT.status===2);await follower.locator('#watch-play').click();await host.waitForFunction(()=>window.__qaYT.status===1);
  assert.deepEqual(errors,[]);report.push({mobile,hiddenPause:true,playerStates:true,joiner:true,staleEnd:true,explicitPause:true});
  await Promise.all(contexts.map(c=>c.close()));
 }
 console.log(JSON.stringify(report));await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
