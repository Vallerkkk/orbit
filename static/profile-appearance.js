import {DECORATIONS} from './profile-decoration-catalog.js';
import {uiSound} from './ui-sounds.js';

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


  return {openProfileCustomizer};
}
