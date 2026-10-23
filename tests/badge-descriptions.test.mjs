import test from 'node:test';import assert from 'node:assert/strict';
import {BADGES,DESC,badgeDesc} from '../static/badges-catalog.js';
test('toda insígnia tem descrição curta em pt-BR',()=>{assert.ok(BADGES.length>=60);for(const b of BADGES){const d=badgeDesc(b.id);assert.ok(d,`sem descrição: ${b.id}`);assert.ok(d.length<=60,`longa demais: ${b.id}`);assert.ok(!/[\n\r]/.test(d));}});
test('sem descrições órfãs',()=>{const ids=new Set(BADGES.map(b=>b.id));for(const k of Object.keys(DESC))assert.ok(ids.has(k),k);});
