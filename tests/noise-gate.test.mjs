import test from 'node:test';
import assert from 'node:assert/strict';
import {gateThreshold} from '../static/noise-processor.js';

test('sensibilidade 100% deixa o gate sempre aberto', () => { assert.equal(gateThreshold(100), -100); });
test('menor sensibilidade exige voz mais alta', () => { assert.ok(gateThreshold(10) > gateThreshold(50)); assert.ok(gateThreshold(50) > gateThreshold(90)); });
test('modo agressivo sobe o limiar em 6 dB', () => { assert.equal(gateThreshold(50,'aggressive') - gateThreshold(50), 6); });
test('valores inválidos caem no padrão', () => { assert.equal(gateThreshold('x'), gateThreshold(50)); assert.equal(gateThreshold(500), -100); });
