const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub}=require('./fixtures/supabase_fixture.cjs');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const tmp=path.resolve(__dirname,'../work/browser-temp');fs.mkdirSync(tmp,{recursive:true});process.env.TEMP=tmp;process.env.TMP=tmp;
const shots=process.env.ORBITA_SHOTS_DIR;
// Auth falso: guarda a sessão real do fixture, começa deslogado e registra as chamadas de recuperação.
const auth=`verifyOtp:async args=>{(window.__qaCalls||=[]).push(['verifyOtp',args]);if(args.token_hash==='bad')return {error:{message:'Email link is invalid or has expired'}};window.__qaSession=window.__qaReal;return {data:{session:window.__qaReal},error:null};},
exchangeCodeForSession:async code=>{(window.__qaCalls||=[]).push(['exchange',code]);window.__qaSession=window.__qaReal;return {data:{session:window.__qaReal},error:null};},
updateUser:async args=>{(window.__qaCalls||=[]).push(['updateUser',args]);return {data:{user:window.__qaReal.user},error:null};},
resetPasswordForEmail:async(email,opts)=>{(window.__qaCalls||=[]).push(['resetPasswordForEmail',email,opts]);return {data:{},error:null};},
signOut:async()=>({error:null})`;
const fixture=stub.replace("signOut:async()=>({error:null})",auth)+'\nwindow.__qaReal=window.__qaSession;window.__qaSession=null;';
let browser;
async function open(suffix,viewport){const context=await browser.newContext({viewport});
 await context.route('**/*',route=>{const url=route.request().url();if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:fixture});if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public',callsConfigured:false}});if(url.includes('/auth/v1/settings'))return route.fulfill({json:{external:{}}});return route.continue();});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));const base=process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/';await page.goto(base+suffix,{waitUntil:'domcontentloaded'});return {context,page,errors,base};}
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});const results=[];
 for(const [label,viewport] of [['desktop',{width:1280,height:800}],['mobile',{width:390,height:844}]]){
  // 1) token_hash válido → Criar nova senha → updateUser → app
  let {context,page,errors,base}=await open('?token_hash=good&type=recovery',viewport);
  await page.locator('#reset-form').waitFor();assert.equal(await page.locator('#auth-title').textContent(),'Criar nova senha');
  assert.equal(new URL(page.url()).search,'');assert.deepEqual((await page.evaluate(()=>window.__qaCalls))[0],['verifyOtp',{token_hash:'good',type:'recovery'}]);
  assert(await page.locator('#auth-form').isHidden());
  await page.fill('#new-password','abc');await page.fill('#confirm-password','abc');assert.equal(await page.locator('#new-password').evaluate(i=>i.validity.tooShort||!i.checkValidity()),true);
  await page.fill('#new-password','novaSenha1');await page.fill('#confirm-password','novaSenha2');await page.click('#reset-form button[type=submit]');await page.getByText('não são iguais',{exact:false}).waitFor();
  await page.fill('#confirm-password','novaSenha1');await page.click('.pw-eye >> nth=0');assert.equal(await page.locator('#new-password').getAttribute('type'),'text');
  if(shots)await page.screenshot({path:path.join(shots,`reset-form-${label}.png`)});
  await page.click('#reset-form button[type=submit]');await page.locator('#app-view').waitFor({state:'visible',timeout:15000});
  assert.deepEqual((await page.evaluate(()=>window.__qaCalls)).find(c=>c[0]==='updateUser'),['updateUser',{password:'novaSenha1'}]);
  assert.deepEqual(errors,[]);await context.close();
  // 2) hash implícito expirado → mensagem + Enviar novo link
  ({context,page,errors}=await open('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',viewport));
  await page.locator('#reset-request').waitFor();assert.equal(await page.locator('#auth-title').textContent(),'Link expirado');assert.equal(new URL(page.url()).hash,'');
  await page.fill('#reset-email','kalil@exemplo.com');if(shots)await page.screenshot({path:path.join(shots,`reset-expired-${label}.png`)});
  await page.click('#reset-request button[type=submit]');await page.getByText('Pronto!',{exact:false}).waitFor();
  assert.deepEqual((await page.evaluate(()=>window.__qaCalls)).at(-1),['resetPasswordForEmail','kalil@exemplo.com',{redirectTo:new URL(base).origin}]);
  assert.deepEqual(errors,[]);await context.close();
  // 3) token_hash inválido também cai na tela de link expirado
  ({context,page,errors}=await open('?token_hash=bad&type=recovery',viewport));await page.locator('#reset-request').waitFor();assert.match(await page.locator('#auth-description').textContent(),/expirou/);assert.deepEqual(errors,[]);await context.close();
  // 4) Esqueci minha senha no login + voltar
  ({context,page,errors}=await open('',viewport));await page.locator('#forgot-password').waitFor();await page.fill('#email','eu@exemplo.com');await page.click('#forgot-password');
  await page.locator('#reset-request').waitFor();assert.equal(await page.inputValue('#reset-email'),'eu@exemplo.com');if(shots)await page.screenshot({path:path.join(shots,`reset-forgot-${label}.png`)});
  await page.getByRole('button',{name:'Voltar para o login'}).click();await page.locator('#auth-form').waitFor();assert.equal(await page.locator('#auth-title').textContent(),'Bom ter você aqui.');assert.deepEqual(errors,[]);await context.close();
  // 5) hash implícito válido (supabase-js emite PASSWORD_RECOVERY)
  ({context,page,errors}=await open('',viewport));await page.locator('#auth-form').waitFor();await page.waitForFunction(()=>window.__qaAuthCallback);
  await page.evaluate(()=>window.__qaAuthCallback('PASSWORD_RECOVERY',window.__qaReal));await page.locator('#reset-form').waitFor();assert(await page.locator('#app-view').isHidden());assert.deepEqual(errors,[]);await context.close();
  results.push({label,ok:true});
 }
 console.log(JSON.stringify(results));await browser.close();
})().catch(async e=>{console.error(e);await browser?.close();process.exitCode=1;});
