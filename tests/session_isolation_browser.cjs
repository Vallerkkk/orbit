// Frontend isolation only: this fixture does not execute or validate Supabase RLS.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,USER,OTHER,TEXT}=require('./fixtures/supabase_fixture.cjs');
const URL=process.env.ORBITA_TEST_URL||'http://127.0.0.1:9001/static/index.html';
const MEDIA_PATH=`channels/${TEXT}/${USER}/session-private-media`;
const mock=stub+`;
const qaCreateClient=createClient;
createClient=function(){
 const client=qaCreateClient(),rawFrom=client.from,rawStorage=client.storage.from,rawRemove=client.removeChannel;
 window.__qaWrites=[];window.__qaStorageActions=[];
 client.from=table=>{
  const q=rawFrom(table),insert=q.insert,del=q.delete,then=q.then;let operation,value;
  q.insert=v=>{operation='insert';value=v;return insert(v)};
  q.delete=()=>{operation='delete';return del()};
  q.then=(resolve,reject)=>{
   if(operation)window.__qaWrites.push({table,operation,value,user:window.__qaSession?.user.id||null});
   if(['messages','direct_messages'].includes(table)&&operation==='insert'&&window.__qaRejectMessage)return Promise.resolve({data:null,error:{message:'publication rejected for test'}}).then(resolve,reject);
   const pending=then(async result=>{
    if(table==='attachments'&&operation==='insert'&&window.__qaDelayAttachment){
     window.__qaDelayAttachment=false;
     await new Promise(done=>{window.__qaReleaseAttachment=()=>{window.__qaReleaseAttachment=null;done()}});
    }
    if(table==='attachments'&&operation==='delete'&&window.__qaDelayDelete){
     window.__qaDelayDelete=false;
     await new Promise(done=>{window.__qaReleaseDelete=()=>{window.__qaReleaseDelete=null;done()}});
    }
    return result;
   });
   return pending.then(resolve,reject);
  };
  return q;
 };
 client.removeChannel=async channel=>{
  if(window.__qaHoldCleanup){window.__qaCleanupReached=true;await new Promise(done=>(window.__qaCleanupWaiters||=[]).push(done));}
  return rawRemove(channel);
 };
 client.storage.from=bucket=>{
  const api=rawStorage(bucket),upload=api.upload,remove=api.remove,signed=api.createSignedUrl,signedMany=api.createSignedUrls;
  const record=(operation,details)=>window.__qaStorageActions.push({operation,bucket,...details,user:window.__qaSession?.user.id||null});
  const mediaReady=async paths=>{
   const media=window.__qaMedia;if(!media||!paths.includes(media.path))return null;
   if(media.delayed)await new Promise(done=>{window.__qaReleaseMedia=url=>{window.__qaReleaseMedia=null;media.delayed=false;if(url)media.url=url;done()}});
   return media;
  };
  api.upload=async(path,...args)=>{record('upload',{path});return upload(path,...args)};
  api.remove=async paths=>{record('remove',{paths});return remove(paths)};
  api.createSignedUrl=async(path,...args)=>{
   record('createSignedUrl',{path});const media=await mediaReady([path]);
   return media?{data:{signedUrl:media.url},error:null}:signed(path,...args);
  };
  api.createSignedUrls=async(paths,...args)=>{
   record('createSignedUrls',{paths});const media=await mediaReady(paths),result=await signedMany(paths,...args);
   if(media)for(const item of result.data||[])if(item.path===media.path)item.signedUrl=media.url;
   return result;
  };
  api.download=async path=>{
   record('download',{path});const media=await mediaReady([path]);
   if(!media)throw Error('Unexpected Storage download: '+path);
   return {data:media.blob,error:null};
  };
  return api;
 };
 return client;
};`;
let browser;
before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined,args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
async function openApp(t){
 const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
 t.after(()=>context.close());
 await context.addInitScript(()=>{
  localStorage.setItem('orbita-onboarded','1');
  window.__qaRevoked=[];const revoke=URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL=url=>{window.__qaRevoked.push(url);revoke(url)};
 });
 await context.route('**/*',async route=>{
  const url=route.request().url();
  if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:url.endsWith('/+esm')?mock:''});
  if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public-qa',callsConfigured:false,storageConfigured:true,uploadLimit:26214400,pushConfigured:false}});
  if(new globalThis.URL(url).origin!==new globalThis.URL(URL).origin)return route.abort();
  return route.continue();
 });
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(URL,{waitUntil:'networkidle'});
 await page.locator('#message-list .message').first().waitFor();
 await page.waitForFunction(()=>window.__qaSubscriptions?.some(c=>c.name.startsWith('user:')));
 return {page,errors};
}
async function auth(page,user,{hold=false}={}){
 await page.evaluate(({user,hold})=>{
  window.__qaHoldCleanup=hold;
  const next=user?{user:{id:user,email:'local@example.invalid',user_metadata:{display_name:'Conta local'}},access_token:'qa-token'}:null;
  window.__qaSession=next;window.__qaAuthCallback(user?'SIGNED_IN':'SIGNED_OUT',next);
 },{user,hold});
 if(hold)await page.waitForFunction(()=>window.__qaCleanupReached);
 else if(!user)await page.waitForFunction(()=>!document.getElementById('auth-view').hidden);
 else await page.waitForFunction(user=>document.querySelector('#message-list .message')&&!document.getElementById('app-view').hidden&&window.__qaSubscriptions.some(c=>!c.removed&&c.name==='user:'+user),user);
}
async function paste(page){
 return page.evaluate(()=>{
  const data=new DataTransfer();data.items.add(new File(['GIF89a'],'conta-a.gif',{type:'image/gif'}));
  document.getElementById('message-input').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
  return document.querySelector('.paste-tray img')?.src;
 });
}
async function enterPaste(page){await page.locator('#message-input').press('Enter');}
async function chooseFile(page){
 await page.locator('#file-input').setInputFiles({name:'conta-a.txt',mimeType:'text/plain',buffer:Buffer.from('private A')});
}
async function writes(page){return page.evaluate(()=>window.__qaWrites.filter(x=>['messages','direct_messages'].includes(x.table)&&x.operation==='insert'));}
async function assertNoCrossAccountCleanup(page){
 const actions=await page.evaluate(()=>({deletes:window.__qaWrites.filter(x=>x.table==='attachments'&&x.operation==='delete'),removes:window.__qaStorageActions.filter(x=>x.operation==='remove')}));
 assert.deepEqual(actions,{deletes:[],removes:[]},'late A upload must not be deleted using the logged-out/B client');
}
async function makeMedia(page,{delayed=false,video=false}={}){
 const name=video?'privado-a.webm':'privado-a.png',path=MEDIA_PATH+(video?'-video':'');
 await page.evaluate(async({delayed,video,name,path,user,channel})=>{
  const canvas=document.createElement('canvas');canvas.width=480;canvas.height=320;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#7c5cff';ctx.fillRect(0,0,480,320);
  let blob;
  if(video){
   const stream=canvas.captureStream(10),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),parts=[];
   recorder.ondataavailable=e=>parts.push(e.data);const stopped=new Promise(done=>recorder.onstop=done);recorder.start();
   const timer=setInterval(()=>{ctx.fillRect(0,0,480,320)},100);
   await new Promise(done=>setTimeout(done,1000));recorder.stop();await stopped;clearInterval(timer);stream.getTracks().forEach(track=>track.stop());
   blob=new Blob(parts,{type:'video/webm'});
  }else blob=await new Promise(done=>canvas.toBlob(done,'image/png'));
  window.__qaMedia={path,delayed,blob,url:URL.createObjectURL(blob)};
  const a={id:crypto.randomUUID(),owner_id:user,channel_id:channel,conversation_id:null,file_id:path,storage_path:path,storage_proof:'supabase-private-v1',name,mime_type:blob.type,size:blob.size};
  const m={id:crypto.randomUUID(),channel_id:channel,author_id:user,content:'Mídia privada de A',created_at:new Date(Date.now()+1000).toISOString(),pinned:false,reply_to:null,thread_root:null,edited_at:null,attachment_id:a.id,attachments:a,profiles:window.__qaData.profiles.find(p=>p.id===user),reactions:[],poll_votes:[]};
  window.__qaData.attachments.push(a);window.__qaData.messages.push(m);
  const live=window.__qaSubscriptions.find(c=>!c.removed&&c.name.startsWith('messages-')&&c.handlers.some(([type,f])=>type==='postgres_changes'&&f.table==='messages'&&f.event==='*'&&f.filter==='channel_id=eq.'+channel));
  if(!live)throw Error('Active message subscription not found');
  const handler=live.handlers.find(([type,f])=>type==='postgres_changes'&&f.table==='messages'&&f.event==='*');
  await handler[2]({eventType:'INSERT',schema:'public',table:'messages',new:{id:m.id,channel_id:channel},old:{}});
 },{delayed,video,name,path,user:USER,channel:TEXT});
 // Identify the preview only after the served app has rendered it; never import app modules.
 const preview=page.locator(video?'#message-list video[aria-label="Vídeo: '+name+'"]':'#message-list .attachment-preview[alt="'+name+'"]');
 await preview.waitFor();await preview.evaluate(node=>node.id='session-test-media');
 if(delayed)await page.waitForFunction(()=>!!window.__qaReleaseMedia);
 else await page.waitForFunction(()=>!!document.getElementById('session-test-media').getAttribute('src'));
 assert(await page.evaluate(path=>window.__qaStorageActions.some(x=>x.bucket==='orbita-files'&&x.user===window.__qaSession.user.id&&((x.operation==='createSignedUrl'&&x.path===path)||(x.operation==='createSignedUrls'&&x.paths.includes(path)))),path),'renderer must resolve the fixture attachment through the app Storage boundary');
}
async function assertViewerEmpty(page){
 assert.deepEqual(await page.evaluate(()=>{
  const d=document.querySelector('.media-viewer');
  return {open:!!d?.open,media:d?.querySelector('.mv-stage').childElementCount||0,name:d?.querySelector('.mv-name').textContent||'',download:!!d?.querySelector('.mv-download').onclick};
 }),{open:false,media:0,name:'',download:false},'viewer must synchronously forget private media and download closure');
}

