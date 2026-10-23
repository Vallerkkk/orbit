// Efeitos sonoros discretos da interface (WebAudio sintetizado, volume baixo).
// Compartilhado por galeria de decorações e eventos de chamada. Desligável em
// localStorage 'orbita-ui-sounds' = 'false'; silencia quando o áudio está ensurdecido.
let context, master, mutedProvider = () => false;
const last = new Map();
export const UI_SOUNDS_KEY = 'orbita-ui-sounds';
export const uiSoundsEnabled = () => localStorage.getItem(UI_SOUNDS_KEY) !== 'false';
export function setUiSoundsEnabled(on) { localStorage.setItem(UI_SOUNDS_KEY, on ? 'true' : 'false'); }
export function configureUiSounds({muted} = {}) { if (typeof muted === 'function') mutedProvider = muted; }
const PATTERNS = {
  // [frequência, início(s), duração(s), ganho relativo, tipo]
  chime: [[880, 0, .2, .6, 'sine'], [1318.5, .06, .26, .4, 'sine']],
  tick: [[2200, 0, .02, .5, 'sine']],
  tab: [[1500, 0, .03, .5, 'sine']],
  join: [[523.3, 0, .16, 1, 'sine'], [784, .09, .22, .8, 'sine']],
  leave: [[784, 0, .16, .9, 'sine'], [523.3, .09, .24, .8, 'sine']],
  peerJoin: [[659.3, 0, .12, .7, 'sine'], [880, .07, .16, .6, 'sine']],
  peerLeave: [[659.3, 0, .12, .6, 'sine'], [493.9, .07, .18, .5, 'sine']],
  mute: [[440, 0, .07, .6, 'triangle'], [330, .05, .09, .5, 'triangle']],
  unmute: [[330, 0, .07, .5, 'triangle'], [440, .05, .09, .6, 'triangle']],
  deafen: [[392, 0, .1, .6, 'sine'], [261.6, .07, .14, .55, 'sine']],
  undeafen: [[261.6, 0, .1, .55, 'sine'], [392, .07, .14, .6, 'sine']],
  // Interface geral: ainda mais curtos e baixos que os da chamada.
  tap: [[1800, 0, .018, .28, 'sine']],
  open: [[880, 0, .06, .3, 'sine'], [1174.7, .03, .07, .22, 'sine']],
  close: [[1174.7, 0, .05, .22, 'sine'], [880, .03, .06, .2, 'sine']],
  send: [[1046.5, 0, .05, .32, 'sine'], [1568, .035, .07, .24, 'sine']],
  react: [[1318.5, 0, .05, .3, 'sine'], [1760, .03, .06, .22, 'sine']],
  like: [[1174.7, 0, .05, .32, 'sine'], [1568, .03, .08, .26, 'sine']],
  on: [[987.8, 0, .1, .6, 'sine'], [1318.5, .06, .12, .5, 'sine']],
  off: [[1318.5, 0, .1, .5, 'sine'], [987.8, .06, .12, .5, 'sine']],
};
export function uiSound(name, {force = false, gap = 70} = {}) {
  try {
    if (!PATTERNS[name] || !uiSoundsEnabled()) return;
    // Ensurdecer silencia tudo, exceto o próprio som de reativar o áudio.
    if (mutedProvider() && !force) return;
    const now = performance.now(); if (now - (last.get(name) || 0) < gap) return; last.set(name, now);
    const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) return;
    if (!context) { context = new Audio(); master = context.createGain(); master.gain.value = Number(localStorage.getItem('orbita-ui-sounds-volume') || '0.06'); master.connect(context.destination); }
    if (context.state === 'suspended') context.resume().catch(() => {});
    const t0 = context.currentTime + .005;
    for (const [freq, start, dur, level, type] of PATTERNS[name]) {
      const osc = context.createOscillator(), gain = context.createGain(), t = t0 + start;
      osc.type = type; osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(level, t + .008); gain.gain.exponentialRampToValueAtTime(.0001, t + dur);
      osc.connect(gain); gain.connect(master); osc.start(t); osc.stop(t + dur + .02);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    }
  } catch {}
}
