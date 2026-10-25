export function wav(pcm){
 const buffer=new ArrayBuffer(44+pcm.byteLength),v=new DataView(buffer),label=(p,s)=>{for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i));};
 label(0,'RIFF');v.setUint32(4,36+pcm.byteLength,true);label(8,'WAVE');label(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);label(36,'data');v.setUint32(40,pcm.byteLength,true);
 const samples=new Int16Array(pcm);for(let i=0;i<samples.length;i++)v.setInt16(44+i*2,samples[i],true);return new Blob([buffer],{type:'audio/wav'});
}
export function initAstro(ctx){
 const {el,button,apiFetch}=ctx,view=document.getElementById('voice-view');
 // Só o ícone: os botões do cabeçalho têm largura de ícone e o texto transbordava por cima do título da sala.
 const toggle=button('',()=>setOpen(panel.hidden),'soft-button astro-toggle');
 toggle.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 14v-3M7 18.5v-9M11 16v-8M15 19V9"/><path d="M19.4 3l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" fill="currentColor" stroke="none"/></svg>';
 toggle.title='Astro · Transcrição';toggle.setAttribute('aria-label','Astro · Transcrição');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-pressed','false');toggle.setAttribute('aria-controls','astro-panel');view.querySelector('.chat-actions').append(toggle);
 const panel=el('aside','astro-panel');panel.id='astro-panel';panel.hidden=true;panel.setAttribute('aria-label','Astro e transcrição da call');
 function setOpen(next){panel.hidden=!next;toggle.setAttribute('aria-expanded',String(next));toggle.setAttribute('aria-pressed',String(next));}
 const header=el('header'),title=el('h3','','Astro'),close=button('Fechar',()=>setOpen(false),'text-button');header.append(title,close);
 const status=el('p','muted','Entre na call para iniciar.');status.setAttribute('role','status');
 const notice=el('p','muted','Astro ativo por padrão: enquanto você estiver nesta call com o microfone aberto, seu áudio é enviado à Groq — fechar este painel não interrompe. Use “Pausar meu áudio” para parar. Contexto temporário de 15 minutos. Diga “Ei Astro” e faça sua pergunta.');
 const tabs=el('div'),transcripts=button('Transcrição',()=>select('transcript')),answers=button('Respostas do Astro',()=>select('answer'));tabs.append(transcripts,answers);
 const list=el('div','astro-events');list.setAttribute('role','log');list.setAttribute('aria-live','polite');
 const controls=el('div'),pause=button('Pausar meu áudio',()=>{enabled=!enabled;pause.textContent=enabled?'Pausar meu áudio':'Retomar meu áudio';if(!enabled)queue=[];}),voice=button('Ativar voz',async()=>{if(!globalThis.speechSynthesis){status.textContent='Este navegador não oferece síntese de voz. As respostas continuam disponíveis em texto.';return;}voiceEnabled=true;await audio?.resume();const u=new SpeechSynthesisUtterance('Astro pronto.');u.lang='pt-BR';speechSynthesis.speak(u);});
 controls.append(pause,voice);panel.append(header,status,notice,tabs,list,controls);view.append(panel);
 let target=null,version=0,cursor=0,items=[],tab='transcript',enabled=true,configured=false,voiceEnabled=true,audio,source,node,track,loadingAudio=false,polling=false,queue=[],sending=false,controller=null,pauseUntil=0,nextAttempt=0,retryAt=0,lastProblem='',lastPoll=0,joinedAt=Date.now()/1000;
 const roomName=s=>s.room?.name||(s.callChannel?(s.callChannel.private?'direct-':'channel-')+s.callChannel.id:null);
 const current=(ticket)=>ticket===version&&!!target;
 function select(value){tab=value;transcripts.setAttribute('aria-pressed',String(value==='transcript'));answers.setAttribute('aria-pressed',String(value==='answer'));render();}
 function render(){const bottom=list.scrollHeight-list.scrollTop-list.clientHeight<80,fragment=document.createDocumentFragment();items=items.filter(e=>e.at>Date.now()/1000-900);for(const e of items.filter(e=>tab==='transcript'?e.kind==='transcript':e.kind!=='transcript')){const card=el('article'),name=el('strong','',e.name),time=el('time','muted',new Date(e.at*1000).toLocaleTimeString('pt-BR'));card.append(name,time,el('p','',e.text));fragment.append(card);}list.replaceChildren(fragment);if(bottom)list.scrollTop=list.scrollHeight;}
 function stopAudio(){track=null;source?.disconnect();node?.disconnect();source=node=null;if(audio){audio.close().catch(()=>{});audio=null;}loadingAudio=false;}
 function reset(){version++;controller?.abort();controller=new AbortController();stopAudio();queue=[];sending=false;polling=false;configured=false;items=[];cursor=0;lastProblem='';nextAttempt=0;retryAt=0;lastPoll=0;joinedAt=Date.now()/1000;pauseUntil=0;globalThis.speechSynthesis?.cancel();render();}
 function speak(event){if(!voiceEnabled||ctx.state().deafened||!globalThis.speechSynthesis)return;
  const utterance=new SpeechSynthesisUtterance(event.text);utterance.lang='pt-BR';utterance.voice=speechSynthesis.getVoices().find(v=>v.lang.toLowerCase()==='pt-br')||null;
  pauseUntil=Date.now()+60000;utterance.onend=utterance.onerror=()=>{pauseUntil=Date.now()+1000;};speechSynthesis.cancel();speechSynthesis.speak(utterance);
 }
 async function poll(){if(polling||Date.now()<nextAttempt)return;polling=true;lastPoll=Date.now();const ticket=version,initial=cursor===0;
  try{const response=await apiFetch('/api/astro/'+encodeURIComponent(target)+'?after='+cursor,{signal:controller.signal}),data=await response.json();if(!current(ticket))return;
   configured=data.configured;const old=cursor;if(data.cursor<cursor){items=[];cursor=0;return;}cursor=data.cursor;for(const e of data.events){if(!items.some(row=>row.id===e.id)){items.push(e);if(e.at>=joinedAt&&e.id>old&&e.kind==='answer')speak(e);}}render();lastProblem='';status.textContent=configured?(data.busy?'Astro pensando…':'Astro na call · ouvindo microfones abertos'):'Configure GROQ_API_KEY no servidor.';
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
