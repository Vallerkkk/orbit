const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,USER,OTHER,VOICE}=require('./fixtures/supabase_fixture.cjs');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const tmp=path.resolve(__dirname,'../work/browser-temp');fs.mkdirSync(tmp,{recursive:true});process.env.TEMP=tmp;process.env.TMP=tmp;
const shots=process.env.ORBITA_SHOTS_DIR||null;
const base=process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/';let browser;
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
   await context.route('**/*',route=>{const url=route.request().url();if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub+session});if(url.includes('livekit-client'))return route.fulfill({contentType:'application/javascript',body:livekit});if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public-qa',callsConfigured:true,storageConfigured:true,pushConfigured:false}});if(url.endsWith('/join'))return route.fulfill({json:{url:'wss://fake.invalid',token:'fake',canPublish:true}});return route.continue();});
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
  async function choose(url){await host.getByLabel('Link do vídeo no YouTube').fill(url);await host.getByRole('button',{name:'Colocar vídeo',exact:true}).click();}
  await panel(host);await choose('https://youtu.be/M7lc1UVf-VE?t=30');await host.waitForFunction(()=>window.__qaYT.ready&&window.__qaYT.video==='M7lc1UVf-VE');assert.ok(Math.abs(await host.evaluate(()=>window.__qaYT.position)-30)<2);assert.equal(await host.locator('#youtube-player').evaluate(n=>n.tagName),'IFRAME');assert.equal(await host.locator('#youtube-player').getAttribute('referrerpolicy'),'strict-origin-when-cross-origin');
  await host.locator('#watch-play').click();await host.waitForFunction(()=>window.__qaYT.status===1);
  // Volume local: um único botão de mudo + slider (inline ou pop-up em larguras estreitas).
  const bar=host.locator('#watch-panel .wp-bar');
  assert.equal(await bar.locator('.wp-ibtn[data-icon=volume],.wp-ibtn[data-icon=muted],.wp-ibtn[data-icon=low],.wp-ibtn[data-icon=everyone]').count(),1);
  const range=host.locator('#watch-panel .wp-volume'),mute=host.locator('#watch-mute');
  const compact=await range.isHidden();
  if(compact){await mute.click();await range.waitFor();assert.equal(await host.evaluate(()=>window.__qaYT.unmuted),false,'abrir o pop-up não altera o mudo');}
  const yt=()=>host.evaluate(()=>({volume:window.__qaYT.volume,unmuted:!!window.__qaYT.unmuted,icon:document.getElementById('watch-mute').dataset.icon,stored:localStorage.getItem('orbita-youtube-volume'),muted:localStorage.getItem('orbita-youtube-muted')}));
  await range.fill('30');await host.waitForFunction(()=>window.__qaYT.volume===30&&window.__qaYT.unmuted===true);assert.deepEqual(await yt(),{volume:30,unmuted:true,icon:'low',stored:'30',muted:'false'});
  await range.fill('80');await host.waitForFunction(()=>window.__qaYT.volume===80);assert.equal((await yt()).icon,'volume');
  if(shots){await host.locator('#watch-panel .wp-bar').screenshot({path:path.join(shots,mobile?'ouvir-volume-mobile-barra.png':'ouvir-volume-barra.png')});await host.screenshot({path:path.join(shots,mobile?'ouvir-volume-mobile.png':'ouvir-volume-tela.png')});}
  const toggle=compact?host.locator('#watch-panel .wp-pop-mute'):mute;
  await toggle.click();await host.waitForFunction(()=>window.__qaYT.unmuted===false);let st=await yt();assert.equal(st.icon,'muted');assert.equal(st.stored,'80');assert.equal(await range.inputValue(),'0');
  await toggle.click();await host.waitForFunction(()=>window.__qaYT.unmuted===true);assert.equal(await range.inputValue(),'80');assert.equal((await yt()).volume,80);
  await range.fill('0');st=await yt();assert.equal(st.icon,'muted');assert.equal(st.unmuted,false);
  await range.fill('45');await host.waitForFunction(()=>window.__qaYT.unmuted===true&&window.__qaYT.volume===45);
  await range.fill('0');await toggle.click();await host.waitForFunction(()=>window.__qaYT.unmuted===true);assert.equal((await yt()).volume,45,'desmutar do zero volta ao último nível');
  if(compact){await host.locator('#watch-panel video, #watch-panel .wp-now, #watch-status').first().click({force:true}).catch(()=>{});await host.mouse.click(5,5);await range.waitFor({state:'hidden'});}
  // O nível fica salvo para a próxima vez.
  assert.equal(await host.evaluate(()=>localStorage.getItem('orbita-youtube-volume')),'45');
  assert.equal(await host.evaluate(()=>!!document.querySelector('#watch-panel .wp-more #watch-global-mute')),true);
  assert.deepEqual(errors,[]);report.push({mobile,compact,singleMute:true,slider:true,persist:true});
  await Promise.all(contexts.map(c=>c.close()));
 }
 console.log(JSON.stringify(report));await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
