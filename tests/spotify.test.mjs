import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpotify} from '../static/spotify.js';

// Exercise polling and disposal with a minimal DOM and controlled clocks.
function fixture(t) {
 const intervals=new Map(),listeners=new Set(),observers=[],frames=[];let id=0;
 const originals=Object.fromEntries(['document','IntersectionObserver','requestAnimationFrame','setInterval','clearInterval'].map(k=>[k,globalThis[k]]));
 globalThis.document={hidden:false,addEventListener:(name,f)=>listeners.add(f),removeEventListener:(name,f)=>listeners.delete(f)};
 globalThis.IntersectionObserver=class {constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
 globalThis.requestAnimationFrame=f=>frames.push(f);
 globalThis.setInterval=(f,ms)=>{intervals.set(++id,{f,ms});return id;};globalThis.clearInterval=id=>intervals.delete(id);
 t.after(()=>{for(const [k,v] of Object.entries(originals)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}});
 const el=(tag,css='',text='')=>({tag,className:css,textContent:text,style:{},children:[],isConnected:true,append(...nodes){this.children.push(...nodes);},set innerHTML(_value){this.children=[];}});
 let account='owner',reply={playing:true,track:'Teste',progressMs:0,durationMs:120000};const requests=[];
 const api=createSpotify({el,session:()=>({user:{id:account}}),apiFetch:async(path,opts)=>{requests.push({path,opts});if(reply instanceof Error)throw reply;return {json:async()=>reply};}});
 const box=api.block('owner');frames.forEach(f=>f());
 return {box,intervals,listeners,requests,observers,setReply:value=>reply=value,setAccount:value=>account=value,async show(){observers[0].callback([{isIntersecting:true}]);await new Promise(setImmediate);},async poll(){await [...intervals.values()].find(x=>x.ms===30000).f();}};
}
test('Spotify stops progress ticks on silence and provider failure',async t=>{
 const f=fixture(t);await f.show();assert.equal(f.box.hidden,false);assert.equal(f.intervals.size,2);
 f.setReply({playing:false});await f.poll();assert.equal(f.box.hidden,true);assert.equal(f.intervals.size,1);
 f.setReply({playing:true,progressMs:0,durationMs:120000});await f.poll();assert.equal(f.intervals.size,2);
 f.setReply(Error('offline'));await f.poll();assert.equal(f.intervals.size,1);assert.equal(f.box.hidden,true);
 assert.match(f.requests[0].path,/^\/api\/spotify\/now-playing\//);
});
test('Spotify removes visibility listeners and intervals when profile is removed',async t=>{
 const f=fixture(t);await f.show();assert.equal(f.listeners.size,1);f.box.isConnected=false;await f.poll();assert.equal(f.listeners.size,0);assert.equal(f.intervals.size,0);assert.equal(f.observers[0].disconnected,true);
});
