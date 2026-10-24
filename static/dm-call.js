// Chamadas privadas 1:1 (PV): toque, atender/recusar, cancelar, tempo limite e registro na conversa.
export const RING_TIMEOUT_MS = 30000;
const ACTIVE = new Set(['ringing', 'accepted']);

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60), h = Math.floor(m / 60);
  return h ? h + ' h ' + String(m % 60).padStart(2, '0') + ' min' : m + ' min ' + String(s % 60).padStart(2, '0') + ' s';
}

// Evento recebido pelo destinatário ainda pode tocar?
export function shouldRing(event, me, now = Date.now()) {
  // `now` should already be corrected to the server clock (see createDmCalls.skew).
  if (!event || event.caller_id === me || (event.status && event.status !== 'ringing')) return false;
  const age = now - Date.parse(event.created_at);
  return Number.isFinite(age) && age < RING_TIMEOUT_MS && age > -60000;
}

export function callLogText(event, me, now = Date.now()) {
  const video = event.kind === 'video', label = video ? 'Chamada de vídeo' : 'Chamada de voz';
  const mine = event.caller_id === me;
  const status = event.status === 'ringing' && now - Date.parse(event.created_at) > RING_TIMEOUT_MS + 15000 ? 'missed' : (event.status || 'missed');
  if (status === 'ended' || (status === 'accepted' && event.ended_at)) {
    const secs = (Date.parse(event.ended_at) - Date.parse(event.answered_at)) / 1000;
    return { icon: video ? '📹' : '📞', tone: 'ok', text: label + ' · ' + formatDuration(secs) };
  }
  if (status === 'accepted') return { icon: video ? '📹' : '📞', tone: 'live', text: label + ' em andamento' };
  if (status === 'ringing') return { icon: video ? '📹' : '📞', tone: 'live', text: mine ? label + ' · chamando…' : label + ' recebida' };
  if (status === 'declined') return { icon: '✕', tone: 'miss', text: label + (mine ? ' recusada' : ' · você recusou') };
  if (status === 'canceled') return { icon: '↩', tone: 'miss', text: label + (mine ? ' cancelada' : ' perdida') };
  return { icon: '!', tone: 'miss', text: mine ? label + ' · sem resposta' : label + ' perdida' };
}

// Resolve a start_dm_call answer: what should this client do with the call?
export function startOutcome(row, me) {
  const event = row?.event || row; if (!event?.id) return 'error';
  if (!row.existing) return 'ringing';
  if (event.status === 'accepted') return 'join';
  if (event.status === 'ringing') return event.caller_id === me ? 'ringing' : 'answer';
  return 'error';
}

// Ringtone with its own audio context so it is audible even if UI sounds are off.
function createRingtone() {
  let context = null, timer = 0;
  const audioCtor = () => window.AudioContext || window.webkitAudioContext;
  const ensure = () => { const A = audioCtor(); if (!A) return null; if (!context) context = new A(); return context; };
  const burst = () => {
    const c = ensure(); if (!c || c.state !== 'running') return false;
    const t0 = c.currentTime + .01, gain = c.createGain(); gain.connect(c.destination);
    gain.gain.setValueAtTime(0, t0);
    for (let i = 0; i < 2; i++) { const t = t0 + i * .45; gain.gain.linearRampToValueAtTime(.18, t + .02); gain.gain.setValueAtTime(.18, t + .32); gain.gain.linearRampToValueAtTime(0, t + .38); }
    for (const f of [440, 480]) { const o = c.createOscillator(); o.frequency.value = f; o.connect(gain); o.start(t0); o.stop(t0 + .95); }
    return true;
  };
  return {
    // Returns false when autoplay is blocked (context suspended without a gesture).
    async start() {
      this.stop(); const c = ensure(); if (!c) return false;
      if (c.state !== 'running') { try { await Promise.race([c.resume(), new Promise(r => setTimeout(r, 300))]); } catch {} }
      const ok = c.state === 'running'; if (ok) burst();
      timer = setInterval(() => { burst(); try { navigator.vibrate?.([300, 200, 300]); } catch {} }, 2600);
      return ok;
    },
    unlock() { const c = ensure(); if (c && c.state !== 'running') c.resume().catch(() => {}); },
    stop() { clearInterval(timer); timer = 0; try { navigator.vibrate?.(0); } catch {} }
  };
}

