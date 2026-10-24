import test from 'node:test';
import assert from 'node:assert/strict';
import {screenSupport,screenCaptureOptions,screenErrorText,SCREEN_UNSUPPORTED} from '../static/screen-share.js';
const gdm={getDisplayMedia(){}};
test('support: iOS never, Android only with getDisplayMedia, desktop yes', () => {
  assert.equal(screenSupport({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari',mediaDevices:gdm}).supported,false);
  assert.equal(screenSupport({userAgent:'Mozilla/5.0 (Macintosh) Safari',maxTouchPoints:5,mediaDevices:{}}).supported,false);
  assert.equal(screenSupport({userAgent:'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile',mediaDevices:{}}).supported,false);
  const a=screenSupport({userAgent:'Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile',mediaDevices:gdm});assert.deepEqual([a.supported,a.mobile],[true,true]);
  assert.equal(screenSupport({userAgent:'Mozilla/5.0 (Windows NT 10.0) Chrome/140',mediaDevices:gdm}).supported,true);
  assert.match(screenSupport({userAgent:'iPhone'}).reason,new RegExp(SCREEN_UNSUPPORTED));
});
test('capture: mobile is video-only and simple; desktop audio is opt-in and never includes the call', () => {
  const m=screenCaptureOptions({mobile:true,audio:true});assert.equal(m.audio,false);assert.equal(m.systemAudio,undefined);assert.equal(m.surfaceSwitching,undefined);
  const d=screenCaptureOptions({});assert.equal(d.audio,false);assert.equal(d.systemAudio,'exclude');assert.equal(d.selfBrowserSurface,'exclude');
  const w=screenCaptureOptions({audio:true});assert.equal(w.audio.restrictOwnAudio,true);assert.equal(w.systemAudio,'exclude');
});
test('errors are explained', () => {
  assert.match(screenErrorText({name:'NotAllowedError'},true),/Iniciar agora/);
  assert.match(screenErrorText({name:'NotSupportedError'},true),/Atualize o Chrome/);
  assert.match(screenErrorText({name:'TypeError'}),new RegExp(SCREEN_UNSUPPORTED));
});
