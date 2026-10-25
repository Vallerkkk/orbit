// PV: dois usuários reais (A e B) contra um "servidor" compartilhado que imita start_dm_call.
// Cobre: B no PC é avisado em qualquer tela (overlay global, toque, título, notificação),
// fallback quando o realtime perde o INSERT, glare (B liga de volta => atende a mesma chamada)
// e ligações simultâneas resolvidas em uma só chamada.
const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,USER,OTHER}=require('./fixtures/supabase_fixture.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/',shots=process.env.ORBITA_SHOTS||'';
const livekit=fs.readFileSync(path.join(__dirname,'fixtures/livekit_stub.mjs'),'utf8');
const convo='66666666-6666-4666-8666-000000000002';
let browser;
const server={events:[],pages:{},realtime:true,
 now:()=>new Date().toISOString(),
 broadcast(type,row){if(!this.realtime)return;for(const page of Object.values(this.pages))page.evaluate(({type,row})=>{for(const s of window.__qaSubscriptions.filter(s=>!s.removed))for(const [kind,filter,cb]of s.handlers||[])if(kind==='postgres_changes'&&filter.table==='call_events'&&(filter.event==='*'||filter.event===type))cb({eventType:type,new:row});},{type,row}).catch(()=>{});},
 rpc(user,name,args){
  if(name==='start_dm_call'){
   for(const e of this.events)if(e.status==='ringing'&&Date.now()-Date.parse(e.created_at)>35000){e.status='missed';this.broadcast('UPDATE',{...e});}
   const active=this.events.find(e=>e.conversation_id===args.target&&['ringing','accepted'].includes(e.status));
   if(active)return [{event:{...active},existing:true,server_now:this.now()}];
   const e={id:crypto.randomUUID(),conversation_id:args.target,caller_id:user,kind:args.call_kind||'voice',status:'ringing',created_at:this.now()};this.events.push(e);this.broadcast('INSERT',{...e});
   return [{event:{...e},existing:false,server_now:this.now()}];}
  if(name==='call_event_transition'){const e=this.events.find(e=>e.id===args.event);if(!e)return null;
   if(args.next==='accepted'&&(e.status!=='ringing'||e.caller_id===user))return {...e};
   if(['canceled','missed','declined'].includes(args.next)&&e.status!=='ringing')return {...e};
   if(args.next==='ended'&&e.status!=='accepted')return {...e};
   e.status=args.next;if(args.next==='accepted')e.answered_at=this.now();else e.ended_at=this.now();this.broadcast('UPDATE',{...e});return {...e};}
  if(name==='dm_ringing_calls')return this.events.filter(e=>e.status==='ringing'&&e.caller_id!==user&&Date.now()-Date.parse(e.created_at)<30000).map(e=>({event:{...e},server_now:this.now()}));
  if(name==='dm_unread_counts')return [];
  return undefined;},
 active(){return this.events.filter(e=>['ringing','accepted'].includes(e.status));}};
async function open(user){
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 const joins=[],errors=[],me=user===USER?'A':'B';
 const body=user===USER?stub:stub.replace(`const uid='${USER}'`,`const uid='${OTHER}'`);
 await context.addInitScript(()=>{window.__qaNotifications=[];window.Notification=class{static permission='granted';static requestPermission(){return Promise.resolve('granted');}constructor(title,opts){this.title=title;this.opts=opts;window.__qaNotifications.push({title,...opts});}close(){this.closed=true;}};});
 await context.route('**/*',async route=>{const url=route.request().url();
  if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body});
  if(url.includes('livekit-client'))return route.fulfill({contentType:'application/javascript',body:livekit});
  if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public-qa',callsConfigured:true,storageConfigured:true}});
  if(url.endsWith('/join')){joins.push(url);return route.fulfill({json:{url:'wss://fake.invalid',token:'fake',canPublish:true}});}
  return route.continue();});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(me+': '+e.message));
 await page.exposeFunction('__qaServer',(name,args)=>server.rpc(user,name,args));
 await page.goto(base,{waitUntil:'networkidle'});await page.locator('#message-list .message').first().waitFor();
 await page.evaluate(({USER,OTHER,convo})=>{const d=window.__qaData;d.friendships.push({id:crypto.randomUUID(),requester_id:USER,recipient_id:OTHER,status:'accepted'});d.conversations.push({id:convo,user_a:USER,user_b:OTHER});d.direct_messages=[];d.call_events=[];
  window.__qaRpc=async(name,args)=>window.__qaServer(name,args);
  for(const s of window.__qaSubscriptions.filter(s=>!s.removed))for(const [kind,filter,cb]of s.handlers||[])if(kind==='postgres_changes'&&filter.table==='friendships')cb({eventType:'INSERT'});},{USER,OTHER,convo});
 server.pages[me]=page;return {page,context,joins,errors};
}
async function openDm(page){await page.locator('#friends-nav').click();await page.locator('.friend-card').getByRole('button',{name:'Mensagem',exact:true}).click();await page.locator('#dm-voice-call').waitFor({timeout:8000}).catch(async e=>{await page.screenshot({path:'/tmp/opendm-fail.png'});console.error('OPENDM',page===server.pages.A?'A':'B',await page.evaluate(()=>[document.title,document.getElementById('voice-view').hidden,document.getElementById('text-view')?.hidden,location.hash]));throw e;});}
const joinedDm=j=>j.some(u=>u.includes('/api/conversations/'+convo+'/join'));
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 const A=await open(USER),B=await open(OTHER);
 await openDm(A.page);
 // 1) B no PC, DM fechada e com um diálogo aberto (perfil): mesmo assim recebe a chamada.
 await B.page.locator('#friends-nav').click();
 await B.page.evaluate(()=>{const d=document.getElementById('app-dialog');d.querySelector('#dialog-title')?.replaceChildren('Diálogo aberto');d.showModal();});
 await B.page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.hasFocus=()=>false;});
 const titleBefore=await B.page.title();
 await A.page.locator('#dm-voice-call').click();
 await A.page.locator('#dm-call-card[data-mode=outgoing]').waitFor();
 await B.page.locator('#dm-call-card[data-mode=incoming]').waitFor();
 assert.equal(await B.page.locator('#dm-call-card').evaluate(n=>n.matches(':popover-open')),true,'overlay in top layer');
 const box=await B.page.locator('#dm-call-card').boundingBox();
 assert.equal(await B.page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('#dm-call-card')!==null,{x:box.x+box.width/2,y:box.y+box.height/2}),true,'overlay above modal dialog');
 await B.page.waitForFunction(()=>window.__qaNotifications.length>0);
 const note=await B.page.evaluate(()=>window.__qaNotifications[0]);assert.match(note.title,/Pessoa de teste está te ligando/);
 await B.page.waitForFunction(t=>document.title!==t&&/está ligando/.test(document.title),titleBefore);
 if(shots)await B.page.screenshot({path:path.join(shots,'dm-call-ring-desktop.png')});
 // 2) Glare: B abre a DM e aperta "ligar" => vira "Atender" e entra na MESMA chamada.
 await B.page.evaluate(()=>{delete document.hidden;document.getElementById('app-dialog').close();});
 await openDm(B.page);
 assert.equal(await B.page.locator('#dm-voice-call').getAttribute('data-state'),'answer');
 assert.equal(await B.page.locator('#dm-voice-call').getAttribute('aria-label'),'Atender');
 await B.page.locator('#dm-voice-call').click();
 await A.page.waitForFunction(()=>document.getElementById('dm-call-card').hidden);
 await B.page.waitForFunction(()=>document.getElementById('dm-call-card').hidden);
 await B.page.waitForFunction(()=>!document.getElementById('voice-view').hidden);
