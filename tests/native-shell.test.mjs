import test from 'node:test';
import assert from 'node:assert/strict';

// Cada cenário importa o módulo de novo, com um "window" diferente.
let n = 0;
async function load({bridge, session, url = 'https://orbita.test/'} = {}) {
  const messages = [];
  globalThis.location = new URL(url);
  globalThis.localStorage = {store: {}, setItem(k, v) { this.store[k] = v; }};
  globalThis.document = {body: {dataset: {}}};
  globalThis.window = {
    webkit: bridge ? {messageHandlers: {orbita: {postMessage: m => messages.push(m)}}} : undefined,
    __orbitaNative: session ? {session} : undefined,
  };
  const mod = await import(`../static/native-shell.js?case=${n++}`);
  return {mod, messages};
}

const SESSION = {access_token: 'a.b.c', refresh_token: 'r1'};

test('inativo no navegador comum, mesmo com sessão injetada', async () => {
  for (const scenario of [{}, {session: SESSION}, {bridge: true}]) {
    const {mod, messages} = await load(scenario);
    assert.equal(mod.nativeShell, false);
    assert.equal(mod.authOptions, null);
    mod.post('theme', {key: 'gold'});
    assert.deepEqual(messages, []);
  }
});

test('no app: sem renovação automática e sessão aplicada ao cliente', async () => {
  const {mod, messages} = await load({bridge: true, session: SESSION});
  assert.equal(mod.nativeShell, true);
  assert.deepEqual(mod.authOptions, {autoRefreshToken: false, persistSession: false, detectSessionInUrl: false});
  const applied = [];
  const db = {auth: {
    onAuthStateChange() {},
    async setSession(s) { applied.push(s); return {data: {session: {expires_at: Math.floor(Date.now() / 1000) + 3600}}, error: null}; },
  }};
  await mod.attach(db);
  assert.deepEqual(applied, [SESSION]);
  await window.orbitaNative.receiveSession({access_token: 'x.y.z', refresh_token: 'r2'});
  assert.deepEqual(applied.at(-1), {access_token: 'x.y.z', refresh_token: 'r2'});
  await window.orbitaNative.receiveSession({access_token: 'sem-refresh'});
  assert.equal(applied.length, 2);
  mod.post('sign-out');
  assert.deepEqual(messages.at(-1), {type: 'sign-out'});
});

test('sessão recusada avisa o app', async () => {
  const {mod, messages} = await load({bridge: true, session: SESSION});
  await mod.attach({auth: {onAuthStateChange() {}, async setSession() { return {data: {}, error: new Error('x')}; }}});
  assert.deepEqual(messages, [{type: 'session-invalid'}]);
});

test('?open= aceita só telas conhecidas', async () => {
  assert.equal((await load({url: 'https://o.test/?open=store'})).mod.requestedScreen(), 'store');
  assert.equal((await load({url: 'https://o.test/?open=admin'})).mod.requestedScreen(), 'admin');
  assert.equal((await load({url: 'https://o.test/?open=javascript:alert(1)'})).mod.requestedScreen(), null);
  assert.equal((await load({url: 'https://o.test/'})).mod.requestedScreen(), null);
});

test('tema vindo do app é validado', async () => {
  const {mod} = await load({bridge: true, session: SESSION});
  await mod.attach({auth: {onAuthStateChange() {}, async setSession() { return {data: {session: {}}, error: null}; }}});
  window.orbitaNative.setTheme('gold');
  assert.equal(document.body.dataset.theme, 'gold');
  window.orbitaNative.setTheme('"><script>');
  assert.equal(document.body.dataset.theme, 'gold');
});
