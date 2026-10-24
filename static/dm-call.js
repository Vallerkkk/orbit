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

export function createDmCalls(ctx) {
  const { el, me, person, setAvatar, toast, uiSound } = ctx;
  const db = { rpc: (...a) => ctx.db().rpc(...a), from: (...a) => ctx.db().from(...a) };
  let current = null, timer = 0, ringTimer = 0, resultTimer = 0;
  const box = el('div', 'dm-call-card'); box.id = 'dm-call-card'; box.hidden = true;
  box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-live', 'assertive');
  document.body.append(box);

  const transition = async (id, next) => {
    const { data, error } = await db.rpc('call_event_transition', { event: id, next });
    if (error) throw error; return data;
  };
  const stopRing = () => { clearInterval(ringTimer); ringTimer = 0; };
  const clear = () => { clearTimeout(timer); clearTimeout(resultTimer); stopRing(); box.hidden = true; box.replaceChildren(); delete box.dataset.mode; };
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
    box.append(actions); box.hidden = false;
    if (mode === 'incoming') actions.lastChild.focus({ preventScroll: true });
  }
  const conversationOf = id => ctx.conversations().find(c => c.id === id);
  function otherOf(event) { const c = conversationOf(event.conversation_id); return c ? (c.user_a === me() ? c.user_b : c.user_a) : null; }
  function showResult(event, text) { render('result', event, text); resultTimer = setTimeout(() => { if (box.dataset.mode === 'result') clear(); }, 3500); }

  async function start(conversation, kind = 'voice') {
    if (current && ACTIVE.has(current.status)) throw Error('Você já está em uma chamada privada.');
    const { data, error } = await db.from('call_events').insert({ conversation_id: conversation.id, caller_id: me(), kind }).select().single();
    if (error) throw error;
    current = { ...data, status: data.status || 'ringing', kind };
    render('outgoing', current, (kind === 'video' ? 'Chamada de vídeo' : 'Chamada de voz') + ' · Chamando…');
    timer = setTimeout(async () => {
      if (current?.id !== data.id || current.status !== 'ringing') return;
      current.status = 'missed';
      try { await transition(data.id, 'missed'); } catch {}
      showResult(current, 'Sem resposta'); await ctx.leaveCall(); ctx.refreshLog?.();
    }, RING_TIMEOUT_MS);
    await ctx.joinCall(conversation, kind);
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
    const updated = await transition(event.id, next);
    current = { ...event, ...(updated || {}), status: next };
    clear();
    if (next === 'accepted') { const c = conversationOf(event.conversation_id) || await ctx.loadConversation(event.conversation_id); await ctx.joinCall(c, event.kind); }
    ctx.refreshLog?.();
  }
  function ring() { stopRing(); const started = Date.now(); const tick = () => { if (box.dataset.mode !== 'incoming' || Date.now() - started > RING_TIMEOUT_MS) return stopRing(); uiSound?.('chime', { gap: 1500 }); }; tick(); ringTimer = setInterval(tick, 2500); }

  function onEvent(event, type = 'INSERT') {
    if (!event?.id) return;
    if (type === 'INSERT') {
      if (!shouldRing(event, me())) return;
      if (current && ACTIVE.has(current.status) && current.id !== event.id) { transition(event.id, 'declined').catch(() => {}); return; }
      current = { ...event, status: 'ringing' };
      render('incoming', current, event.kind === 'video' ? 'Chamada de vídeo recebida' : 'Chamada de voz recebida'); ring();
      clearTimeout(timer);
      timer = setTimeout(() => { if (current?.id === event.id && current.status === 'ringing') { current.status = 'missed'; clear(); ctx.refreshLog?.(); } }, Math.max(1000, RING_TIMEOUT_MS - (Date.now() - Date.parse(event.created_at))));
      ctx.refreshLog?.(); return;
    }
    ctx.refreshLog?.();
    if (current?.id !== event.id) return;
    const was = current.status; current = { ...current, ...event };
    if (event.status === 'accepted' && was === 'ringing' && event.caller_id === me()) { clearTimeout(timer); clear(); uiSound?.('peerJoin', { gap: 400 }); }
    else if (event.status === 'declined' && event.caller_id === me()) { clearTimeout(timer); showResult(current, 'Chamada recusada'); ctx.leaveCall(); }
    else if (['canceled', 'missed'].includes(event.status) && event.caller_id !== me() && box.dataset.mode === 'incoming') { clear(); toast('Chamada perdida de ' + (person(event.caller_id)?.display_name || 'contato') + '.'); }
    else if (event.status === 'ended' && was === 'accepted') { current = null; ctx.leaveCall(); }
  }
  // Chamado ao sair de uma sala privada: encerra (ou cancela) o evento ativo.
  async function left(conversationId) {
    const event = current; if (!event || event.conversation_id !== conversationId) return;
    if (event.status === 'ringing' && event.caller_id === me()) { event.status = 'canceled'; clear(); await transition(event.id, 'canceled').catch(() => {}); }
    else if (event.status === 'accepted') { event.status = 'ended'; current = null; await transition(event.id, 'ended').catch(() => {}); }
    ctx.refreshLog?.();
  }
  function reset() { current = null; clear(); }
  return { start, onEvent, left, reset, cancel, respond, get current() { return current; } };
}
