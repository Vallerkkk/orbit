// Regressões: erro do SDK deve invalidar o histórico sem duplicar a primeira página;
// reconexão durante uma leitura deve enfileirar uma nova página, não perder o refresh.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub:baseStub,TEXT,TEXT2}=require('./fixtures/supabase_fixture.cjs');
const base=process.env.ORBITA_TEST_URL||'http://127.0.0.1:7373/static/index.html';
const stub=baseStub.replace('return {data:head?null:single?rows[0]||null:structuredClone(rows),error:null,count};',
 'const result={data:head?null:single?rows[0]||null:structuredClone(rows),error:null,count};if(operation===\'select\'&&table===\'messages\'&&!single&&limit===50&&window.__qaHoldHistory){window.__qaHoldHistory=false;await new Promise(resolve=>window.__qaReleaseHistory=resolve);}return result;');
let browser;
before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});});
after(async()=>{await browser?.close();});
async function open(t,hold=false){
 const context=await browser.newContext({viewport:{width:1440,height:900}});t.after(()=>context.close());
 await context.addInitScript(hold=>{window.__qaHoldHistory=hold;window.__qaOnlineEvents=0;window.addEventListener('online',()=>window.__qaOnlineEvents++);},hold);
 await context.route('**/*',route=>{const url=route.request().url();if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub});if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'anon'}});return route.continue();});
 const page=await context.newPage(),errors=[],sources=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(/\/static\/(?:dist\/)?app[^/]*\.js/.test(r.url()))sources.push(r.url());});
 await page.goto(base,{waitUntil:'networkidle'});
 await page.waitForFunction(TEXT=>(window.__qaSubscriptions||[]).some(s=>s.name.startsWith('messages-'+TEXT+'-')&&!s.removed),TEXT);
 if(hold)await page.waitForFunction(()=>!!window.__qaReleaseHistory);else await page.waitForFunction(()=>document.querySelectorAll('#message-list .message').length===50&&document.querySelector('#message-list').getAttribute('aria-busy')==='false');
 const entry=await page.locator('script[type="module"][src]').evaluate(node=>node.src);assert(sources.includes(entry),'Executar a entrada servida pelo HTML atual');
 return {page,errors};
}
async function reads(page){return page.evaluate(TEXT=>(window.__qaQueries||[]).filter(q=>q.table==='messages'&&q.operation==='select'&&q.limit===50&&q.filters.some(([k,c,v])=>k==='eq'&&c==='channel_id'&&v===TEXT)&&q.filters.some(([k,c,v])=>k==='is'&&c==='thread_root'&&v===null)&&!q.filters.some(([k,c])=>c==='id'||k==='lt')).length,TEXT);}
async function reconnect(page,status){
 return page.evaluate(({TEXT,status})=>{
  const live=window.__qaSubscriptions.find(s=>s.name.startsWith('messages-'+TEXT+'-')&&!s.removed);window.__qaOldSubscription=live;
  live.callback(status);
  const row={...window.__qaData.messages.at(-1),id:crypto.randomUUID(),channel_id:TEXT,reply_to:null,content:'Perdida durante a desconexão',created_at:new Date(Date.now()+60000).toISOString()};
  window.__qaData.messages.push(row); // Só DB: nenhum postgres_changes ou evento online.
  live.callback('SUBSCRIBED');live.callback('SUBSCRIBED');return row.id;
 },{TEXT,status});
}
async function assertRecovered(page,id){
 await page.waitForFunction(id=>!!document.querySelector('#message-list [data-message-id="'+id+'"]'),id,{timeout:2000}).catch(()=>{});
 assert.equal(await page.locator('#message-list [data-message-id="'+id+'"]').count(),1,'Mensagem perdida deve aparecer após SUBSCRIBED; consultas='+await reads(page));
 assert.equal(await reads(page),2,'Uma primeira página inicial e uma atualização de reconexão');
 assert.equal(await page.evaluate(()=>window.__qaOnlineEvents),0,'Recuperação não depende de window.online');
}
for(const status of ['CHANNEL_ERROR','TIMED_OUT','CLOSED'])test('SDK '+status+' recupera mensagem sem broadcast nem online',async t=>{
 const {page,errors}=await open(t);assert.equal(await reads(page),1,'SUBSCRIBED inicial não duplica histórico');
 const id=await reconnect(page,status);await assertRecovered(page,id);
 await page.locator('[data-channel-id="'+TEXT2+'"]').first().click();await page.locator('#channel-title').getByText('projetos',{exact:true}).waitFor();
 await page.evaluate(()=>{window.__qaOldSubscription.callback('CHANNEL_ERROR');window.__qaOldSubscription.callback('SUBSCRIBED');});
 assert.equal(await reads(page),2,'Assinatura obsoleta não consulta o canal anterior');assert.equal(await page.locator('#message-list [data-message-id="'+id+'"]').count(),0);assert.deepEqual(errors,[]);
});
test('reconexão durante primeira página em voo enfileira uma única atualização',async t=>{
 const {page,errors}=await open(t,true);assert.equal(await reads(page),1,'SUBSCRIBED inicial durante loading não duplica histórico');
 const id=await reconnect(page,'CHANNEL_ERROR');assert.equal(await reads(page),1,'Leituras serializadas enquanto a primeira está retida');
 await page.evaluate(()=>window.__qaReleaseHistory());await assertRecovered(page,id);assert.deepEqual(errors,[]);
});
