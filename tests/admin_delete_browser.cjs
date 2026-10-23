const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,USER,COMM}=require('./fixtures/supabase_fixture.cjs');
const assert=require('node:assert/strict');
const base=process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/';
const COMM2='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',TEXT3='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',TEXT4='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const extra=`data.communities.push({id:'${COMM2}',name:'Servidor apagavel',created_by:'${USER}',invite_only:false});data.channels.push({id:'${TEXT3}',name:'canal-alvo',kind:'text',community_id:'${COMM2}',position:0},{id:'${TEXT4}',name:'canal-extra',kind:'text',community_id:'${COMM2}',position:1});data.community_members.push({community_id:'${COMM2}',user_id:'${USER}'});`;
// Simula o efeito real do RPC: a linha some do banco e o Realtime avisa as tabelas em cascata.
const emit=(page,table,old)=>page.evaluate(([table,old])=>{for(const handlers of window.__qaChannels||[])for(const [kind,filter,cb]of handlers)if(kind==='postgres_changes'&&filter.table===table&&['*','DELETE'].includes(filter.event))cb({eventType:'DELETE',old,new:{}});},[table,old]);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  let pendingDelete=null;
  await context.route('**/*',async route=>{const url=route.request().url();if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub+extra});if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public-qa',callsConfigured:false,storageConfigured:true,pushConfigured:false}});
   const m=url.match(/\/api\/admin\/(communities|channels)\/([^/]+)\/delete$/);if(m){pendingDelete={kind:m[1],id:m[2]};return route.fulfill({json:{ok:true,warning:null}});}return route.continue();});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'networkidle'});
  await page.locator(`.server-icon[data-community-id="${COMM2}"]`).click();
  await page.locator(`.channel[data-channel-id="${TEXT3}"]`).waitFor();
  await page.waitForFunction(()=>window.orbitaAdminReady||true);
  // --- excluir canal ativo ---
  await page.locator(`.channel[data-channel-id="${TEXT3}"]`).click();await page.waitForTimeout(300);
  await page.locator(`.channel[data-channel-id="${TEXT3}"]`).click({button:'right'});
  await page.getByRole('menuitem',{name:'Excluir canal'}).click();
  await page.fill('#adm-confirm-input','canal-alvo');await page.click('#adm-confirm-go');
  await page.waitForFunction(()=>!document.getElementById('app-dialog').open,null,{timeout:5000});
  assert.equal(pendingDelete?.id,TEXT3);
  await page.evaluate(id=>{const d=window.__qaData;d.channels=d.channels.filter(c=>c.id!==id);},TEXT3);await emit(page,'channels',{id:TEXT3});
  await page.waitForFunction(id=>!document.querySelector(`.channel[data-channel-id="${id}"]`),TEXT3,{timeout:5000});
  assert.equal(await page.locator(`.channel[data-channel-id="${TEXT3}"]`).count(),0,'canal excluído some da lista');
  // --- excluir servidor ativo ---
  await page.locator(`.server-icon[data-community-id="${COMM2}"]`).click({button:'right'});
  await page.getByRole('menuitem',{name:'Excluir servidor'}).click();
  await page.fill('#adm-confirm-input','Servidor apagavel');await page.click('#adm-confirm-go');
  await page.waitForFunction(()=>!document.getElementById('app-dialog').open,null,{timeout:5000});
  assert.equal(pendingDelete?.id,COMM2);
  await page.waitForFunction(id=>!document.querySelector(`.server-icon[data-community-id="${id}"]`),COMM2,{timeout:5000});
  await page.waitForFunction(()=>document.getElementById('message-list')?.getAttribute('aria-busy')!=='true',null,{timeout:5000});
  const title=await page.locator('#sidebar-server-title').textContent();assert.notEqual(title,'Servidor apagavel');
  assert.equal(await page.locator(`.channel[data-channel-id="${TEXT4}"]`).count(),0,'canais do servidor excluído saem da barra');
  assert.equal(await page.locator(`.server-icon.active[data-community-id="${COMM}"]`).count(),1,'volta ao servidor padrão');
  // eventos Realtime atrasados não podem quebrar nada
  await page.evaluate(id=>{const d=window.__qaData;d.communities=d.communities.filter(c=>c.id!==id);d.channels=d.channels.filter(c=>c.community_id!==id);},COMM2);
  await emit(page,'communities',{id:COMM2});await emit(page,'channels',{id:TEXT4});await emit(page,'community_welcome',{community_id:COMM2});await page.waitForTimeout(1200);
  assert.equal(await page.locator(`.server-icon[data-community-id="${COMM2}"]`).count(),0);
  assert.deepEqual(errors,[]);
  console.log('admin delete browser: ok');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
