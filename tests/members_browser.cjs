// Coluna de membros v2: alternância persistida, seções Equipe/Online/Offline, atualização incremental de presença, gaveta em telas estreitas e perfil compacto na DM.
const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,USER,OTHER}=require('./fixtures/supabase_fixture.cjs');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const shots='/workspace/redesign-shots';fs.mkdirSync(shots,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});const report=[];
 for(const [label,width,height,mobile] of [['desktop',1440,900,false],['tablet',1000,800,false],['mobile',390,844,true]]){
  const context=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});
  await context.route('**/*',route=>{const url=route.request().url();if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub});if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'anon'}});return route.continue();});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/',{waitUntil:'networkidle'});await page.locator('#message-list .message').first().waitFor();
  const btn=page.locator('#btn-members-toggle'),side=page.locator('#members-sidebar');
  await btn.waitFor();assert.match(await btn.getAttribute('aria-label'),/(Mostrar|Ocultar) membros/);
  // padrão: aberta só no desktop largo
  assert.equal(await side.isVisible(),label==='desktop');
  if(label!=='desktop')await btn.click();
  await side.locator('.mv2-row').first().waitFor();assert.equal(await btn.getAttribute('aria-pressed'),'true');
  const heads=await side.locator('.mv2-head').allTextContents();assert(heads.some(h=>/^Equipe da Órbita — 1$/.test(h)),heads.join('|'));assert(heads.some(h=>/^(Online|Offline) — \d+$/.test(h)));
  // presença incremental: a linha do colega é reaproveitada (mesmo nó) quando só o próprio usuário muda
  await page.evaluate(()=>{window.__row=document.querySelector('#member-list .mv2-row[data-user-id="22222222-2222-4222-8222-222222222222"]');});
  await page.evaluate(({USER,OTHER})=>{window.__qaPresence={[USER]:[{status:'online'}],[OTHER]:[{status:'online',channel_id:'44444444-4444-4444-8444-444444444444',screen:true}]};for(const handlers of window.__qaChannels||[])for(const [type,f,fn] of handlers)if(type==='presence'&&f?.event==='sync')fn();},{USER,OTHER});
  await side.locator('.mv2-voice.live').waitFor();
  assert.equal(await page.evaluate(()=>document.querySelector('#member-list .mv2-row[data-user-id="22222222-2222-4222-8222-222222222222"]')===window.__row),true);
  assert.equal(await side.locator('canvas').count(),0);
  const geo=await page.evaluate(()=>{const s=document.getElementById('members-sidebar').getBoundingClientRect(),m=document.querySelector('#app-view .main').getBoundingClientRect();return {sideLeft:s.left,mainRight:m.right,w:innerWidth};});
  if(label==='desktop')assert(geo.mainRight<=geo.sideLeft+1,'coluna encaixada não cobre o chat');else assert(geo.mainRight>geo.sideLeft+50,'gaveta sobreposta');
  await page.screenshot({path:path.join(shots,`full-members-v2-${label}-shown.png`)});
  await btn.click();await page.waitForTimeout(150);assert.equal(await side.isVisible(),false);assert.equal(await btn.getAttribute('aria-pressed'),'false');
  await page.screenshot({path:path.join(shots,`full-members-v2-${label}-hidden.png`)});
  // persistência
  await page.reload({waitUntil:'networkidle'});await page.locator('#message-list .message').first().waitFor();assert.equal(await side.isVisible(),false);
  await page.keyboard.press('Control+Shift+M');await side.locator('.mv2-row').first().waitFor();
  if(label==='desktop'){await page.evaluate(OTHER=>{const d=window.__qaData;},OTHER);}
  // v3: » no topo da coluna oculta, « na borda direita restaura (mesmo estado do botão do cabeçalho)
  const hide=page.locator('#mv2-hide'),show=page.locator('#mv2-show');
  assert.equal(await hide.isVisible(),true);assert.equal(await show.isVisible(),false);assert.equal(await hide.getAttribute('aria-label'),'Ocultar membros');
  if(label!=='tablet')await page.screenshot({path:path.join(shots,`full-members-v3-${label}-shown.png`)});
  await hide.click();await page.waitForTimeout(150);assert.equal(await side.isVisible(),false);assert.equal(await btn.getAttribute('aria-pressed'),'false');
  assert.equal(await show.isVisible(),true);assert.equal(await show.getAttribute('aria-label'),'Mostrar membros'); // o Grafite transfere o title para data-tip no hover: o nome acessível é a invariant
  assert.equal(await page.evaluate(()=>Object.entries(localStorage).find(([k])=>k.startsWith('orbita-members-panel:'))?.[1]),'0');
  if(label==='desktop')await page.screenshot({path:path.join(shots,`full-members-v3-desktop-hidden.png`)});
  await show.click();await side.locator('.mv2-row').first().waitFor();assert.equal(await btn.getAttribute('aria-pressed'),'true');assert.equal(await show.isVisible(),false);
  if(label==='desktop'){
   await page.locator('#feed-nav').click();await page.locator('#feed-view:not([hidden])').waitFor();await page.waitForTimeout(150);
   assert.equal(await side.isVisible(),false);assert.equal(await btn.isVisible(),false);assert.equal(await show.isVisible(),false);assert.equal(await hide.isVisible(),false);
   await page.screenshot({path:path.join(shots,'full-members-v3-feed.png')});
   await page.locator('#rail-servers-list .server-icon').first().click().catch(()=>{});await page.locator('.channel-item,[data-channel-id]').filter({hasNotText:'voz'}).first().click().catch(()=>{});
   await page.locator('#message-list .message').first().waitFor();await side.locator('.mv2-row').first().waitFor();assert.equal(await btn.isVisible(),true);
  }
  if(mobile){await page.mouse.click(60,500);await page.waitForTimeout(150);assert.equal(await side.isVisible(),false,'toque fora fecha a gaveta');}
  assert.deepEqual(errors,[]);report.push({label,sections:heads,incremental:true,persisted:true});await context.close();
 }
 console.log(JSON.stringify(report));await browser.close();
})().catch(async e=>{console.error(e);process.exitCode=1;});
