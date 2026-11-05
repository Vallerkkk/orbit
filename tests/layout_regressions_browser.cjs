const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,VOICE}=require('./fixtures/supabase_fixture.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const tmp=path.resolve(__dirname,'../work/layout-regressions');fs.mkdirSync(tmp,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 try{
  for(const viewport of [{width:390,height:844},{width:320,height:568},{width:768,height:600},{width:1440,height:900}]){
   const mobile=viewport.width<=780,context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});
   try{
    await context.route('**/*',route=>{const url=route.request().url();if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub});if(url.includes('livekit-client'))return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(__dirname,'fixtures/livekit_stub.mjs'),'utf8')});if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'qa',callsConfigured:true,storageConfigured:true}});if(url.endsWith('/join'))return route.fulfill({json:{url:'wss://fake.invalid',token:'fake',canPublish:true}});return route.continue();});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/',{waitUntil:'networkidle'});await page.locator('#message-list .message').first().waitFor();
    if(mobile)await page.locator('#mobile-menu-btn').click();
    await page.locator(`[data-channel-id="${VOICE}"]`).first().click();await page.locator('#join-call').click();await page.waitForFunction(()=>window.__qaRoom?.state==='connected');
    await page.evaluate(()=>{const room=window.__qaRoom,peer=[...room.remoteParticipants.values()][0];for(let i=0;i<6;i++){const participant=Object.assign(Object.create(Object.getPrototypeOf(peer)),peer,{identity:'layout-peer-'+i,name:'Participante '+i});room.remoteParticipants.set(participant.identity,participant);room.emit('ParticipantConnected',participant);}});
    await page.waitForFunction(()=>document.querySelectorAll('.call-grid .participant').length===8);
    await page.screenshot({path:path.join(tmp,viewport.width+'-call.png')});
    const reachable=await page.locator('.voice-stage').evaluate(stage=>{stage.scrollTop=0;const rect=stage.getBoundingClientRect(),tiles=[...stage.querySelectorAll('.participant')],firstTop=tiles[0].getBoundingClientRect().top;stage.scrollTop=stage.scrollHeight;return {overflow:getComputedStyle(stage).overflowY,canScroll:stage.scrollTop>0,firstTop,stageTop:rect.top,lastBottom:tiles.at(-1).getBoundingClientRect().bottom,stageBottom:rect.bottom};});
    assert(reachable.firstTop>=reachable.stageTop-1&&reachable.lastBottom<=reachable.stageBottom+1&&(!reachable.canScroll||['auto','scroll'].includes(reachable.overflow)),'Participantes devem ser alcançáveis por rolagem: '+JSON.stringify({viewport,...reachable}));
    if(mobile&&reachable.canScroll){const stage=page.locator('.voice-stage'),rect=await stage.boundingBox();await stage.evaluate(node=>{node.scrollTop=0;});const client=await context.newCDPSession(page),x=Math.round(rect.x+rect.width/4),y=Math.round(rect.y+rect.height-30);await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let step=1;step<=6;step++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-step*30}]});await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForFunction(()=>document.querySelector('.voice-stage').scrollTop>0,null,{timeout:2000});assert(await stage.evaluate(node=>node.scrollTop>0),'O gesto de toque deve rolar os participantes');await client.detach();}
    const leave=await page.locator('#leave-call').boundingBox();assert(leave&&leave.y>=0&&leave.y+leave.height<=viewport.height+1,'Desconectar deve ficar dentro da tela: '+JSON.stringify({viewport,leave}));
    if(mobile){const menu=await page.locator('.participant .call-tile-menu').last().boundingBox();assert(menu&&menu.width>=44&&menu.height>=44,'Menu do participante deve ter alvo de toque de 44px: '+JSON.stringify({viewport,menu}));}
    await page.locator('#leave-call').click();await page.waitForFunction(()=>!document.querySelector('.call-footer')||getComputedStyle(document.querySelector('.call-footer')).display==='none');
    assert.deepEqual(errors,[]);console.log(JSON.stringify({viewport,participants:8,reachable:true,leaveVisible:true,touchTargets:mobile}));
   }finally{await context.close();}
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
