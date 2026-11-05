// Regressão de alinhamento: nenhuma folha externa (extensão, userscript ou tema) pode
// deslocar as linhas do corpo da mensagem para fora da coluna do conteúdo.
// O guard em stylesheet empata em especificidade com o invasor e perde pela ordem de
// origem; só o estilo inline com !important é inatingível por CSS de autor.
const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,USER,OTHER,TEXT}=require('./fixtures/supabase_fixture.cjs');
const path=require('node:path'),assert=require('node:assert/strict');
const multiline={id:'66666666-6666-4666-8666-666666666666',channel_id:TEXT,author_id:OTHER,
  content:'meu mic n quer funfar\nmas no teste ele funciona\nentao\nbora discord\nresolver essa fita',
  created_at:new Date().toISOString(),pinned:false,reply_to:null,thread_root:null,edited_at:null,
  profiles:{id:OTHER,display_name:'Outra pessoa',username:'colega'},attachments:null,reactions:[],poll_votes:[]};
const INJECTIONS={
  'display:block e avatar flutuante':`html body #message-list .message{display:block!important}
    html body #message-list .message>.avatar{float:left!important;margin:0 16px 0 0!important}
    html body #message-list .message>.message-content{display:block!important}`,
  'recuo só nas continuações':`html body #message-list .message>.message-content>p{padding-left:56px!important}`,
  'avatar absoluto sobre o texto':`html body #message-list .message>.avatar{position:absolute!important;top:0!important;left:0!important}`
};
const measure=()=>{
  const row=[...document.querySelectorAll('#message-list .message')].find(n=>n.dataset.messageId==='66666666-6666-4666-8666-666666666666');
  if(!row)return {missing:true};
  const p=row.querySelector('.message-content>p');
  const column=Math.round(row.querySelector('.message-content').getBoundingClientRect().left);
  const range=document.createRange();range.selectNodeContents(p);
  const lines=[...range.getClientRects()].filter(r=>r.width>1).map(r=>Math.round(r.left));
  const avatar=row.querySelector('.avatar').getBoundingClientRect();
  return {column,lefts:lines,ragged:Math.max(...lines)-Math.min(...lines),
    avatarInside:Math.round(avatar.left)>=Math.round(row.getBoundingClientRect().left),
    avatarWidth:Math.round(avatar.width),display:getComputedStyle(row).display};
};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 const report=[];
 try{
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   const mobile=viewport.width<=780,context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});
   try{
    await context.route('**/*',route=>{const url=route.request().url();
     if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub+`;window.__qaData.messages.push(${JSON.stringify(multiline)});`});
     if(url.includes('livekit-client'))return route.fulfill({contentType:'application/javascript',body:'export default class{}'});
     if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'qa',callsConfigured:false,storageConfigured:true}});
     return route.continue();});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/',{waitUntil:'networkidle'});
    await page.locator('#message-list .message').first().waitFor();
    const clean=await page.evaluate(measure);
    assert(!clean.missing,'a mensagem de teste precisa estar na tela');
    assert.equal(clean.ragged,0,'sem injeção as linhas devem alinhar na coluna do conteúdo: '+JSON.stringify(clean));
    report.push({viewport:viewport.width,clean:true,ragged:clean.ragged});
    for(const [name,css] of Object.entries(INJECTIONS)){
     await page.evaluate(text=>{document.getElementById('qa-hostile')?.remove();
      const link=document.createElement('style');link.id='qa-hostile';link.textContent=text;document.head.append(link);},css);
     await page.waitForTimeout(60);
     const at=await page.evaluate(measure);
     assert.equal(at.ragged,0,`injeção "${name}" deixei as linhas irregulares: `+JSON.stringify(at));
     assert.equal(at.column,at.lefts[0],`injeção "${name}" tirou o corpo da coluna do conteúdo: `+JSON.stringify(at));
     assert(at.avatarInside,`injeção "${name}" tirou o avatar da linha: `+JSON.stringify(at));
     report.push({viewport:viewport.width,injection:name,ragged:at.ragged,display:at.display});
     await page.evaluate(()=>document.getElementById('qa-hostile')?.remove());
    }
    assert.deepEqual(errors,[]);
   }finally{await context.close();}
  }
  console.log('message alignment OK: '+JSON.stringify(report));
 }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
