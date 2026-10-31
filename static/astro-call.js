import {getSharedSounds} from './app-sounds.js';

export function wav(pcm){
 const buffer=new ArrayBuffer(44+pcm.byteLength),v=new DataView(buffer),label=(p,s)=>{for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i));};
 label(0,'RIFF');v.setUint32(4,36+pcm.byteLength,true);label(8,'WAVE');label(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);label(36,'data');v.setUint32(40,pcm.byteLength,true);
 const samples=new Int16Array(pcm);for(let i=0;i<samples.length;i++)v.setInt16(44+i*2,samples[i],true);return new Blob([buffer],{type:'audio/wav'});
}
const VOICE_KEY='orbita-astro-voice',NAME_KEY='orbita-astro-voice-name',RATE_KEY='orbita-astro-rate',VOLUME_KEY='orbita-astro-volume';
const storedNumber=(key,fallback)=>{const raw=localStorage.getItem(key);if(raw===null)return fallback;const value=Number(raw);return Number.isFinite(value)?Math.max(0,Math.min(2,value)):fallback;};

export function initAstro(ctx){
 const {el,button,apiFetch}=ctx,view=document.getElementById('voice-view');
 // Só o ícone: os botões do cabeçalho têm largura de ícone e o texto transbordava por cima do título da sala.
 const toggle=button('',()=>setOpen(panel.hidden),'soft-button astro-toggle');
 toggle.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 14v-3M7 18.5v-9M11 16v-8M15 19V9"/><path d="M19.4 3l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" fill="currentColor" stroke="none"/></svg>';
 toggle.title='Astro · Transcrição';toggle.setAttribute('aria-label','Astro · Transcrição');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-pressed','false');toggle.setAttribute('aria-controls','astro-panel');view.querySelector('.chat-actions').append(toggle);
 const panel=el('aside','astro-panel');panel.id='astro-panel';panel.hidden=true;panel.setAttribute('aria-label','Astro e transcrição da call');
 function setOpen(next){panel.hidden=!next;toggle.setAttribute('aria-expanded',String(next));toggle.setAttribute('aria-pressed',String(next));if(next)fillVoices();}
 const header=el('header'),title=el('h3','','Astro'),close=button('Fechar',()=>setOpen(false),'text-button');header.append(title,close);
 const status=el('p','muted','Entre na call para iniciar.');status.setAttribute('role','status');
 const notice=el('p','muted','Diga “Ei Astro” e faça a pergunta, ou escreva no campo abaixo. Para interromper uma resposta, use “Parar fala”. Contexto temporário de 15 minutos.');
 const tabs=el('div'),transcripts=button('Transcrição',()=>select('transcript')),answers=button('Respostas do Astro',()=>select('answer'));tabs.append(transcripts,answers);
 const list=el('div','astro-events');list.setAttribute('role','log');list.setAttribute('aria-live','polite');
 const controls=el('div'),pause=button('Pausar meu áudio',()=>{enabled=!enabled;pause.textContent=enabled?'Pausar meu áudio':'Retomar meu áudio';pause.setAttribute('aria-pressed',String(!enabled));if(!enabled)queue=[];});pause.setAttribute('aria-pressed','false');controls.append(pause);
 const voiceBox=el('section','astro-voice'),voiceTitle=el('h4','','Voz do Astro'),voiceRow=el('div','astro-voice-row');
 const voiceToggle=button('',()=>setVoiceEnabled(!voiceEnabled),'soft-button astro-voice-toggle'),stopButton=button('Parar fala',()=>stopSpeech(true),'soft-button');
 voiceRow.append(voiceToggle,stopButton);
 const voiceLabel=el('label','field','Voz'),voiceSelect=el('select');voiceSelect.setAttribute('aria-label','Voz do Astro');voiceLabel.append(voiceSelect);
 const rateLabel=el('label','field','Velocidade'),rateInput=el('input'),rateOutput=el('output');rateInput.type='range';rateInput.min='.7';rateInput.max='1.3';rateInput.step='.05';rateInput.setAttribute('aria-label','Velocidade da voz');rateLabel.append(rateInput,rateOutput);
 const volumeLabel=el('label','field','Volume da voz'),volumeInput=el('input'),volumeOutput=el('output');volumeInput.type='range';volumeInput.min='0';volumeInput.max='1';volumeInput.step='.05';volumeInput.setAttribute('aria-label','Volume da voz');volumeLabel.append(volumeInput,volumeOutput);
 const preview=button('Testar voz',()=>{if(!voiceEnabled)setVoiceEnabled(true);speakNow('Olá! Eu sou o Astro. Posso resumir a conversa quando você me chamar.');},'soft-button');
 const voiceNote=el('p','muted','');
 voiceBox.append(voiceTitle,voiceRow,voiceLabel,rateLabel,volumeLabel,preview,voiceNote);
 const ask=el('form','astro-ask'),askInput=el('input'),askSend=el('button','soft-button','Perguntar');askSend.type='submit';
 askInput.type='text';askInput.maxLength=500;askInput.placeholder='Pergunte ao Astro por texto';askInput.setAttribute('aria-label','Pergunta para o Astro por texto');
 ask.append(askInput,askSend);
 panel.append(header,status,notice,tabs,list,controls,voiceBox,ask);view.append(panel);
 let target=null,version=0,cursor=0,items=[],tab='transcript',enabled=true,configured=false,audio,source,node,track,loadingAudio=false,polling=false,queue=[],sending=false,controller=null,pauseUntil=0,nextAttempt=0,retryAt=0,lastProblem='',lastPoll=0,joinedAt=Date.now()/1000;
 let voiceEnabled=localStorage.getItem(VOICE_KEY)!=='off',voiceName=localStorage.getItem(NAME_KEY)||'',voiceRate=storedNumber(RATE_KEY,1),voiceVolume=storedNumber(VOLUME_KEY,.9);
 let speaking=false,speechQueue=[],watchdog=0,speakToken=0;
 const roomName=s=>s.room?.name||(s.callChannel?(s.callChannel.private?'direct-':'channel-')+s.callChannel.id:null);
 const current=(ticket)=>ticket===version&&!!target;
 function sound(effect){try{getSharedSounds()?.play(effect);}catch{}}
 function allVoices(){try{return globalThis.speechSynthesis?.getVoices()||[];}catch{return [];}}
 // As vozes carregam de forma assíncrona no Chrome: ordenar por qualidade evita cair na voz padrão do sistema.
 function pickVoice(){const list=allVoices().filter(v=>/^pt/i.test(v.lang));if(!list.length)return null;const rank=v=>/natural|neural/i.test(v.name)?0:/google/i.test(v.name)?1:/francisca|luciana|maria|thalita|yara|camila|joana|helena|beatriz/i.test(v.name)?2:3;const sorted=[...list].sort((a,b)=>rank(a)-rank(b));return sorted.find(v=>v.name===voiceName)||sorted[0];}
 function fillVoices(){const voices=allVoices(),pt=voices.filter(v=>/^pt/i.test(v.lang)),list=pt.length?pt:voices;voiceSelect.replaceChildren(new Option('Automática (recomendada)',''));for(const v of list)voiceSelect.append(new Option(v.name,v.name));voiceSelect.value=list.some(v=>v.name===voiceName)?voiceName:'';voiceNote.textContent=pt.length?'':`Nenhuma voz em português neste aparelho. Instale uma voz pt-BR nas configurações do sistema para o Astro falar melhor.`;}
 function renderVoiceState(){voiceToggle.textContent=voiceEnabled?'Voz ativada':'Voz desativada';voiceToggle.setAttribute('aria-pressed',String(voiceEnabled));stopButton.disabled=!speaking;}
 function clearWatchdog(){if(watchdog)clearTimeout(watchdog);watchdog=0;}
 function cleanForSpeech(text){return String(text||'').replace(/```[\s\S]*?```/g,' ').replace(/!\[[^\]]*\]\([^)]*\)/g,' ').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*_`#>~|]/g,'').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu,'').replace(/\s+/g,' ').trim();}
 function stopSpeech(cue){speakToken++;clearWatchdog();speechQueue=[];if(speaking||globalThis.speechSynthesis?.speaking)globalThis.speechSynthesis?.cancel();speaking=false;pauseUntil=Date.now()+500;if(cue)sound('astro-stop');renderVoiceState();}
 function speakNow(text){
  const synth=globalThis.speechSynthesis;if(!synth){status.textContent='Este navegador não oferece síntese de voz. As respostas continuam disponíveis em texto.';speaking=false;return;}
  const phrase=cleanForSpeech(text).slice(0,700);if(!phrase){speaking=false;return;}
  const token=++speakToken,voice=pickVoice(),utterance=new SpeechSynthesisUtterance(phrase);
  utterance.lang=voice?.lang||'pt-BR';if(voice)utterance.voice=voice;utterance.rate=voiceRate;utterance.volume=voiceVolume;
  // Enquanto o Astro fala o microfone fica pausado; o limite é a duração estimada, não um minuto fixo.
  const estimate=Math.min(120000,Math.max(2000,phrase.length*90/Math.max(.7,voiceRate)));pauseUntil=Date.now()+estimate+900;
  const finish=()=>{if(token!==speakToken)return;speaking=false;clearWatchdog();pauseUntil=Date.now()+800;renderVoiceState();pump();};
  utterance.onend=finish;utterance.onerror=finish;
  clearWatchdog();watchdog=setTimeout(()=>{if(token!==speakToken)return;synth.cancel();finish();},estimate+5000);
  if(synth.speaking&&!speaking)synth.cancel();speaking=true;renderVoiceState();synth.speak(utterance);
 }
 function pump(){if(speaking||!speechQueue.length)return;if(!voiceEnabled||ctx.state().deafened){speechQueue=[];renderVoiceState();return;}sound('astro-answer');speakNow(speechQueue.shift());}
 function speak(text){if(!voiceEnabled||ctx.state().deafened)return;if(speechQueue.length>=3)speechQueue.shift();speechQueue.push(text);pump();}
 function setVoiceEnabled(next){voiceEnabled=!!next;localStorage.setItem(VOICE_KEY,voiceEnabled?'on':'off');if(!voiceEnabled)stopSpeech(false);renderVoiceState();if(voiceEnabled){try{audio?.resume?.().catch(()=>{});}catch{}}}
 rateInput.value=String(voiceRate);rateOutput.value=Math.round(voiceRate*100)+'%';
 volumeInput.value=String(voiceVolume);volumeOutput.value=Math.round(voiceVolume*100)+'%';
 rateInput.oninput=()=>{voiceRate=Number(rateInput.value);localStorage.setItem(RATE_KEY,String(voiceRate));rateOutput.value=Math.round(voiceRate*100)+'%';};
 volumeInput.oninput=()=>{voiceVolume=Number(volumeInput.value);localStorage.setItem(VOLUME_KEY,String(voiceVolume));volumeOutput.value=Math.round(voiceVolume*100)+'%';};
 voiceSelect.onchange=()=>{voiceName=voiceSelect.value;localStorage.setItem(NAME_KEY,voiceName);};
 globalThis.speechSynthesis?.addEventListener?.('voiceschanged',fillVoices);
 globalThis.speechSynthesis?.getVoices?.();fillVoices();renderVoiceState();
 function select(value){tab=value;transcripts.setAttribute('aria-pressed',String(value==='transcript'));answers.setAttribute('aria-pressed',String(value==='answer'));render();}
 function render(){const bottom=list.scrollHeight-list.scrollTop-list.clientHeight<80,fragment=document.createDocumentFragment();items=items.filter(e=>e.at>Date.now()/1000-900);for(const e of items.filter(e=>tab==='transcript'?e.kind==='transcript':e.kind==='answer'||e.kind==='error')){const card=el('article'),name=el('strong','',e.name),time=el('time','muted',new Date(e.at*1000).toLocaleTimeString('pt-BR'));card.append(name,time,el('p','',e.text));fragment.append(card);}list.replaceChildren(fragment);if(bottom)list.scrollTop=list.scrollHeight;}
 function stopAudio(){track=null;source?.disconnect();node?.disconnect();source=node=null;if(audio){audio.close().catch(()=>{});audio=null;}loadingAudio=false;}
 function reset(){version++;stopSpeech(false);controller?.abort();controller=new AbortController();stopAudio();queue=[];sending=false;polling=false;configured=false;items=[];cursor=0;lastProblem='';nextAttempt=0;retryAt=0;lastPoll=0;joinedAt=Date.now()/1000;pauseUntil=0;render();}
 ask.onsubmit=async event=>{event.preventDefault();const text=askInput.value.trim();if(!text)return;if(!target){status.textContent='Entre na call para perguntar ao Astro.';return;}askSend.disabled=true;
  try{await apiFetch('/api/astro/'+encodeURIComponent(target)+'/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:controller.signal});askInput.value='';status.textContent='Pergunta enviada ao Astro.';}
  catch(error){if(error.name!=='AbortError')status.textContent=error.message;}
  finally{askSend.disabled=false;}};
 async function poll(){if(polling||Date.now()<nextAttempt)return;polling=true;lastPoll=Date.now();const ticket=version,initial=cursor===0;
  try{const response=await apiFetch('/api/astro/'+encodeURIComponent(target)+'?after='+cursor,{signal:controller.signal}),data=await response.json();if(!current(ticket))return;
   configured=data.configured;const old=cursor;if(data.cursor<cursor){items=[];cursor=0;return;}cursor=data.cursor;for(const e of data.events){if(items.some(row=>row.id===e.id))continue;items.push(e);if(e.at>=joinedAt&&e.id>old){if(e.kind==='answer')speak(e.text);else if(e.kind==='stop')stopSpeech(true);else if(e.kind==='transcript'&&e.wake)sound('astro-wake');}}render();lastProblem='';status.textContent=configured?(data.busy?'Astro pensando…':'Astro na call · ouvindo microfones abertos'):'O Astro ainda não foi ligado neste servidor. Avise um administrador.';
  }catch(error){if(current(ticket)&&error.name!=='AbortError'){lastProblem=error.message;status.textContent=lastProblem;nextAttempt=Date.now()+10000;}}
  finally{if(current(ticket))polling=false;}
 }
 async function drain(){if(sending||!queue.length||!target)return;sending=true;const ticket=version;
  try{while(queue.length&&current(ticket)){const chunk=queue.shift();if(!enabled)continue;try{await apiFetch('/api/astro/'+encodeURIComponent(target)+'/audio?chunk_id='+chunk.id,{method:'POST',headers:{'Content-Type':'audio/wav'},body:chunk.body,signal:controller.signal});}catch(error){if(!current(ticket)||error.name==='AbortError')return;// 429/5xx é contrapressão do servidor, não falha da pessoa: o trecho
       // é a única cópia daquela fala, jogá-lo fora perdia a transcrição e calava o Astro por 10 s.
       if(error.status===429||error.status>=500){retryAt=Date.now()+900;queue.unshift(chunk);break;}lastProblem=error.message;status.textContent=lastProblem;nextAttempt=Date.now()+10000;queue=[];break;}}}
  finally{if(current(ticket))sending=false;}
 }
 async function capture(nextTrack){if(loadingAudio||track===nextTrack)return;stopAudio();loadingAudio=true;track=nextTrack;const ticket=version;
  try{const ac=new AudioContext();audio=ac;await ac.audioWorklet.addModule('/static/astro-recorder.js');if(!current(ticket)||audio!==ac){ac.close().catch(()=>{});return;}
   source=ac.createMediaStreamSource(new MediaStream([nextTrack]));node=new AudioWorkletNode(ac,'astro-recorder');source.connect(node);node.connect(ac.destination);await ac.resume();if(!current(ticket)||audio!==ac)return;
   node.port.onmessage=event=>{if(!current(ticket)||!enabled||Date.now()<pauseUntil||Date.now()<nextAttempt)return;if(queue.length>=3){status.textContent='Conexão lenta: alguns trechos não puderam ser enviados.';return;}queue.push({id:crypto.randomUUID(),body:wav(event.data)});drain();};
  }catch(error){if(current(ticket)){status.textContent='Não foi possível capturar áudio: '+error.message;stopAudio();nextAttempt=Date.now()+10000;}}
  finally{if(current(ticket))loadingAudio=false;}
 }
 function sync(){const state=ctx.state(),next=state.session&&state.room?.state==='connected'?roomName(state):null;if(next!==target){target=next;reset();status.textContent=next?'Conectando Astro…':'Entre na call para iniciar.';}
  if(!target)return;if(queue.length&&Date.now()>=retryAt)drain();if(Date.now()-lastPoll>=2500)poll();
  const pub=[...state.room.localParticipant.audioTrackPublications.values()].find(p=>p.source==='microphone'),media=pub?.track?.mediaStreamTrack;
  const active=enabled&&configured&&!state.deafened&&state.room.localParticipant.isMicrophoneEnabled&&!pub?.isMuted&&Date.now()>pauseUntil&&Date.now()>nextAttempt;
  if(media&&media.readyState==='live'&&Date.now()>nextAttempt)capture(media);else if(track){stopAudio();if(enabled&&configured&&target&&!lastProblem)status.textContent='O microfone foi desconectado: escolha outro em Entrada e saída de áudio.';}
  node?.port.postMessage({enabled:!!active});if(enabled&&configured&&!lastProblem){if(!state.room.localParticipant.isMicrophoneEnabled)status.textContent='Astro na call · seu microfone está fechado';else if(audio?.state==='suspended')status.textContent='Toque em Ativar voz para liberar o áudio do navegador.';}if(!enabled)status.textContent='Envio do seu áudio pausado. Os outros participantes controlam o próprio áudio.';
 }
 select('transcript');const timer=setInterval(sync,500);window.addEventListener('pagehide',event=>{if(!event.persisted){clearInterval(timer);target=null;reset();}});
 return {sync};
}
