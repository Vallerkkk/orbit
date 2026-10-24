import test from 'node:test';
import assert from 'node:assert/strict';
import {isMusicChannel,checkMusicMessage,callScope} from '../static/music-channel.js';

test('identifica canal do Ouvir juntos', () => {
  assert.equal(isMusicChannel({kind:'text',is_music:true}), true);
  assert.equal(isMusicChannel({kind:'text',is_music:false}), false);
  assert.equal(isMusicChannel({kind:'voice',is_music:true}), false);
  assert.equal(isMusicChannel({kind:'text',is_music:true,private:true}), false);
});

test('aceita só comandos e links', () => {
  assert.equal(checkMusicMessage('/pular').ok, true);
  assert.equal(checkMusicMessage('https://www.youtube.com/playlist?list=PLabcdefghij').ok, true);
  assert.equal(checkMusicMessage('/tocar https://youtu.be/dQw4w9WgXcQ?list=PLabcdefghij só').parsed.only, true);
  const bad = checkMusicMessage('bom dia pessoal');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /só aceita comandos/);
});

test('exige chamada no mesmo servidor', () => {
  const channel = {community_id:'a'};
  assert.match(callScope({room:null}, channel), /não está em uma sala de voz/);
  assert.match(callScope({room:{state:'connected'},callChannel:{community_id:'b'}}, channel), /outro servidor/);
  assert.equal(callScope({room:{state:'connected'},callChannel:{community_id:'a'}}, channel), '');
});
