let deferredPrompt, installed = false, prompting = false;
// Rodando como app (PWA instalada, APK/TWA Android ou desktop Electron): não faz sentido oferecer download/instalação.
export const runningAsApp = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true || !!window.orbitaDesktop || /Electron\/|OrbitaNative\//.test(navigator.userAgent) || document.referrer.startsWith('android-app://');
const markApp = () => { if (runningAsApp()) document.documentElement.dataset.appWindow = 'true'; else delete document.documentElement.dataset.appWindow; };
markApp(); matchMedia('(display-mode: standalone)').addEventListener?.('change', markApp);
export const isAppWindow = () => installed || runningAsApp() || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const changed = () => window.dispatchEvent(new Event('orbita-install-state'));
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); deferredPrompt = event; changed();
});
window.addEventListener('appinstalled', () => { installed = true; deferredPrompt = undefined; changed(); });

export async function requestAppInstall() {
  if (isAppWindow()) return 'installed';
  if (prompting) return 'busy';
  if (!deferredPrompt) return 'unavailable';
  const prompt = deferredPrompt; deferredPrompt = undefined; prompting = true; changed();
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch { return 'unavailable'; }
  finally { prompting = false; changed(); }
}

export function detectPlatform(ua = navigator.userAgent, platform = navigator.platform || '', touch = navigator.maxTouchPoints || 0) {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (platform === 'MacIntel' && touch > 1)) return 'ios';
  if (/windows/i.test(ua)) return 'windows';
  return 'other';
}

if (document.body?.dataset.installPage === 'true') {
  const os = detectPlatform(), labels = {android:'Detectamos um Android: o APK está em destaque.', ios:'Detectamos um iPhone/iPad: siga os 3 passos no Safari.', windows:'Detectamos o Windows: o instalador está em destaque.', other:'Escolha a plataforma abaixo ou use pelo navegador.'};
  document.documentElement.dataset.platform = os;
  const hero = os === 'other' ? 'windows' : os;
  document.querySelectorAll('.actions .cta').forEach(a => { a.hidden = a.dataset.platform !== hero; });
  document.querySelector(`[data-card="${hero}"]`)?.classList.add('is-detected');
  const note = document.getElementById('detected'); if (note) note.textContent = labels[os];
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), {threshold:.12}) : null;
  document.querySelectorAll('.reveal').forEach(el => io ? io.observe(el) : el.classList.add('in'));
  document.querySelectorAll('[data-pwa-install]').forEach(b => b.addEventListener('click', () => document.getElementById('install-app').click()));
  const button = document.getElementById('install-app'), status = document.getElementById('install-status');
  function update() {
    button.disabled = prompting || isAppWindow();
    button.textContent = isAppWindow() ? 'Órbita instalado neste navegador' : 'Instalar versão do navegador';
    if (isAppWindow()) status.textContent = 'O aplicativo está pronto. Abra a Órbita pelo ícone ou continue usando o site.';
  }
  window.addEventListener('orbita-install-state', update); update();
  button.onclick = async () => {
    const result = await requestAppInstall();
    status.textContent = ({accepted:'Solicitação aceita. Aguarde o navegador concluir a instalação.',
      dismissed:'Instalação cancelada. Você pode tentar mais tarde pelo menu do navegador.',
      unavailable:'Use a opção de instalar aplicativo no menu do seu navegador. Veja o passo a passo abaixo.',
      installed:'O aplicativo já está instalado neste navegador.'})[result] || 'Aguarde a confirmação do navegador.';
    if (result === 'unavailable') document.getElementById('install-help').focus();
    update();
  };
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js', {scope:'/'}).catch(() => {
    status.textContent = 'O navegador não conseguiu preparar a instalação. Verifique a conexão e use as instruções abaixo.';
  });
}