console.log(JSON.stringify(server.events));
 assert.equal(server.events.length,1,'no second call created');assert.equal(server.events[0].status,'accepted');
 assert(joinedDm(A.joins)&&joinedDm(B.joins),'both in the DM room');
 assert.equal(await B.page.title(),titleBefore,'title restored');
 // Já em chamada um com o outro: não dá para ligar de novo.
 await A.page.waitForFunction(()=>document.getElementById('dm-voice-call')?.dataset.state==='in-call'||document.getElementById('dm-voice-call')?.disabled);
 await A.page.locator('#leave-call').click();
 // A desligou: o evento vira "ended" e B sai sozinho da sala.
 await B.page.waitForFunction(()=>document.getElementById('voice-view').hidden||document.getElementById('leave-call').offsetParent===null);
 await A.page.waitForFunction(()=>!document.getElementById('dm-voice-call').disabled);
 await openDm(A.page);await openDm(B.page);
 assert.equal(server.active().length,0,'call ended');
 // 3) Realtime perdeu o INSERT (aba em segundo plano): ao voltar, o fallback do servidor toca.
 server.realtime=false;
 await A.page.locator('#dm-video-call').click();await A.page.locator('#dm-call-card[data-mode=outgoing]').waitFor();
 assert(await B.page.locator('#dm-call-card').isHidden());
 await B.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await B.page.locator('#dm-call-card[data-mode=incoming]').waitFor();
 server.realtime=true;
 await A.page.getByRole('button',{name:'Cancelar chamada'}).click();
 await B.page.waitForFunction(()=>document.getElementById('dm-call-card').hidden);
 assert.equal(server.active().length,0);
 // 4) Ligações simultâneas: ambos apertam ao mesmo tempo => uma só chamada, os dois entram.
 await openDm(A.page);await openDm(B.page);
 const before=server.events.length;A.joins.length=0;B.joins.length=0;
 await Promise.all([A.page.locator('#dm-voice-call').click(),B.page.locator('#dm-voice-call').click()]);
 await A.page.waitForFunction(()=>!document.getElementById('voice-view').hidden);await B.page.waitForFunction(()=>!document.getElementById('voice-view').hidden);
 await A.page.waitForFunction(()=>document.getElementById('dm-call-card').hidden);await B.page.waitForFunction(()=>document.getElementById('dm-call-card').hidden);
 assert.equal(server.events.length-before,1,'simultaneous starts => one call');
 assert.equal(server.events.at(-1).status,'accepted');assert(joinedDm(A.joins)&&joinedDm(B.joins));
 assert.deepEqual([...A.errors,...B.errors],[]);
 console.log(JSON.stringify({desktopIncoming:true,overlayTopLayer:true,notification:true,titleFlash:true,glareAnswer:true,realtimeFallback:true,simultaneous:true,errors:0}));
 await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exit(1)});
