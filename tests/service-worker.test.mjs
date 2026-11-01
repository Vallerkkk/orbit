import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../static/service-worker.js',import.meta.url),'utf8');
function worker(){
  const handlers={},entries=new Map(),origin='https://orbita.example',absolute=url=>new URL(typeof url==='string'?url:url.url,origin).href;
  let failNetwork=false,failStorage=false;
  const cache={
    keys:async()=>[...entries.keys()].map(url=>new Request(url)),
    put:async(request,response)=>{if(failStorage)throw Error('quota');entries.set(absolute(request),response);},
    delete:async request=>entries.delete(absolute(request)),
    addAll:async paths=>paths.forEach(url=>entries.set(absolute(url),new Response('offline'))),
  };
  const context={URL,Response,Promise,console,importScripts:()=>{},self:{location:{origin},addEventListener:(type,callback)=>handlers[type]=callback},
    fetch:async request=>{if(failNetwork)throw Error('offline');const body=request.mode==='navigate'?'page:'+new URL(typeof request==='string'?request:request.url).pathname:'asset';return new Response(body);},
    caches:{open:async()=>cache,match:async request=>entries.get(absolute(request))?.clone()}};
  vm.runInNewContext(source,context);
  async function run(request){
    const waits=[];let result;
    handlers.fetch({request,respondWith:promise=>result=promise,waitUntil:promise=>waits.push(promise)});
    const response=await result;await Promise.all(waits);return response;
  }
  return {entries,cache,set offline(value){failNetwork=value;},set quota(value){failStorage=value;},
    request:(path,options={})=>run(new Request(absolute(path),options)),
    navigate:(path='/')=>run({url:absolute(path),method:'GET',mode:'navigate',headers:new Headers()})};
}

test('worker bypasses APIs, third parties, installers, ranges and no-store requests',async()=>{
  const w=worker();
  for(const url of ['/api/config','https://private.example/avatar','/static/downloads/Orbita-Windows.zip','/static/private/file.jpg'])assert.equal(await w.request(url),undefined);
  assert.equal(await w.request('/static/app.js',{headers:{Range:'bytes=0-10'}}),undefined);
  assert.equal(await w.request('/static/app.js',{cache:'no-store'}),undefined);
  assert.equal(w.entries.size,0);
});

test('cache replaces query versions and retains only a bounded number of assets',async()=>{
  const w=worker();await w.request('/static/app.js?v=old');await w.request('/static/app.js?v=new');
  assert.equal(w.entries.size,1);assert(w.entries.has('https://orbita.example/static/app.js?v=new'));
  await w.cache.addAll(['/static/offline.html','/static/icons/icon-192.png','/static/icons/icon-512.png']);
  await w.navigate('/');
  await Promise.all(Array.from({length:100},(_,i)=>w.request('/static/chunk-'+i+'.js')));
  assert.equal(w.entries.size,84);assert(w.entries.has('https://orbita.example/static/offline.html'));
  // A casca da navegação não entra na cota de recursos e sobrevive à limpeza.
  assert(w.entries.has('https://orbita.example/__orbita_navigation'));
});

test('navigation caches the app shell and serves it when offline',async()=>{
  const w=worker();
  assert.equal(await (await w.navigate('/')).text(),'page:/');
  assert(w.entries.has('https://orbita.example/__orbita_navigation'));
  // Link profundo não substitui a casca guardada.
  await w.navigate('/instalar');
  assert.equal(await (await w.navigate('/')).text(),'page:/');
  w.offline=true;
  assert.equal(await (await w.navigate('/')).text(),'page:/');
  const cold=worker();cold.offline=true;
  assert.equal((await cold.navigate('/')).type,'error');
});

test('cached resources recover offline and quota failures still return network content',async()=>{
  const w=worker();await w.request('/static/app.js');w.offline=true;
  assert.equal(await (await w.request('/static/app.js')).text(),'asset');
  assert.equal((await w.request('/static/missing.js')).type,'error');
  w.offline=false;w.quota=true;assert.equal(await (await w.request('/static/style.css')).text(),'asset');
});