test('pasted image still sends normally and token refresh retains the tray',async t=>{
 const {page,errors}=await openApp(t);const url=await paste(page);assert(url?.startsWith('blob:'));
 await auth(page,USER);assert.equal(await page.locator('.paste-tray img').count(),1);
 await enterPaste(page);await page.waitForFunction(()=>document.getElementById('toast').textContent==='Arquivo enviado.');
 const sent=await writes(page);assert.equal(sent.length,1);assert.equal(sent[0].value.author_id,USER);assert(sent[0].value.attachment_id);
 assert.equal(await page.locator('.paste-tray img').count(),0);assert((await page.evaluate(()=>window.__qaRevoked)).includes(url));assert.deepEqual(errors,[]);
});
for(const next of [null,OTHER]){
 const label=next?'A => B':'logout';
 test('paste tray clears before subscription cleanup awaits: '+label,async t=>{
  const {page,errors}=await openApp(t),url=await paste(page);
  await auth(page,next,{hold:true});
  assert.equal(await page.locator('.paste-tray img').count(),0,'account A images remain in tray during cleanup');
  assert((await page.evaluate(()=>window.__qaRevoked)).includes(url),'object URL must be revoked immediately');
  await page.evaluate(()=>{window.__qaHoldCleanup=false;window.__qaCleanupWaiters.splice(0).forEach(done=>done())});
  if(!next)await auth(page,OTHER);else await page.locator('#message-list .message').first().waitFor();
  await enterPaste(page);assert.deepEqual(await writes(page),[]);assert.deepEqual(errors,[]);
 });
 test('open private media is synchronously closed: '+label,async t=>{
  const {page,errors}=await openApp(t);await makeMedia(page);await page.locator('#session-test-media').click();
  assert.equal(await page.locator('.media-viewer[open]').count(),1);
  await auth(page,next,{hold:true});await assertViewerEmpty(page);assert.deepEqual(errors,[]);
 });
 test('delayed media click cannot reopen after transition: '+label,async t=>{
  const {page,errors}=await openApp(t);await makeMedia(page,{delayed:true});
  await page.evaluate(()=>document.getElementById('session-test-media').click());
  await auth(page,next,{hold:true});
  await page.evaluate(async()=>{window.__qaReleaseMedia('/static/icons/icon-192.png');await new Promise(done=>setTimeout(done,0))});
  await assertViewerEmpty(page);assert.deepEqual(errors,[]);
 });
 for(const method of ['file picker','paste'])test('late attachments.insert never publishes or throws TypeError ('+method+'): '+label,async t=>{
  const {page,errors}=await openApp(t);await page.evaluate(()=>window.__qaDelayAttachment=true);
  if(method==='paste'){await paste(page);await enterPaste(page);}else await chooseFile(page);
  await page.waitForFunction(()=>!!window.__qaReleaseAttachment);
  await auth(page,next);
  await page.evaluate(()=>window.__qaReleaseAttachment());
  await page.waitForFunction(()=>!document.getElementById('attach-file').disabled);
  assert.deepEqual(await writes(page),[],'late A attachment generated a message after identity changed');
  assert.doesNotMatch(await page.locator('#toast').textContent(),/Cannot read|TypeError/);
  await assertNoCrossAccountCleanup(page);assert.deepEqual(errors,[]);
 });
}
test('media click, keyboard, download, video play/pause, dismiss and reopen work normally',async t=>{
 const {page,errors}=await openApp(t);await makeMedia(page);await page.locator('#session-test-media').click();
 assert.equal(await page.locator('.mv-name').textContent(),'privado-a.png');
 assert.equal(await page.locator('.mv-stage img').getAttribute('alt'),'privado-a.png');
 assert.equal(await page.locator('.mv-stage img').getAttribute('src'),await page.locator('#session-test-media').getAttribute('src'));
 assert.equal(await page.evaluate(()=>window.__qaStorageActions.filter(x=>x.operation==='download').length),0);
 const downloaded=page.waitForEvent('download');await page.locator('.mv-download').click();const download=await downloaded;
 assert.equal(download.suggestedFilename(),'privado-a.png');assert.equal(await download.failure(),null);
 assert.deepEqual(await page.evaluate(()=>window.__qaStorageActions.filter(x=>x.operation==='download')),[{operation:'download',bucket:'orbita-files',path:MEDIA_PATH,user:USER}]);
 await page.locator('.mv-close').click();await assertViewerEmpty(page);
 await page.locator('#session-test-media').press('Enter');assert.equal(await page.locator('.media-viewer[open]').count(),1);
 await page.keyboard.press('Escape');await assertViewerEmpty(page);
 await page.locator('#session-test-media').press('Space');assert.equal(await page.locator('.media-viewer[open]').count(),1);
 await page.locator('.mv-stage').click({position:{x:5,y:5}});await assertViewerEmpty(page);
 await page.locator('#session-test-media').evaluate(node=>node.removeAttribute('id'));await makeMedia(page,{video:true});
 const clip=page.locator('#session-test-media');await clip.evaluate(v=>v.loop=true);await clip.scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>{const v=document.getElementById('session-test-media');return v.readyState>=2&&!v.paused&&v.currentTime>0});
 assert.equal(await clip.evaluate(v=>v.controls&&v.muted&&v.playsInline),true);
 await clip.press('Space');await page.waitForFunction(()=>document.getElementById('session-test-media').paused);
 await clip.press('Space');await page.waitForFunction(()=>!document.getElementById('session-test-media').paused);
 await clip.evaluate(v=>window.__qaOldClip=v);await auth(page,OTHER);
 await page.waitForFunction(()=>{const v=window.__qaOldClip;return v.paused&&!v.isConnected&&!v.hasAttribute('src')});
 assert.deepEqual(errors,[]);
});
test('delayed ready cannot open a removed media node',async t=>{
 const {page,errors}=await openApp(t);await makeMedia(page,{delayed:true});
 await page.evaluate(async()=>{
  const node=document.getElementById('session-test-media');node.click();node.remove();
  window.__qaReleaseMedia('/static/icons/icon-192.png');await new Promise(done=>setTimeout(done,0));
 });
 await assertViewerEmpty(page);assert.deepEqual(errors,[]);
});
test('transition invalidates delayed media even if its inline node stays connected',async t=>{
 const {page,errors}=await openApp(t);await makeMedia(page,{delayed:true});
 await page.evaluate(()=>{const node=document.getElementById('session-test-media');document.body.append(node);node.click()});
 await auth(page,OTHER,{hold:true});
 await page.evaluate(async()=>{window.__qaReleaseMedia('/static/icons/icon-192.png');await new Promise(done=>setTimeout(done,0))});
 assert.equal(await page.locator('#session-test-media').getAttribute('src'),null);
 await assertViewerEmpty(page);assert.deepEqual(errors,[]);
});
for(const method of ['file picker','paste'])test('late upload is cancelled after logout and return to A ('+method+')',async t=>{
 const {page,errors}=await openApp(t);await page.evaluate(()=>window.__qaDelayAttachment=true);
 if(method==='paste'){await paste(page);await enterPaste(page);}else await chooseFile(page);
 await page.waitForFunction(()=>!!window.__qaReleaseAttachment);
 await auth(page,null);await auth(page,USER);await page.evaluate(()=>window.__qaReleaseAttachment());
 await page.waitForFunction(()=>!document.getElementById('attach-file').disabled);
 assert.deepEqual(await writes(page),[],'returning to the same user must not resume an old send');
 assert.deepEqual(errors,[]);
});
test('normal file picker publishes under captured owner',async t=>{
 const {page,errors}=await openApp(t);await chooseFile(page);
 await page.waitForFunction(()=>document.getElementById('toast').textContent==='Arquivo enviado.');
 const sent=await writes(page);assert.equal(sent.length,1);assert.equal(sent[0].value.author_id,USER);
 assert.equal(await page.evaluate(()=>window.__qaData.attachments.at(-1).owner_id),USER);assert.deepEqual(errors,[]);
});
test('publication failure cleans attachment under A, but does not remove storage after A => B',async t=>{
 const {page,errors}=await openApp(t);await page.evaluate(()=>{window.__qaRejectMessage=true;window.__qaDelayDelete=true});
 await chooseFile(page);await page.waitForFunction(()=>!!window.__qaReleaseDelete);
 const deletion=await page.evaluate(()=>window.__qaQueries.find(x=>x.table==='attachments'&&x.operation==='delete'));
 assert(deletion.filters.some(([op,key,value])=>op==='eq'&&key==='owner_id'&&value===USER));
 await auth(page,OTHER);await page.evaluate(()=>window.__qaReleaseDelete());
 await page.waitForFunction(()=>!document.getElementById('attach-file').disabled);
 assert.equal(await page.evaluate(()=>window.__qaStorageActions.filter(x=>x.operation==='remove').length),0,'cleanup crossed into account B after delete await');
 assert.deepEqual(errors,[]);
});
