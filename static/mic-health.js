// Saúde do microfone na call: erros claros com "Tentar de novo", dispositivo salvo que sumiu,
// faixa que termina sozinha (fone removido, outro app tomou o microfone, iOS interrompeu)
// e medidor de nível do que está sendo enviado. Nunca para a faixa compartilhada:
// o medidor só lê por um AnalyserNode próprio.
const DEVICE_KEY='orbita-audio-input';

export function micErrorText(error){
  const name=error?.name||'',message=String(error?.message||'');
  if(name==='NotAllowedError'||name==='PermissionDeniedError'||name==='SecurityError')return 'O navegador bloqueou o microfone. Libere o acesso ao microfone para a Órbita (ícone de cadeado ao lado do endereço ou ajustes do app) e toque em Tentar de novo.';
  if(name==='NotFoundError'||name==='DevicesNotFoundError')return 'Nenhum microfone foi encontrado. Conecte um microfone ou fone com microfone e toque em Tentar de novo.';
  if(name==='NotReadableError'||name==='TrackStartError'||name==='AbortError'||/could not start audio source|device in use|busy/i.test(message))return 'O microfone está ocupado por outro aplicativo (outra chamada, gravador ou aba). Feche-o e toque em Tentar de novo.';
  if(name==='OverconstrainedError'||name==='ConstraintNotSatisfiedError')return 'O microfone escolhido não está disponível. Voltamos ao microfone padrão do sistema; toque em Tentar de novo.';
  if(name==='TimeoutError')return 'O microfone demorou demais para responder. Toque em Tentar de novo.';
  return 'Não foi possível ativar o microfone'+(message?': '+message:'.')+' Toque em Tentar de novo.';
}
const deviceProblem=error=>['OverconstrainedError','ConstraintNotSatisfiedError','NotFoundError','DevicesNotFoundError'].includes(error?.name);
const busyProblem=error=>['NotReadableError','TrackStartError','AbortError'].includes(error?.name);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Remove o microfone salvo quando ele não existe mais neste aparelho. IDs de dispositivo mudam
// entre sessões no Safari/iOS e no Android, ao limpar os dados do site e ao reconectar um USB.
export async function forgetMissingInput(storage=localStorage,media=globalThis.navigator?.mediaDevices){
  const saved=storage.getItem(DEVICE_KEY);if(!saved||!media?.enumerateDevices)return false;
  try{const inputs=(await media.enumerateDevices()).filter(d=>d.kind==='audioinput');
    // Sem permissão os IDs vêm vazios: não dá para saber, e a restrição "ideal" já cai no padrão.
    if(!inputs.length||inputs.every(d=>!d.deviceId))return false;
    if(inputs.some(d=>d.deviceId===saved))return false;
    storage.removeItem(DEVICE_KEY);return true;
  }catch{return false;}
}

export function micPublication(room){const lp=room?.localParticipant;if(!lp)return null;return [...lp.audioTrackPublications.values()].find(p=>(p.source||p.track?.source)==='microphone')||null;}
export function liveMicTrack(room){const media=micPublication(room)?.track?.mediaStreamTrack;return media&&media.readyState==='live'?media:null;}

