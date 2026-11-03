import {getSharedSounds} from './app-sounds.js';

export function wav(pcm){
 const buffer=new ArrayBuffer(44+pcm.byteLength),v=new DataView(buffer),label=(p,s)=>{for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i));};
 label(0,'RIFF');v.setUint32(4,36+pcm.byteLength,true);label(8,'WAVE');label(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);label(36,'data');v.setUint32(40,pcm.byteLength,true);
 const samples=new Int16Array(pcm);for(let i=0;i<samples.length;i++)v.setInt16(44+i*2,samples[i],true);return new Blob([buffer],{type:'audio/wav'});
}
const VOICE_KEY='orbita-astro-voice',NAME_KEY='orbita-astro-voice-name',SOURCE_KEY='orbita-astro-voice-source',SERVICE_KEY='orbita-astro-service-voice',RATE_KEY='orbita-astro-rate',VOLUME_KEY='orbita-astro-volume';
const storedNumber=(key,fallback)=>{const raw=localStorage.getItem(key);if(raw===null)return fallback;const value=Number(raw);return Number.isFinite(value)?Math.max(0,Math.min(2,value)):fallback;};
export function sourceItems(event){
 const seen=new Set();
 return (Array.isArray(event?.sources)?event.sources:[]).flatMap(item=>{
  try{
   const url=new URL(String(item?.url||'')),host=url.hostname.toLowerCase();
   if(url.protocol!=='http:'&&url.protocol!=='https:')return [];
   // Defesa extra: mesmo que o servidor erre, o painel não abre endereços internos.
   if(host==='localhost'||host.endsWith('.local')||host==='[::1]'||/^\d+\.\d+\.\d+\.\d+$/.test(host))return [];
   if(seen.has(url.href))return [];
   seen.add(url.href);
   return [{title:(String(item?.title||url.hostname).replace(/\s+/g,' ').trim()||url.hostname).slice(0,160),url:url.href}];
  }catch{return [];}
 }).slice(0,4);
}

