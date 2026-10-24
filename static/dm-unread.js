// Mensagens diretas não lidas na barra de servidores (estilo Discord): avatares acima da lista de servidores.
export function totalUnread(rows) { return rows.reduce((sum, r) => sum + Math.max(0, r.unread | 0), 0); }
export const badgeText = n => n > 99 ? '99+' : String(n);

export function createDmUnread(ctx) {
  const { el, person, setAvatar } = ctx;
  let rows = [], task = 0, timer = 0;
  const stack = el('div', 'rail-dm-unread'); stack.id = 'rail-dm-unread'; stack.setAttribute('aria-label', 'Mensagens diretas não lidas');
  const homeBadge = el('span', 'rail-unread-badge home-unread'); homeBadge.hidden = true;
  function render() {
    const visible = rows.filter(r => r.unread > 0 && !ctx.isOpen(r.conversation_id));
    stack.replaceChildren(...visible.map(r => {
      const p = person(r.other_id), b = el('button', 'server-icon rail-dm-item'); b.type = 'button';
      b.dataset.conversationId = r.conversation_id; b.title = (p.display_name || 'Mensagem direta') + ' · ' + r.unread + (r.unread === 1 ? ' mensagem não lida' : ' mensagens não lidas');
      b.setAttribute('aria-label', b.title);
      const av = el('span', 'avatar rail-dm-av'); setAvatar(av, p);
      const badge = el('span', 'rail-unread-badge', badgeText(r.unread));
      b.append(av, badge); b.onclick = () => { markRead(r.conversation_id); ctx.open(r.conversation_id); };
      return b;
    }));
    stack.hidden = !visible.length;
    const home = ctx.home(); if (home && homeBadge.parentElement !== home) home.append(homeBadge);
    if (home && stack.previousElementSibling !== home) home.after(stack);
    const total = totalUnread(visible); homeBadge.hidden = !total; homeBadge.textContent = total ? badgeText(total) : '';
    if (home) home.dataset.unread = total || '';
  }
  async function load() {
    const db = ctx.db(); if (!db || !ctx.me()) return;
    const ticket = ++task, { data, error } = await db.rpc('dm_unread_counts');
    if (error || ticket !== task) return;
    rows = Array.isArray(data) ? data.filter(r => r && r.conversation_id && r.other_id) : [];
    render();
  }
  function refresh() { clearTimeout(timer); timer = setTimeout(() => load().catch(() => {}), 250); }
  async function markRead(id) {
    if (!id) return; const had = rows.some(r => r.conversation_id === id && r.unread);
    rows = rows.filter(r => r.conversation_id !== id); render();
    const db = ctx.db(); if (!db) return;
    try { await db.rpc('mark_conversation_read', { target: id }); } catch {}
    if (had) refresh();
  }
  function reset() { rows = []; task++; render(); }
  return { refresh, load, markRead, reset, render, get rows() { return rows; } };
}
