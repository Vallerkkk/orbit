// Bio "Sobre você": Enter quebra linha (não envia), salva com \n e exibe com pre-line, sem HTML injetado.
const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,USER}=require('./fixtures/supabase_fixture.cjs');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const shots='/workspace/redesign-shots';fs.mkdirSync(shots,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await context.route('**/*',route=>{const url=route.request().url();if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub});if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public',callsConfigured:false,storageConfigured:true}});return route.continue();});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/',{waitUntil:'networkidle'});await page.locator('#message-list .message').first().waitFor();
 await page.locator('#settings').click();
 const bio=page.locator('form label.bio-field textarea').first();await bio.waitFor();
 assert.equal(await bio.evaluate(n=>n.tagName),'TEXTAREA');assert.equal(await bio.getAttribute('maxlength'),'160');
 await bio.fill('');await bio.type('Primeira linha');await bio.press('Enter');await bio.type('Segunda <b>linha</b>');await bio.press('Enter');await bio.press('Enter');await bio.press('Enter');await bio.press('Enter');await bio.type('Fim');
 await page.waitForTimeout(200);
 assert.equal(await page.evaluate(USER=>window.__qaData.profiles.find(p=>p.id===USER).bio,USER),'Perfil local para validação','Enter não deve enviar');
 assert.match(await bio.inputValue(),/Primeira linha\nSegunda/);
 assert.match(await page.locator('.bio-counter').first().textContent(),/^\d+\/160$/);
 await bio.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(shots,'fix-bio-editor.png')});
 await bio.locator('xpath=ancestor::form').getByRole('button',{name:'Salvar alterações',exact:true}).click();
 await page.waitForFunction(USER=>window.__qaData.profiles.find(p=>p.id===USER).bio.includes('\n'),USER);
 assert.equal(await page.evaluate(USER=>window.__qaData.profiles.find(p=>p.id===USER).bio,USER),'Primeira linha\nSegunda <b>linha</b>\n\nFim');
 await page.keyboard.press('Escape');await page.waitForTimeout(200);
 // abre o próprio perfil a partir da coluna de membros
 await page.locator(`#member-list .mv2-row[data-user-id="${USER}"]`).first().click();
 const shown=page.locator('.rich-profile .rp-bio').first();await shown.waitFor();
 assert.equal(await shown.evaluate(n=>getComputedStyle(n).whiteSpace),'pre-line');
 assert.equal(await shown.locator('b').count(),0,'sem injeção de HTML');
 assert.match(await shown.evaluate(n=>n.textContent),/Primeira linha\nSegunda <b>linha<\/b>\n\nFim/);
 assert((await shown.evaluate(n=>n.getBoundingClientRect().height))>40,'várias linhas visíveis');
 await page.screenshot({path:path.join(shots,'fix-bio-profile.png')});
 assert.deepEqual(errors,[]);await browser.close();console.log('bio_browser ok');
})().catch(e=>{console.error(e);process.exit(1);});