export function initMicHealth(ctx){
  const {el,room:currentRoom,capture,toast}=ctx;
  let alertNode,recovering=null,watchTimer=0,meterAudio=null,meterSource=null,analyser=null,meterTrack=null,lastLevel=0,watchedTrack=null,failures=0;
  const buf=new Float32Array(1024);
  function alertBox(){
    if(alertNode?.isConnected)return alertNode;
    alertNode=el('div','mic-alert');alertNode.setAttribute('role','alert');alertNode.hidden=true;
    const text=el('span','mic-alert-text'),retry=el('button','soft-button mic-alert-retry','Tentar de novo'),close=el('button','text-button mic-alert-close','Fechar');
    retry.type=close.type='button';close.setAttribute('aria-label','Fechar aviso do microfone');
    retry.onclick=async()=>{retry.disabled=true;try{await retryNow();}finally{retry.disabled=false;}};close.onclick=()=>hideAlert();
    alertNode.append(text,retry,close);
    const host=document.getElementById('active-controls');(host?.parentElement||document.getElementById('voice-view')||document.body).insertBefore(alertNode,host||null);
    return alertNode;
  }
  function showAlert(message){const box=alertBox();box.querySelector('.mic-alert-text').textContent=message;box.hidden=false;}
  function hideAlert(){if(alertNode)alertNode.hidden=true;}
  // Liga/desliga o microfone com as quedas mais comuns resolvidas sozinhas.
  async function setEnabled(participant,value){
    if(!value){await participant.setMicrophoneEnabled(false);return;}
    // Faixa antiga já encerrada (fone removido com o microfone fechado): o LiveKit "desmutava"
    // a faixa morta sem erro e o botão voltava a fechado. Publica uma nova, com erro de verdade.
    const stale=[...participant.audioTrackPublications.values()].find(p=>(p.source||p.track?.source)==='microphone'&&p.track?.mediaStreamTrack&&p.track.mediaStreamTrack.readyState!=='live');
    if(stale?.track)await participant.unpublishTrack(stale.track).catch(()=>{});
    const enable=async()=>{await participant.setMicrophoneEnabled(true,capture());const pub=[...participant.audioTrackPublications.values()].find(p=>(p.source||p.track?.source)==='microphone');if(pub?.track?.mediaStreamTrack&&pub.track.mediaStreamTrack.readyState!=='live')throw new DOMException('Faixa do microfone encerrada','NotReadableError');};
    try{await enable();}
    catch(error){
      if(deviceProblem(error)&&localStorage.getItem(DEVICE_KEY)){localStorage.removeItem(DEVICE_KEY);toast?.('O microfone salvo não está conectado. Usando o microfone padrão do sistema.');}
      else if(busyProblem(error))await wait(700);
      else{showAlert(micErrorText(error));throw Object.assign(Error(micErrorText(error)),{name:error?.name,cause:error});}
      try{await enable();}
      catch(again){showAlert(micErrorText(again));throw Object.assign(Error(micErrorText(again)),{name:again?.name,cause:again});}
    }
    hideAlert();failures=0;
  }
  async function retryNow(){
    const room=currentRoom();if(!room){hideAlert();return;}
    await forgetMissingInput();
    const pub=micPublication(room);
    try{
      if(pub?.track&&pub.track.mediaStreamTrack?.readyState!=='live')await restart(room,pub.track);
      else await setEnabled(room.localParticipant,true);
      hideAlert();ctx.updated?.();
    }catch(error){showAlert(micErrorText(error?.cause||error));}
  }
  async function restart(room,track){
    try{await track.restartTrack(capture());}
    catch(error){
      if(deviceProblem(error)){localStorage.removeItem(DEVICE_KEY);await track.restartTrack(capture());}
      else{
        // Última saída: publica uma faixa nova.
        await room.localParticipant.unpublishTrack(track).catch(()=>{});
        await room.localParticipant.setMicrophoneEnabled(true,capture());
      }
    }
  }
  // Faixa terminou com o microfone ligado: reabre o mesmo microfone (ou o padrão).
  function recover(room,reason){
    if(recovering||ctx.wanted?.()===false)return recovering;
    recovering=(async()=>{
      for(const delay of [0,800,2500]){
        if(delay)await wait(delay);if(currentRoom()!==room)return;
        const pub=micPublication(room);if(!pub?.track){if(!room.localParticipant.isMicrophoneEnabled)return;}
        if(pub?.track?.mediaStreamTrack?.readyState==='live')return;
        try{await forgetMissingInput();if(pub?.track)await restart(room,pub.track);else await room.localParticipant.setMicrophoneEnabled(true,capture());
          if(liveMicTrack(room)){hideAlert();toast?.('O microfone caiu e foi reconectado.');ctx.updated?.();return;}
        }catch(error){failures++;if(delay===2500)showAlert(micErrorText(error?.cause||error));}
      }
      if(!liveMicTrack(room))showAlert('O microfone parou de enviar áudio ('+reason+'). Toque em Tentar de novo.');
    })().finally(()=>{recovering=null;});
    return recovering;
  }
  function senderTrack(pub){const t=pub?.track;const sent=t?.sender?.track;return sent&&sent.readyState==='live'?sent:t?.mediaStreamTrack;}
  function ensureMeter(track){
    if(meterTrack===track&&meterAudio&&meterAudio.state!=='closed')return;
    closeMeter();if(!track)return;
    const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;
    try{meterAudio=new Audio();analyser=meterAudio.createAnalyser();analyser.fftSize=1024;
      meterSource=meterAudio.createMediaStreamSource(new MediaStream([track]));meterSource.connect(analyser);meterTrack=track;
      if(meterAudio.state!=='running')meterAudio.resume().catch(()=>{});
    }catch{closeMeter();}
  }
  function closeMeter(){try{meterSource?.disconnect();}catch{}meterSource=null;analyser=null;meterTrack=null;const a=meterAudio;meterAudio=null;if(a&&a.state!=='closed')a.close().catch(()=>{});}
  function paint(value,open){
    for(const node of document.querySelectorAll('[data-call-mic-meter]')){node.style.setProperty('--mic-level',String(value));node.setAttribute('aria-valuenow',String(Math.round(value*100)));node.classList.toggle('closed',!open);node.title=open?(value>0.02?'Microfone captando':'Microfone ligado, sem som no momento'):'Microfone fechado';}
  }
  function meterNode(){if(document.querySelector('[data-call-mic-meter]'))return;const mic=document.getElementById('mic');if(!mic)return;
    const bar=el('span','call-mic-meter');bar.dataset.callMicMeter='';bar.setAttribute('role','meter');bar.setAttribute('aria-label','Nível do microfone');bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');bar.setAttribute('aria-valuenow','0');mic.append(bar);}
  function tick(){
    const room=currentRoom();if(!room){paint(0,false);closeMeter();return;}
    meterNode();
    const pub=micPublication(room),media=pub?.track?.mediaStreamTrack,on=!!room.localParticipant.isMicrophoneEnabled&&!pub?.isMuted;
    if(media&&media!==watchedTrack){watchedTrack=media;media.addEventListener('ended',()=>{if(currentRoom()===room&&room.localParticipant.isMicrophoneEnabled)recover(room,'faixa encerrada');},{once:true});}
    if(on&&media&&media.readyState==='ended'&&room.state==='connected')recover(room,'faixa encerrada');
    if(!on||!media||media.readyState!=='live'){paint(0,false);lastLevel=0;return;}
    ensureMeter(senderTrack(pub));
    if(!analyser){paint(0,true);return;}
    if(meterAudio.state==='suspended')meterAudio.resume().catch(()=>{});
    analyser.getFloatTimeDomainData(buf);let sum=0;for(const v of buf)sum+=v*v;const rms=Math.sqrt(sum/buf.length);
    // Escala logarítmica: -60 dBFS = vazio, 0 dBFS = cheio.
    const db=20*Math.log10(rms+1e-9),value=Math.max(0,Math.min(1,(db+60)/60));lastLevel=Math.max(value,lastLevel*0.85);paint(lastLevel,true);
  }
  function start(){if(!watchTimer)watchTimer=setInterval(tick,100);}
  function stop(){clearInterval(watchTimer);watchTimer=0;closeMeter();watchedTrack=null;paint(0,false);hideAlert();}
  // Desbloqueia o AudioContext do medidor no primeiro toque (iOS/Android começam suspensos).
  for(const type of ['pointerdown','keydown'])document.addEventListener(type,()=>{if(meterAudio?.state==='suspended')meterAudio.resume().catch(()=>{});},{capture:true,passive:true});
  return {setEnabled,recover,start,stop,showAlert,hideAlert,retry:retryNow,level:()=>lastLevel,failures:()=>failures};
}
