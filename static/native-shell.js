// Ponte com o app iOS nativo, que abre partes do site num WKWebView.
// Só ativa quando o app injeta o canal de mensagens e a sessão; no navegador nada muda.
//
// Sessão: o app nativo é o ÚNICO que renova o token. Se o site também renovasse,
// os dois usariam o mesmo refresh token e o Supabase derrubaria a sessão (reuso).
// Por isso, aqui o cliente roda sem renovação automática nem persistência e pede
// um token novo ao app quando o atual está perto de vencer.
const bridge = window.webkit?.messageHandlers?.orbita;
const injected = window.__orbitaNative;

export const nativeShell = !!(bridge && injected?.session?.access_token && injected?.session?.refresh_token);

export function post(type, data = {}) {
  if (!nativeShell) return;
  try { bridge.postMessage({type, ...data}); } catch {}
}

// Opções do createClient no modo app: sem renovar, sem guardar no aparelho, sem ler tokens da URL.
export const authOptions = nativeShell ? {autoRefreshToken: false, persistSession: false, detectSessionInUrl: false} : null;

const OPEN = new Set(['store', 'decorations', 'youtube', 'settings', 'admin', 'friends', 'profile', 'members', 'feed']);
// Tela que o app pediu para abrir (?open=...), validada contra a lista conhecida.
export function requestedScreen() {
  const value = new URL(location.href).searchParams.get('open');
  return OPEN.has(value) ? value : null;
}

export function attach(db) {
  if (!nativeShell) return;
  let timer = 0;
  const schedule = session => {
    clearTimeout(timer);
    const expiresAt = session?.expires_at;
    if (!expiresAt) return;
    // Pede o token novo 2 minutos antes de vencer (ou já, se faltar menos que isso).
    const wait = Math.max(0, (expiresAt - 120) * 1000 - Date.now());
    timer = setTimeout(() => post('session-expiring'), Math.min(wait, 2 ** 31 - 1));
    timer?.unref?.(); // só existe no Node (testes); no navegador é um número
  };
  // O app chama window.orbitaNative.receiveSession({access_token, refresh_token}) após renovar.
  window.orbitaNative = {
    async receiveSession(next) {
      if (!next?.access_token || !next?.refresh_token) return;
      const {data, error} = await db.auth.setSession({access_token: next.access_token, refresh_token: next.refresh_token});
      if (!error) schedule(data.session);
    },
    setTheme(key) {
      if (typeof key !== 'string' || !/^[a-z]{2,20}$/.test(key)) return;
      try { localStorage.setItem('orbita-theme', key); } catch {}
      document.body.dataset.theme = key;
    },
  };
  db.auth.onAuthStateChange((event, session) => { if (session) schedule(session); });
  return db.auth.setSession({access_token: injected.session.access_token, refresh_token: injected.session.refresh_token})
    .then(({data, error}) => { if (error) post('session-invalid'); else schedule(data.session); });
}
