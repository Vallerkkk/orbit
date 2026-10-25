import {requestWithDeadline} from './chat-state.js';
import {createNoiseProcessor,gateThreshold} from './noise-processor.js';

export function initAudioControls(ctx){
  const {el,button}=ctx,read=kind=>localStorage.getItem('orbita-audio-'+kind)||'',tracks=new WeakMap();
  const supportsOutput=()=>typeof (window.AudioContext||window.webkitAudioContext)?.prototype?.setSinkId==='function';
  let warned=false,mixContext;const mixes=new WeakMap();
  function mixOptions(){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return false;mixContext=new Audio();return {audioContext:mixContext};}
  function bind(room){if(mixContext){mixes.set(room,mixContext);mixContext=null;}}
  async function ended(room){const audio=mixes.get(room);mixes.delete(room);if(audio&&audio.state!=='closed')await audio.close().catch(()=>{});}
  async function switchDevice(room,kind,value){
    // LiveKit 2.15's mixer switch does not await setSinkId. Confirm it ourselves.
    if(kind==='audiooutput'){const audio=mixes.get(room);if(audio?.setSinkId)await audio.setSinkId(value||'');}
    const ok=await room.switchActiveDevice(kind,value||'default');if(ok===false)throw Error('Dispositivo indisponível');
  }
  const enhanced=()=>ctx.noise()&&localStorage.getItem('orbita-noise-mode')!=='browser';
  const sensitivity=()=>Number(localStorage.getItem('orbita-mic-sensitivity')||'50');
  const micVolume=()=>Number(localStorage.getItem('orbita-mic-volume')||'100');
  const noiseMode=()=>localStorage.getItem('orbita-noise-mode')||'enhanced';
  async function process(track,room){
    if(!track||track.source!=='microphone'||typeof track.setProcessor!=='function')return;
    const prior=tracks.get(track);if(prior?.pending){prior.again=true;return prior.pending;}
    const record=prior||{};tracks.set(track,record);
    record.pending=(async()=>{do{record.again=false;
      if(!enhanced()){if(record.processor){await track.stopProcessor();record.processor=null;}continue;}
      // Processador já ativo: aplica sensibilidade e modo na hora, sem reiniciar a faixa.
      if(record.processor){record.processor.update({sensitivity:sensitivity(),mode:noiseMode(),volume:micVolume()});continue;}
      // O LiveKit chama processor.init() dentro de setProcessor; iniciar antes criava um segundo AudioContext.
      const processor=createNoiseProcessor({sensitivity:sensitivity(),mode:noiseMode(),volume:micVolume()});
      try{
        await requestWithDeadline(()=>track.setProcessor(processor),{timeout:12000});
        if(ctx.room()!==room){await track.stopProcessor();return;}
        record.processor=processor;
      }catch{await processor.destroy();if(!warned&&ctx.room()===room){warned=true;ctx.toast('O filtro adicional não está disponível agora. A supressão de ruído do navegador continua ativa.');}}
      }while(record.again&&ctx.room()===room);
    })().finally(()=>{record.pending=null;});return record.pending;
  }
  async function sync(room=ctx.room()){
    if(!room||room!==ctx.room())return;
    for(const pub of room.localParticipant.audioTrackPublications.values())if(pub.track)await process(pub.track,room);
  }
  async function connected(room){
    const output=read('output');if(output&&supportsOutput())try{await switchDevice(room,'audiooutput',output);}catch{ctx.toast('Não foi possível usar a saída salva. Escolha outra em Entrada e saída de áudio.');}
    await sync(room);
  }
  // Medidor ao vivo: usa um stream próprio só enquanto o teste está ligado.
  function micMeter(threshold){
    const node=el('div','mic-meter'),bar=el('div','mic-meter-bar'),fill=el('div','mic-meter-fill'),mark=el('div','mic-meter-mark'),label=el('span','muted','Toque em Testar para ver o nível do microfone.');
    bar.setAttribute('role','meter');bar.setAttribute('aria-label','Nível do microfone');bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');bar.setAttribute('aria-valuenow','0');bar.append(fill,mark);
    let stream,audio,timer;const pct=db=>Math.max(0,Math.min(100,(db+90)/90*100));
    const paintMark=()=>{mark.style.left=pct(threshold())+'%';};paintMark();
    const stop=()=>{clearInterval(timer);stream?.getTracks().forEach(t=>t.stop());audio?.close().catch(()=>{});stream=audio=null;fill.style.width='0%';bar.setAttribute('aria-valuenow','0');toggle.textContent='Testar microfone';toggle.setAttribute('aria-pressed','false');label.textContent='Toque em Testar para ver o nível do microfone.';};
    const toggle=el('button','soft-button mic-meter-toggle','Testar microfone');toggle.type='button';toggle.setAttribute('aria-pressed','false');
    toggle.onclick=async()=>{if(stream)return stop();try{const id=read('input');stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:id?{exact:id}:undefined,noiseSuppression:ctx.noise(),echoCancellation:true,autoGainControl:true}});const A=window.AudioContext||window.webkitAudioContext;audio=new A();const an=audio.createAnalyser();an.fftSize=1024;audio.createMediaStreamSource(stream).connect(an);const buf=new Float32Array(an.fftSize);toggle.textContent='Parar teste';toggle.setAttribute('aria-pressed','true');
      timer=setInterval(()=>{if(!node.isConnected)return stop();an.getFloatTimeDomainData(buf);let sum=0;for(const v of buf)sum+=v*v;const db=10*Math.log10(sum/buf.length+1e-12),p=pct(db),open=db>threshold();fill.style.width=p+'%';fill.classList.toggle('open',open);bar.setAttribute('aria-valuenow',String(Math.round(p)));label.textContent=open?'Sua voz passa pelo filtro.':'Abaixo do limiar: o microfone fica fechado.';},50);}catch{stop();label.textContent='Sem acesso ao microfone. Verifique a permissão do navegador.';}};
    document.getElementById('app-dialog')?.addEventListener('close',stop,{once:true});
    node.append(bar,toggle,label);return {node,mark:paintMark,stop};
  }
  function fields(container){
    const box=el('section','audio-settings');box.append(el('h3','','Entrada e saída de áudio'),el('p','muted','As alterações abaixo são aplicadas imediatamente neste aparelho.'));
    const input=el('select'),output=el('select'),mode=el('select'),status=el('p','muted');
    for(const [node,label] of [[input,'Dispositivo de entrada (microfone)'],[output,'Dispositivo de saída (fone ou alto-falante)'],[mode,'Redução de ruído adicional']]){const field=el('label','field',label);node.setAttribute('aria-label',label);field.append(node);box.append(field);}
    mode.append(
  new Option('Padrão (navegador)','browser'),
  new Option('Aprimorada · RNNoise','enhanced'),
  new Option('Agressiva · estilo Krisp','aggressive')
);mode.value=localStorage.getItem('orbita-noise-mode')||'enhanced';
    const setStatus=()=>status.textContent=!ctx.noise()?'Ative Supressão de ruído e salve o perfil para filtrar o microfone.':mode.value==='enhanced'?'Filtro de voz local (RNNoise) com noise gate pela sensibilidade. Em caso de incompatibilidade, usa o filtro do navegador.':mode.value==='aggressive'?'RNNoise com corte de graves mais alto e gate 6 dB mais rígido.':'Usando só a redução de ruído do navegador.';
    mode.onchange=async()=>{mode.disabled=true;localStorage.setItem('orbita-noise-mode',mode.value);meter.mark();try{await sync();setStatus();}catch{ctx.toast('Não foi possível atualizar o filtro. Tente novamente.');}finally{mode.disabled=false;}};
    // Sensibilidade do microfone
    const sensLabel=el('label','field','Sensibilidade do microfone');
    const sens=el('input');sens.type='range';sens.min='10';sens.max='100';sens.value=sensitivity();sens.setAttribute('aria-label','Sensibilidade do microfone');
    const sensVal=el('span','muted',sens.value+'%');
    sens.oninput=()=>{sensVal.textContent=sens.value+'%';localStorage.setItem('orbita-mic-sensitivity',sens.value);sync().catch(()=>{});meter.mark();};
    sens.onchange=async()=>{try{await sync();}catch{}};
    sensLabel.append(sens,sensVal);box.append(sensLabel);
    // Volume de entrada (aplicado no processamento do microfone) e volume geral de saída da chamada.
    const fader=(label,key,min,max,def,after)=>{const l=el('label','field',label),r=el('input'),v=el('span','muted');r.type='range';r.min=String(min);r.max=String(max);r.value=localStorage.getItem(key)||String(def);r.setAttribute('aria-label',label);v.textContent=r.value+'%';r.oninput=()=>{v.textContent=r.value+'%';localStorage.setItem(key,r.value);after();};l.append(r,v);box.append(l);};
    fader('Volume do microfone','orbita-mic-volume',0,200,100,()=>{if(!enhanced())localStorage.getItem('orbita-noise-mode')==='browser'&&ctx.toast?.('O volume do microfone funciona com a redução de ruído Aprimorada ou Agressiva.');sync().catch(()=>{});});
    fader('Volume de saída da chamada','orbita-output-volume',0,100,100,()=>window.dispatchEvent(new Event('orbita-output-volume')));
    const meter=micMeter(()=>gateThreshold(sens.value,mode.value));box.append(meter.node);

    async function refresh(){
      try{const devices=await navigator.mediaDevices?.enumerateDevices()||[];if(!box.isConnected)return;
        for(const [node,kind,key] of [[input,'audioinput','input'],[output,'audiooutput','output']]){node.replaceChildren(new Option('Padrão do sistema',''));const saved=read(key),choices=devices.filter(d=>d.kind===kind&&d.deviceId&&d.deviceId!=='default'&&d.deviceId!=='communications');for(const [index,d] of choices.entries())node.append(new Option(d.label||(key==='input'?'Microfone ':'Saída ')+(index+1),d.deviceId));if(saved&&!choices.some(d=>d.deviceId===saved))node.append(new Option('Dispositivo salvo · reconecte ou escolha outro',saved));node.value=saved;}
        input.disabled=!navigator.mediaDevices;output.disabled=!supportsOutput();if(output.disabled)output.title='Neste navegador, escolha a saída nas configurações do sistema.';
      }catch{status.textContent='Não foi possível listar os dispositivos. Verifique as permissões do microfone.';}
    }
    for(const [node,key,kind] of [[input,'input','audioinput'],[output,'output','audiooutput']])node.onchange=async()=>{
      const value=node.value,previous=read(key),room=ctx.room();node.disabled=true;
      try{if(room){await switchDevice(room,kind,value);if(ctx.room()!==room)throw Error('A chamada mudou. Escolha o dispositivo novamente.');}if(key==='output')await ctx.output(value);localStorage.setItem('orbita-audio-'+key,value);if(room)await sync(room);ctx.toast('Dispositivo de áudio atualizado.');}
      catch{if(room&&ctx.room()===room)await switchDevice(room,kind,previous).catch(()=>{});if(key==='output')await ctx.output(previous).catch(()=>{});node.value=previous;ctx.toast('Não foi possível usar esse dispositivo. Verifique a conexão e a permissão do navegador.');}
      finally{node.disabled=false;}
    };
    box.append(status);setStatus();if(!supportsOutput())box.append(el('p','muted','Este navegador usa a saída de áudio definida no sistema.'));
    box.append(button('Atualizar dispositivos',async()=>{let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:true});}finally{stream?.getTracks().forEach(t=>t.stop());}await refresh();}));
    container.append(box);refresh();const devicesAbort=new AbortController();navigator.mediaDevices?.addEventListener?.('devicechange',refresh,{signal:devicesAbort.signal});document.getElementById('app-dialog')?.addEventListener('close',()=>devicesAbort.abort(),{once:true});
  }
  return {fields,sync,connected,mixOptions,bind,ended,capture:()=>read('input')?{deviceId:{exact:read('input')}}:{},open:()=>ctx.dialog('Entrada e saída de áudio',fields)};
}
