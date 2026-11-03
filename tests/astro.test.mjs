import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {sourceItems,wav} from '../static/astro-call.js';
test('WAV is decodable mono PCM16 at 16 kHz',async()=>{
 const pcm=Int16Array.from([-32768,0,32767]),v=new DataView(await wav(pcm.buffer).arrayBuffer());
 assert.equal(v.getUint32(24,true),16000);assert.equal(v.getUint16(22,true),1);assert.equal(v.getUint32(40,true),6);assert.equal(v.getInt16(44,true),-32768);assert.equal(v.getInt16(48,true),32767);
});
test('search sources only expose safe http links and no duplicates',()=>{
 const items=sourceItems({sources:[
  {title:' Banco Central ',url:'https://exemplo.com/cotacao'},
  {title:'Repetido',url:'https://exemplo.com/cotacao'},
  {title:'Interno',url:'http://127.0.0.1/segredo'},
  {title:'Script',url:'javascript:alert(1)'},
  {title:'Outro',url:'https://outro.com/a'}
 ]});
 assert.deepEqual(items.map(item=>item.url),['https://exemplo.com/cotacao','https://outro.com/a']);
 assert.equal(items[0].title,'Banco Central');
 assert.deepEqual(sourceItems(null),[]);
});
test('worklet rejects silence, emits bounded complete chunks, discards muted audio',()=>{
 let Processor;const emitted=[];class Base{constructor(){this.port={postMessage:b=>emitted.push(b)};}}
 vm.runInNewContext(readFileSync(new URL('../static/astro-recorder.js',import.meta.url),'utf8'),{AudioWorkletProcessor:Base,sampleRate:48000,registerProcessor:(name,p)=>{Processor=p;}});
 const p=new Processor();p.port.onmessage({data:{enabled:true}});
 const frame=new Float32Array(128);for(let i=0;i<4000;i++)p.process([[frame]]);assert.equal(emitted.length,0);
 frame.fill(.1);for(let i=0;i<3100;i++)p.process([[frame]]);assert.equal(emitted.length,1);assert.ok(emitted[0].byteLength<=256000);
 p.port.onmessage({data:{enabled:false}});for(let i=0;i<4000;i++)p.process([[frame]]);assert.equal(emitted.length,1);
});
test('the end of a phrase closes the chunk after about half a second of silence',()=>{
 let Processor;const emitted=[];class Base{constructor(){this.port={postMessage:b=>emitted.push(b)};}}
 vm.runInNewContext(readFileSync(new URL('../static/astro-recorder.js',import.meta.url),'utf8'),{AudioWorkletProcessor:Base,sampleRate:48000,registerProcessor:(name,p)=>{Processor=p;}});
 const p=new Processor();p.port.onmessage({data:{enabled:true}});
 const quiet=new Float32Array(128),voiced=new Float32Array(128).fill(.1);
 for(let i=0;i<200;i++)p.process([[voiced]]);assert.equal(emitted.length,0);
 // 100 quadros de silêncio são ~0,27 s: ainda é cedo para fechar o trecho.
 for(let i=0;i<100;i++)p.process([[quiet]]);assert.equal(emitted.length,0,'trecho fechado antes da pausa');
 // Somados, os 200 quadros passam de 0,45 s de silêncio: o trecho é enviado.
 for(let i=0;i<100;i++)p.process([[quiet]]);assert.equal(emitted.length,1,'trecho não foi fechado no fim da fala');
});
