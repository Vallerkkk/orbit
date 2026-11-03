import {getSharedSounds} from './app-sounds.js';

export function wav(pcm){
 const buffer=new ArrayBuffer(44+pcm.byteLength),v=new DataView(buffer),label=(p,s)=>{for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i));};
 label(0,'RIFF');v.setUint32(4,36+pcm.byteLength,true);label(8,'WAVE');label(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);label(36,'data');v.setUint32(40,pcm.byteLength,true);
 const samples=new Int16Array(pcm);for(let i=0;i<samples.length;i++)v.setInt16(44+i*2,samples[i],true);return new Blob([buffer],{type:'audio/wav'});
}
const VOICE_KEY='orbita-astro-voice',NAME_KEY='orbita-astro-voice-name',SOURCE_KEY='orbita-astro-voice-source',SERVICE_KEY='orbita-astro-service-voice',RATE_KEY='orbita-astro-rate',VOLUME_KEY='orbita-astro-volume';
const storedNumber=(key,fallback)=>{const raw=localStorage.getItem(key);if(raw===null)return fallback;const value=Number(raw);return Number.isFinite(value)?Math.max(0,Math.min(2,value)):fallback;};

export function initCloe(ctx){
 const {el,button,apiFetch}=ctx,view=document.getElementById('voice-view');
 // Só o ícone: os botões do cabeçalho têm largura de ícone e o texto transbordava por cima do título da sala.
 const toggle=button('',()=>setOpen(panel.hidden),'soft-button astro-toggle');
 toggle.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 14v-3M7 18.5v-9M11 16v-8M15 19V9"/><path d="M19.4 3l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" fill="currentColor" stroke="none"/></svg>';
 toggle.title='Cloe · Transcrição';toggle.setAttribute('aria-label','Cloe · Transcrição');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-pressed','false');toggle.setAttribute('aria-controls','astro-panel');view.querySelector('.chat-actions').append(toggle);
 const panel=el('aside','astro-panel');panel.id='astro-panel';panel.hidden=true;panel.setAttribute('aria-label','Cloe e transcrição da call');
 function setOpen(next){panel.hidden=!next;toggle.setAttribute('aria-expanded',String(next));toggle.setAttribute('aria-pressed',String(next));if(next)fillVoices();}
 const header=el('header'),title=el('h3','','Cloe'),close=button('Fechar',()=>setOpen(false),'text-button');header.append(title,close);
 const status=el('p','muted','Entre na call para iniciar.');status.setAttribute('role','status');
 const notice=el('p','muted','Diga “Ei Cloe” para perguntar ou pedir música (“Ei Cloe, toque For the Last Time”) — também dá para escrever abaixo. “Parar fala” — ou dizer “para de falar” — interrompe a resposta. Contexto temporário de 15 minutos.');
 const tabs=el('div'),transcripts=button('Transcrição',()=>select('transcript')),answers=button('Respostas da Cloe',()=>select('answer'));tabs.append(transcripts,answers);
 const list=el('div','astro-events');list.setAttribute('role','log');list.setAttribute('aria-live','polite');
 const controls=el('div'),pause=button('Pausar meu áudio',()=>{enabled=!enabled;pause.textContent=enabled?'Pausar meu áudio':'Retomar meu áudio';pause.setAttribute('aria-pressed',String(!enabled));if(!enabled)queue=[];});pause.setAttribute('aria-pressed','false');controls.append(pause);
 const voiceBox=el('section','astro-voice'),voiceTitle=el('h4','','Voz da Cloe'),voiceRow=el('div','astro-voice-row');
 const voiceToggle=button('',()=>setVoiceEnabled(!voiceEnabled),'soft-button astro-voice-toggle'),stopButton=button('Parar fala',()=>stopSpeech(true),'soft-button');
 voiceRow.append(voiceToggle,stopButton);
 const voiceLabel=el('label','field','Voz'),voiceSelect=el('select');voiceSelect.setAttribute('aria-label','Voz da Cloe');voiceLabel.append(voiceSelect);
 const rateLabel=el('label','field','Velocidade'),rateInput=el('input'),rateOutput=el('output');rateInput.type='range';rateInput.min='.7';rateInput.max='1.3';rateInput.step='.05';rateInput.setAttribute('aria-label','Velocidade da voz');rateLabel.append(rateInput,rateOutput);
 const volumeLabel=el('label','field','Volume da voz'),volumeInput=el('input'),volumeOutput=el('output');volumeInput.type='range';volumeInput.min='0';volumeInput.max='1';volumeInput.step='.05';volumeInput.setAttribute('aria-label','Volume da voz');volumeLabel.append(volumeInput,volumeOutput);
 const preview=button('Testar voz',()=>{if(!voiceEnabled)setVoiceEnabled(true);speakNow('Olá! Eu sou a Cloe. Posso resumir a conversa quando você me chamar.');},'soft-button');
 const voiceNote=el('p','muted','');
 voiceBox.append(voiceTitle,voiceRow,voiceLabel,rateLabel,volumeLabel,preview,voiceNote);
 const ask=el('form','astro-ask'),askInput=el('input'),askSend=el('button','soft-button','Perguntar');askSend.type='submit';
 askInput.type='text';askInput.maxLength=500;askInput.placeholder='Pergunte à Cloe por texto';askInput.setAttribute('aria-label','Pergunta para a Cloe por texto');
 ask.append(askInput,askSend);
 panel.append(header,status,notice,tabs,list,controls,voiceBox,ask);view.append(panel);
 let target=null,version=0,cursor=0,items=[],tab='transcript',enabled=true,configured=false,audio,source,node,track,listenCopy=null,loadingAudio=false,polling=false,queue=[],sending=false,controller=null,pauseUntil=0,nextAttempt=0,retryAt=0,lastProblem='',lastPoll=0,joinedAt=Date.now()/1000;
 let voiceEnabled=localStorage.getItem(VOICE_KEY)!=='off',voiceSource=localStorage.getItem(SOURCE_KEY)==='device'?'device':'natural',voiceName=localStorage.getItem(NAME_KEY)||'',serviceVoice=localStorage.getItem(SERVICE_KEY)||'',voiceRate=storedNumber(RATE_KEY,1),voiceVolume=storedNumber(VOLUME_KEY,.9);
 let speaking=false,speechQueue=[],watchdog=0,speakToken=0,speechAbort=null,speechAudio=null,speechUrl='',naturalReady=false,naturalDownUntil=0,serverVoices=[],voiceSignature='';
 const roomName=s=>s.room?.name||(s.callChannel?(s.callChannel.private?'direct-':'channel-')+s.callChannel.id:null);
 const current=(ticket)=>ticket===version&&!!target;
 function sound(effect){try{getSharedSounds()?.play(effect);}catch{}}
 function allVoices(){try{return globalThis.speechSynthesis?.getVoices()||[];}catch{return [];}}
 // As vozes carregam de forma assíncrona no Chrome: ordenar por qualidade evita cair na voz padrão do sistema.
 function pickVoice(){const list=allVoices().filter(v=>/^pt/i.test(v.lang));if(!list.length)return null;const rank=v=>/natural|neural/i.test(v.name)?0:/google/i.test(v.name)?1:/francisca|luciana|maria|thalita|yara|camila|joana|helena|beatriz/i.test(v.name)?2:3;const sorted=[...list].sort((a,b)=>rank(a)-rank(b));return sorted.find(v=>v.name===voiceName)||sorted[0];}
 function naturalVoiceId(){return serverVoices.find(v=>v.id===serviceVoice)?.id||serverVoices[0]?.id||'';}
 function canUseNatural(){return voiceSource==='natural'&&naturalReady&&serverVoices.length>0&&Date.now()>=naturalDownUntil&&!!target;}
 function fillVoices(){
  const voices=allVoices(),pt=voices.filter(v=>/^pt/i.test(v.lang)),device=pt.length?pt:voices,groups=[];
  const natural=document.createElement('optgroup');natural.label='Vozes naturais';
  if(naturalReady&&serverVoices.length)for(const v of serverVoices)natural.append(new Option(`${v.name} — ${v.note}`,'n:'+v.id));
  else{const placeholder=new Option(naturalReady?'Carregando vozes…':'Indisponível neste servidor','n:');placeholder.disabled=true;natural.append(placeholder);}
  groups.push(natural);
  const local=document.createElement('optgroup');local.label='Voz do aparelho';local.append(new Option('Automática','b:'));for(const v of device)local.append(new Option(v.name,'b:'+v.name));groups.push(local);
  voiceSelect.replaceChildren(...groups);
  const wanted=naturalReady?naturalVoiceId():'';voiceSelect.value=voiceSource==='natural'&&wanted?'n:'+wanted:'b:'+voiceName;
  if(!voiceSelect.value)voiceSelect.value=wanted?'n:'+wanted:'b:';
  voiceNote.textContent=naturalReady&&serverVoices.length?'Voz neural gerada no servidor. Se a conexão falhar, a Cloe usa a voz do aparelho.':naturalReady?'Nenhuma voz natural disponível agora. A Cloe usa a voz do aparelho.':(pt.length?'':'Nenhuma voz em português neste aparelho. Instale uma voz pt-BR nas configurações do sistema.');
 }
 function renderVoiceState(){voiceToggle.textContent=voiceEnabled?'Voz ativada':'Voz desativada';voiceToggle.setAttribute('aria-pressed',String(voiceEnabled));stopButton.disabled=!speaking;}
 function clearWatchdog(){if(watchdog)clearTimeout(watchdog);watchdog=0;}
 function cleanForSpeech(text){return String(text||'').replace(/```[\s\S]*?```/g,' ').replace(/!\[[^\]]*\]\([^)]*\)/g,' ').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*_`#>~|]/g,'').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu,'').replace(/\s+/g,' ').trim();}
 function stopSpeech(cue){speakToken++;clearWatchdog();speechQueue=[];speechAbort?.abort();speechAbort=null;if(speaking||globalThis.speechSynthesis?.speaking)globalThis.speechSynthesis?.cancel();releaseAudio();speaking=false;pauseUntil=Date.now()+500;if(cue)sound('astro-stop');renderVoiceState();}
 function releaseAudio(){if(speechAudio){try{speechAudio.pause();}catch{}speechAudio=null;}if(speechUrl){URL.revokeObjectURL(speechUrl);speechUrl='';}}
 function finishSpeech(token){if(token!==speakToken)return;speaking=false;clearWatchdog();releaseAudio();pauseUntil=Date.now()+800;renderVoiceState();pump();}
 async function speakNatural(phrase,token){
  const abort=new AbortController();speechAbort=abort;
  const response=await apiFetch('/api/astro/'+encodeURIComponent(target)+'/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:phrase,voice:naturalVoiceId(),rate:voiceRate}),signal:abort.signal});
  if(token!==speakToken)return false;
  const blob=await response.blob();if(token!==speakToken||!blob.size)return false;
  const url=URL.createObjectURL(blob),player=new Audio(url);speechAudio=player;speechUrl=url;player.volume=voiceVolume;
  const cleanup=()=>{if(speechAbort===abort)speechAbort=null;if(speechUrl===url){URL.revokeObjectURL(url);speechUrl='';}if(speechAudio===player)speechAudio=null;};
  player.addEventListener('ended',()=>{cleanup();finishSpeech(token);});
  player.addEventListener('error',()=>{cleanup();finishSpeech(token);});
  const duration=await new Promise(resolve=>{const timer=setTimeout(()=>resolve(0),3000);player.addEventListener('loadedmetadata',()=>{clearTimeout(timer);resolve(player.duration||0);},{once:true});player.addEventListener('error',()=>{clearTimeout(timer);resolve(0);},{once:true});});
  if(token!==speakToken){cleanup();return false;}
  if(duration)pauseUntil=Date.now()+duration*1000+1200;
  clearWatchdog();watchdog=setTimeout(()=>{releaseAudio();finishSpeech(token);},Math.max(8000,(duration||30)*1000+8000));
  await player.play();
  return true;
 }
 async function speakNow(text){
  const phrase=cleanForSpeech(text).slice(0,600);if(!phrase){speaking=false;return;}
  const token=++speakToken;
  // O microfone fica pausado já durante a geração da voz na nuvem; o áudio em si ajusta o tempo depois.
  const estimate=Math.min(120000,Math.max(5000,phrase.length*90/Math.max(.7,voiceRate)+4000));pauseUntil=Date.now()+estimate+900;
  speaking=true;renderVoiceState();
  if(canUseNatural()){
   try{if(await speakNatural(phrase,token))return;if(token!==speakToken)return;}
   catch(error){
    if(token!==speakToken)return;
    speechAbort=null;releaseAudio();
    if(error.name!=='AbortError'&&error.name!=='NotAllowedError'){naturalDownUntil=Date.now()+60000;status.textContent='Voz natural indisponível: usando a voz do aparelho.';}
   }
  }
  if(token!==speakToken)return;
  speakDevice(phrase,token);
 }
 function speakDevice(phrase,token){
  const synth=globalThis.speechSynthesis;if(!synth){status.textContent='Este navegador não oferece voz. As respostas continuam disponíveis em texto.';speaking=false;renderVoiceState();return;}
  const voice=pickVoice(),utterance=new SpeechSynthesisUtterance(phrase);
  utterance.lang=voice?.lang||'pt-BR';if(voice)utterance.voice=voice;utterance.rate=voiceRate;utterance.volume=voiceVolume;
  const estimate=Math.min(120000,Math.max(2000,phrase.length*90/Math.max(.7,voiceRate)));pauseUntil=Date.now()+estimate+900;
  const finish=()=>{if(token!==speakToken)return;speaking=false;clearWatchdog();pauseUntil=Date.now()+800;renderVoiceState();pump();};
  utterance.onend=finish;utterance.onerror=finish;
  clearWatchdog();watchdog=setTimeout(()=>{if(token!==speakToken)return;synth.cancel();finish();},estimate+5000);
  if(synth.speaking&&!speaking)synth.cancel();speaking=true;renderVoiceState();synth.speak(utterance);
 }
 function pump(){if(speaking||!speechQueue.length)return;if(!voiceEnabled||ctx.state().deafened){speechQueue=[];renderVoiceState();return;}sound('astro-answer');speakNow(speechQueue.shift());}
 function speak(text){if(!voiceEnabled||ctx.state().deafened)return;if(speechQueue.length>=3)speechQueue.shift();speechQueue.push(text);pump();}
 function note(text){items.push({id:'local-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),kind:'answer',name:'Cloe',text,at:Date.now()/1000});render();}
 let watchBusy=false;
 // Quem pediu executa no Ouvir juntos; o player sincroniza para a call inteira.
 async function runWatch(command){
  if(!ctx.watch){status.textContent='Recarregue a página para a Cloe controlar o Ouvir juntos.';return;}
  if(watchBusy)return;
  watchBusy=true;
  try{
   const result=String(await ctx.watch(command)||'Feito.').trim();
   note(result);
   status.textContent=result.split('\n')[0].slice(0,140);
   if(voiceEnabled&&!ctx.state().deafened)speak(result.length>260?result.slice(0,240)+'…':result);
  }catch(error){status.textContent=error?.message||'Não foi possível executar no Ouvir juntos.';}
  finally{watchBusy=false;}
 }
 function setVoiceEnabled(next){voiceEnabled=!!next;localStorage.setItem(VOICE_KEY,voiceEnabled?'on':'off');if(!voiceEnabled)stopSpeech(false);renderVoiceState();if(voiceEnabled){try{audio?.resume?.().catch(()=>{});}catch{}}}
 rateInput.value=String(voiceRate);rateOutput.value=Math.round(voiceRate*100)+'%';
 volumeInput.value=String(voiceVolume);volumeOutput.value=Math.round(voiceVolume*100)+'%';
 rateInput.oninput=()=>{voiceRate=Number(rateInput.value);localStorage.setItem(RATE_KEY,String(voiceRate));rateOutput.value=Math.round(voiceRate*100)+'%';};
 volumeInput.oninput=()=>{voiceVolume=Number(volumeInput.value);localStorage.setItem(VOLUME_KEY,String(voiceVolume));volumeOutput.value=Math.round(voiceVolume*100)+'%';if(speechAudio)speechAudio.volume=voiceVolume;};
 voiceSelect.onchange=()=>{const value=voiceSelect.value;if(value.startsWith('n:')){voiceSource='natural';serviceVoice=value.slice(2);localStorage.setItem(SOURCE_KEY,'natural');localStorage.setItem(SERVICE_KEY,serviceVoice);}else{voiceSource='device';voiceName=value.slice(2);localStorage.setItem(SOURCE_KEY,'device');localStorage.setItem(NAME_KEY,voiceName);}};
 globalThis.speechSynthesis?.addEventListener?.('voiceschanged',fillVoices);
 globalThis.speechSynthesis?.getVoices?.();fillVoices();renderVoiceState();
 function select(value){tab=value;transcripts.setAttribute('aria-pressed',String(value==='transcript'));answers.setAttribute('aria-pressed',String(value==='answer'));render();}
 function render(){const bottom=list.scrollHeight-list.scrollTop-list.clientHeight<80,fragment=document.createDocumentFragment();items=items.filter(e=>e.at>Date.now()/1000-900);const rows=items.filter(e=>tab==='transcript'?e.kind==='transcript':e.kind==='answer'||e.kind==='error');for(const e of rows){const card=el('article'),name=el('strong','',e.name),time=el('time','muted',new Date(e.at*1000).toLocaleTimeString('pt-BR'));card.append(name,time,el('p','',e.text));fragment.append(card);}if(!rows.length)fragment.append(el('p','astro-empty',tab==='transcript'?'Nenhuma fala transcrita ainda. A Cloe mostra aqui o que ouve na call.':'Nenhuma resposta ainda. Diga “Ei Cloe” ou escreva abaixo.'));list.classList.toggle('is-empty',!rows.length);list.replaceChildren(fragment);if(bottom)list.scrollTop=list.scrollHeight;}
 // Só para a cópia própria da Cloe; a faixa publicada no LiveKit nunca é parada aqui.
 function stopAudio(){track=null;source?.disconnect();node?.disconnect();source=node=null;try{listenCopy?.stop();}catch{}listenCopy=null;if(audio){audio.close().catch(()=>{});audio=null;}loadingAudio=false;}
 function reset(){version++;stopSpeech(false);controller?.abort();controller=new AbortController();stopAudio();queue=[];sending=false;polling=false;configured=false;items=[];cursor=0;lastProblem='';nextAttempt=0;retryAt=0;lastPoll=0;joinedAt=Date.now()/1000;pauseUntil=0;render();}
 ask.onsubmit=async event=>{event.preventDefault();const text=askInput.value.trim();if(!text)return;if(!target){status.textContent='Entre na call para perguntar à Cloe.';return;}askSend.disabled=true;
  try{const response=await apiFetch('/api/astro/'+encodeURIComponent(target)+'/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:controller.signal});let data={};try{data=await response.json();}catch{}askInput.value='';if(data?.watch)await runWatch(data.watch);else status.textContent='Pergunta enviada à Cloe.';}
  catch(error){if(error.name!=='AbortError')status.textContent=error.message;}
  finally{askSend.disabled=false;}};
 async function poll(){if(polling||Date.now()<nextAttempt)return;polling=true;lastPoll=Date.now();const ticket=version,initial=cursor===0;
  try{const response=await apiFetch('/api/astro/'+encodeURIComponent(target)+'?after='+cursor,{signal:controller.signal}),data=await response.json();if(!current(ticket))return;
   configured=data.configured;if(Array.isArray(data.voices)){const signature=JSON.stringify([!!data.tts,data.voices]);if(signature!==voiceSignature){voiceSignature=signature;serverVoices=data.voices.filter(v=>v&&v.id);naturalReady=!!data.tts;fillVoices();}}const old=cursor;if(data.cursor<cursor){items=[];cursor=0;return;}cursor=data.cursor;for(const e of data.events){if(items.some(row=>row.id===e.id))continue;items.push(e);if(e.at>=joinedAt&&e.id>old){if(e.kind==='answer')speak(e.text);else if(e.kind==='stop')stopSpeech(true);else if(e.kind==='transcript'&&e.wake)sound('astro-wake');}}render();lastProblem='';status.textContent=configured?(data.busy?'Cloe pensando…':'Cloe na call · ouvindo microfones abertos'):'A Cloe ainda não foi ligada neste servidor. Avise um administrador.';
  }catch(error){if(current(ticket)&&error.name!=='AbortError'){lastProblem=error.message;status.textContent=lastProblem;nextAttempt=Date.now()+10000;}}
  finally{if(current(ticket))polling=false;}
 }
 async function drain(){if(sending||!queue.length||!target)return;sending=true;const ticket=version;
  try{while(queue.length&&current(ticket)){const chunk=queue.shift();if(!enabled)continue;try{const response=await apiFetch('/api/astro/'+encodeURIComponent(target)+'/audio?chunk_id='+chunk.id+(chunk.stopOnly?'&stop_only=1':''),{method:'POST',headers:{'Content-Type':'audio/wav'},body:chunk.body,signal:controller.signal});let data={};try{data=await response.json();}catch{}if(data?.stop)stopSpeech(true);else if(data?.watch)runWatch(data.watch);}catch(error){if(!current(ticket)||error.name==='AbortError')return;// 429/5xx é contrapressão do servidor, não falha da pessoa: o trecho
       // é a única cópia daquela fala, jogá-lo fora perdia a transcrição e calava a Cloe por 10 s.
       if(error.status===429||error.status>=500){retryAt=Date.now()+900;queue.unshift(chunk);break;}lastProblem=error.message;status.textContent=lastProblem;nextAttempt=Date.now()+10000;queue=[];break;}}}
  finally{if(current(ticket))sending=false;}
 }
 async function capture(nextTrack){if(loadingAudio||track===nextTrack)return;stopAudio();loadingAudio=true;track=nextTrack;const ticket=version;
  try{const ac=new AudioContext();audio=ac;await ac.audioWorklet.addModule('/static/astro-recorder.js?v=cloe-20261031');if(!current(ticket)||audio!==ac){ac.close().catch(()=>{});return;}
   // Escuta uma cópia (clone) da faixa: a Cloe nunca compartilha, muta nem encerra o microfone da call.
   listenCopy=nextTrack.clone();source=ac.createMediaStreamSource(new MediaStream([listenCopy]));node=new AudioWorkletNode(ac,"cloe-recorder");source.connect(node);node.connect(ac.destination);
   // resume() fica pendente para sempre sem gesto no iOS; não trava a captura esperando.
   await Promise.race([ac.resume(),new Promise(resolve=>setTimeout(resolve,1500))]);if(!current(ticket)||audio!==ac)return;
   // Mesmo com a Cloe falando, o trecho sobe: o servidor só o usa para achar "para de falar".
   node.port.onmessage=event=>{if(!current(ticket)||!enabled||Date.now()<nextAttempt)return;const stopOnly=speaking||Date.now()<pauseUntil,chunk={id:crypto.randomUUID(),body:wav(event.data),stopOnly};if(queue.length>=3){if(!stopOnly){status.textContent='Conexão lenta: alguns trechos não puderam ser enviados.';return;}queue.shift();}queue.push(chunk);drain();};
  }catch(error){if(current(ticket)){status.textContent='Não foi possível capturar áudio: '+error.message;stopAudio();nextAttempt=Date.now()+10000;}}
  // Captura abortada no meio (call mudou, contexto fechado): esquece a faixa para tentar de novo,
  // senão "track===nextTrack" bloqueava a Cloe de ouvir até a faixa mudar.
  finally{if(current(ticket)){loadingAudio=false;if(!node&&track===nextTrack)track=null;}}
 }
 function sync(){const state=ctx.state(),next=state.session&&state.room?.state==='connected'?roomName(state):null;if(next!==target){target=next;reset();status.textContent=next?'Conectando a Cloe…':'Entre na call para iniciar.';}
  if(!target)return;if(queue.length&&Date.now()>=retryAt)drain();if(Date.now()-lastPoll>=2500)poll();
  const pub=[...state.room.localParticipant.audioTrackPublications.values()].find(p=>p.source==='microphone'),media=pub?.track?.mediaStreamTrack;
  const active=enabled&&configured&&!state.deafened&&state.room.localParticipant.isMicrophoneEnabled&&!pub?.isMuted&&Date.now()>nextAttempt;
  if(media&&media.readyState==='live'&&Date.now()>nextAttempt)capture(media);else if(track){stopAudio();if(enabled&&configured&&target&&!lastProblem)status.textContent='O microfone foi desconectado: escolha outro em Entrada e saída de áudio.';}
  if(listenCopy&&media&&listenCopy.enabled!==media.enabled)listenCopy.enabled=media.enabled;
  // Durante a fala o microfone segue aberto só para o comando de parar; o modo rápido
  // fecha o trecho após ~0,6 s de silêncio para a interrupção chegar logo.
  node?.port.postMessage({enabled:!!active,quick:speaking||Date.now()<pauseUntil});if(enabled&&configured&&!lastProblem){if(!state.room.localParticipant.isMicrophoneEnabled)status.textContent='Cloe na call · seu microfone está fechado';else if(audio?.state==='suspended')status.textContent='Toque em Ativar voz para liberar o áudio do navegador.';}if(!enabled)status.textContent='Envio do seu áudio pausado. Os outros participantes controlam o próprio áudio.';
 }
 for(const type of ['pointerdown','keydown'])document.addEventListener(type,()=>{if(audio?.state==='suspended')audio.resume().catch(()=>{});},{capture:true,passive:true});
 select('transcript');const timer=setInterval(sync,500);window.addEventListener('pagehide',event=>{if(!event.persisted){clearInterval(timer);target=null;reset();}});
 return {sync};
}
