let binary;
export function createNoiseProcessor(defaults={}){
  return {
    name:'orbita-rnnoise',processedTrack:undefined,
    async init({track, sensitivity=defaults.sensitivity??50, mode=defaults.mode??'enhanced', volume=defaults.volume??100}){
      try{
        const Audio=window.AudioContext||window.webkitAudioContext;
        this.context=new Audio({sampleRate:48000});
        if(!this.context.audioWorklet)throw Error('AudioWorklet indisponível');
        const [{RnnoiseWorkletNode},bytes]=await Promise.all([
          import('/static/vendor/rnnoise-0.4.1/index.js'),
          binary||(binary=fetch('/static/vendor/rnnoise-0.4.1/rnnoise.wasm').then(r=>{if(!r.ok)throw Error('Filtro indisponível');return r.arrayBuffer();}).catch(e=>{binary=null;throw e;})),
          this.context.audioWorklet.addModule('/static/vendor/rnnoise-0.4.1/worklet.js'),
        ]);
        if(this.cancelled)throw Error('Processamento cancelado');
        this.source=this.context.createMediaStreamSource(new MediaStream([track]));
        this.highpass=this.context.createBiquadFilter();
        this.highpass.type='highpass';
        this.highpass.frequency.value=mode==='aggressive'?120:80;
        this.highpass.Q.value=0.7;
        this.filter=new RnnoiseWorkletNode(this.context,{maxChannels:1,wasmBinary:bytes});
        // Sensibilidade = noise gate: abaixo do limiar o microfone fecha suavemente.
        this.gain=this.context.createGain();this.gain.gain.value=0;
        this.analyser=this.context.createAnalyser();this.analyser.fftSize=1024;
        this.destination=this.context.createMediaStreamDestination();
        this.input=this.context.createAnalyser();this.input.fftSize=1024;this.source.connect(this.input);
        this.source.connect(this.highpass);
        this.highpass.connect(this.filter);
        this.filter.connect(this.analyser);
        this.filter.connect(this.gain);
        // Volume de entrada do microfone (0–200%), depois do gate.
        this.volume=this.context.createGain();this.volume.gain.value=1;
        this.gain.connect(this.volume);this.volume.connect(this.destination);
        this.update({sensitivity,mode,volume});this.startGate();
        // iOS/Android interrompem o AudioContext (ligação, Siri, outra mídia) e ele fica suspenso:
        // com o contexto parado a faixa processada sai muda para todo mundo. Retoma sozinho.
        const context=this.context;this.onstate=()=>{if(this.context===context&&context.state!=='running'&&context.state!=='closed')context.resume().catch(()=>{});};context.addEventListener?.('statechange',this.onstate);
        await Promise.race([context.resume(),new Promise(resolve=>setTimeout(resolve,1500))]);
        if(this.cancelled)throw Error('Processamento cancelado');
        this.processedTrack=this.destination.stream.getAudioTracks()[0];
      }catch(error){await this.destroy();throw error;}
    },
    update({sensitivity=this.sensitivity??50,mode=this.mode??'enhanced',volume=this.micVolume??100}={}){
      this.sensitivity=sensitivity;this.mode=mode;this.micVolume=volume;
      if(this.volume)this.volume.gain.value=Math.max(0,Math.min(200,Number(volume)||0))/100;
      if(this.highpass)this.highpass.frequency.value=mode==='aggressive'?120:80;
      this.threshold=gateThreshold(sensitivity,mode);
    },
    level(){return this.lastLevel??-100;},
    startGate(){
      const buf=new Float32Array(this.analyser.fftSize);let open=false,hold=0;
      const tick=()=>{if(!this.context||!this.analyser)return;if(this.context.state==='suspended'||this.context.state==='interrupted')this.context.resume().catch(()=>{});
        // Contexto parado por mais de 2,5 s (sem gesto no iOS/Android, interrupção do sistema): a faixa enviada fica muda
        // para todo mundo enquanto a pessoa vê o microfone ligado. Avisa para voltar ao microfone direto.
        if(this.context.state!=='running'){this.stuckSince??=performance.now();if(!this.reported&&performance.now()-this.stuckSince>2500){this.reported=true;try{defaults.onBlocked?.(this);}catch{}}}else this.stuckSince=null;
        // Filtro que não processa (WASM bloqueado pela CSP, worklet com erro): entrada com som e saída em silêncio absoluto.
        if(this.input){this.input.getFloatTimeDomainData(buf);let s=0;for(const v of buf)s+=v*v;const inDb=10*Math.log10(s/buf.length+1e-12);
          if(inDb>-55&&this.lastLevel<-110){this.silentSince??=performance.now();if(!this.reported&&performance.now()-this.silentSince>3000){this.reported=true;try{defaults.onBlocked?.(this);}catch{}}}else if(this.lastLevel>=-110)this.silentSince=null;}
        this.analyser.getFloatTimeDomainData(buf);let sum=0;for(const v of buf)sum+=v*v;const db=10*Math.log10(sum/buf.length+1e-12);this.lastLevel=db;
        // Em aba oculta os timers ficam lentos; o gate fica aberto para não cortar a fala.
        const above=document.hidden||db>this.threshold;if(above){hold=12;}else if(hold>0)hold--;
        const next=above||hold>0;if(next!==open){open=next;const t=this.context.currentTime;this.gain.gain.cancelScheduledValues(t);this.gain.gain.setTargetAtTime(open?1:0,t,open?0.01:0.08);}
      };
      this.gateTimer=setInterval(tick,20);tick();
    },
    // O LiveKit chama restart ao trocar de microfone ou reabrir a faixa: mantém sensibilidade, modo e volume atuais.
    async restart(options){const keep={sensitivity:this.sensitivity,mode:this.mode,volume:this.micVolume};await this.destroy();this.cancelled=false;await this.init({...options,...Object.fromEntries(Object.entries(keep).filter(([,v])=>v!==undefined))});},
    blocked(){return !!this.context&&this.context.state!=='running';},
    async destroy(){
      this.cancelled=true;clearInterval(this.gateTimer);
      for(const node of [this.source,this.highpass,this.filter,this.analyser,this.gain,this.volume,this.destination]){try{node?.disconnect();}catch{}}
      try{this.filter?.destroy();this.filter?.port?.close();}catch{}
      this.processedTrack?.stop();this.processedTrack=undefined;
      const context=this.context;this.context=null;if(context&&context.state!=='closed')await context.close().catch(()=>{});
      this.source=this.highpass=this.filter=this.analyser=this.gain=this.volume=this.destination=null;
    },
  };
}
// 100% = sempre aberto; 10% = só fala forte passa. No modo agressivo o limiar sobe 6 dB.
// O padrão (50%) fica em -60 dBFS: o limiar antigo (-51 dBFS, -34 dBFS em 10%) cortava fala baixa
// de microfone de notebook/headset sem AGC, e a pessoa parecia muda mesmo com o microfone ligado.
export function gateThreshold(sensitivity=50,mode='enhanced'){const s=Math.max(10,Math.min(100,Number(sensitivity)||50));return (s>=100?-100:-80+(100-s)*0.4)+(mode==='aggressive'?6:0);}
