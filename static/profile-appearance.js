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
      container.classList.add('decoration-dialog');
      const hero = el('div', 'deco-hero');
      const heroIcon = el('div', 'deco-hero-icon', '✦');
      heroIcon.setAttribute('aria-hidden', 'true');
      const heroText = el('div', 'deco-hero-text');
      heroText.append(el('h3', 'deco-title', 'Decorações de Perfil'), el('p', '', 'Personalize seu perfil com efeitos exclusivos e destaque-se na Órbita.'));
      hero.append(heroIcon, heroText);
      container.append(hero);

      const categories = [
        {id: 'effect', label: 'Efeitos', hint: 'Animados'},
        {id: 'frame', label: 'Quadros', hint: 'Avatar'},
        {id: 'banner', label: 'Capas', hint: 'Perfil'},
      ];
      let current = 'effect';
      let prefs = loadProfilePrefs();
      let showAll = false;
      const tabs = el('div', 'shop-tabs');
      tabs.setAttribute('role', 'tablist');
      const grid = el('div', 'shop-grid');
      const more = button('Ver todos', () => { showAll = !showAll; render(); }, 'deco-show-all');
      const foot = el('div', 'deco-foot');

      function selectedId() {
        if (current === 'effect') return prefs.profileEffect || '';
        if (current === 'frame') return prefs.frame || '';
        return prefs.bannerStyle || '';
      }

      function apply(d) {
        const next = {...loadProfilePrefs()};
        if (current === 'effect') next.profileEffect = d.id;
        else if (current === 'frame') next.frame = d.id;
        else next.bannerStyle = d.id;
        saveProfilePrefs(next);
        prefs = next;
        applyDecorations();
        render();
        toast(d.name + ' aplicado — grátis');
      }

      function preview(d) {
        const profile = ctx.state().profile || {};
        const name = (profile.display_name || 'Você').trim();
        const initial = (name[0] || 'O').toUpperCase();
        const card = el('button', 'deco-card' + (selectedId() === d.id ? ' selected' : ''));
        card.type = 'button';
        card.setAttribute('aria-pressed', String(selectedId() === d.id));
        card.setAttribute('aria-label', d.name + ' — grátis');

        const art = el('div', 'deco-preview ' + (current === 'effect' ? d.css || '' : ''));
        if (current === 'banner') art.classList.add('deco-preview-banner', d.css || 'banner-gradient');
        const avatar = el('div', 'deco-avatar ' + (current === 'frame' ? d.css || '' : ''));
        if (profile.avatar_src) {
          const img = el('img');
          img.src = profile.avatar_src;
          img.alt = '';
          avatar.append(img);
        } else {
          avatar.textContent = initial;
          avatar.style.background = profile.avatar_color || 'linear-gradient(135deg,#ff4f9a,#8b5cff)';
        }
        art.append(avatar);
        if (current === 'effect') art.append(el('span', 'deco-aura'), el('span', 'deco-spark s1'), el('span', 'deco-spark s2'), el('span', 'deco-spark s3'));
        card.append(art);
        if (selectedId() === d.id) card.append(el('span', 'deco-check', '✓'));
        const meta = el('div', 'deco-meta');
        meta.append(el('strong', '', d.name), el('small', '', d.theme || 'Efeito'));
        card.append(meta, el('span', 'deco-price', 'Grátis'));
        card.onclick = () => apply(d);
        return card;
      }

      const footText = el('div', 'deco-foot-text');
      footText.append(el('p', '', 'Todas as decorações listadas são gratuitas.'), el('small', '', 'Escolha uma e destaque seu perfil!'));
      function render() {
        grid.replaceChildren();
        const all = DECORATIONS.filter(d => d.type === current);
        const items = showAll ? all : (all.filter(d => d.featured).length ? all.filter(d => d.featured) : all.slice(0, 6));
        items.forEach(d => grid.append(preview(d)));
        more.hidden = all.length <= items.length;
        more.textContent = showAll ? 'Mostrar destaque' : `Ver todos (${all.length})`;
        tabs.querySelectorAll('.shop-tab').forEach(tab => {
          const active = tab.dataset.category === current;
          tab.classList.toggle('active', active);
          tab.setAttribute('aria-selected', String(active));
        });
        foot.replaceChildren(
          el('span', 'deco-free-icon', '✦'),
          footText,
        );
      }

      categories.forEach(cat => {
        const tab = el('button', 'shop-tab' + (cat.id === current ? ' active' : ''));
        tab.type = 'button';
        tab.dataset.category = cat.id;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(cat.id === current));
        tab.append(el('span', '', cat.label), el('small', '', cat.hint));
        tab.onclick = () => {
          current = cat.id;
          showAll = false;
          render();
        };
        tabs.append(tab);
      });

      const clear = button('Remover decoração', () => {
        const next = {...loadProfilePrefs()};
        if (current === 'effect') next.profileEffect = '';
        else if (current === 'frame') next.frame = 'none';
        else next.bannerStyle = 'banner-none';
        saveProfilePrefs(next);
        prefs = next;
        applyDecorations();
        render();
        toast('Decoração removida.');
      }, 'deco-clear');
      const links = el('div', 'deco-links');
      links.append(more, clear);
      container.append(tabs, grid, links, foot);
      render();
    });
  }

  return {openProfileCustomizer, openDecorationGallery};
}