export function createDmCalls(ctx) {
  const { el, me, person, setAvatar, toast, uiSound } = ctx;
  const db = { rpc: (...a) => ctx.db().rpc(...a), from: (...a) => ctx.db().from(...a) };
  let current = null, timer = 0, resultTimer = 0, skew = 0, titleTimer = 0, savedTitle = '', notice = null, pollTimer = 0;
  const seen = new Set(), ringtone = createRingtone();
  const serverNow = () => Date.now() + skew;
  // Global overlay: lives on <body> and is promoted to the top layer (popover) so it
  // shows over open dialogs, the call stage and fullscreen, on any screen of the app.
  const box = el('div', 'dm-call-card'); box.id = 'dm-call-card'; box.hidden = true;
  box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-live', 'assertive');
  if ('popover' in box) box.setAttribute('popover', 'manual');
  document.body.append(box);
  // A modal <dialog> makes everything outside it inert (not clickable), so the card is
  // re-parented into the topmost open modal; the popover keeps it above everything.
  const host = () => { const modals = [...document.querySelectorAll('dialog[open]')].filter(d => { try { return d.matches(':modal'); } catch { return false; } }); return modals.at(-1) || document.fullscreenElement || document.body; };
  const showBox = () => {
    box.hidden = false; const target = host(); if (box.parentNode !== target) { target.append(box); if (target.tagName === 'DIALOG') target.addEventListener('close', () => { if (!box.hidden) showBox(); }, { once: true }); }
    try { if (box.showPopover) { if (box.matches(':popover-open')) box.hidePopover(); box.showPopover(); } } catch {}
  };
  const hideBox = () => { try { if (box.matches?.(':popover-open')) box.hidePopover(); } catch {} box.hidden = true; if (box.parentNode !== document.body) document.body.append(box); };
  const unlockAudio = () => ringtone.unlock();
  addEventListener('pointerdown', unlockAudio, { capture: true, passive: true }); addEventListener('keydown', unlockAudio, { capture: true });
  const notify = () => ctx.changed?.();

  const transition = async (id, next) => {
    const { data, error } = await db.rpc('call_event_transition', { event: id, next });
    if (error) throw error; return data;
  };
  const stopAlert = () => {
    ringtone.stop(); clearInterval(titleTimer); titleTimer = 0;
    if (savedTitle) { document.title = savedTitle; savedTitle = ''; }
    try { notice?.close(); } catch {} notice = null;
  };
  const stopRing = stopAlert;
  const clear = () => { clearTimeout(timer); clearTimeout(resultTimer); stopAlert(); hideBox(); box.replaceChildren(); delete box.dataset.mode; delete box.dataset.audio; notify(); };
  // Ask for system notifications from a user gesture (call button, accept, first click).
  function askNotifications() { try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch?.(() => {}); } catch {} }
  addEventListener('pointerdown', function once() { removeEventListener('pointerdown', once, true); askNotifications(); }, true);
  function alertIncoming(event) {
    const who = person(event.caller_id)?.display_name || 'Alguém', label = event.kind === 'video' ? 'chamada de vídeo' : 'chamada de voz';
    ringtone.start().then(ok => { if (!ok && box.dataset.mode === 'incoming') { box.dataset.audio = 'blocked'; const hint = box.querySelector('.dm-call-info small'); if (hint) hint.textContent += ' · clique para ativar o som'; } });
    savedTitle = savedTitle || document.title; let on = false;
    clearInterval(titleTimer); titleTimer = setInterval(() => { on = !on; document.title = on ? '📞 ' + who + ' está ligando…' : savedTitle; }, 1000); document.title = '📞 ' + who + ' está ligando…';
    try {
      if ((document.hidden || !document.hasFocus()) && 'Notification' in window && Notification.permission === 'granted') {
        notice = new Notification(who + ' está te ligando', { body: 'Toque para atender a ' + label + '.', tag: 'orbita-call-' + event.id, requireInteraction: true, renotify: true, silent: false });
        notice.onclick = () => { try { window.focus(); } catch {} notice?.close(); };
      }
    } catch {}
  }
  const btn = (cls, label, icon, fn) => { const b = el('button', 'dm-call-btn ' + cls); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; b.innerHTML = icon; b.onclick = () => Promise.resolve(fn()).catch(e => toast(e?.message || 'Não foi possível concluir.')); return b; };
  const ICON = {
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
    hang: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15.5c5-4.7 13-4.7 18 0l-2.2 2.4-3.6-1.4v-2.8a10 10 0 0 0-6.4 0v2.8l-3.6 1.4z"/></svg>',
    video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 6-3v10l-6-3"/></svg>'
  };
  function render(mode, event, status) {
    clearTimeout(resultTimer);
    const other = person(event.caller_id === me() ? otherOf(event) : event.caller_id);
    box.dataset.mode = mode; box.replaceChildren();
    const av = el('span', 'avatar dm-call-av'); setAvatar(av, other);
    const info = el('div', 'dm-call-info');
    info.append(el('strong', '', other?.display_name || 'Contato'), el('small', '', status));
    box.append(av, info);
    const actions = el('div', 'dm-call-actions');
    if (mode === 'incoming') actions.append(
      btn('decline', 'Recusar', ICON.hang, () => respond('declined')),
      btn('accept', event.kind === 'video' ? 'Atender com vídeo' : 'Atender', event.kind === 'video' ? ICON.video : ICON.phone, () => respond('accepted')));
    if (mode === 'outgoing') actions.append(btn('decline', 'Cancelar chamada', ICON.hang, cancel));
    box.append(actions); showBox();
    if (mode === 'incoming') { actions.lastChild.focus({ preventScroll: true }); box.onpointerdown = unlockAudio; }
    notify();
  }
  const conversationOf = id => ctx.conversations().find(c => c.id === id);
  function otherOf(event) { const c = conversationOf(event.conversation_id); return c ? (c.user_a === me() ? c.user_b : c.user_a) : null; }
  function showResult(event, text) { render('result', event, text); resultTimer = setTimeout(() => { if (box.dataset.mode === 'result') clear(); }, 3500); }

  async function start(conversation, kind = 'voice') {
    askNotifications(); unlockAudio();
    const mine = current && current.conversation_id === conversation.id ? current : null;
    if (mine?.status === 'ringing' && mine.caller_id !== me()) return respond('accepted');
    if (mine?.status === 'accepted' && ctx.inCall?.(conversation.id)) { toast('Vocês já estão em uma chamada.'); return current; }
    if (mine?.status === 'ringing' && mine.caller_id === me()) return current;
    if (current && ACTIVE.has(current.status) && !mine) throw Error('Você já está em uma chamada privada.');
    const { data, error } = await db.rpc('start_dm_call', { target: conversation.id, call_kind: kind });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data, event = row?.event;
    if (row?.server_now) skew = Date.parse(row.server_now) - Date.now();
    const outcome = startOutcome(row, me());
    if (outcome === 'error') throw Error('Não foi possível iniciar a chamada.');
    seen.add(event.id);
    if (outcome === 'answer') { current = { ...event }; return respond('accepted'); }
    if (outcome === 'join') { current = { ...event }; clear(); if (!ctx.inCall?.(conversation.id)) await ctx.joinCall(conversation, event.kind); else toast('Vocês já estão em uma chamada.'); return current; }
    current = { ...event, status: 'ringing' };
    const callKind = event.kind || kind;
    render('outgoing', current, (callKind === 'video' ? 'Chamada de vídeo' : 'Chamada de voz') + ' · Chamando…');
    const remaining = row.existing ? Math.max(1000, RING_TIMEOUT_MS - (serverNow() - Date.parse(event.created_at))) : RING_TIMEOUT_MS;
    timer = setTimeout(async () => {
      if (current?.id !== event.id || current.status !== 'ringing') return;
      current.status = 'missed';
      try { await transition(event.id, 'missed'); } catch {}
      showResult(current, 'Sem resposta'); await ctx.leaveCall(); ctx.refreshLog?.(); notify();
    }, remaining);
    if (!ctx.inCall?.(conversation.id)) await ctx.joinCall(conversation, callKind);
    return current;
  }
  async function cancel() {
    const event = current; if (!event) return clear();
    event.status = 'canceled'; clear();
    try { await transition(event.id, 'canceled'); } finally { await ctx.leaveCall(); ctx.refreshLog?.(); }
  }
  async function respond(next) {
    const event = current; if (!event) return clear();
    stopRing();
    askNotifications(); unlockAudio();
    let updated;
    try { updated = await transition(event.id, next); }
    catch (e) { current = null; clear(); ctx.refreshLog?.(); throw e; }
    current = { ...event, ...(updated || {}), status: next };
    clear();
    if (next === 'accepted' && !ctx.inCall?.(event.conversation_id)) { const c = conversationOf(event.conversation_id) || await ctx.loadConversation(event.conversation_id); await ctx.joinCall(c, event.kind); }
    ctx.refreshLog?.();
  }

  function onEvent(event, type = 'INSERT') {
    if (!event?.id) return;
    if (type === 'INSERT') {
      if (seen.has(event.id) && current?.id === event.id) return;
      if (!shouldRing(event, me(), serverNow())) return;
      seen.add(event.id);
      // Glare: we are already ringing them in this same DM → just answer their call.
      if (current && current.status === 'ringing' && current.caller_id === me() && current.conversation_id === event.conversation_id && current.id !== event.id) { current = { ...event, status: 'ringing' }; respond('accepted').catch(e => toast(e?.message || 'Não foi possível atender.')); return; }
      // Já estou dentro da sala dessa DM: não toca nem mostra "chamando" — apenas aceita em silêncio.
      if (ctx.inCall?.(event.conversation_id)) { current = { ...event, status: 'ringing' }; respond('accepted').catch(() => {}); return; }
      if (current && ACTIVE.has(current.status) && current.id !== event.id) { transition(event.id, 'declined').catch(() => {}); return; }
      current = { ...event, status: 'ringing' };
      render('incoming', current, event.kind === 'video' ? 'Chamada de vídeo recebida' : 'Chamada de voz recebida'); alertIncoming(event);
      clearTimeout(timer);
      timer = setTimeout(() => { if (current?.id === event.id && current.status === 'ringing') { current.status = 'missed'; clear(); ctx.refreshLog?.(); } }, Math.max(1000, RING_TIMEOUT_MS - (serverNow() - Date.parse(event.created_at))));
      ctx.refreshLog?.(); return;
    }
    ctx.refreshLog?.(); setTimeout(notify);
    if (current?.id !== event.id) return;
    const was = current.status; current = { ...current, ...event };
    if (event.status === 'accepted' && was === 'ringing' && event.caller_id === me()) { clearTimeout(timer); clear(); uiSound?.('peerJoin', { gap: 400 }); }
    else if (event.status === 'accepted' && was === 'ringing' && box.dataset.mode === 'incoming') { clearTimeout(timer); clear(); }
    else if (event.status === 'declined' && event.caller_id === me()) { clearTimeout(timer); showResult(current, 'Chamada recusada'); ctx.leaveCall(); }
    else if (['canceled', 'missed'].includes(event.status) && event.caller_id !== me() && box.dataset.mode === 'incoming') { clear(); toast('Chamada perdida de ' + (person(event.caller_id)?.display_name || 'contato') + '.'); }
    else if (event.status === 'ended' && was === 'accepted') { current = null; ctx.leaveCall(); }
  }
  // Chamado ao sair de uma sala privada: encerra (ou cancela) o evento ativo.
  async function left(conversationId) {
    const event = current; if (!event || event.conversation_id !== conversationId) return;
    if (event.status === 'ringing' && event.caller_id === me()) { event.status = 'canceled'; clear(); await transition(event.id, 'canceled').catch(() => {}); }
    else if (event.status === 'accepted') { event.status = 'ended'; current = null; await transition(event.id, 'ended').catch(() => {}); }
    ctx.refreshLog?.(); notify();
  }
  // Fallback for missed realtime INSERTs (background tab, reconnect): ask the server.
  async function poll() {
    if (!me()) return;
    try {
      const { data, error } = await db.rpc('dm_ringing_calls');
      if (error || !Array.isArray(data)) return;
      if (data[0]?.server_now) skew = Date.parse(data[0].server_now) - Date.now();
      for (const row of data) if (row?.event && !(current?.id === row.event.id)) onEvent(row.event, 'INSERT');
    } catch {}
  }
  function watch() {
    clearInterval(pollTimer); pollTimer = setInterval(poll, 15000);
    const wake = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', wake); addEventListener('focus', wake); addEventListener('online', wake);
    poll();
  }
  // Incoming ringing call for this DM (button turns into "Atender").
  function pendingFor(conversationId) { return current && current.conversation_id === conversationId && ACTIVE.has(current.status) ? current : null; }
  function reset() { current = null; seen.clear(); clear(); }
  return { start, onEvent, left, reset, cancel, respond, poll, watch, pendingFor, get current() { return current; }, get skew() { return skew; } };
}
