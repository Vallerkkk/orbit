/* LulaDroid — assistente de voz da chamada.
   Transcreve a fala local pelo reconhecimento do navegador, envia o texto ao
   backend autenticado e reproduz a resposta no aparelho. */

const WAKE = /\b(?:ei|e\s*a[ií]|oi|ol[aá])\s*[,!.]?\s*lula\s*[-_]?\s*droid\b[\s,.:;!?\-]*(.*)/i;

export function wakeQuestion(text) {
  const match = String(text || '').match(WAKE);
  return match ? match[1].trim() : null;
}

export function initLuladroid(ctx) {
  const { el, button, toast, showDialog, apiFetch, state } = ctx;
  const view = document.getElementById('voice-view');
  if (!view) return { update() {}, stop() {}, open() {} };
  // Uma nova entrada na chamada pode acontecer antes da anterior terminar de
  // montar o painel; remove restos para nunca duplicar botão/painel.
  document.querySelectorAll('#luladroid-panel,#luladroid-toggle').forEach(node => node.remove());
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let active = false, muted = false, recognition = null, closed = false;
  let callId = '', log = [], lastFinal = '', lastFinalAt = 0;

  const panel = el('aside', 'luladroid-panel');
  panel.id = 'luladroid-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'LulaDroid, assistente da chamada');

  const header = el('header', 'luladroid-header');
  const title = el('h3', '', 'LulaDroid');
  const dot = el('span', 'luladroid-dot');
  const status = el('span', 'luladroid-status', 'Assistente de voz');
  status.setAttribute('role', 'status');
  const close = button('×', () => setOpen(false), 'luladroid-close');
  close.setAttribute('aria-label', 'Fechar LulaDroid');
  header.append(title, dot, status, close);

  const intro = el('p', 'luladroid-intro', 'Diga “eai LulaDroid” e faça a pergunta. A resposta é falada nesta chamada.');
  const logBox = el('div', 'luladroid-log');
  logBox.setAttribute('role', 'log');
  logBox.setAttribute('aria-live', 'polite');
  logBox.setAttribute('aria-label', 'Conversa com o LulaDroid');

  const actions = el('div', 'luladroid-actions');
  const listen = button('Ativar escuta', () => activate(), 'primary');
  const stopButton = button('Parar', () => deactivate(), 'soft-button');
  stopButton.hidden = true;
  const mute = button('Silenciar voz', () => toggleMute(), 'soft-button');
  mute.setAttribute('aria-pressed', 'false');
  const transcripts = button('Transcrições', () => showTranscripts(), 'soft-button');
  actions.append(listen, stopButton, mute, transcripts);

  const note = el('p', 'luladroid-note', Recognition
    ? 'O reconhecimento do navegador pode enviar áudio ao fornecedor do navegador. Só o texto é guardado; áudio não é armazenado pela Órbita.'
    : 'Este navegador não oferece reconhecimento de voz. Use Chrome, Edge ou outro navegador compatível.');
  panel.append(header, intro, logBox, actions, note);

  const toggle = button('LulaDroid', () => setOpen(panel.hidden), 'soft-button');
  toggle.id = 'luladroid-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'luladroid-panel');
  view.querySelector('.chat-actions').prepend(toggle);
  view.append(panel);

  const current = () => !closed && !!state().session?.user.id && state().selected?.kind === 'voice';
  const inRoom = () => !!state().room && state().room.state === 'connected';
  const scope = () => {
    const selected = state().selected;
    return selected ? (selected.private ? 'direct-' : 'channel-') + selected.id : '';
  };

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) requestAnimationFrame(() => panel.querySelector('button')?.focus({ preventScroll: true }));
  }

  function setStatus(text, live = false) {
    status.textContent = text;
    dot.classList.toggle('on', live);
  }

  function add(author, text) {
    const row = el('div', 'luladroid-line ' + author);
    row.append(el('strong', '', author === 'ai' ? 'LulaDroid' : 'Você'), el('p', '', text));
    logBox.append(row);
    logBox.scrollTop = logBox.scrollHeight;
    log.push({ author, text, at: Date.now() });
    if (log.length > 60) { log.shift(); logBox.firstElementChild?.remove(); }
  }

  function speak(text) {
    if (muted || !text || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'pt-BR';
      utterance.rate = 1.02;
      const voices = speechSynthesis.getVoices();
      utterance.voice = voices.find(v => /pt[-_]BR/i.test(v.lang)) || voices.find(v => /^pt/i.test(v.lang)) || null;
      utterance.onend = utterance.onerror = () => {};
      speechSynthesis.speak(utterance);
    } catch {}
  }

  function toggleMute() {
    muted = !muted;
    mute.textContent = muted ? 'Ouvir voz' : 'Silenciar voz';
    mute.setAttribute('aria-pressed', String(muted));
    if (muted && 'speechSynthesis' in window) speechSynthesis.cancel();
  }

  function startRecognition() {
    if (!Recognition || !active || recognition) return;
    recognition = new Recognition();
    recognition.lang = 'pt-BR';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = event => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (!event.results[i].isFinal) continue;
        const text = event.results[i][0]?.transcript?.trim();
        if (text) handle(text);
      }
    };
    recognition.onerror = event => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        active = false; setStatus('Microfone não autorizado'); toast('Autorize o microfone para usar o LulaDroid.'); stopRecognition();
      } else if (event.error !== 'aborted') setStatus('Reconhecimento indisponível');
    };
    recognition.onend = () => {
      recognition = null;
      if (active && current() && inRoom()) setTimeout(() => { if (active) startRecognition(); }, 500);
    };
    try { recognition.start(); setStatus('Escuta ativa', true); }
    catch { recognition = null; setStatus('Não foi possível iniciar'); }
  }

  function stopRecognition() {
    if (!recognition) return;
    const previous = recognition; recognition = null;
    try { previous.onend = null; previous.abort(); } catch {}
    setStatus('Escuta pausada');
  }

  async function handle(text) {
    if (!current() || !inRoom()) return;
    const now = Date.now();
    if (text === lastFinal && now - lastFinalAt < 2000) return;
    lastFinal = text; lastFinalAt = now;
    if (!state().room?.localParticipant?.isMicrophoneEnabled) { setStatus('Microfone desligado'); return; }
    add('you', text);
    const session = state().session;
    const displayName = session?.user?.user_metadata?.display_name || 'Participante';
    const id = callId || (callId = scope());
    if (!id) return;
    try {
      await apiFetch('/api/ai/transcript', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_id: id, text, display_name: displayName }),
      });
    } catch { toast('Não foi possível guardar esta fala no histórico.'); }
    const question = wakeQuestion(text);
    if (question === null) return;
    setStatus('Pensando…', true);
    try {
      const response = await apiFetch('/api/ai/opinion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_id: id, question: question || 'Resuma o que foi falado até agora.' }),
      });
      const data = await response.json();
      const answer = String(data.answer || '').trim();
      if (!current()) return;
      if (answer) { add('ai', answer); speak(answer); setStatus('Escuta ativa', true); }
      else setStatus('Sem resposta');
    } catch (error) {
      setStatus('Não foi possível responder');
      toast(error.message || 'O LulaDroid não conseguiu responder.');
    }
  }

  function activate() {
    if (!current()) return toast('Entre em uma sala de voz para usar o LulaDroid.');
    if (!Recognition) return toast('Este navegador não oferece reconhecimento de voz.');
    if (!inRoom()) return toast('Entre na chamada antes de ativar o LulaDroid.');
    if (active) return;
    showDialog('Ativar LulaDroid', box => {
      box.classList.add('luladroid-consent');
      box.append(
        el('p', '', 'Ao ativar, o navegador transcreve a sua fala nesta chamada. O texto fica no histórico restrito aos administradores do site. O áudio não é gravado pela Órbita.'),
        el('p', '', 'Diga “eai LulaDroid” seguido da pergunta. Todos na chamada ouvem a resposta. Não fale dados confidenciais.'),
        button('Ativar escuta do LulaDroid', () => {
          document.getElementById('app-dialog').close();
          active = true; listen.hidden = true; stopButton.hidden = false;
          setStatus('Escuta ativa', true); startRecognition();
        }, 'primary'),
        button('Agora não', () => document.getElementById('app-dialog').close(), 'soft-button'),
      );
    });
  }

  function deactivate() {
    active = false; stopRecognition();
    listen.hidden = false; stopButton.hidden = true;
    setStatus('Assistente de voz');
  }

  async function showTranscripts() {
    if (!state().isAdmin) return toast('Transcrições disponíveis somente aos administradores.');
    const id = callId || scope();
    if (!id) return;
    showDialog('Transcrições da chamada', async box => {
      const loading = el('p', 'muted', 'Carregando…'); box.append(loading);
      try {
        const response = await apiFetch('/api/ai/transcript/' + encodeURIComponent(id));
        const data = await response.json();
        box.replaceChildren();
        if (!data.items?.length) { box.append(el('p', 'muted', 'Nenhuma transcrição nesta chamada.')); return; }
        box.append(el('p', 'muted', 'Leitura restrita a ADM. O áudio não é armazenado.'));
        for (const item of data.items) {
          const card = el('article', 'luladroid-transcript');
          card.append(el('strong', '', item.display_name || 'Participante'),
            el('small', 'muted', ' · ' + new Date(item.ts || Date.now()).toLocaleString('pt-BR')),
            el('p', '', item.text || ''));
          box.append(card);
        }
      } catch (error) { loading.textContent = error.message || 'Não foi possível carregar.'; }
    });
  }

  function update() {
    const next = scope();
    if (next !== callId) {
      callId = next; log = []; logBox.replaceChildren(); lastFinal = '';
      if (!next) { active = false; stopRecognition(); setOpen(false); }
    }
    const ready = current() && inRoom();
    listen.disabled = !ready || !Recognition;
    transcripts.hidden = !state().isAdmin;
    if (!ready) {
      active = false; stopRecognition();
      setStatus(current() ? 'Entre na chamada para ativar' : 'Assistente de voz');
    } else if (active) setStatus('Escuta ativa', true);
    else if (!Recognition) setStatus('Reconhecimento indisponível');
    else setStatus('Pronto para ativar');
  }

  function shutdown() {
    closed = true; active = false; stopRecognition();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    document.querySelectorAll('#luladroid-panel,#luladroid-toggle').forEach(node => node.remove());
  }

  return { update, stop: shutdown, open: () => { setOpen(true); update(); } };
}
