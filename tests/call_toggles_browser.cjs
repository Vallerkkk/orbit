const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,VOICE,OTHER}=require('./fixtures/supabase_fixture.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const tmp=path.resolve(__dirname,'../work/browser-temp');fs.mkdirSync(tmp,{recursive:true});process.env.TEMP=tmp;process.env.TMP=tmp;
let browser,page;
const viaMore=async id=>{await page.locator('#call-more').click();await page.locator(`.cm-item[data-target="${id}"]`).click();};
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});const report=[];
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1024,height:576},isMobile:mobile,hasTouch:mobile});
  await context.route('**/*',route=>{const url=route.request().url();if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub});if(url.includes('livekit-client'))return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(__dirname,'fixtures/livekit_stub.mjs'),'utf8')});if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'qa',callsConfigured:true,storageConfigured:true,pushConfigured:false}});if(url.endsWith('/join'))return route.fulfill({json:{url:'wss://fake.invalid',token:'fake',canPublish:true}});return route.continue();});
  page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/',{waitUntil:'networkidle'});await page.locator('#message-list .message').first().waitFor();
  if(mobile)await page.locator('#mobile-menu-btn').click();await page.locator(`[data-channel-id="${VOICE}"]`).first().click();await page.locator('#join-call').click();await page.waitForFunction(()=>window.__qaRoom?.state==='connected'&&window.__qaRoom.localParticipant.isMicrophoneEnabled);
  const shots='/workspace/redesign-shots',shot=n=>page.screenshot({path:path.join(shots,n)});
  // Ouvir juntos: toggle na barra da chamada, sincronizado com "Ocultar".
  const watch=page.locator('#call-watch');await watch.waitFor();assert.equal(await watch.getAttribute('aria-pressed'),'false');assert.equal(await watch.getAttribute('aria-label'),'Ouvir juntos');
  await watch.click();await page.locator('#watch-panel').waitFor();await page.waitForFunction(()=>document.getElementById('call-watch').getAttribute('aria-pressed')==='true');
  assert.equal(await watch.getAttribute('aria-label'),'Ocultar Ouvir juntos');await page.mouse.move(5,5);await page.waitForTimeout(400);const bg=n=>getComputedStyle(n).backgroundColor;assert.equal(await watch.evaluate(bg),await page.locator('#mic').evaluate(bg));
  if(!mobile)await shot('fix-ouvir-toggle-open.png');
  await watch.click();await page.locator('#watch-panel').waitFor({state:'hidden'});assert.equal(await watch.getAttribute('aria-pressed'),'false');
  if(!mobile)await shot('fix-ouvir-toggle-closed.png');
  await watch.click();await page.locator('#watch-panel').waitFor();await page.locator('#watch-panel .wp-hide').click();await page.waitForFunction(()=>document.getElementById('call-watch').getAttribute('aria-pressed')==='false');
  // Participantes: todos aparecem nos tiles e na sala da barra lateral (inclusive só áudio, entrada tardia e saída).
  if(mobile)await page.locator('#call-navigation').click();
  const tiles=()=>page.locator('#participants .participant').count(),rows=()=>page.locator(`.voice-tree-person`).count();
  await page.waitForFunction(()=>document.querySelectorAll('#participants .participant').length===2);
  assert.equal(await rows(),2);
  await page.evaluate(()=>{const r=window.__qaRoom,peer=[...r.remoteParticipants.values()][0];for(const [id,name] of [['audio-only-1','Ana'],['audio-only-2','Bia']]){const p=Object.assign(Object.create(Object.getPrototypeOf(peer)),peer,{identity:id,name,isCameraEnabled:false,isScreenShareEnabled:false,isMicrophoneEnabled:id.endsWith('1')});r.remoteParticipants.set(id,p);r.emit('ParticipantConnected',p);}});
  await page.waitForFunction(()=>document.querySelectorAll('#participants .participant').length===4);assert.equal(await rows(),4);
  // Duplicata de presença (duas abas do mesmo usuário) não duplica a linha.
  await page.evaluate(()=>{const r=window.__qaRoom,p=r.remoteParticipants.get('audio-only-2');r.remoteParticipants.delete('audio-only-2');r.emit('ParticipantDisconnected',p);});
  await page.waitForFunction(()=>document.querySelectorAll('#participants .participant').length===3);assert.equal(await rows(),3);
  // Recolher "Salas de voz" mantém a sala com gente visível; expandir de novo restaura tudo.
  const fold=page.locator('.ux-category-toggle[aria-controls="voice-channels"]');await fold.click();
  assert.equal(await fold.getAttribute('aria-expanded'),'false');assert.equal(await rows(),3);assert.equal(await page.locator('#voice-channels .voice-tree-person:visible').count(),3);assert.equal(await page.locator('#voice-channels .channel.has-peers:visible').count(),1);
  await fold.click();assert.equal(await fold.getAttribute('aria-expanded'),'true');assert.equal(await page.locator('#voice-channels .voice-tree-person:visible').count(),3);
  if(mobile)await page.touchscreen.tap(385,420);
  // Canais e conversas.
  const nav=page.locator('#call-navigation');assert.equal(await nav.isVisible(),true);
  if(!mobile){
   assert.equal(await nav.getAttribute('aria-expanded'),'true');assert.equal(await nav.getAttribute('aria-label'),'Ocultar canais e conversas');assert.equal(await page.locator('.app>.sidebar').isVisible(),true);
   await page.mouse.move(600,300);await shot('fix-sidebar-toggle-open.png');
   const before=await page.locator('.main').evaluate(n=>n.offsetWidth);
   await nav.click();assert.equal(await page.locator('.app>.sidebar').isVisible(),false);assert.equal(await nav.getAttribute('aria-expanded'),'false');assert.equal(await nav.getAttribute('aria-label'),'Mostrar canais e conversas');assert.ok(await page.locator('.main').evaluate(n=>n.offsetWidth)>before+150);
   await page.mouse.move(600,300);await page.waitForTimeout(300);await shot('fix-sidebar-toggle-closed.png');
   await page.reload({waitUntil:'networkidle'});await page.locator('#message-list .message').first().waitFor();assert.equal(await page.locator('.app>.sidebar').isVisible(),false);
   const textNav=page.locator('#mobile-menu-btn');assert.equal(await textNav.isVisible(),true);await textNav.click();assert.equal(await page.locator('.app>.sidebar').isVisible(),true);await page.waitForFunction(()=>document.getElementById('mobile-menu-btn').getAttribute('aria-expanded')==='true');await textNav.click();assert.equal(await page.locator('.app>.sidebar').isVisible(),false);await textNav.click();
  }else{
   assert.equal(await nav.getAttribute('aria-expanded'),'false');await nav.click();await page.waitForFunction(()=>document.body.classList.contains('mobile-menu-open'));assert.equal(await page.locator('.app>.sidebar').isVisible(),true);
   await page.waitForFunction(()=>document.getElementById('call-navigation').getAttribute('aria-expanded')==='true');await page.waitForTimeout(600);await shot('fix-sidebar-toggle-mobile.png');
   await page.touchscreen.tap(385,420);await page.waitForFunction(()=>!document.body.classList.contains('mobile-menu-open'));
  }
  assert.deepEqual(errors,[]);report.push({mobile,ok:true});await context.close();
 }
 console.log(JSON.stringify(report));await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
