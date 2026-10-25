import test from 'node:test';
import assert from 'node:assert/strict';
import {initAstro} from '../static/astro-call.js';

function fixture(t){
 const originals=Object.fromEntries(['document','window','setInterval','AudioContext','AudioWorkletNode','MediaStream'].map(k=>[k,globalThis[k]]));
 const nodes=[];let clock=Date.now(),replacements=0;const now=Date.now;
 const el=(tag,css='',text='')=>{const node={tag,className:css,textContent:text,hidden:false,scrollHeight:100,scrollTop:0,clientHeight:100,children:[],setAttribute(){},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;replacements++;}};nodes.push(node);return node;};
 const actions=el('div'),view=el('div');view.querySelector=()=>actions;
 globalThis.document={getElementById:()=>view,createDocumentFragment:()=>el('fragment')};
 globalThis.window={addEventListener(){}};
 globalThis.setInterval=()=>0;Date.now=()=>clock;
 const contexts=[],worklets=[];
 globalThis.AudioContext=class{constructor(){this.state='running';this.audioWorklet={addModule:async()=>{}};contexts.push(this);}createMediaStreamSource(){return {connect(){},disconnect(){}};}async resume(){}async close(){this.closed=true;}};
 globalThis.AudioWorkletNode=class{constructor(){this.port={postMessage(){}};worklets.push(this);}connect(){}disconnect(){}};
 globalThis.MediaStream=class{};
 t.after(()=>{Date.now=now;for(const [key,value]of Object.entries(originals)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
 const track={readyState:'live'},publication={source:'microphone',track:{mediaStreamTrack:track}},participant={audioTrackPublications:new Map([['mic',publication]]),isMicrophoneEnabled:true};
 const state={session:{},room:{name:'channel-test',state:'connected',localParticipant:participant},deafened:false};
 const calls=[];let events=[{id:1,at:clock/1000,kind:'transcript',name:'Teste',text:'Olá'}];
 const button=(label,action)=>{const node=el('button','',label);node.click=action;return node;};
 const api=initAstro({el,button,state:()=>state,apiFetch:async(path,options)=>{calls.push({path,options});return {json:async()=>({configured:true,events,cursor:1,busy:false})};}});
 const flush=async()=>{await new Promise(setImmediate);};
 return {api,state,contexts,worklets,calls,participant,nodes,async sync(){api.sync();await flush();},advance(){clock+=3000;},empty(){events=[];},get replacements(){return replacements;}};
}
test('Astro releases capture when muted and resumes with a fresh context',async t=>{
 const f=fixture(t);await f.sync();await f.sync();assert.equal(f.contexts.length,1);
 f.participant.isMicrophoneEnabled=false;await f.sync();assert.equal(f.contexts[0].closed,true);
 f.participant.isMicrophoneEnabled=true;await f.sync();assert.equal(f.contexts.length,2);
 f.state.deafened=true;await f.sync();assert.equal(f.contexts[1].closed,true);
});
test('Astro retains row identity on empty polls and renders on panel open',async t=>{
 const f=fixture(t);await f.sync();f.nodes.find(n=>n.tag==='button'&&n.textContent==='✦ Astro').click();
 const count=f.replacements;f.empty();f.advance();await f.sync();assert.equal(f.replacements,count);
});
test('Astro rejects queued microphone chunks immediately after muting',async t=>{
 const f=fixture(t);await f.sync();await f.sync();const handler=f.worklets[0].port.onmessage;
 f.participant.isMicrophoneEnabled=false;handler({data:new ArrayBuffer(8000)});await new Promise(setImmediate);
 assert.equal(f.calls.some(c=>c.path.includes('/audio?')),false);
});
