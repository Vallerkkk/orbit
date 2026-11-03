import test from 'node:test';
import assert from 'node:assert/strict';
import {micErrorText,forgetMissingInput} from '../static/mic-health.js';

const store=(v)=>{const m=new Map(v?[['orbita-audio-input',v]]:[]);return {getItem:k=>m.get(k)??null,removeItem:k=>m.delete(k),has:k=>m.has(k)};};
const devices=list=>({enumerateDevices:async()=>list});

test('erros do microfone viram mensagens claras em pt-BR com Tentar de novo', () => {
  assert.match(micErrorText({name:'NotAllowedError'}),/bloqueou o microfone.*Tentar de novo/);
  assert.match(micErrorText({name:'NotFoundError'}),/Nenhum microfone/);
  assert.match(micErrorText({name:'NotReadableError'}),/ocupado por outro aplicativo/);
  assert.match(micErrorText({name:'OverconstrainedError'}),/padrão do sistema/);
});
test('microfone salvo que sumiu é esquecido', async () => {
  const s=store('velho');assert.equal(await forgetMissingInput(s,devices([{kind:'audioinput',deviceId:'novo'}])),true);assert.equal(s.has('orbita-audio-input'),false);
});
test('microfone salvo presente é mantido', async () => {
  const s=store('usb');assert.equal(await forgetMissingInput(s,devices([{kind:'audioinput',deviceId:'usb'}])),false);assert.equal(s.getItem('orbita-audio-input'),'usb');
});
test('sem permissão (IDs vazios) não apaga a escolha', async () => {
  const s=store('usb');assert.equal(await forgetMissingInput(s,devices([{kind:'audioinput',deviceId:''}])),false);assert.equal(s.getItem('orbita-audio-input'),'usb');
});
