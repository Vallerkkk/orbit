// AudioWorklet: PCM16/16 kHz, utterance boundaries and silence rejection.
class AstroRecorder extends AudioWorkletProcessor {
  constructor(){super();this.enabled=false;this.reset();this.port.onmessage=e=>{this.enabled=!!e.data.enabled;if(!this.enabled)this.reset();};}
  reset(){this.samples=[];this.phase=0;this.sum=0;this.count=0;this.quiet=0;this.voiced=0;}
  flush(){if(this.voiced>=3200&&this.samples.length>=4000){const pcm=Int16Array.from(this.samples);this.port.postMessage(pcm.buffer,[pcm.buffer]);}this.reset();}
  process(inputs){const input=inputs[0]?.[0];if(!this.enabled||!input)return true;
    for(const value of input){this.sum+=value;this.count++;this.phase+=16000;if(this.phase<sampleRate)continue;this.phase-=sampleRate;const v=this.sum/this.count;this.sum=0;this.count=0;
      const active=Math.abs(v)>.012;if(active){this.voiced++;this.quiet=0;}else this.quiet++;
      if(active||this.samples.length)this.samples.push(Math.max(-32768,Math.min(32767,Math.round(v*32767))));
      if(this.samples.length>=128000||(this.samples.length>=8000&&this.quiet>=11200))this.flush();
    }return true;
  }
}
registerProcessor('astro-recorder',AstroRecorder);
