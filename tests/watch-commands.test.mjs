import test from 'node:test';
import assert from 'node:assert/strict';
const {youtubeLink,youtubePlaylistId,youtubeId}=await import(new URL('../static/media-utils.js',import.meta.url));
const C=await import(new URL('../static/watch-commands.js',import.meta.url));
const V='M7lc1UVf-VE',L='PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
test('playlist links are recognised in every YouTube form',()=>{
 for(const u of [`https://www.youtube.com/playlist?list=${L}`,`https://youtube.com/watch?v=${V}&list=${L}&index=3`,`https://music.youtube.com/playlist?list=${L}`,`https://music.youtube.com/watch?v=${V}&list=${L}`,`https://youtu.be/${V}?list=${L}`,`https://m.youtube.com/playlist?list=${L}&si=x`,`youtube.com/playlist?list=${L}`])assert.equal(youtubePlaylistId(u),L,u);
 assert.deepEqual(youtubeLink(`https://youtu.be/${V}?list=${L}&t=30`),{video:V,list:L,start:30,mix:false});
 assert.deepEqual(youtubeLink(`https://www.youtube.com/playlist?list=${L}`),{video:null,list:L,start:0,mix:false});
 assert.equal(youtubeLink(`https://youtube.com/watch?v=${V}&list=RD${V}`).mix,true);
 for(const bad of [`https://evil.invalid/playlist?list=${L}`,`https://youtube.com/playlist?list=WL`,`https://youtube.com/playlist?list=<x>`,'texto'])assert.equal(youtubePlaylistId(bad),null,bad);
 assert.equal(youtubeId(`https://youtube.com/playlist?list=${L}`),null);
});
test('commands parse in pt-BR with aliases and arguments',()=>{
 assert.equal(C.parseWatchInput('/pular').cmd,'pular');assert.equal(C.parseWatchInput('/SKIP').cmd,'pular');
 assert.deepEqual(C.parseWatchInput('/remover 3'),{cmd:'remover',n:3});assert.ok(C.parseWatchInput('/remover x').error);
 assert.deepEqual(C.parseWatchInput('/volume 40%'),{cmd:'volume',n:40});assert.ok(C.parseWatchInput('/volume 300').error);
 assert.equal(C.parseWatchInput('/tocar lofi beats').search,'lofi beats');
 assert.equal(C.parseWatchInput(`/tocar https://youtu.be/${V}`).link.video,V);
 assert.equal(C.parseWatchInput(`/playlist https://youtube.com/playlist?list=${L}`).link.list,L);
 assert.ok(C.parseWatchInput(`/playlist https://youtu.be/${V}`).error);
 assert.ok(C.parseWatchInput('/xyz').error);assert.ok(C.parseWatchInput('').error);
 for(const n of C.COMMANDS.map(c=>c[0]))assert.ok(!C.parseWatchInput('/'+n+(['tocar','adicionar','proxima'].includes(n)?' a':n==='remover'?' 1':n==='playlist'?` https://youtube.com/playlist?list=${L}`:'')).error,n);
});
test('plain links enqueue, plain text is rejected with a hint',()=>{
 assert.deepEqual([C.parseWatchInput(`https://youtu.be/${V}`).cmd,C.parseWatchInput(`https://youtu.be/${V}`).queue],['tocar',true]);
 assert.equal(C.parseWatchInput(`https://www.youtube.com/playlist?list=${L}`).cmd,'playlist');
 assert.match(C.parseWatchInput('oi pessoal').error,/só aceita comandos/);
});
test('queue helpers: order from video, remove, shuffle, cap and chunking',()=>{
 const items=Array.from({length:5},(_,i)=>({v:String(i).repeat(11)}));
 assert.deepEqual(C.orderFrom(items,'22222222222').map(x=>x.v[0]),['2','3','4']);assert.equal(C.orderFrom(items,'zzzzzzzzzzz').length,5);
 assert.deepEqual(C.removeAt(items,1).length,4);assert.equal(C.removeAt(items,9),null);
 const s=C.shuffled(items,()=>0);assert.equal(s.length,5);assert.deepEqual(new Set(s),new Set(items));
 const big=Array.from({length:250},(_,i)=>({v:'x'+i}));const r=C.appendLimited(items,big);assert.equal(r.queue.length,C.QUEUE_LIMIT);assert.equal(r.added,195);assert.equal(r.dropped,55);
 assert.deepEqual(C.chunk(big.slice(0,60),25).map(x=>x.length),[25,25,10]);assert.deepEqual(C.chunk([]),[[]]);
 assert.match(C.helpText(),/\/embaralhar/);
});

test('adicionar/proxima/tocar agora: enfileirar sem interromper', () => {
  const V='dQw4w9WgXcQ';
  assert.equal(C.parseWatchInput(`/adicionar https://youtu.be/${V}`).mode,'queue');
  assert.equal(C.parseWatchInput(`/add lofi`).search,'lofi');
  assert.equal(C.parseWatchInput(`/fila+ https://youtu.be/${V}`).cmd,'tocar');
  assert.equal(C.parseWatchInput(`/proxima https://youtu.be/${V}`).mode,'next');
  assert.equal(C.parseWatchInput(`/próxima lofi`).mode,'next');
  assert.equal(C.parseWatchInput(`/tocar https://youtu.be/${V}`).mode,'queue');
  const now=C.parseWatchInput(`/tocar agora https://youtu.be/${V}`);assert.equal(now.mode,'now');assert.equal(now.link.video,V);
  assert.equal(C.parseWatchInput(`https://youtu.be/${V}`).mode,'queue');
  assert.ok(C.parseWatchInput('/adicionar').error);assert.ok(C.parseWatchInput('/tocar agora').error);
  const q=[{v:'a'},{v:'b'}];
  assert.deepEqual(C.placeItems(q,[{v:'x'}],'next').queue.map(x=>x.v),['x','a','b']);
  assert.deepEqual(C.placeItems(q,[{v:'x'}]).queue.map(x=>x.v),['a','b','x']);
  assert.match(C.helpText(),/\/adicionar/);assert.match(C.helpText(),/\/proxima/);
});
