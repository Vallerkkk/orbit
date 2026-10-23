import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const m=await import('data:text/javascript;base64,'+readFileSync(new URL('../static/youtube-core.js',import.meta.url)).toString('base64'));
test('contagens e durações em pt-BR',()=>{
 assert.equal(m.formatCount(1400000,'visualizações'),'1,4 mi visualizações');assert.equal(m.formatCount(48000),'48 mil');assert.equal(m.formatCount(812),'812');assert.equal(m.formatCount(null),'');
 assert.equal(m.formatDuration(1335),'22:15');assert.equal(m.formatDuration(10931),'3:02:11');assert.equal(m.formatDuration(9),'0:09');
});
test('tempo relativo',()=>{const now=Date.parse('2026-10-23T12:00:00Z');assert.equal(m.ago('2026-10-23T09:00:00Z',now),'há 3 horas');assert.equal(m.ago('2026-10-09T12:00:00Z',now),'há 2 semanas');assert.equal(m.ago('x',now),'');});
test('fila do mini player avança e dá a volta',()=>{const q=[{id:'aaaaaaaaaaa'},{id:'bbbbbbbbbbb'},{id:'bad'}];assert.equal(m.nextInQueue(q,'aaaaaaaaaaa').id,'bbbbbbbbbbb');assert.equal(m.nextInQueue(q,'bbbbbbbbbbb').id,'aaaaaaaaaaa');assert.equal(m.nextInQueue([{id:'aaaaaaaaaaa'}],'aaaaaaaaaaa'),null);});
test('respostas mockadas da API: erro com mensagem pt-BR do servidor',async()=>{
 const ok=await m.apiJson(async()=>({ok:true,json:async()=>({items:[{id:'M7lc1UVf-VE'}]})}),'/x');assert.equal(ok.items[0].id,'M7lc1UVf-VE');
 await assert.rejects(m.apiJson(async()=>({ok:false,status:503,json:async()=>({detail:'O YouTube ainda não foi configurado neste servidor (falta a YOUTUBE_API_KEY).'})}),'/x'),/YOUTUBE_API_KEY/);
});
test('linhas da biblioteca (Supabase) ida e volta',()=>{const r=m.libraryRow({id:'M7lc1UVf-VE',title:'T',channelTitle:'C',duration:75},'later');assert.equal(r.kind,'later');assert.equal(r.duration,'1:15');assert.equal(m.fromLibrary({...r,position_seconds:3}).id,'M7lc1UVf-VE');assert.equal(m.shareText({id:'M7lc1UVf-VE',title:'T'}),'T https://youtu.be/M7lc1UVf-VE');});
