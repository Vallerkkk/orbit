// Regressão: root antigo + 150 recentes deve entrar na janela pelo clique real
// de citação/busca. Scroll deve sobreviver aos frames de restauração e troca de canal.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub:baseStub,TEXT,TEXT2}=require('./fixtures/supabase_fixture.cjs');
const base=process.env.ORBITA_TEST_URL||'http://127.0.0.1:7373/static/index.html';
const match=baseStub.match(/^const data=(\{.*?\});window\.__qaData/s),data=JSON.parse(match[1]);
const ROOT='aaaaaaaa-aaaa-4aaa-8aaa-000000000001',start=Date.now()-200*60000;
function message(i,channel=TEXT){return {...data.messages[0],id:(channel===TEXT?'bbbbbbbb-bbbb-4bbb-8bbb-':'cccccccc-cccc-4ccc-8ccc-')+String(i+1).padStart(12,'0'),channel_id:channel,content:'Recente '+i,created_at:new Date(start+i*60000).toISOString(),reply_to:null};}
data.messages=[{...message(0),id:ROOT,content:'Raiz antiga azulejo',created_at:new Date(start-86400000).toISOString()},...Array.from({length:150},(_,i)=>message(i)),...Array.from({length:160},(_,i)=>message(i,TEXT2))];
data.messages.find(m=>m.channel_id===TEXT&&m.content==='Recente 149').reply_to=ROOT;
const stub=baseStub.replace(match[1],()=>JSON.stringify(data)).replace('return {data:head?null:single?rows[0]||null:structuredClone(rows),error:null,count};',
 'const result={data:head?null:single?rows[0]||null:structuredClone(rows),error:null,count};if(operation===\'select\'&&single&&rows[0]?.id===\''+ROOT+'\'&&window.__qaHoldRoot){window.__qaHoldRoot=false;await new Promise(resolve=>window.__qaReleaseRoot=resolve);}if(operation===\'select\'&&table===\'messages\'&&!single&&limit===50&&window.__qaHoldHistory){window.__qaHoldHistory=false;await new Promise(resolve=>window.__qaReleaseHistory=resolve);}return result;');
