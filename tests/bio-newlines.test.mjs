import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../static/app.js',import.meta.url),'utf8');
const src=app.match(/function normalizeBio\(value,max=160\)\{.*\}\n/)[0];
const normalizeBio=new Function(src+';return normalizeBio;')();
test('bio preserva quebras de linha',()=>{assert.equal(normalizeBio('Oi\nTudo bem?\r\nTchau'),'Oi\nTudo bem?\nTchau');});
test('bio colapsa linhas em branco e espaços finais',()=>{assert.equal(normalizeBio('  a  \n\n\n\n\nb\t\n'),'a\n\nb');});
test('bio limita a 8 linhas e 160 caracteres',()=>{const r=normalizeBio(Array.from({length:12},(_,i)=>'l'+i).join('\n'));assert.equal(r.split('\n').length,8);assert.match(r,/l7 l8 l9 l10 l11$/);assert.equal(normalizeBio('x'.repeat(300)).length,160);});
test('editor da bio é textarea com contador e salvamento normalizado',()=>{assert.match(app,/bio=bioField\(form,'Sobre você'/);assert.match(app,/bio:normalizeBio\(bio\.value\)/);assert.doesNotMatch(app,/bio:bio\.value\.trim\(\)/);});
test('CSS da bio usa pre-line',()=>{const css=readFileSync(new URL('../static/grafite.css',import.meta.url),'utf8');assert.match(css,/\.rich-profile \.rp-bio,\.pv2 \.rp-bio\{white-space:pre-line/);assert.match(css,/\.mv2-dm-bio\{[^}]*white-space:pre-line[^}]*line-clamp:5/);});
