// Astro: pedido por texto vira comando real no Ouvir juntos (busca + sessão sincronizada).
const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,VOICE}=require('./fixtures/supabase_fixture.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const tmp=path.resolve(__dirname,'../work/browser-temp');fs.mkdirSync(tmp,{recursive:true});process.env.TEMP=tmp;process.env.TMP=tmp;
const base=process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/';
function fakeYouTube(){
 window.__qaYTPlayers=[];
 window.YT={Player:class{
  constructor(id,options){this.options=options;this.position=options.playerVars?.start||0;this.status=5;this.video=options.videoId||'';const placeholder=document.getElementById(id),frame=document.createElement('iframe');frame.id=id;placeholder?.replaceWith(frame);this.frame=frame;window.__qaYT=this;window.__qaYTPlayers.push(this);setTimeout(()=>{this.ready=true;options.events.onReady({target:this});},300);}
  loadVideoById(value,start=0){this.video=typeof value==='string'?value:value.videoId;this.position=typeof value==='string'?start:value.startSeconds||0;this.status=1;this.options.events.onStateChange({target:this,data:1});}
  cueVideoById(value,start=0){this.video=typeof value==='string'?value:value.videoId;this.position=typeof value==='string'?start:value.startSeconds||0;this.status=5;this.options.events.onStateChange({target:this,data:5});}
  getCurrentTime(){return this.position;}getPlayerState(){return this.status;}getIframe(){return this.frame;}getDuration(){return 0;}getVideoData(){return {video_id:this.video};}
  seekTo(value){this.position=value;}playVideo(){this.status=1;this.options.events.onStateChange({target:this,data:1});}pauseVideo(){this.status=2;this.options.events.onStateChange({target:this,data:2});}
  unMute(){this.unmuted=true;}mute(){this.unmuted=false;}setVolume(value){this.volume=value;}destroy(){this.destroyed=true;this.frame.remove();}
 }};}
let searched='';
let browser,context,page;
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.addInitScript(fakeYouTube);
 const livekit=fs.readFileSync(path.join(__dirname,'fixtures/livekit_stub.mjs'),'utf8');
 await context.route('**/*',route=>{const url=route.request().url();
  if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub});
  if(url.includes('livekit-client'))return route.fulfill({contentType:'application/javascript',body:livekit});
  if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public-qa',callsConfigured:true,storageConfigured:true,pushConfigured:false}});
  if(url.endsWith('/join'))return route.fulfill({json:{url:'wss://fake.invalid',token:'fake',canPublish:true}});
  if(url.includes('/api/astro/')&&route.request().method()==='POST'&&url.includes('/ask'))return route.fulfill({json:{ok:true,watch:'/tocar Suicideboys For the Last Time'}});
  if(url.includes('/api/astro/'))return route.fulfill({json:{configured:true,events:[],cursor:0,window_seconds:900,busy:false}});
  if(url.includes('/api/youtube/search')){searched=new URL(url).searchParams.get('q')||'';return route.fulfill({json:{videos:[{id:'M7lc1UVf-VE',title:'Suicideboys - For the Last Time'}]}});}
  if(url.includes('/oembed'))return route.fulfill({json:{title:'Suicideboys - For the Last Time'}});
  return route.continue();});
 page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base,{waitUntil:'networkidle'});
 await page.locator('#message-list .message').first().waitFor();
 await page.locator(`[data-channel-id="${VOICE}"]`).first().click();
 await page.locator('#join-call').click();
 await page.waitForFunction(()=>window.__qaRoom?.state==='connected');
 const toggle=page.locator('#voice-view .chat-actions button[aria-controls="astro-panel"]');
 await toggle.click();
 await page.locator('#astro-panel').waitFor({state:'visible'});
 await page.getByLabel('Pergunta para a Cloe por texto').fill('Ei Cloe, toque Suicideboys For the Last Time');
 await page.getByRole('button',{name:'Perguntar',exact:true}).click();
 await page.waitForFunction(()=>window.__qaPublished?.some(p=>p.topic==='orbita-watch'&&p.value?.video==='M7lc1UVf-VE'),null,{timeout:20000});
 assert.equal(searched,'Suicideboys For the Last Time','busca enviada ao YouTube não correspondeu ao pedido');
 await page.locator('#watch-panel').waitFor({state:'visible',timeout:10000});
 await page.waitForFunction(()=>window.__qaYT?.video==='M7lc1UVf-VE',null,{timeout:10000});
 assert(/tocou/i.test(await page.locator('#astro-panel').textContent()),'resultado do pedido não apareceu no painel da Cloe');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ask:true,search:true,watchCommand:true,player:true,errors:0}));
 await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
