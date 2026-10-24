// Chamada v2: telas opt-in (placeholder → Assistir → Parar), Ouvir juntos oculto ao entrar, palco sem sobreposição,
// avatares circulares no celular e tela cheia com toque duplo.
const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,VOICE}=require('./fixtures/supabase_fixture.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const tmp=path.resolve(__dirname,'../work/browser-temp');fs.mkdirSync(tmp,{recursive:true});process.env.TEMP=tmp;process.env.TMP=tmp;
const shots=process.env.ORBITA_SHOTS_DIR||null;let browser;
function fakeYouTube(){window.YT={Player:class{constructor(id,o){this.options=o;this.video=o.videoId||'';this.position=0;this.status=5;const f=document.createElement('iframe');f.id=id;f.width='100%';f.height='210';document.getElementById(id).replaceWith(f);this.frame=f;window.__qaYT=this;setTimeout(()=>{this.ready=true;o.events.onReady({target:this});},0);}
 cueVideoById(v){this.video=typeof v==='string'?v:v.videoId;}loadVideoById(v){this.video=typeof v==='string'?v:v.videoId;}getCurrentTime(){return this.position;}getPlayerState(){return this.status;}getIframe(){return this.frame;}seekTo(p){this.position=p;}
 playVideo(){this.status=1;this.options.events.onStateChange({target:this,data:1});}pauseVideo(){this.status=2;this.options.events.onStateChange({target:this,data:2});}unMute(){}mute(){}setVolume(){}isMuted(){return false;}getVolume(){return 100;}destroy(){this.frame.remove();}}};}
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});const report=[];
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:{width:mobile?390:1440,height:mobile?844:900},isMobile:mobile,hasTouch:mobile,...(mobile?{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{})});await context.addInitScript(fakeYouTube);
  const livekit=fs.readFileSync(path.join(__dirname,'fixtures/livekit_stub.mjs'),'utf8');
  await context.route('**/*',route=>{const url=route.request().url();if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub});if(url.includes('livekit-client'))return route.fulfill({contentType:'application/javascript',body:livekit});if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public-qa',callsConfigured:true,storageConfigured:true}});if(url.endsWith('/join'))return route.fulfill({json:{url:'wss://fake.invalid',token:'fake',canPublish:true}});return route.continue();});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/',{waitUntil:'networkidle'});await page.waitForFunction(()=>document.querySelectorAll('#message-list .message').length===50);
  if(mobile)await page.locator('.main>div:not([hidden]) .mobile-nav-btn').first().click();
  await page.locator(`[data-channel-id="${VOICE}"]`).first().click();await page.locator('#join-call').click();await page.waitForFunction(()=>window.__qaRoom?.state==='connected');
  await page.evaluate(()=>{
   window.qaRemote=[...window.__qaRoom.remoteParticipants.values()][0];window.qaSubs=[];
   window.qaTrack=(key,source)=>{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const c=canvas.getContext('2d');c.fillStyle=source==='camera'?'#3a3f46':'#24282e';c.fillRect(0,0,320,180);c.fillStyle='#d8dde3';c.font='20px sans-serif';c.fillText(source==='camera'?'Câmera':'Tela compartilhada',20,95);
    const stream=canvas.captureStream(5),ls=new Map();
    const t={sid:key,source,kind:'video',isMuted:false,on(e,f){ls.set(e,[...(ls.get(e)||[]),f])},off(){},emit(e){for(const f of ls.get(e)||[])f()},attach(){const v=document.createElement('video');v.autoplay=true;v.muted=true;v.srcObject=stream;return v},detach(v){if(v)v.srcObject=null;return[]}};
    const pub={track:t,trackSid:key,source,kind:'video',isMuted:false,isSubscribed:true,setSubscribed(v){this.isSubscribed=v;window.qaSubs.push([key,v]);}};
    window.qaRemote.videoTrackPublications.set(key,pub);return {t,pub};};
   const cam=window.qaTrack('cam','camera');window.__qaRoom.emit('TrackSubscribed',cam.t,cam.pub,window.qaRemote);
   const scr=window.qaTrack('scr','screen_share');window.qaScr=scr;window.__qaRoom.emit('TrackSubscribed',scr.t,scr.pub,window.qaRemote);
  });
  // Compartilhar tela: no iPhone o botão some; no desktop o áudio é opt-in e nunca inclui as vozes da chamada.
  if(mobile){assert.equal(await page.locator('#screen').isVisible(),false);assert.match(await page.locator('#screen').getAttribute('title'),/não permite compartilhar a tela/);}
  else{const opts=await page.evaluate(async()=>{const lp=window.__qaRoom.localParticipant;let got;lp.setScreenShareEnabled=async(on,capture)=>{got=capture;};document.getElementById('screen').click();await new Promise(r=>setTimeout(r,50));localStorage.setItem('orbita-screen-audio','true');document.getElementById('screen').click();await new Promise(r=>setTimeout(r,50));const second=got;return {second};});
   assert.equal(opts.second.systemAudio,'exclude');assert.equal(opts.second.audio.restrictOwnAudio,true);assert.equal(opts.second.selfBrowserSurface,'exclude');await page.evaluate(()=>localStorage.removeItem('orbita-screen-audio'));}
  // Tela não assinada por padrão: placeholder com "Assistir".
  const ph=page.locator('.screen-placeholder');await ph.waitFor();assert.match(await ph.textContent(),/está compartilhando a tela/);
  assert.deepEqual(await page.evaluate(()=>window.qaSubs),[['scr',false]]);
  if(shots)await page.screenshot({path:path.join(shots,mobile?'call-v2-placeholder-mobile.png':'call-v2-placeholder.png')});
  await ph.getByRole('button',{name:/Assistir/}).click();assert.deepEqual(await page.evaluate(()=>window.qaSubs.at(-1)),['scr',true]);
  await page.evaluate(()=>window.__qaRoom.emit('TrackSubscribed',window.qaScr.t,window.qaScr.pub,window.qaRemote));
  await page.locator('.media-tile.media-screen:not(.screen-placeholder) video').waitFor();assert.equal(await ph.count(),0);
  await page.locator('.sp-stop').click();assert.deepEqual(await page.evaluate(()=>window.qaSubs.at(-1)),['scr',false]);await ph.waitFor();
  await ph.getByRole('button',{name:/Assistir/}).click();await page.evaluate(()=>window.__qaRoom.emit('TrackSubscribed',window.qaScr.t,window.qaScr.pub,window.qaRemote));await page.locator('.media-tile.media-screen video').waitFor();
  // Trocar de tela sem "Parar de assistir": a segunda tela vai para o palco; câmera também pode ser focada.
  if(!mobile){
   await page.evaluate(()=>{const r=window.__qaRoom,p2=Object.assign(Object.create(Object.getPrototypeOf(window.qaRemote)),window.qaRemote,{identity:'qa-second',videoTrackPublications:new Map(),audioTrackPublications:new Map()});r.remoteParticipants.set('qa-second',p2);const keep=window.qaRemote;window.qaRemote=p2;const s2=window.qaTrack('scr2','screen_share');window.qaRemote=keep;window.qaScr2=s2;window.qaP2=p2;s2.pub.setSubscribed=function(v){this.isSubscribed=v;window.qaSubs.push(['scr2',v]);if(v)setTimeout(()=>r.emit('TrackSubscribed',s2.t,s2.pub,p2),0);};r.emit('TrackSubscribed',s2.t,s2.pub,p2);});
   const ph2=page.locator('.screen-placeholder[data-participant-id="qa-second"]');await ph2.waitFor();await ph2.getByRole('button',{name:/Assistir/}).click();
   await page.waitForFunction(()=>document.querySelector('.call-stage-tile video')?.dataset.track==='scr2');
   assert.equal(await page.locator('.media-tile.media-screen:not(.screen-placeholder) video').count(),2);
   await page.locator('.media-tile video[data-track="cam"]').click();await page.waitForFunction(()=>document.querySelector('.call-stage-tile video')?.dataset.track==='cam');
   await page.locator('.media-tile video[data-track="scr"]').click();await page.waitForFunction(()=>document.querySelector('.call-stage-tile video')?.dataset.track==='scr');
   await page.locator('.media-tile video[data-track="scr"]').click();
   if(shots)await page.screenshot({path:path.join(shots,'call-v2-share-switch.png')});
   await page.evaluate(()=>{window.__qaRoom.emit('TrackUnpublished',window.qaScr2.pub,window.qaP2);window.__qaRoom.emit('ParticipantDisconnected',window.qaP2);window.__qaRoom.remoteParticipants.delete('qa-second');document.querySelector('.media-tile video[data-track="scr2"]')?.closest('figure')?.remove();});
  }
  // Ouvir juntos: sessão remota tocando não abre o painel; o botão mostra o indicador.
  await page.evaluate(()=>window.__qaRoom.emit('DataReceived',new TextEncoder().encode(JSON.stringify({type:'command',video:'M7lc1UVf-VE',position:0,playing:true,sharedMuted:false,n:5,actor:window.qaRemote.identity})),window.qaRemote,undefined,'orbita-watch'));
  await page.waitForFunction(()=>document.getElementById('watch-panel'));assert.equal(await page.locator('#watch-panel').isVisible(),false);
  const toggle=page.locator('#call-watch');await page.locator('#call-watch.watch-live').waitFor({state:'attached'});
  await toggle.click();await page.locator('#watch-panel').waitFor();
  // Sem sobreposição entre os blocos da grade.
  const overlap=await page.evaluate(()=>{const n=[...document.querySelectorAll('.call-grid .media-tile, .call-grid #watch-panel, .call-grid .participant')].filter(x=>x.offsetParent);const r=n.map(x=>x.getBoundingClientRect());for(let i=0;i<r.length;i++)for(let j=i+1;j<r.length;j++){const a=r[i],b=r[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2)return [n[i].className,n[j].className];}return null;});
  assert.equal(overlap,null);
  if(!mobile)assert.equal(await page.evaluate(()=>document.querySelector('.call-grid').dataset.layout),'focus');
  if(shots)await page.screenshot({path:path.join(shots,mobile?'call-v2-mobile.png':'call-v2-desktop.png')});
  if(mobile){
   await page.evaluate(()=>{for(const id of ['cam','scr']){const p=window.qaRemote.videoTrackPublications.get(id);window.__qaRoom.emit('TrackUnpublished',p,window.qaRemote);}});
   await toggle.click();await page.locator('#watch-panel').waitFor({state:'hidden'});
   const card=page.locator('.call-grid .participant').first();await card.waitFor();
   const box=await card.boundingBox();assert.ok(box.width<=110,'avatar compacto: '+box.width);
   const radius=await card.locator('img, .avatar, [class*=avatar]').first().evaluate(n=>getComputedStyle(n).borderRadius);assert.match(radius,/50%|9999|px/);
   if(shots)await page.screenshot({path:path.join(shots,'call-v2-mobile-avatars.png')});
   await toggle.click();await page.locator('#watch-panel').waitFor();
   const panel=await page.locator('#watch-panel').boundingBox();const tap=async()=>page.touchscreen.tap(panel.x+panel.width/2,panel.y+40);
   await tap();await page.waitForTimeout(80);await tap();
   await page.waitForFunction(()=>document.fullscreenElement||document.querySelector('.pseudo-fullscreen'));
   await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors,[]);report.push({mobile,placeholder:true,watch:true,stop:true,hiddenPanel:true,noOverlap:true});
  await context.close();
 }
 console.log(JSON.stringify(report));await browser.close();
})().catch(async e=>{console.error(e);await browser?.close();process.exitCode=1;});
