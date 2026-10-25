// Duas abas: uma lê a conversa, a outra tem um contador antigo e não pode restaurá-lo.
const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,USER,OTHER,TEXT,TEXT2,VOICE}=require('./fixtures/supabase_fixture.cjs');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const tmp=path.resolve(__dirname,'../work/browser-temp');fs.mkdirSync(tmp,{recursive:true});process.env.TEMP=tmp;process.env.TMP=tmp;
let browser;
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.addInitScript(()=>localStorage.setItem('orbita-onboarded','1'));
 await context.route('**/*',async route=>{const url=route.request().url();if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:url.endsWith('/+esm')?stub:''});if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public-qa',callsConfigured:false,storageConfigured:true,pushConfigured:false}});return route.continue();});
 const errors=[];
 async function open(){const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/',{waitUntil:'domcontentloaded'});await page.locator('#message-list .message').first().waitFor({timeout:10000});return page;}
 const fireActivity=(page,payload)=>page.evaluate(payload=>{for(const handlers of window.__qaChannels||[])for(const [kind,filter,fn]of handlers)if(kind==='broadcast'&&filter?.event==='activity')fn({payload});},payload);
 const pageA=await open();
 await pageA.locator(`[data-channel-id="${TEXT2}"]`).first().click();
 await pageA.locator('#channel-title').getByText('projetos',{exact:true}).waitFor();
 await fireActivity(pageA,{id:'atividade-antiga',scope:TEXT,author_id:OTHER,mentioned:false,private:false});
 await pageA.waitForFunction(({uid,id})=>(JSON.parse(localStorage.getItem('orbita-unread-'+uid)||'{}')[id]?.count||0)===1,{uid:USER,id:TEXT});
 await pageA.locator(`[data-channel-id="${TEXT}"] .unread-indicator`).waitFor();
 const pageB=await open();await pageB.bringToFront();
 await pageB.locator(`[data-channel-id="${TEXT}"]`).first().click();
 await pageB.locator('#channel-title').getByText('geral',{exact:true}).waitFor();
 await pageB.waitForFunction(({uid,id})=>(JSON.parse(localStorage.getItem('orbita-unread-'+uid)||'{}')[id]?.count||0)===0,{uid:USER,id:TEXT});
 await pageA.waitForFunction(id=>!document.querySelector(`[data-channel-id="${id}"] .unread-indicator`),TEXT,{timeout:5000});
 await fireActivity(pageA,{id:'atividade-nova',scope:VOICE,author_id:OTHER,mentioned:false,private:false});
 await pageA.waitForFunction(({uid,id})=>(JSON.parse(localStorage.getItem('orbita-unread-'+uid)||'{}')[id]?.count||0)===1,{uid:USER,id:VOICE});
 const counts=await pageA.evaluate(({uid,TEXT,VOICE})=>({text:JSON.parse(localStorage.getItem('orbita-unread-'+uid)||'{}')[TEXT]?.count||0,voice:JSON.parse(localStorage.getItem('orbita-unread-'+uid)||'{}')[VOICE]?.count||0}),{uid:USER,TEXT,VOICE});
 assert.equal(counts.text,0,'a aba com estado antigo restaurou o contador já lido');
 assert.equal(counts.voice,1);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({staleBadgeRestored:false,voiceUnread:counts.voice,errors:0}));
 await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
