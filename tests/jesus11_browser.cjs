const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub}=require('./fixtures/supabase_fixture.cjs');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const tmp=path.resolve(__dirname,'../work/browser-temp');fs.mkdirSync(tmp,{recursive:true});process.env.TEMP=tmp;process.env.TMP=tmp;
let browser;
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});const report=[];
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:{width:mobile?390:1440,height:mobile?844:1000},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});
  await context.route('**/*',route=>{const url=route.request().url();if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub});if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public',callsConfigured:false,storageConfigured:true}});return route.continue();});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));const base=process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/';
  await page.goto(base,{waitUntil:'networkidle'});await page.locator('#message-list .message').first().waitFor();
  async function menu(){if(mobile&&!await page.locator('body').evaluate(n=>n.classList.contains('mobile-menu-open')))await page.locator('.main>div:not([hidden]) .mobile-nav-btn').first().click();}
  await menu();await page.locator('#up-profile-btn').click();await page.locator('.rich-profile').waitFor();
  assert.equal(await page.locator('.rp-banner').evaluate(n=>n.getBoundingClientRect().height),118);
  if(mobile)assert.equal(await page.locator('#dialog-close').evaluate(n=>n.getBoundingClientRect().width>=44&&n.getBoundingClientRect().height>=44),true);
  assert.equal(await page.locator('#app-dialog').evaluate(n=>n.getBoundingClientRect().width<=innerWidth-20&&n.scrollWidth<=n.clientWidth+1),true);
  await page.screenshot({path:path.join(tmp,`jesus11-profile-${mobile?'mobile':'desktop'}.png`)});
  await page.locator('#dialog-close').click();await menu();await page.locator('#settings').click();
  assert.equal(await page.locator('.profile-edit-card .rp-avatar').first().evaluate(n=>n.getBoundingClientRect().width>=72),true); // estúdio da Configurações v2 usa avatar maior
  assert.equal(await page.locator('#dialog-content input[type=checkbox]').evaluateAll(list=>list.filter(n=>n.offsetParent).every(n=>n.getBoundingClientRect().width<30)),true); // checkboxes saíram do card de perfil na v2
  await page.getByRole('tab',{name:'Aparência',exact:true}).click();const theme=page.getByRole('radiogroup',{name:'Tema'});await theme.waitFor();assert.equal(await theme.getByRole('radio').count(),12); // seletor de tema virou grade de cards
  const names={cyber:'Cyber Neon',forest:'Floresta',ocean:'Oceano',sunset:'Pôr do Sol',midnight:'Meia-Noite',blood:'Sangue',gold:'Ouro',sakura:'Sakura'};
  for(const [value,name] of Object.entries(names)){await theme.getByRole('radio',{name}).click();assert.equal(await page.locator('body').getAttribute('data-theme'),value);}
  await theme.getByRole('radio',{name:'Ouro'}).click();await page.locator('#dialog-close').click();await page.reload({waitUntil:'networkidle'});await page.locator('#message-list .message').first().waitFor();assert.equal(await page.locator('body').getAttribute('data-theme'),'gold');
  assert.equal((await page.locator('body').evaluate(n=>getComputedStyle(n).getPropertyValue('--accent'))).trim().length>0,true);
  await menu();await page.locator('#settings').click();await page.locator('.profile-edit-card').first().waitFor(); // personalizador agora embutido na aba Perfil
  assert.equal(await page.locator('#app-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth+1),true);await page.locator('#dialog-close').click();
  assert.deepEqual(errors,[]);report.push({mobile,profileBanner:true,dialogFits:true,touchClose:true,editCard:true,checkboxes:true,eightNewThemes:true,persisted:true,customizer:true,errors:0});await context.close();
 }
 console.log(JSON.stringify(report));await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
