// PV: ícones de chamada no cabeçalho, toque/cancelamento, chamada recebida, registro e não lidas na barra.
const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,USER,OTHER}=require('./fixtures/supabase_fixture.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/',shots=process.env.ORBITA_SHOTS||'';
const livekit=fs.readFileSync(path.join(__dirname,'fixtures/livekit_stub.mjs'),'utf8');
let browser;
const emit=(page,table,eventType,row)=>page.evaluate(({table,eventType,row})=>{for(const s of window.__qaSubscriptions.filter(s=>!s.removed))for(const [kind,filter,cb]of s.handlers||[])if(kind==='postgres_changes'&&filter.table===table&&(filter.event==='*'||filter.event===eventType))cb({eventType,new:row});},{table,eventType,row});
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 for(const mobile of [false,true]){
  const tag=mobile?'mobile':'desktop';
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});
  const joins=[],errors=[];
  await context.route('**/*',async route=>{const url=route.request().url();
   if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub});
   if(url.includes('livekit-client'))return route.fulfill({contentType:'application/javascript',body:livekit});
   if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public-qa',callsConfigured:true,videochamadaConfigured:true,storageConfigured:true}});
   if(url.endsWith('/join')){joins.push(url);return route.fulfill({json:{url:'wss://fake.invalid',token:'fake',canPublish:true}});}
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'networkidle'});await page.locator('#message-list .message').first().waitFor();
  const convo='66666666-6666-4666-8666-000000000001';
  await page.evaluate(({USER,OTHER,convo})=>{const d=window.__qaData;d.friendships.push({id:crypto.randomUUID(),requester_id:USER,recipient_id:OTHER,status:'accepted'});d.conversations.push({id:convo,user_a:USER,user_b:OTHER});
   d.direct_messages=[0,1,2,3,4].map(i=>({id:'88888888-8888-4888-8888-00000000000'+i,conversation_id:convo,author_id:i<3?OTHER:USER,content:['Oi! Tudo certo?','Vi o novo layout do Órbita','Ficou bem mais limpo 👀','Sim! Bora testar a chamada?','Te ligo agora'][i],created_at:new Date(Date.now()-(10-i)*60000).toISOString(),pinned:false,reply_to:null,thread_root:null,edited_at:null,profiles:d.profiles.find(p=>p.id===(i<3?OTHER:USER))}));
   d.call_events=[{id:crypto.randomUUID(),conversation_id:convo,caller_id:OTHER,kind:'voice',status:'ended',created_at:new Date(Date.now()-8.5*60000).toISOString(),answered_at:new Date(Date.now()-8.4*60000).toISOString(),ended_at:new Date(Date.now()-5*60000).toISOString()},{id:crypto.randomUUID(),conversation_id:convo,caller_id:USER,kind:'video',status:'missed',created_at:new Date(Date.now()-6.5*60000).toISOString()}];
   window.__qaUnread=[{conversation_id:convo,other_id:OTHER,unread:3,last_at:new Date().toISOString()}];
   window.__qaRpc=(name,args)=>{if(name==='dm_unread_counts')return window.__qaUnread;if(name==='mark_conversation_read'){window.__qaUnread=window.__qaUnread.filter(r=>r.conversation_id!==args.target);return new Date().toISOString();}
    if(name==='start_dm_call'){const d=window.__qaData;const active=d.call_events.find(e=>e.conversation_id===args.target&&['ringing','accepted'].includes(e.status));if(active)return [{event:active,existing:true,server_now:new Date().toISOString()}];const e={id:crypto.randomUUID(),conversation_id:args.target,caller_id:d.profiles[0].id,kind:args.call_kind,status:'ringing',created_at:new Date().toISOString()};d.call_events.push(e);return [{event:e,existing:false,server_now:new Date().toISOString()}];}
    if(name==='dm_ringing_calls')return [];
    if(name==='call_event_transition'){const e=window.__qaData.call_events.find(e=>e.id===args.event);if(e){e.status=args.next;if(args.next==='accepted')e.answered_at=new Date().toISOString();else e.ended_at=new Date().toISOString();}return e||null;}};
   for(const s of window.__qaSubscriptions.filter(s=>!s.removed))for(const [kind,filter,cb]of s.handlers||[])if(kind==='postgres_changes'&&filter.table==='friendships')cb({eventType:'INSERT'});},{USER,OTHER,convo});
  // Não lidas: nova DM em tempo real => avatar na barra + total no ícone de início.
  await emit(page,'direct_messages','INSERT',{id:crypto.randomUUID(),conversation_id:convo,author_id:OTHER,content:'oi'});
  await page.locator('#rail-dm-unread .rail-dm-item').waitFor();
  assert.equal(await page.locator('#rail-dm-unread .rail-unread-badge').textContent(),'3');
  assert.equal(await page.locator('#friends-nav .home-unread').textContent(),'3');
  if(shots&&!mobile)await page.locator('#server-rail').screenshot({path:path.join(shots,'dm-notificacoes-rail.png')});
  if(mobile){await page.locator('.main>div:not([hidden]) .mobile-nav-btn').first().click();if(shots)await page.screenshot({path:path.join(shots,'dm-notificacoes-mobile.png')});}
  else if(shots)await page.screenshot({path:path.join(shots,'dm-notificacoes-desktop.png')});
  await page.locator('#rail-dm-unread .rail-dm-item').click();
  await page.locator('#dm-voice-call').waitFor();
  await page.waitForFunction(()=>window.__qaRpcCalls.some(([n])=>n==='mark_conversation_read'));
  await page.waitForFunction(()=>document.getElementById('rail-dm-unread').hidden&&document.querySelector('#friends-nav .home-unread').hidden);
  // Botão flutuante removido; ícones no cabeçalho.
  assert.equal(await page.locator('#private-call').count(),0);
  assert.equal(await page.getByText('Ligar em particular').count(),0);
  assert(await page.locator('#dm-video-call').isVisible());
  await page.locator('#message-list .message').filter({hasText:'Te ligo agora'}).waitFor();
  await page.locator('.dm-call-log').nth(1).waitFor();
  const logs=await page.locator('.dm-call-log').allTextContents();
  assert(logs.some(t=>t.includes('Chamada de voz · 3 min')),logs.join('|'));assert(logs.some(t=>t.includes('sem resposta')),logs.join('|'));
  assert.match(await page.locator('#channel-description').textContent(),/@colega/);
  if(shots)await page.screenshot({path:path.join(shots,'dm-'+tag+'.png')});
  // Chamada de saída: toca, mostra "Chamando…", e cancelar encerra o evento.
  await page.locator('#dm-voice-call').click();
  await page.locator('#dm-call-card[data-mode=outgoing]').waitFor();
  assert.match(await page.locator('#dm-call-card').textContent(),/Chamando…/);
  const event=await page.evaluate(()=>window.__qaData.call_events.at(-1));assert.equal(event.kind,'voice');assert.equal(event.caller_id,USER);
  await page.waitForFunction(()=>!document.getElementById('voice-view').hidden);
  assert(joins.some(u=>u.includes('/api/conversations/'+convo+'/join')),'joins DM room');
  // Destinatário aceita => cartão some e a chamada segue com os controles normais.
  await emit(page,'call_events','UPDATE',{...event,status:'accepted',answered_at:new Date().toISOString()});
  await page.waitForFunction(()=>document.getElementById('dm-call-card').hidden);
  if(shots)await page.screenshot({path:path.join(shots,'dm-in-call-'+tag+'.png')});
  await page.locator('#leave-call').click();
  await page.waitForFunction(id=>window.__qaRpcCalls.some(([n,a])=>n==='call_event_transition'&&a.event===id&&a.next==='ended'),event.id);
  // Chamada recebida: cartão com aceitar/recusar; recusar registra.
  const incoming={id:crypto.randomUUID(),conversation_id:convo,caller_id:OTHER,kind:'video',status:'ringing',created_at:new Date().toISOString()};
  await page.evaluate(e=>window.__qaData.call_events.push(e),incoming);
  await emit(page,'call_events','INSERT',incoming);
  await page.locator('#dm-call-card[data-mode=incoming]').waitFor();
  assert(await page.getByRole('button',{name:'Atender com vídeo'}).isVisible());
  if(shots)await page.screenshot({path:path.join(shots,'dm-incoming-'+tag+'.png')});
  await page.getByRole('button',{name:'Recusar'}).click();
  await page.waitForFunction(id=>window.__qaRpcCalls.some(([n,a])=>n==='call_event_transition'&&a.event===id&&a.next==='declined'),incoming.id);
  assert(await page.locator('#dm-call-card').isHidden());
  // Chamada de saída cancelada pelo autor.
  if(mobile)await page.locator('.main>div:not([hidden]) .mobile-nav-btn').first().click();await page.locator('#friends-nav').click();await page.locator('.friend-card').getByRole('button',{name:'Mensagem',exact:true}).click();
  await page.locator('#dm-video-call').click();await page.locator('#dm-call-card[data-mode=outgoing]').waitFor();
  const outgoing=await page.evaluate(()=>window.__qaData.call_events.at(-1));assert.equal(outgoing.kind,'video');
  await page.getByRole('button',{name:'Cancelar chamada'}).click();
  await page.waitForFunction(id=>window.__qaRpcCalls.some(([n,a])=>n==='call_event_transition'&&a.event===id&&a.next==='canceled'),outgoing.id);
  assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth)>(mobile?391:1441),false);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({mobile,unread_rail:true,header_icons:true,ringing:true,incoming:true,cancel:true,call_log:true,errors:0}));await context.close();
 }
 await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exit(1)});
