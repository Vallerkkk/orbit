import {DECORATIONS} from './profile-decoration-catalog.js';

export function initProfileAppearance(ctx) {
  const {el, button, showDialog, loadProfilePrefs, saveProfilePrefs, applyDecorations, toast} = ctx;
  const $ = id => document.getElementById(id);

  function openProfileCustomizer() {
    showDialog('Personalizar perfil', container => {
      const card = el('div', 'profile-edit-card');
      container.append(card);
      const inner = el('div', 'profile-edit-content');
      card.append(inner);
      container = inner;
      const prefs = loadProfilePrefs();
      const font = el('select');
      font.innerHTML = '<option value="">Padrão</option><option value="inter">Inter</option><option value="mono">Monospace</option><option value="serif">Serif</option><option value="display">Display</option>';
      font.value = prefs.font || '';
      const effect = el('select');
      effect.innerHTML = '<option value="">Nenhum</option><option value="glow">Glow</option><option value="shimmer">Shimmer</option><option value="rainbow">Rainbow</option>';
      effect.value = prefs.effect || '';
      const preview = el('div', 'profile-color-preview', ctx.state().profile?.display_name || 'Sua capa');
      const bannerColor = el('input');
      bannerColor.type = 'color';
      bannerColor.value = prefs.bannerColor || '#ff4f9a';
      preview.style.backgroundColor = bannerColor.value;
      bannerColor.oninput = () => preview.style.backgroundColor = bannerColor.value;
      const fontLabel = el('label', 'field', 'Fonte do nome');
      fontLabel.append(font);
      const effectLabel = el('label', 'field', 'Efeito do nome');
      effectLabel.append(effect);
      const colorLabel = el('label', 'field', 'Cor da capa');
      colorLabel.append(bannerColor);
      container.append(preview, el('p', 'muted', 'Personalização local do seu perfil neste dispositivo.'), fontLabel, effectLabel, colorLabel,
        button('Salvar', () => {
          saveProfilePrefs({...loadProfilePrefs(), font: font.value, effect: effect.value, bannerColor: bannerColor.value});
          $('app-dialog').close();
          toast('Personalização salva.');
        }, 'primary'));
    });
  }

  function openDecorationGallery() {
    showDialog('Decorações de Perfil', container => {
      container.classList.add('dg');
      const categories = [
        {id: 'effect', label: 'Efeitos', icon: '✨', key: 'profileEffect', empty: ''},
        {id: 'frame', label: 'Quadros', icon: '◎', key: 'frame', empty: 'none'},
        {id: 'banner', label: 'Capas', icon: '▭', key: 'bannerStyle', empty: 'banner-none'},
        {id: 'name', label: 'Nome', icon: 'Aa', key: 'effect', empty: ''},
      ];
      const profile = ctx.state().profile || {};
      const name = (profile.display_name || profile.username || 'Você').trim();
      let current = 'effect', query = '';
      let prefs = loadProfilePrefs();
      const cat = () => categories.find(c => c.id === current);
      const stored = c => c.id === 'name' ? (DECORATIONS.find(d => d.type === 'name' && d.value === (prefs.effect || ''))?.id || 'name-none') : (prefs[c.key] || '');
      const pending = Object.fromEntries(categories.map(c => [c.id, stored(c)]));
      const find = (type, id) => DECORATIONS.find(d => d.type === type && d.id === id);

      function avatarNode(cls) {
        const av = el('div', 'dg-avatar ' + (cls || ''));
        if (profile.avatar_src) { const img = el('img'); img.src = profile.avatar_src; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; av.append(img); }
        else { av.textContent = (name[0] || 'O').toUpperCase(); av.style.background = profile.avatar_color || 'linear-gradient(135deg,#e07ad6,#8b5cff)'; }
        return av;
      }
      function bannerNode(cls) {
        const b = el('div', 'dg-banner ' + (cls || ''));
        if (!cls && profile.banner_src) b.style.backgroundImage = `url("${String(profile.banner_src).replace(/"/g, '%22')}")`;
        return b;
      }

      // Pré-visualização ao vivo com todas as escolhas combinadas
      const live = el('div', 'dg-live');
      function renderLive() {
        const fx = find('effect', pending.effect), fr = find('frame', pending.frame), bn = find('banner', pending.banner), nm = find('name', pending.name);
        live.className = 'dg-live ' + (fx?.css || '');
        const n = el('strong', 'dg-live-name ' + (nm?.css || ''), name);
        const info = el('div', 'dg-live-info');
        info.append(n, el('small', '', '@' + (profile.username || 'voce')));
        const tags = el('div', 'dg-live-tags');
        for (const [label, d] of [['Efeito', fx], ['Quadro', fr], ['Capa', bn], ['Nome', nm]]) if (d?.css) tags.append(el('span', 'dg-chip', label + ': ' + d.name));
        if (!tags.children.length) tags.append(el('span', 'dg-chip muted', 'Sem decorações'));
        live.replaceChildren(bannerNode(bn?.css), avatarNode(fr?.css), info, tags);
      }

      const tabs = el('div', 'dg-tabs');
      tabs.setAttribute('role', 'tablist');
      const search = el('input', 'dg-search');
      search.type = 'search'; search.placeholder = 'Buscar decoração ou tema'; search.setAttribute('aria-label', 'Buscar decoração');
      search.oninput = () => { query = search.value.trim().toLowerCase(); render(); };
      const grid = el('div', 'dg-grid');

      function card(d) {
        const selected = pending[current] === d.id || (!pending[current] && !d.css && d.id === cat().empty);
        const applied = stored(cat()) === d.id;
        const c = el('button', 'dg-card' + (selected ? ' selected' : ''));
        c.type = 'button';
        c.setAttribute('aria-pressed', String(selected));
        c.setAttribute('aria-label', d.name + (applied ? ' — aplicado' : ''));
        const stage = el('div', 'dg-stage ' + (current === 'effect' ? d.css || '' : ''));
        if (current === 'banner') stage.append(bannerNode(d.css));
        if (current === 'name') stage.append(el('strong', 'dg-stage-name ' + (d.css || ''), name));
        else stage.append(avatarNode(current === 'frame' ? d.css : ''));
        c.append(stage);
        if (applied) c.append(el('span', 'dg-badge', 'Em uso'));
        if (selected) c.append(el('span', 'dg-check', '✓'));
        const meta = el('div', 'dg-meta');
        meta.append(el('strong', '', d.name), el('small', '', d.theme || ''));
        c.append(meta);
        c.onclick = () => { pending[current] = d.id; render(); };
        c.ondblclick = () => { pending[current] = d.id; applyAll(); };
        return c;
      }

      function render() {
        tabs.querySelectorAll('.dg-tab').forEach(t => { const on = t.dataset.category === current; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); });
        const items = DECORATIONS.filter(d => d.type === current && (!query || (d.name + ' ' + (d.theme || '')).toLowerCase().includes(query)));
        grid.replaceChildren(...items.map(card));
        if (!items.length) grid.append(el('p', 'dg-empty', 'Nenhuma decoração encontrada.'));
        renderLive();
        const dirty = categories.some(c => pending[c.id] !== stored(c));
        applyBtn.disabled = !dirty;
        applyBtn.textContent = dirty ? 'Aplicar decorações' : 'Tudo aplicado';
      }

      function persist(next) { saveProfilePrefs(next); prefs = next; applyDecorations(); }
      function applyAll() {
        const next = {...loadProfilePrefs()};
        for (const c of categories) {
          if (c.id === 'name') next.effect = find('name', pending.name)?.value || '';
          else next[c.key] = pending[c.id] || c.empty;
        }
        persist(next); render(); toast('Decorações aplicadas.');
      }
      function removeCurrent() {
        const c = cat(), next = {...loadProfilePrefs()};
        if (c.id === 'name') { next.effect = ''; pending.name = 'name-none'; }
        else { next[c.key] = c.empty; pending[c.id] = c.empty; }
        persist(next); render(); toast(c.label + ': decoração removida.');
      }

      categories.forEach(c => {
        const t = el('button', 'dg-tab');
        t.type = 'button'; t.dataset.category = c.id; t.setAttribute('role', 'tab');
        const count = DECORATIONS.filter(d => d.type === c.id).length;
        t.append(el('span', 'dg-tab-icon', c.icon), el('span', '', c.label), el('small', 'dg-count', String(count)));
        t.onclick = () => { current = c.id; render(); };
        tabs.append(t);
      });

      const bar = el('div', 'dg-bar');
      const removeBtn = button('Remover desta categoria', removeCurrent, 'dg-remove');
      const applyBtn = button('Aplicar decorações', applyAll, 'primary dg-apply');
      bar.append(removeBtn, applyBtn);
      const tools = el('div', 'dg-tools');
      tools.append(tabs, search);
      container.append(live, tools, grid, bar);
      render();
    });
  }

  return {openProfileCustomizer, openDecorationGallery};
}
