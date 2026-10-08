// Streaming area-average conversion to mono 16 kHz. Carries fractional samples
// across render blocks so 44.1 kHz input does not drift or drop boundary samples.
class PCMProcessor extends AudioWorkletProcessor {
  constructor(){super();this.ratio=sampleRate/16000;this.area=0;this.weight=0;this.output=[];}
  process(inputs){
    const input=inputs[0]?.[0];if(!input)return true;
    for(const value of input){
      let remaining=1;
      while(remaining>0.000001){
        const take=Math.min(remaining,this.ratio-this.weight);
        this.area+=value*take;this.weight+=take;remaining-=take;
        if(this.weight>=this.ratio-0.000001){
          const sample=Math.max(-1,Math.min(1,this.area/this.ratio));
          this.output.push(sample<0?Math.round(sample*32768):Math.round(sample*32767));
          this.area=0;this.weight=0;
          if(this.output.length===1024){const pcm=new ArrayBuffer(2048);const view=new DataView(pcm);this.output.forEach((s,i)=>view.setInt16(i*2,s,true));this.port.postMessage(pcm,[pcm]);this.output=[];}
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture',PCMProcessor);
