import test from 'node:test';
import assert from 'node:assert/strict';
import {wantsTrack,readAutoWatch,writeAutoWatch,AUTO_WATCH_KEY} from '../static/screen-watch.js';
import {pickStage,isDoubleTap} from '../static/call-stage.js';
import {endAction,endDelay} from '../static/watch-commands.js';

test('screen shares are opt-in unless auto-watch is on', () => {
  assert.equal(wantsTrack('camera','a',{watching:new Set(),declined:new Set(),auto:false}),true);
  assert.equal(wantsTrack('screen_share','a',{watching:new Set(),declined:new Set(),auto:false}),false);
  assert.equal(wantsTrack('screen_share','a',{watching:new Set(['a']),declined:new Set(),auto:false}),true);
  assert.equal(wantsTrack('screen_share','a',{watching:new Set(),declined:new Set(),auto:true}),true);
  assert.equal(wantsTrack('screen_share','a',{watching:new Set(),declined:new Set(['a']),auto:true}),false);
});

test('auto-watch setting persists and defaults off', () => {
  const store=new Map();globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
  assert.equal(readAutoWatch(),false);writeAutoWatch(true);assert.equal(readAutoWatch(),true);assert.ok(store.has(AUTO_WATCH_KEY));
});

test('double tap needs same target, short interval and distance', () => {
  const t={};
  assert.equal(isDoubleTap({t:0,x:0,y:0,target:t},{t:200,x:5,y:5,target:t}),true);
  assert.equal(isDoubleTap({t:0,x:0,y:0,target:t},{t:500,x:0,y:0,target:t}),false);
  assert.equal(isDoubleTap({t:0,x:0,y:0,target:t},{t:100,x:0,y:0,target:{}}),false);
  assert.equal(isDoubleTap(null,{t:100,x:0,y:0,target:t}),false);
});

test('end of video: repeat, next or stop, and only the leader acts at once', () => {
  assert.equal(endAction({loop:true,queueLength:3}),'repeat');
  assert.equal(endAction({queueLength:2}),'next');
  assert.equal(endAction({queueLength:0}),'stop');
  assert.equal(endDelay(0),0);
  assert.ok(endDelay(1)>=2000&&endDelay(2)>endDelay(1));
});

test('stage prefers Ouvir juntos, then a screen', () => {
  assert.equal(pickStage([{kind:'camera'},{kind:'screen'},{kind:'watch'}]),2);
  assert.equal(pickStage([{kind:'camera'},{kind:'screen'}]),1);
  assert.equal(pickStage([{kind:'avatar'}]),-1);
});
