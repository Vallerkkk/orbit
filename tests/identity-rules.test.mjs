import test from 'node:test';import assert from 'node:assert/strict';
import {handleProblem,nicknameProblem} from '../static/identity-rules.js';
test('@ válido, inválido e reservado',()=>{assert.equal(handleProblem('kalil_99'),'');assert.equal(handleProblem('ab'),'invalid');assert.equal(handleProblem('a-b-c'),'invalid');assert.equal(handleProblem('x'.repeat(25)),'invalid');assert.equal(handleProblem('Suporte'),'reserved');});
test('nickname aceita emoji e barra controle',()=>{assert.equal(nicknameProblem('Kalil ✨🚀'),'');assert.ok(nicknameProblem(''));assert.ok(nicknameProblem('a\tb'));assert.ok(nicknameProblem('x'.repeat(33)));assert.equal(nicknameProblem('🚀'.repeat(32)),'');});
