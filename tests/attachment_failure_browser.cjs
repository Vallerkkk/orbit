// Regressão: anexo de imagem ou vídeo que não carrega não pode sumir da tela.
// Antes, sem storage_path o node era removido e a linha ficava 0x0 com dois "⋯" soltos;
// com URL quebrada sobrava uma <img> de texto alternativo, de tamanho variável.
const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,OTHER}=require('./fixtures/supabase_fixture.cjs');
const path=require('node:path'),assert=require('node:assert/strict');
const TEXT='33333333-3333-4333-8333-333333333333',base=Date.now();
const mk=(n,attachments)=>({id:`88888888-8888-4888-8888-00000000000${n}`,channel_id:TEXT,author_id:OTHER,
  content:'',created_at:new Date(base-(10-n)*60000).toISOString(),pinned:false,reply_to:null,thread_root:null,
  edited_at:null,profiles:{id:OTHER,display_name:'Outra pessoa',username:'colega'},attachments,
  reactions:[],poll_votes:[]});
const rows=[
  mk(1,{id:'a-ok',name:'foto-boa.png',mime_type:'image/png',size:4096,storage_path:'qa/foto-1.png'}),
  mk(2,{id:'a-orfa',name:'foto-orfa.png',mime_type:'image/png',size:8192,storage_path:''}),
  mk(3,{id:'a-morta',name:'foto-quebrada.png',mime_type:'image/png',size:8192,storage_path:'qa/foto-3.png'})];
const measure=()=>[...document.querySelectorAll('#message-list .message')].map(row=>{
  const wrap=row.querySelector('.att-wrap'),img=row.querySelector('img.attachment-preview');
  const note=row.querySelector('.attachment-missing');
  return {id:row.dataset.messageId.slice(-1),
    wrap:wrap?Math.round(wrap.getBoundingClientRect().width)+'x'+Math.round(wrap.getBoundingClientRect().height):null,
    broken:!!img&&img.complete&&img.naturalWidth===0,
    note:note?(note.textContent||'').trim():null,
    noteHeight:note?Math.round(note.getBoundingClientRect().height):0};});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 const report=[];
 try{
  for(const dead of [false,true]){
   const context=await browser.newContext({viewport:{width:390,height:1200},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
   try{
    await context.route('**/*',route=>{const url=route.request().url();
     if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub+`;window.__qaData.messages.length=0;window.__qaData.messages.push(...${JSON.stringify(rows)});`});
     if(url.includes('livekit-client'))return route.fulfill({contentType:'application/javascript',body:'export default class{}'});
     if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'qa',callsConfigured:false,storageConfigured:true}});
     // Só a URL assinada da imagem morre; o resto da interface continua servido pelo app.
     if(dead&&/\/static\/icons\/icon-192\.png/.test(url))return route.fulfill({status:404,body:'storage indisponível'});
     return route.continue();});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/',{waitUntil:'networkidle'});
    await page.locator('#message-list .message').first().waitFor();
    await page.waitForTimeout(900);
    const at=await page.evaluate(measure),byId=Object.fromEntries(at.map(r=>[r.id,r]));
    assert.deepEqual(errors,[]);
    // 2 — linha órfã sem storage_path: precisa haver aviso visível com o nome do arquivo.
    assert(byId['2'].note,'anexo sem caminho ficou invisível (wrap '+byId['2'].wrap+'): '+JSON.stringify(byId['2']));
    assert(/não carregou/.test(byId['2'].note),'o aviso precisa dizer o que aconteceu: '+byId['2'].note);
    assert(/foto-orfa\.png/.test(byId['2'].note),'o aviso precisa nomear o arquivo: '+byId['2'].note);
    assert(byId['2'].noteHeight>=24,'o aviso precisa ter altura de alvo tocável: '+byId['2'].noteHeight);
    const [w2,h2]=byId['2'].wrap.split('x').map(Number);
    assert(w2>40&&h2>20,'a linha não pode colapsar: '+byId['2'].wrap);
    if(!dead){
      // 1 — caminho válido: imagem de verdade, sem aviso.
      assert.equal(byId['1'].note,null,'anexo que carrega não pode mostrar aviso de falha: '+JSON.stringify(byId['1']));
      assert.equal(byId['1'].broken,false);
      const [,h]=byId['1'].wrap.split('x').map(Number);
      assert(h>40,'a imagem deve ter altura real: '+byId['1'].wrap);
    }else{
      // 3 — a URL assinada única do fixture morre para todas as linhas: nenhuma pode ficar muda.
      for(const id of ['1','3'])assert(byId[id].note,`anexo com URL quebrada ficou no lugar-comum do navegador: ${JSON.stringify(byId[id])}`);
      assert(/foto-quebrada\.png/.test(byId['3'].note),'o aviso precisa nomear o arquivo: '+byId['3'].note);
      assert.equal(at.find(r=>r.id==='3').broken,false,'não pode sobrar uma <img> quebrada na tela: '+JSON.stringify(byId['3']));
    }
    report.push({storage:dead?'404':'ok',rows:at});
    await page.screenshot({path:path.resolve(__dirname,`../work/browser-temp/attachment-failure-${dead?'dead':'ok'}.png`),fullPage:true});
   }finally{await context.close();}
  }
  console.log('attachment failure states OK: '+JSON.stringify(report));
 }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