export function initCloe(ctx){
 const {el,button,apiFetch}=ctx,view=document.getElementById('voice-view');
 // Só o ícone: os botões do cabeçalho têm largura de ícone e o texto transbordava por cima do título da sala.
 const toggle=button('',()=>setOpen(panel.hidden),'soft-button astro-toggle');
 toggle.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 14v-3M7 18.5v-9M11 16v-8M15 19V9"/><path d="M19.4 3l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" fill="currentColor" stroke="none"/></svg>';
 toggle.title='Cloe · Transcrição';toggle.setAttribute('aria-label','Cloe · Transcrição');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-pressed','false');toggle.setAttribute('aria-controls','astro-panel');view.querySelector('.chat-actions').append(toggle);
 const panel=el('aside','astro-panel');panel.id='astro-panel';panel.hidden=true;panel.setAttribute('aria-label','Cloe e transcrição da call');
 function setOpen(next){if(!next)cancelListening();panel.hidden=!next;toggle.setAttribute('aria-expanded',String(next));toggle.setAttribute('aria-pressed',String(next));if(next){fillVoices();sync();if(target){lastPoll=0;poll();}}}
 const header=el('header'),title=el('h3','','Cloe'),close=button('Fechar',()=>setOpen(false),'text-button');header.append(title,close);
 const status=el('p','muted','Entre na call para iniciar.');status.setAttribute('role','status');
 const ownerNote=el('p','muted','Como dono, toque em “Falar com a Cloe” e peça ações administrativas — eu descrevo o que vou fazer e espero você falar a frase de confirmação.');ownerNote.hidden=true;
 const notice=el('p','muted','Toque em “Falar com a Cloe” para perguntar, pedir música ou dar uma ordem. Nada é transcrito antes disso. Use “Parar fala” para interromper. Contexto temporário de 15 minutos.');
 const tabs=el('div'),transcripts=button('Transcrição',()=>select('transcript')),answers=button('Respostas da Cloe',()=>select('answer'));tabs.append(transcripts,answers);
 const list=el('div','astro-events');list.setAttribute('role','log');list.setAttribute('aria-live','polite');
 const controls=el('div'),listen=button('Falar com a Cloe',()=>toggleListening(),'soft-button astro-listen'),pause=button('Pausar meu áudio',()=>{enabled=!enabled;pause.textContent=enabled?'Pausar meu áudio':'Retomar meu áudio';pause.setAttribute('aria-pressed',String(!enabled));if(!enabled){queue=[];cancelListening();}});pause.setAttribute('aria-pressed','false');listen.setAttribute('aria-pressed','false');listen.title='Grava só o próximo trecho e envia para a Cloe';controls.append(listen,pause);
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
 panel.append(header,status,notice,ownerNote,tabs,list,controls,voiceBox,ask);view.append(panel);
 let target=null,version=0,cursor=0,items=[],tab='transcript',enabled=true,configured=false,audio,source,node,track,listenCopy=null,loadingAudio=false,polling=false,queue=[],sending=false,controller=null,nextAttempt=0,retryAt=0,lastProblem='',lastPoll=0,joinedAt=Date.now()/1000,listening=false,listenTimer=0;
 let seenIds=new Set(),statusUntil=0;
 const POLL_OPEN=1200,POLL_IDLE=3000;
 let voiceEnabled=localStorage.getItem(VOICE_KEY)!=='off',voiceSource=localStorage.getItem(SOURCE_KEY)==='device'?'device':'natural',sourceChosen=localStorage.getItem(SOURCE_KEY)!==null,voiceName=localStorage.getItem(NAME_KEY)||'',serviceVoice=localStorage.getItem(SERVICE_KEY)||'',voiceRate=storedNumber(RATE_KEY,1),voiceVolume=storedNumber(VOLUME_KEY,.9);
 let speaking=false,speechQueue=[],watchdog=0,speakToken=0,speechAbort=null,speechAudio=null,speechUrl='',naturalReady=false,naturalDownUntil=0,serverVoices=[],voiceSignature='';
 const roomName=s=>s.room?.name||(s.callChannel?(s.callChannel.private?'direct-':'channel-')+s.callChannel.id:null);
 const current=(ticket)=>ticket===version&&!!target;
 function sound(effect){try{getSharedSounds()?.play(effect);}catch{}}
 // Avisos importantes (voz indisponível, resultado do player) não podem ser apagados pelo tique de 500 ms.
 function setStatus(text,ms=0){status.textContent=text;statusUntil=ms?Date.now()+ms:0;}
 function defaultStatus(text){if(Date.now()>statusUntil)status.textContent=text;}
 function cancelListening(){listening=false;clearTimeout(listenTimer);listenTimer=0;listen.textContent='Falar com a Cloe';listen.setAttribute('aria-pressed','false');try{node?.port.postMessage({enabled:false,quick:false});}catch{}}
 function stopListening(message){cancelListening();if(message)setStatus(message,6000);}
 function startListening(){
  sync();
  if(!target){setStatus('Entre na call para falar com a Cloe.',6000);return;}
  if(!configured){setStatus('A Cloe ainda não foi ligada neste servidor.',6000);return;}
  if(!enabled){setStatus('Seu áudio está pausado. Toque em “Retomar meu áudio” primeiro.',6000);return;}
  if(Date.now()<nextAttempt){setStatus('Aguarde um instante e tente de novo.',5000);return;}
  const state=ctx.state();
  if(state.deafened||!state.room?.localParticipant?.isMicrophoneEnabled){setStatus('Abra seu microfone para falar com a Cloe.',6000);return;}
  if(!node){setStatus('Preparando o microfone… toque novamente em instantes.',5000);return;}
  if(speaking)stopSpeech(false);
  listening=true;clearTimeout(listenTimer);listen.textContent='Ouvindo…';listen.setAttribute('aria-pressed','true');setStatus('Ouvindo… fale agora.',12000);
  try{node.port.postMessage({enabled:true,quick:false});}catch{stopListening('Não foi possível abrir o microfone. Tente de novo.');return;}
  listenTimer=setTimeout(()=>{if(listening)stopListening('Não ouvi nada. Toque em “Falar com a Cloe” e tente de novo.');},12000);
 }
 function toggleListening(){if(listening)stopListening('Chamada cancelada.');else startListening();}
 const pollEvery=()=>document.hidden||panel.hidden?POLL_IDLE:POLL_OPEN;
 function remember(event){if(!event||typeof event!=='object'||!event.kind)return false;if(event.id!==undefined&&seenIds.has(event.id))return false;if(event.id!==undefined)seenIds.add(event.id);items.push(event);items.sort((a,b)=>(Number(a.id)||Infinity)-(Number(b.id)||Infinity));return true;}
 function apply(event){if(event.kind==='answer')speak(event.text);else if(event.kind==='stop')stopSpeech(true);else if(event.kind==='transcript'&&event.wake)sound('astro-wake');}
 function deliver(event){if(!remember(event))return false;render();apply(event);return true;}
 function allVoices(){try{return globalThis.speechSynthesis?.getVoices()||[];}catch{return [];}}
 // As vozes carregam de forma assíncrona no Chrome: ordenar por qualidade evita cair na voz padrão do sistema.
 // Com uma voz escolhida, só ela é usada; se sumir do aparelho, a Cloe fica em silêncio em vez de trocar sozinha.
 function pickVoice(){const list=allVoices().filter(v=>/^pt/i.test(v.lang));if(voiceName)return list.find(v=>v.name===voiceName)||null;if(!list.length)return null;const rank=v=>/natural|neural/i.test(v.name)?0:/google/i.test(v.name)?1:/francisca|luciana|maria|thalita|yara|camila|joana|helena|beatriz/i.test(v.name)?2:3;const sorted=[...list].sort((a,b)=>rank(a)-rank(b));return sorted[0];}
 // A voz padrão (sem escolha salva) é a primeira da lista; uma escolha salva nunca é substituída.
 function selectedNaturalId(){if(!serverVoices.length)return '';if(serviceVoice)return serverVoices.some(v=>v.id===serviceVoice)?serviceVoice:'';return serverVoices[0]?.id||'';}
 function naturalVoiceMissing(){return !!serviceVoice&&naturalReady&&serverVoices.length>0&&!selectedNaturalId();}
 function canUseNatural(){return voiceSource==='natural'&&naturalReady&&!!selectedNaturalId()&&Date.now()>=naturalDownUntil&&!!target;}
 function fillVoices(){
  const voices=allVoices(),pt=voices.filter(v=>/^pt/i.test(v.lang)),device=pt.length?pt:voices,groups=[];
  const natural=document.createElement('optgroup');natural.label='Vozes naturais';
  if(naturalReady&&serverVoices.length){
   for(const v of serverVoices)natural.append(new Option(`${v.name} — ${v.note}`,'n:'+v.id));
   if(naturalVoiceMissing())natural.append(new Option('Voz escolhida indisponível agora','n:'+serviceVoice));
  }else{const placeholder=new Option(naturalReady?'Carregando vozes…':'Indisponível neste servidor','n:');placeholder.disabled=true;natural.append(placeholder);}
  groups.push(natural);
  const local=document.createElement('optgroup');local.label='Voz do aparelho';local.append(new Option('Automática','b:'));
  for(const v of device)local.append(new Option(v.name,'b:'+v.name));
  if(voiceName&&!device.some(v=>v.name===voiceName))local.append(new Option('Voz escolhida indisponível agora','b:'+voiceName));
  groups.push(local);
  voiceSelect.replaceChildren(...groups);
  const wanted=naturalReady?selectedNaturalId():'';
  voiceSelect.value=voiceSource==='natural'?'n:'+(wanted||serviceVoice):'b:'+voiceName;
  if(![...voiceSelect.options].some(option=>option.value===voiceSelect.value))voiceSelect.value='b:';
  voiceNote.textContent=!naturalReady?(pt.length?'A voz natural não está disponível neste servidor. Escolha uma voz do aparelho.':'A voz natural não está disponível. Instale uma voz pt-BR no aparelho.'):naturalVoiceMissing()?'A voz escolhida não está disponível agora. A Cloe não troca de voz sozinha.':voiceSource==='natural'?'Voz neural gerada no servidor, somente na voz escolhida. Se ela falhar, a resposta aparece só em texto.':(pt.length?'Voz do aparelho, somente na voz escolhida.':'Nenhuma voz em português neste aparelho. Instale uma voz pt-BR nas configurações do sistema.');
 }
 function renderVoiceState(){voiceToggle.textContent=voiceEnabled?'Voz ativada':'Voz desativada';voiceToggle.setAttribute('aria-pressed',String(voiceEnabled));stopButton.disabled=!speaking;}
 function clearWatchdog(){if(watchdog)clearTimeout(watchdog);watchdog=0;}
 function cleanForSpeech(text){return String(text||'').replace(/```[\s\S]*?```/g,' ').replace(/!\[[^\]]*\]\([^)]*\)/g,' ').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*_`#>~|]/g,'').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu,'').replace(/\s+/g,' ').trim();}
 function stopSpeech(cue){speakToken++;clearWatchdog();speechQueue=[];speechAbort?.abort();speechAbort=null;if(speaking||globalThis.speechSynthesis?.speaking)globalThis.speechSynthesis?.cancel();releaseAudio();speaking=false;if(cue)sound('astro-stop');renderVoiceState();}
 function releaseAudio(){if(speechAudio){try{speechAudio.pause();}catch{}speechAudio=null;}if(speechUrl){URL.revokeObjectURL(speechUrl);speechUrl='';}}
 function finishSpeech(token){if(token!==speakToken)return;speaking=false;clearWatchdog();releaseAudio();renderVoiceState();pump();}
 async function speakNatural(phrase,token){
  const abort=new AbortController();speechAbort=abort;
  const response=await apiFetch('/api/astro/'+encodeURIComponent(target)+'/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:phrase,voice:selectedNaturalId(),rate:voiceRate}),signal:abort.signal});
  if(token!==speakToken)return false;
  const blob=await response.blob();if(token!==speakToken||!blob.size)return false;
  // Nunca deixar duas vozes ao mesmo tempo: encerra qualquer fala do aparelho antes do MP3.
  globalThis.speechSynthesis?.cancel();
  releaseAudio();
  const url=URL.createObjectURL(blob),player=new Audio(url);speechAudio=player;speechUrl=url;player.volume=voiceVolume;
  const cleanup=()=>{if(speechAbort===abort)speechAbort=null;if(speechUrl===url){URL.revokeObjectURL(url);speechUrl='';}if(speechAudio===player)speechAudio=null;};
  player.addEventListener('ended',()=>{cleanup();finishSpeech(token);});
  player.addEventListener('error',()=>{cleanup();finishSpeech(token);});
  const duration=await new Promise(resolve=>{const timer=setTimeout(()=>resolve(0),3000);player.addEventListener('loadedmetadata',()=>{clearTimeout(timer);resolve(player.duration||0);},{once:true});player.addEventListener('error',()=>{clearTimeout(timer);resolve(0);},{once:true});});
  if(token!==speakToken){cleanup();return false;}
  clearWatchdog();watchdog=setTimeout(()=>{releaseAudio();finishSpeech(token);},Math.max(8000,(duration||30)*1000+8000));
  await player.play();
  return true;
 }
 function noVoice(message){speaking=false;speechQueue=[];voiceNote.textContent=message;setStatus(message,8000);renderVoiceState();}
 async function speakNow(text){
  const phrase=cleanForSpeech(text).slice(0,600);if(!phrase){speaking=false;return;}
  const token=++speakToken;
  speaking=true;renderVoiceState();
  if(voiceSource==='natural'){
   if(naturalVoiceMissing())return noVoice('A voz escolhida não está disponível agora. A resposta continua no texto.');
   if(!naturalReady)return noVoice('A voz natural não está disponível neste servidor. Escolha uma voz do aparelho.');
   if(!canUseNatural())return noVoice('A voz escolhida está indisponível agora. A resposta continua no texto.');
   try{if(await speakNatural(phrase,token))return;if(token!==speakToken)return;}
   catch(error){
    if(token!==speakToken)return;
    speechAbort=null;releaseAudio();
    if(error.name==='AbortError')return;
    if(error.name==='NotAllowedError')return noVoice('Toque em “Testar voz” para liberar o som.');
    if(error.status===429||error.status===400)return noVoice(error.message||'A voz escolhida está indisponível agora.');
    naturalDownUntil=Date.now()+60000;
    return noVoice(/voz|indispon/i.test(error.message||'')?error.message:'A voz escolhida está indisponível agora. A resposta continua no texto.');
   }
   return noVoice('A voz escolhida está indisponível agora. A resposta continua no texto.');
  }
  if(token!==speakToken)return;
  speakDevice(phrase,token);
 }
 function speakDevice(phrase,token){
  const synth=globalThis.speechSynthesis;if(!synth)return noVoice('Este navegador não oferece voz. As respostas continuam em texto.');
  const voice=pickVoice();
  if(voiceName&&!voice)return noVoice('A voz escolhida ('+voiceName+') não está disponível neste aparelho. Escolha outra voz.');
  releaseAudio();
  const utterance=new SpeechSynthesisUtterance(phrase);
  utterance.lang=voice?.lang||'pt-BR';if(voice)utterance.voice=voice;utterance.rate=voiceRate;utterance.volume=voiceVolume;
  const estimate=Math.min(120000,Math.max(2000,phrase.length*90/Math.max(.7,voiceRate)));
  const finish=()=>{if(token!==speakToken)return;speaking=false;clearWatchdog();renderVoiceState();pump();};
  utterance.onend=finish;utterance.onerror=finish;
  clearWatchdog();watchdog=setTimeout(()=>{if(token!==speakToken)return;synth.cancel();finish();},estimate+5000);
  if(synth.speaking)synth.cancel();speaking=true;renderVoiceState();synth.speak(utterance);
 }
 function pump(){if(speaking||!speechQueue.length)return;if(!voiceEnabled||ctx.state().deafened){speechQueue=[];renderVoiceState();return;}sound('astro-answer');speakNow(speechQueue.shift());}
 function speak(text){if(!voiceEnabled||ctx.state().deafened)return;if(speechQueue.length>=3)speechQueue.shift();speechQueue.push(text);pump();}
 function note(text){items.push({id:'local-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),kind:'answer',name:'Cloe',text,at:Date.now()/1000});render();}
 let watchChain=Promise.resolve();
 // Quem pediu executa no Ouvir juntos; o player sincroniza para a call inteira.
 // Pedidos seguidos entram em fila: antes, um comando logo após o outro era descartado em silêncio.
 function runWatch(command){
  if(!ctx.watch){setStatus('Recarregue a página para a Cloe controlar o Ouvir juntos.',6000);return Promise.resolve();}
  const task=watchChain.then(async()=>{
   try{
    const result=String(await ctx.watch(command)||'Feito.').trim();
    note(result);
    // Fala antes de fixar o aviso: se a voz falhar, o resultado do comando continua visível.
    if(voiceEnabled&&!ctx.state().deafened)speak(result.length>260?result.slice(0,240)+'…':result);
    setStatus(result.split('\n')[0].slice(0,140),5000);
   }catch(error){setStatus(error?.message||'Não foi possível executar no Ouvir juntos.',6000);}
  });
  watchChain=task.catch(()=>{});
  return task;
 }
 function setVoiceEnabled(next){voiceEnabled=!!next;localStorage.setItem(VOICE_KEY,voiceEnabled?'on':'off');if(!voiceEnabled)stopSpeech(false);renderVoiceState();if(voiceEnabled){try{audio?.resume?.().catch(()=>{});}catch{}}}
 rateInput.value=String(voiceRate);rateOutput.value=Math.round(voiceRate*100)+'%';
 volumeInput.value=String(voiceVolume);volumeOutput.value=Math.round(voiceVolume*100)+'%';
 rateInput.oninput=()=>{voiceRate=Number(rateInput.value);localStorage.setItem(RATE_KEY,String(voiceRate));rateOutput.value=Math.round(voiceRate*100)+'%';};
 volumeInput.oninput=()=>{voiceVolume=Number(volumeInput.value);localStorage.setItem(VOLUME_KEY,String(voiceVolume));volumeOutput.value=Math.round(voiceVolume*100)+'%';if(speechAudio)speechAudio.volume=voiceVolume;};
 voiceSelect.onchange=()=>{const value=voiceSelect.value;sourceChosen=true;if(value.startsWith('n:')){voiceSource='natural';serviceVoice=value.slice(2);localStorage.setItem(SOURCE_KEY,'natural');localStorage.setItem(SERVICE_KEY,serviceVoice);}else{voiceSource='device';voiceName=value.slice(2);localStorage.setItem(SOURCE_KEY,'device');localStorage.setItem(NAME_KEY,voiceName);}};
 globalThis.speechSynthesis?.addEventListener?.('voiceschanged',fillVoices);
 globalThis.speechSynthesis?.getVoices?.();fillVoices();renderVoiceState();
 function select(value){tab=value;transcripts.setAttribute('aria-pressed',String(value==='transcript'));answers.setAttribute('aria-pressed',String(value==='answer'));render();}
 function render(){const bottom=list.scrollHeight-list.scrollTop-list.clientHeight<80,fragment=document.createDocumentFragment();items=items.filter(e=>e.at>Date.now()/1000-900);const rows=items.filter(e=>tab==='transcript'?e.kind==='transcript':e.kind==='answer'||e.kind==='error');for(const e of rows){const card=el('article'),name=el('strong','',e.name),time=el('time','muted',new Date(e.at*1000).toLocaleTimeString('pt-BR'));card.append(name,time,el('p','',e.text));const sources=sourceItems(e);if(sources.length){const box=el('div','astro-sources');box.append(el('span','muted','Fontes'));for(const source of sources){const link=el('a','',source.title);link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';box.append(link);}card.append(box);}fragment.append(card);}if(!rows.length)fragment.append(el('p','astro-empty',tab==='transcript'?'Nenhuma fala transcrita ainda. A Cloe mostra aqui o que ouve na call.':'Nenhuma resposta ainda. Diga “Ei Cloe” ou escreva abaixo.'));list.classList.toggle('is-empty',!rows.length);list.replaceChildren(fragment);if(bottom)list.scrollTop=list.scrollHeight;}
 // Só para a cópia própria da Cloe; a faixa publicada no LiveKit nunca é parada aqui.
 function stopAudio(){track=null;source?.disconnect();node?.disconnect();source=node=null;try{listenCopy?.stop();}catch{}listenCopy=null;if(audio){audio.close().catch(()=>{});audio=null;}loadingAudio=false;}
 function reset(){version++;stopSpeech(false);cancelListening();controller?.abort();controller=new AbortController();stopAudio();queue=[];sending=false;polling=false;configured=false;items=[];seenIds=new Set();cursor=0;lastProblem='';nextAttempt=0;retryAt=0;lastPoll=0;joinedAt=Date.now()/1000;statusUntil=0;render();}
 ask.onsubmit=async event=>{event.preventDefault();const text=askInput.value.trim();if(!text)return;sync();if(!target){setStatus('Entre na call para perguntar à Cloe.',6000);return;}askSend.disabled=true;
  try{const response=await apiFetch('/api/astro/'+encodeURIComponent(target)+'/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:controller.signal});let data={};try{data=await response.json();}catch{}askInput.value='';if(data?.watch)await runWatch(data.watch);else{if(data?.answer)deliver(data.answer);setStatus(data?.answer?'Cloe respondeu.':'Pergunta enviada à Cloe.',4000);}lastPoll=0;poll();}
  catch(error){if(error.name!=='AbortError')setStatus(error.message,8000);}
  finally{askSend.disabled=false;}};
 async function poll(){if(polling||Date.now()<nextAttempt)return;polling=true;lastPoll=Date.now();const ticket=version;
  try{const response=await apiFetch('/api/astro/'+encodeURIComponent(target)+'?after='+cursor,{signal:controller.signal}),data=await response.json();if(!current(ticket))return;
   configured=data.configured;ownerNote.hidden=!data.owner;if(Array.isArray(data.voices)){const signature=JSON.stringify([!!data.tts,data.voices]);if(signature!==voiceSignature){voiceSignature=signature;serverVoices=data.voices.filter(v=>v&&v.id);naturalReady=!!data.tts;if(!sourceChosen)voiceSource=naturalReady?'natural':'device';fillVoices();}}if(data.cursor<cursor){items=[];seenIds=new Set();cursor=0;return;}cursor=data.cursor;for(const e of data.events)if(remember(e)&&e.at>=joinedAt)apply(e);render();lastProblem='';defaultStatus(configured?((data.queued??data.busy)?'Cloe pensando…':'Cloe na call · ouvindo microfones abertos'):'A Cloe ainda não foi ligada neste servidor. Avise um administrador.');
  }catch(error){if(current(ticket)&&error.name!=='AbortError'){lastProblem=error.message;setStatus(lastProblem,10000);nextAttempt=Date.now()+10000;}}
  finally{if(current(ticket))polling=false;}
 }
 async function drain(){if(sending||!queue.length||!target)return;sending=true;const ticket=version;
  try{while(queue.length&&current(ticket)){const chunk=queue.shift();if(!enabled)continue;try{const response=await apiFetch('/api/astro/'+encodeURIComponent(target)+'/audio?chunk_id='+chunk.id+'&direct=1',{method:'POST',headers:{'Content-Type':'audio/wav'},body:chunk.body,signal:controller.signal});let data={};try{data=await response.json();}catch{}if(data?.stop)stopSpeech(true);else if(data?.watch)runWatch(data.watch);else if(data?.answer)deliver(data.answer);else if(data?.transcribed===false)setStatus('Não ouvi nada. Toque em “Falar com a Cloe” e tente de novo.',6000);else if(data?.transcribed)setStatus('Não entendi. Toque em “Falar com a Cloe” e repita.',6000);}catch(error){if(!current(ticket)||error.name==='AbortError')return;// 429/5xx é contrapressão do servidor, não falha da pessoa: o trecho
       // é a única cópia daquela fala, jogá-lo fora perdia a transcrição e calava a Cloe por 10 s.
       if(error.status===429||error.status>=500){retryAt=Date.now()+900;queue.unshift(chunk);break;}lastProblem=error.message;setStatus(lastProblem,10000);nextAttempt=Date.now()+10000;queue=[];break;}}}
  finally{if(current(ticket))sending=false;}
 }
 async function capture(nextTrack){if(loadingAudio||track===nextTrack)return;stopAudio();loadingAudio=true;track=nextTrack;const ticket=version;
  try{const ac=new AudioContext();audio=ac;await ac.audioWorklet.addModule('/static/astro-recorder.js?v=cloe-20261031');if(!current(ticket)||audio!==ac){ac.close().catch(()=>{});return;}
   // Escuta uma cópia (clone) da faixa: a Cloe nunca compartilha, muta nem encerra o microfone da call.
   listenCopy=nextTrack.clone();source=ac.createMediaStreamSource(new MediaStream([listenCopy]));node=new AudioWorkletNode(ac,"cloe-recorder");source.connect(node);node.connect(ac.destination);
   // resume() fica pendente para sempre sem gesto no iOS; não trava a captura esperando.
   await Promise.race([ac.resume(),new Promise(resolve=>setTimeout(resolve,1500))]);if(!current(ticket)||audio!==ac)return;
   // Só o trecho gravado depois do botão "Falar com a Cloe" é enviado.
   node.port.onmessage=event=>{if(!current(ticket)||!enabled||!listening||Date.now()<nextAttempt)return;stopListening();const chunk={id:crypto.randomUUID(),body:wav(event.data)};if(queue.length>=3){setStatus('Conexão lenta: aguarde a resposta anterior.',6000);return;}queue.push(chunk);setStatus('Processando…',4000);drain();};
  }catch(error){if(current(ticket)){setStatus('Não foi possível capturar áudio: '+error.message,10000);stopAudio();nextAttempt=Date.now()+10000;}}
  // Captura abortada no meio (call mudou, contexto fechado): esquece a faixa para tentar de novo,
  // senão "track===nextTrack" bloqueava a Cloe de ouvir até a faixa mudar.
  finally{if(current(ticket)){loadingAudio=false;if(!node&&track===nextTrack)track=null;}}
 }
 function sync(){const state=ctx.state(),next=state.session&&state.room?.state==='connected'?roomName(state):null;if(next!==target){target=next;reset();setStatus(next?'Conectando a Cloe…':'Entre na call para iniciar.',next?6000:0);}
  if(!target)return;if(queue.length&&Date.now()>=retryAt)drain();if(Date.now()-lastPoll>=pollEvery())poll();
  const pub=[...state.room.localParticipant.audioTrackPublications.values()].find(p=>p.source==='microphone'),media=pub?.track?.mediaStreamTrack;
  const active=enabled&&configured&&!state.deafened&&state.room.localParticipant.isMicrophoneEnabled&&!pub?.isMuted&&Date.now()>nextAttempt;
  if(media&&media.readyState==='live'&&Date.now()>nextAttempt)capture(media);else if(track){stopAudio();if(enabled&&configured&&target&&!lastProblem)defaultStatus('O microfone foi desconectado: escolha outro em Entrada e saída de áudio.');}
  if(listenCopy&&media&&listenCopy.enabled!==media.enabled)listenCopy.enabled=media.enabled;
  if(listening&&!active)stopListening('O microfone não está disponível agora.');
  // O worklet fica desligado até o botão "Falar com a Cloe": nada é capturado nem enviado.
  node?.port.postMessage({enabled:!!active&&listening,quick:false});if(enabled&&configured&&!lastProblem){if(!state.room.localParticipant.isMicrophoneEnabled)defaultStatus('Cloe pronta · abra seu microfone para falar');else if(audio?.state==='suspended')defaultStatus('Toque em Ativar voz para liberar o áudio do navegador.');else if(speaking)defaultStatus('Cloe falando · toque em “Parar fala” para interromper.');else if(!listening)defaultStatus('Cloe pronta · toque em “Falar com a Cloe”');}if(!enabled)defaultStatus('Envio do seu áudio pausado. Os outros participantes controlam o próprio áudio.');
 }
 for(const type of ['pointerdown','keydown'])document.addEventListener(type,()=>{if(audio?.state==='suspended')audio.resume().catch(()=>{});},{capture:true,passive:true});
 select('transcript');const timer=setInterval(sync,500);window.addEventListener('pagehide',event=>{if(!event.persisted){clearInterval(timer);target=null;reset();}});
 return {sync};
}
