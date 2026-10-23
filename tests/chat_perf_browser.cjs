// Chat real com histórico grande (260 mensagens, rajadas do mesmo autor, imagens, nomes estilizados e molduras):
// mede tarefas longas, script/layout ao rolar e ao chegar mensagens em tempo real, nós do DOM e heap; confere agrupamento e Chat v2.
const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub:baseStub,USER,TEXT}=require('./fixtures/supabase_fixture.cjs');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const m=baseStub.match(/^const data=(\{.*?\});window\.__qaData/s);const data=JSON.parse(m[1]);
const styles=['nebulosa-name_style','cyber-tokyo-name_style','floresta-name_style','inferno-name_style','abissal-name_style'];
const people=data.profiles.slice(0,2);for(let i=0;i<5;i++)people.push({...data.profiles[0],id:`aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12,'0')}`,display_name:'Pessoa '+(i+1),username:'pessoa'+(i+1)});
people.forEach((p,i)=>{p.appearance={name_style:styles[i%5],frame:styles[i%5].replace('name_style','frame')};});
data.profiles=[...people,data.profiles[2]];data.community_members=people.map(p=>({community_id:data.communities[0].id,user_id:p.id}));
const N=+(process.env.CHAT_N||260),msgs=[],atts=[];let t=Date.now()-N*50000,k=0;
while(msgs.length<N){const author=people[k++%people.length];const burst=1+(k*7)%5;for(let j=0;j<burst&&msgs.length<N;j++){t+=j?20000:120000;const i=msgs.length;const id=`55555555-5555-4555-8555-${String(i+1).padStart(12,'0')}`;let attachment=null;if(i%9===4){attachment={id:'a'+i,name:'foto'+i+'.png',mime_type:'image/png',size:204800,path:'x/'+i+'.png',width:640,height:400};atts.push(attachment);}
 msgs.push({id,channel_id:TEXT,author_id:author.id,content:j===0?`Mensagem ${i} com um texto mais longo para ocupar duas linhas no chat e parecer conversa de verdade, com **negrito** e um link https://example.com/${i}`:'continuação '+i,created_at:new Date(Math.min(t,Date.now()-1000)).toISOString(),pinned:false,reply_to:null,thread_root:null,edited_at:null,profiles:author,attachments:attachment,attachment_id:attachment?.id||null,reactions:[],poll_votes:[]});}}
