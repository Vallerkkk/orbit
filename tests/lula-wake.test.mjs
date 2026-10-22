import test from 'node:test';
import assert from 'node:assert/strict';
import { wakeQuestion } from '../static/luladroid.js';

test('Lula responds to the new voice wake phrase', () => {
  assert.equal(wakeQuestion('Ei, Lula, o que foi combinado?'), 'o que foi combinado?');
  assert.equal(wakeQuestion('oi Lula tudo bem?'), 'tudo bem?');
  assert.equal(wakeQuestion('e aí Lula resume a conversa'), 'resume a conversa');
  assert.equal(wakeQuestion('Olá, Lula!'), '');
});

test('Lula does not activate from the retired brand or similar words', () => {
  assert.equal(wakeQuestion('Ei LulaDroid, pode falar'), null);
  assert.equal(wakeQuestion('É sobre a lula no mar'), null);
  assert.equal(wakeQuestion('Oi, Lulapalooza'), null);
});
