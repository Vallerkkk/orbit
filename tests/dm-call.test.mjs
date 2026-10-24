import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRing, callLogText, formatDuration, RING_TIMEOUT_MS } from '../static/dm-call.js';
import { totalUnread, badgeText } from '../static/dm-unread.js';
const ME = 'a', OTHER = 'b', now = Date.parse('2026-10-24T01:00:00Z');
const at = ms => new Date(now - ms).toISOString();
test('only the callee rings, and only while the call is fresh', () => {
  assert.equal(shouldRing({ caller_id: OTHER, status: 'ringing', created_at: at(1000) }, ME, now), true);
  assert.equal(shouldRing({ caller_id: ME, status: 'ringing', created_at: at(1000) }, ME, now), false);
  assert.equal(shouldRing({ caller_id: OTHER, status: 'ringing', created_at: at(RING_TIMEOUT_MS + 1) }, ME, now), false);
  assert.equal(shouldRing({ caller_id: OTHER, status: 'canceled', created_at: at(1000) }, ME, now), false);
  assert.equal(RING_TIMEOUT_MS, 30000);
});
test('call log describes duration, missed and declined calls', () => {
  assert.match(callLogText({ caller_id: OTHER, kind: 'voice', status: 'ended', created_at: at(300000), answered_at: at(290000), ended_at: at(100000) }, ME, now).text, /Chamada de voz · 3 min 10 s/);
  assert.match(callLogText({ caller_id: ME, kind: 'video', status: 'missed', created_at: at(60000) }, ME, now).text, /sem resposta/);
  assert.match(callLogText({ caller_id: OTHER, kind: 'voice', status: 'missed', created_at: at(60000) }, ME, now).text, /perdida/);
  assert.match(callLogText({ caller_id: ME, kind: 'voice', status: 'declined', created_at: at(60000) }, ME, now).text, /recusada/);
  assert.equal(callLogText({ caller_id: ME, kind: 'voice', status: 'ringing', created_at: at(120000) }, ME, now).tone, 'miss');
});
test('formats durations and unread badges', () => {
  assert.equal(formatDuration(42), '42 s');assert.equal(formatDuration(3725), '1 h 02 min');
  assert.equal(totalUnread([{ unread: 3 }, { unread: 120 }]), 123);assert.equal(badgeText(123), '99+');
});