data.messages=msgs;data.attachments=atts;
const stub=baseStub.replace(m[1],()=>JSON.stringify(data));
const shots='/workspace/redesign-shots';fs.mkdirSync(shots,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});const report=[];
 for(const mobile of (process.env.CHAT_MOBILE==='0'?[false]:[false,true])){
  const context=await browser.newContext({viewport:{width:mobile?390:1440,height:mobile?844:900},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});
  await context.route('**/*',route=>{const url=route.request().url();if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub});if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'anon'}});return route.continue();});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.__long=[];new PerformanceObserver(l=>{for(const e of l.getEntries())window.__long.push(e.duration);}).observe({type:'longtask',buffered:true});});
  const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
  const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
  const base=process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/';const t0=Date.now();
  await page.goto(base,{waitUntil:'networkidle'});await page.locator('#message-list .message').first().waitFor();if(process.env.CHAT_CSS)await page.addStyleTag({content:process.env.CHAT_CSS});
  // carrega o histórico inteiro (botão "Carregar mensagens anteriores")
  for(let i=0;i<10;i++){const more=page.locator('#message-list .load-more');if(!await more.count())break;await more.click();await page.waitForTimeout(300);}
  await page.waitForTimeout(1500);const loadMs=Date.now()-t0;
  const a=await metrics(),longLoad=await page.evaluate(()=>window.__long.splice(0));
  // rolagem: 40 passos até o topo e volta
  const list=page.locator('#message-list');
  for(let i=0;i<40;i++){await list.evaluate((n,i)=>{n.scrollTop=n.scrollHeight*(1-i/40)},i);await page.waitForTimeout(25);}
  for(let i=0;i<40;i++){await list.evaluate((n,i)=>{n.scrollTop=n.scrollHeight*i/40},i);await page.waitForTimeout(25);}
  await page.waitForTimeout(300);const b=await metrics(),longScroll=await page.evaluate(()=>window.__long.splice(0));
  if(process.env.CHAT_PROFILE){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
  // tempo real: 20 mensagens novas + digitação/presença
  await page.evaluate(async({TEXT})=>{const subs=(window.__qaChannels||[]).flat();const ins=subs.filter(([type,f])=>type==='postgres_changes'&&f?.table==='messages'&&(f.event==='INSERT'||f.event==='*'));const bc=subs.filter(([type])=>type==='broadcast'||type==='presence');const author=window.__qaData.profiles[3];
   for(let i=0;i<20;i++){const row={id:crypto.randomUUID(),channel_id:TEXT,author_id:author.id,content:'ao vivo '+i,created_at:new Date().toISOString(),pinned:false,reply_to:null,thread_root:null,attachments:null,reactions:[],poll_votes:[]};window.__qaData.messages.push(row);for(const [, ,fn] of ins)fn?.({eventType:'INSERT',new:row,old:{}});for(const [, ,fn] of bc)try{fn?.({event:'typing',payload:{user_id:author.id,name:author.display_name,channel_id:TEXT}});}catch{}await new Promise(r=>setTimeout(r,60));}},{TEXT});
  await page.waitForTimeout(800);if(process.env.CHAT_PROFILE){const {profile}=await cdp.send('Profiler.stop');const self=new Map(),dt=profile.timeDeltas;const byId=new Map(profile.nodes.map(n=>[n.id,n])),par=new Map();profile.nodes.forEach(n=>(n.children||[]).forEach(c=>par.set(c,n.id)));profile.samples.forEach((id,i)=>{let n=byId.get(id).callFrame;if(n.functionName==='querySelectorAll'){const pn=byId.get(par.get(id))?.callFrame;if(pn)n={...pn,functionName:'qsa<'+pn.functionName};}const k=n.functionName+' '+n.url.split('/').pop()+':'+n.lineNumber+':'+n.columnNumber;self.set(k,(self.get(k)||0)+(dt[i]||0)/1000);});console.log([...self].sort((a,b)=>b[1]-a[1]).slice(0,15).map(([k,v])=>Math.round(v)+'ms '+k).join('\n'));}const c=await metrics(),longLive=await page.evaluate(()=>window.__long.splice(0));
  const dom=await page.evaluate(()=>{const l=document.getElementById('message-list'),rows=[...l.querySelectorAll('.message')];const first=rows.find(r=>!r.classList.contains('message-grouped')),g=rows.find(r=>r.classList.contains('message-grouped'));const cs=n=>n&&getComputedStyle(n);
   return {nodes:document.getElementsByTagName('*').length,rows:rows.length,grouped:rows.filter(r=>r.classList.contains('message-grouped')).length,groupedMetaVisible:g?cs(g.querySelector('.message-meta')).display!=='none':null,groupedAvatarVisible:g?cs(g.querySelector('.avatar')).visibility!=='hidden'&&cs(g.querySelector('.avatar')).display!=='none':null,
    textPx:parseFloat(cs(first.querySelector('.message-content p, .message-content .message-text, .message-content div:not(.message-meta)'))?.fontSize||0),namePx:parseFloat(cs(first.querySelector('.message-meta strong')).fontSize),avatarPx:first.querySelector('.avatar').getBoundingClientRect().width,
    canvases:l.querySelectorAll('canvas').length,animatedNames:[...l.querySelectorAll('.message-meta strong')].filter(n=>{const s=cs(n);return s.animationName!=='none'&&s.animationPlayState!=='paused';}).length}});
  const sum=x=>Math.round(x.reduce((s,v)=>s+v,0));
  const r={mobile,loadMs,longTasks:{load:longLoad.length,scroll:longScroll.length,live:longLive.length,liveMs:sum(longLive),scrollMs:sum(longScroll)},scriptMs:{load:Math.round(a.ScriptDuration*1000),scroll:Math.round((b.ScriptDuration-a.ScriptDuration)*1000),live:Math.round((c.ScriptDuration-b.ScriptDuration)*1000)},layoutMs:{scroll:Math.round((b.LayoutDuration-a.LayoutDuration)*1000),live:Math.round((c.LayoutDuration-b.LayoutDuration)*1000)},recalcMs:{scroll:Math.round((b.RecalcStyleDuration-a.RecalcStyleDuration)*1000),live:Math.round((c.RecalcStyleDuration-b.RecalcStyleDuration)*1000)},heapMB:+(c.JSHeapUsedSize/1048576).toFixed(1),...dom,errors:errors.length};
  report.push(r);
  await list.evaluate(n=>n.scrollTop=n.scrollHeight);await page.waitForTimeout(300);
  const tag=process.env.CHAT_TAG||'';await page.screenshot({path:path.join(shots,`full-chat-v3${tag}-${mobile?'mobile':'desktop'}.png`)});
  const row=page.locator('#message-list .message-grouped').last();if(await row.count()){await row.hover();await page.waitForTimeout(250);await page.screenshot({path:path.join(shots,`full-chat-v3${tag}-${mobile?'mobile':'desktop'}-hover.png`)});}
  if(process.env.CHAT_ASSERT!=='0'){assert(r.grouped>0,'agrupamento');assert.equal(r.groupedMetaVisible,false);assert.equal(r.groupedAvatarVisible,false);assert(r.namePx>=15&&r.textPx>=15,'tamanhos');assert(r.avatarPx>=36);assert.equal(r.canvases,0);assert(r.animatedNames<=1,'nomes animados');assert(r.longTasks.live<=2,'tarefas longas ao vivo: '+r.longTasks.live);assert.deepEqual(errors,[]);}
  await context.close();
 }
 console.log(JSON.stringify(report,null,1));await browser.close();
})().catch(async e=>{console.error(e);process.exitCode=1;});
