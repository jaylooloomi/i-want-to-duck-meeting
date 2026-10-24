// Downmix and resample to PCM16/16k. The output is silence; microphone is never played back.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.phase = 0; this.sum = 0; this.count = 0; this.samples = [];
    this.port.onmessage = ({ data }) => { if (data === 'flush') { this.flush(); this.port.postMessage({ flushed:true }); } };
  }
  flush() {
    if (!this.samples.length) return;
    const pcm = new Int16Array(this.samples); this.samples = [];
    this.port.postMessage({ pcm:pcm.buffer }, [pcm.buffer]);
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] / channels.length;
      this.sum += value; this.count++; this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        this.samples.push(Math.round(Math.max(-1, Math.min(1, this.sum / this.count)) * 32767));
        this.sum = 0; this.count = 0;
        if (this.samples.length >= 4000) this.flush();
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
