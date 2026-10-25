import test from 'node:test';
import assert from 'node:assert/strict';

const media=match=>({matches:match,addEventListener(){},removeEventListener(){}});

async function withPrefs({os=false,setting=null},run){
  const original={matchMedia:globalThis.matchMedia,localStorage:globalThis.localStorage,window:globalThis.window};
  globalThis.matchMedia=()=>media(os);
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>key==='orbita-reduce-motion'?setting:null}});
  try{return await run();}
  finally{
    if(original.matchMedia===undefined)delete globalThis.matchMedia;else globalThis.matchMedia=original.matchMedia;
    if(original.localStorage===undefined)delete globalThis.localStorage;else Object.defineProperty(globalThis,'localStorage',{configurable:true,value:original.localStorage});
    if(original.window===undefined)delete globalThis.window;else globalThis.window=original.window;
  }
}

test('movimento reduzido combina preferência do SO com o ajuste do app',async()=>{
  const {prefersReducedMotion}=await import('../static/motion-preference.js');
  await withPrefs({os:false,setting:null},()=>assert.equal(prefersReducedMotion(),false));
  await withPrefs({os:false,setting:'true'},()=>assert.equal(prefersReducedMotion(),true));
  await withPrefs({os:true,setting:'false'},()=>assert.equal(prefersReducedMotion(),true));
  await withPrefs({os:false,setting:'corrompido'},()=>assert.equal(prefersReducedMotion(),false));
});

test('onMotionPreferenceChange ouve a mídia e o evento do app',async()=>{
  const mediaListeners=[],windowListeners={},removed=[];
  globalThis.matchMedia=()=>({matches:false,addEventListener:(type,fn)=>mediaListeners.push(fn),removeEventListener(){}});
  globalThis.window={addEventListener:(type,fn)=>{windowListeners[type]=fn;},removeEventListener:(type,fn)=>{removed.push([type,fn]);}};
  try{
    const {onMotionPreferenceChange}=await import('../static/motion-preference.js');
    let calls=0;const off=onMotionPreferenceChange(()=>calls++);
    mediaListeners[0]();
    windowListeners['orbita:motion-changed']();
    assert.equal(calls,2);
    off();
    assert.equal(removed.length,1);
  }finally{
    delete globalThis.matchMedia;
    delete globalThis.window;
  }
});
