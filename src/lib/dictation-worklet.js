/* Raw PCM16 LE mono; no WAV/WebM header and no AEC prefix. */
class DictationPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.frameSize = Math.max(128, Math.round(sampleRate / 10)); this.samples = new Float32Array(this.frameSize); this.used = 0;
    this.port.onmessage = event => { if (event.data?.type === 'flush') { this.flush(); this.port.postMessage({ type: 'flushed' }); } };
  }
  flush() {
    if (!this.used) return;
    const buffer = new ArrayBuffer(this.used * 2), view = new DataView(buffer); let energy = 0;
    for (let index = 0; index < this.used; index++) { const sample = this.samples[index]; energy += sample * sample; view.setInt16(index * 2, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true); }
    this.port.postMessage({ type: 'pcm', buffer, rms: Math.sqrt(energy / this.used) }, [buffer]); this.used = 0;
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const channels = inputs[0]; if (!channels?.length) return true;
    for (let index = 0; index < channels[0].length; index++) {
      let value = 0; for (const channel of channels) value += Number.isFinite(channel[index]) ? channel[index] : 0;
      this.samples[this.used++] = Math.max(-1, Math.min(1, value / channels.length)); if (this.used === this.frameSize) this.flush();
    }
    return true;
  }
}
registerProcessor('seventy-seven-dictation-pcm', DictationPcmProcessor);