let browser;
before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});});
after(async()=>{await browser?.close();});
async function open(t){
 const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});t.after(()=>context.close());
 await context.route('**/*',route=>{const url=route.request().url();if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub});if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'anon'}});return route.continue();});
 const page=await context.newPage(),errors=[],sources=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(/\/static\/(?:dist\/)?app[^/]*\.js/.test(r.url()))sources.push(r.url());});
 await page.goto(base,{waitUntil:'networkidle'});await page.waitForFunction(()=>document.querySelectorAll('#message-list .message').length===50&&document.querySelector('#message-list').getAttribute('aria-busy')==='false');
 const entry=await page.locator('script[type="module"][src]').evaluate(node=>node.src);assert(sources.includes(entry),'Executar a entrada servida pelo HTML atual');
 await hydrate(page,TEXT,150);assert.equal(await page.locator('#message-list [data-message-id="'+ROOT+'"]').count(),0,'Root ainda não carregado');return {page,errors};
}
async function hydrate(page,channel,count){
 // Hidrata via eventos reais da assinatura: carregar páginas pelo botão expande
 // a janela e mascararia o bug. DB tem os dados, root nunca recebe broadcast.
 await page.evaluate(async({channel,count,ROOT})=>{
  const live=window.__qaSubscriptions.find(s=>s.name.startsWith('messages-'+channel+'-')&&!s.removed);
  const handler=live.handlers.find(([type,f])=>type==='postgres_changes'&&f.table==='messages'&&f.event==='*')[2];
  const rows=window.__qaData.messages.filter(m=>m.channel_id===channel&&m.id!==ROOT).slice(0,count);
  await Promise.all(rows.map(row=>handler({eventType:'INSERT',new:row,old:{}})));
 },{channel,count,ROOT});
 await page.waitForFunction(()=>document.querySelectorAll('#message-list .message').length===150);
}
async function assertTarget(page,count=151){
 await page.waitForFunction(ROOT=>!!document.querySelector('#message-list [data-message-id="'+ROOT+'"].message-target'),ROOT,{timeout:2000}).catch(()=>{});
 const target=page.locator('#message-list [data-message-id="'+ROOT+'"]');
 assert.equal(await target.count(),1,'Root antigo deve estar no DOM após revelar (150 recentes não podem excluí-lo)');
 assert(await target.evaluate(n=>n.classList.contains('message-target')),'Destaque visual aplicado');
 const inView=()=>page.evaluate(ROOT=>{const list=document.querySelector('#message-list'),row=list.querySelector('[data-message-id="'+ROOT+'"]'),a=list.getBoundingClientRect(),b=row?.getBoundingClientRect();return !!b&&b.top>=a.top-2&&b.bottom<=a.bottom+2;},ROOT);
 await page.waitForFunction(ROOT=>{const list=document.querySelector('#message-list'),row=list.querySelector('[data-message-id="'+ROOT+'"]'),a=list.getBoundingClientRect(),b=row?.getBoundingClientRect();return !!b&&b.top>=a.top-2&&b.bottom<=a.bottom+2;},ROOT,{timeout:1000}).catch(()=>{});
 assert(await inView(),'Scroll leva o alvo para dentro do viewport');
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
 assert(await inView(),'Restauração posterior não devolve scroll ao fim');
 assert.equal(await page.locator('#message-list .message').count(),count,'Expansão mínima para incluir a raiz');
}
test('clique real na citação revela root fora das últimas 150 linhas',async t=>{
 const {page,errors}=await open(t);await page.getByRole('button',{name:'Ir para a mensagem respondida',exact:true}).click();await assertTarget(page);
 const queries=await page.evaluate(()=>window.__qaQueries.filter(q=>q.table==='messages'&&q.operation==='select'));
 const rootReads=queries.filter(q=>q.filters.some(([k,c,v])=>k==='eq'&&c==='id'&&v===ROOT));
 assert.equal(rootReads.length,1,'Só fetch pontual da raiz');assert(rootReads[0].filters.some(([k,c,v])=>k==='eq'&&c==='channel_id'&&v===TEXT),'Fetch limitado ao canal');
 assert.equal(queries.filter(q=>q.limit===50).length,1,'Navegação não busca páginas adicionais: '+JSON.stringify(queries.filter(q=>q.limit===50)));assert.deepEqual(errors,[]);
});
test('clique real no resultado da busca revela root antigo e mantém scroll',async t=>{
 const {page,errors}=await open(t);await page.locator('#search-messages').fill('azulejo');await page.locator('#search-messages').press('Enter');
 const result=page.locator('.search-result').filter({hasText:'Raiz antiga azulejo'});await result.getByRole('button',{name:'Abrir mensagem',exact:true}).click();await assertTarget(page);assert.deepEqual(errors,[]);
});
test('resultado de busca mantém alvo após primeira página atrasada terminar',async t=>{
 const {page,errors}=await open(t);await page.locator('#search-messages').fill('azulejo');await page.locator('#search-messages').press('Enter');
 const result=page.locator('.search-result').filter({hasText:'Raiz antiga azulejo'});await result.waitFor();await page.evaluate(()=>window.__qaHoldHistory=true);
 await result.getByRole('button',{name:'Abrir mensagem',exact:true}).click();await page.waitForFunction(()=>!!window.__qaReleaseHistory);
 await page.waitForFunction(ROOT=>!!document.querySelector('#message-list [data-message-id="'+ROOT+'"]'),ROOT);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
 await page.evaluate(()=>window.__qaReleaseHistory());await page.waitForFunction(()=>document.querySelector('#message-list').getAttribute('aria-busy')==='false');
 await assertTarget(page);assert.deepEqual(errors,[]);
});
test('leitura pendente com novas mensagens não remove a raiz revelada',async t=>{
 const {page,errors}=await open(t),newer=Array.from({length:50},(_,i)=>message(i+150));
 await page.evaluate(rows=>window.__qaData.messages.push(...rows),newer);
 await page.locator('#search-messages').fill('azulejo');await page.locator('#search-messages').press('Enter');
 const result=page.locator('.search-result').filter({hasText:'Raiz antiga azulejo'});await result.waitFor();
 await page.evaluate(()=>window.__qaHoldHistory=true);await result.getByRole('button',{name:'Abrir mensagem',exact:true}).click();
 await page.waitForFunction(()=>!!window.__qaReleaseHistory);
 await page.waitForFunction(ROOT=>!!document.querySelector('#message-list [data-message-id="'+ROOT+'"]'),ROOT);
 await page.evaluate(()=>window.__qaReleaseHistory());await page.waitForFunction(()=>document.querySelector('#message-list').getAttribute('aria-busy')==='false');
 await assertTarget(page,201);assert.deepEqual(errors,[]);
});
test('janela ampliada de um canal não vaza para outro',async t=>{
 const {page,errors}=await open(t);await page.getByRole('button',{name:'Ir para a mensagem respondida',exact:true}).click();await assertTarget(page);
 await page.locator('[data-channel-id="'+TEXT2+'"]').first().click();await page.locator('#channel-title').getByText('projetos',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('#message-list').getAttribute('aria-busy')==='false');
 await hydrate(page,TEXT2,160);assert.equal(await page.locator('#message-list .message').count(),150,'Outro canal preserva sua janela limitada');assert.equal(await page.locator('#message-list [data-message-id="'+ROOT+'"]').count(),0);assert.equal(await page.locator('#message-list .message-target').count(),0);
 await page.locator('[data-channel-id="'+TEXT+'"]').first().click();await page.locator('#channel-title').getByText('geral',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('#message-list').getAttribute('aria-busy')==='false');
 assert.equal(await page.locator('#message-list [data-message-id="'+ROOT+'"]').count(),1,'Canal de origem guarda sua janela ao voltar');assert.deepEqual(errors,[]);
});
test('root buscado em voo não é injetado após navegar para outro canal',async t=>{
 const {page,errors}=await open(t);await page.evaluate(()=>window.__qaHoldRoot=true);await page.getByRole('button',{name:'Ir para a mensagem respondida',exact:true}).click();await page.waitForFunction(()=>!!window.__qaReleaseRoot);
 await page.locator('[data-channel-id="'+TEXT2+'"]').first().click();await page.locator('#channel-title').getByText('projetos',{exact:true}).waitFor();await page.evaluate(()=>window.__qaReleaseRoot());
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await page.locator('#message-list [data-message-id="'+ROOT+'"]').count(),0);assert.equal(await page.locator('#message-list .message-target').count(),0);assert.deepEqual(errors,[]);
});
