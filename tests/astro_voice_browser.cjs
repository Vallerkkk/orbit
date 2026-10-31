// Astro: a voz natural feminina é escolhida no painel e pedida ao servidor.
const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,VOICE}=require('./fixtures/supabase_fixture.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const tmp=path.resolve(__dirname,'../work/browser-temp');fs.mkdirSync(tmp,{recursive:true});process.env.TEMP=tmp;process.env.TMP=tmp;
const base=process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/';
const voices=[
 {id:'pt-BR-ThalitaMultilingualNeural',name:'Thalita',note:'feminina, jovem e natural'},
 {id:'pt-BR-FranciscaNeural',name:'Francisca',note:'feminina, clássica e natural'}
];
let spoken=null;
let browser;
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 const livekit=fs.readFileSync(path.join(__dirname,'fixtures/livekit_stub.mjs'),'utf8');
 await context.route('**/*',route=>{const url=route.request().url(),method=route.request().method();
  if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub});
  if(url.includes('livekit-client'))return route.fulfill({contentType:'application/javascript',body:livekit});
  if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public-qa',callsConfigured:true,storageConfigured:true,pushConfigured:false}});
  if(url.endsWith('/join'))return route.fulfill({json:{url:'wss://fake.invalid',token:'fake',canPublish:true}});
  if(url.includes('/api/astro/')&&method==='POST'&&url.endsWith('/speech')){spoken=JSON.parse(route.request().postData()||'{}');return route.fulfill({contentType:'audio/mpeg',body:Buffer.from('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000','binary')});}
  if(url.includes('/api/astro/'))return route.fulfill({json:{configured:true,events:[],cursor:0,window_seconds:900,busy:false,tts:true,voices}});
  return route.continue();});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base,{waitUntil:'networkidle'});
 await page.locator('#message-list .message').first().waitFor();
 await page.locator(`[data-channel-id="${VOICE}"]`).first().click();
 await page.locator('#join-call').click();
 await page.waitForFunction(()=>window.__qaRoom?.state==='connected');
 await page.locator('#voice-view .chat-actions button[aria-controls="astro-panel"]').click();
 await page.locator('#astro-panel').waitFor({state:'visible'});
 const select=page.getByLabel('Voz do Astro');
 await page.waitForFunction(()=>[...document.querySelectorAll('#astro-panel select[aria-label="Voz do Astro"] option')].some(option=>/Thalita/.test(option.textContent)),null,{timeout:15000});
 assert.equal(await select.inputValue(),'n:pt-BR-ThalitaMultilingualNeural','voz natural recomendada não foi a padrão');
 await select.selectOption('n:pt-BR-FranciscaNeural');
 assert.equal(await page.evaluate(()=>localStorage.getItem('orbita-astro-service-voice')),'pt-BR-FranciscaNeural','escolha da voz não foi salva');
 const speech=page.waitForRequest(request=>request.url().includes('/speech')&&request.method()==='POST',{timeout:15000});
 await page.getByRole('button',{name:'Testar voz'}).click();
 await speech;
 assert.equal(spoken.voice,'pt-BR-FranciscaNeural','pedido usou outra voz');
 assert.match(spoken.text,/Astro/,'texto de teste não foi enviado');
 assert.equal(typeof spoken.rate,'number','velocidade não foi enviada');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({voices:'ok',select:'ok',speechRequest:'ok',errors:0}));
 await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
