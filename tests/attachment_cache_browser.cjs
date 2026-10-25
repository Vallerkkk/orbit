// Anexos imutáveis: baixar de novo (ou clicar duas vezes enquanto baixa) usa o blob em memória.
const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,USER,TEXT}=require('./fixtures/supabase_fixture.cjs');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const tmp=path.resolve(__dirname,'../work/browser-temp');fs.mkdirSync(tmp,{recursive:true});process.env.TEMP=tmp;process.env.TMP=tmp;
const ATT='dddddddd-dddd-4ddd-8ddd-dddddddddddd',MSG='cccccccc-cccc-4ccc-8ccc-cccccccccccc',FILE='channels/'+TEXT+'/'+USER+'/relatorio.pdf';
const seed=`;data.attachments.push({id:'${ATT}',owner_id:'${USER}',channel_id:'${TEXT}',conversation_id:null,file_id:'${FILE}',storage_path:'${FILE}',name:'relatorio.pdf',mime_type:'application/pdf',size:16});
data.messages.push({id:'${MSG}',channel_id:'${TEXT}',author_id:'${USER}',content:'📎 relatorio.pdf',created_at:new Date(Date.now()+1000).toISOString(),thread_root:null,pinned:false,reply_to:null,edited_at:null,attachments:{id:'${ATT}',owner_id:'${USER}',storage_path:'${FILE}',file_id:'${FILE}',name:'relatorio.pdf',mime_type:'application/pdf',size:16},profiles:{id:'${USER}',display_name:'Você',username:'eu',avatar_color:'#8b5cf6'},reactions:[],poll_votes:[]});`;
const mock=stub+seed+`;const qaCreateClient=createClient;createClient=function(){const client=qaCreateClient(),from=client.storage.from.bind(client.storage);window.__qaDownloads=0;client.storage.from=bucket=>{const api=from(bucket);if(bucket==='orbita-files')api.download=path=>{window.__qaDownloads++;window.__qaDownloadedPath=path;return new Promise(resolve=>{window.__qaReleaseDownload=()=>resolve({data:new Blob(['arquivo de teste'],{type:'application/pdf'}),error:null});});};return api;};return client;};`;
let browser;
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
 await context.addInitScript(()=>localStorage.setItem('orbita-onboarded','1'));
 await context.route('**/*',async route=>{const url=route.request().url();if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:url.endsWith('/+esm')?mock:''});if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public-qa',callsConfigured:false,storageConfigured:true,pushConfigured:false}});return route.continue();});
 const page=await context.newPage(),errors=[],downloads=[];page.on('pageerror',error=>errors.push(error.message));page.on('download',download=>downloads.push(download));
 await page.goto(process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/',{waitUntil:'networkidle'});
 await page.locator('#message-list .message').first().waitFor({timeout:10000});
 const card=page.locator('#message-list .att-card').first();await card.waitFor();
 await card.click();await page.waitForFunction(()=>window.__qaDownloads===1);
 await card.click(); // segundo clique enquanto o primeiro download está em andamento
 await page.evaluate(()=>window.__qaReleaseDownload());
 await page.waitForTimeout(500);
 assert.equal(await page.evaluate(()=>window.__qaDownloads),1,'dois cliques simultâneos baixaram o arquivo duas vezes');
 assert(downloads.length>=1,'o clique em Baixar não iniciou um download');
 await card.click();await page.waitForTimeout(500);
 assert.equal(await page.evaluate(()=>window.__qaDownloads),1,'baixar de novo o mesmo anexo voltou a consultar o Storage');
 assert.equal(await page.evaluate(()=>window.__qaDownloadedPath),FILE);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({downloads:downloads.length,storageRequests:await page.evaluate(()=>window.__qaDownloads),errors:0}));
 await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
