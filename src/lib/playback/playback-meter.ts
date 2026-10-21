import { AudioFeatureTracker, quietFeatures, type AudioFeatures } from './audio-features';
export type { AudioFeatures } from './audio-features';
/** Source-page FFT averages: low 0–200 Hz, mid 200–2000 Hz, high 2000–20000 Hz, all bins. */
export type OrbAudioBands = readonly [low: number, mid: number, high: number, all: number];
export type PlaybackActivity = { playing: boolean; level: number; bands: number[]; orbAudio: OrbAudioBands; available: boolean; voiceId?: string; features?: AudioFeatures };
export const quietActivity = (): PlaybackActivity => ({ playing: false, level: 0, bands: Array(24).fill(0), orbAudio: [0, 0, 0, 0], available: false, features: quietFeatures() });

/** Rounded inclusive endpoints match the source. Clamp rates below 40 kHz safely to Nyquist. */
export function averageOrbSpectrum(spectrum: Uint8Array, sampleRate: number): OrbAudioBands {
  const count = spectrum.length;
  if (!count || !Number.isFinite(sampleRate) || sampleRate <= 0) return [0, 0, 0, 0];
  const bin = (hz: number) => Math.min(count - 1, Math.max(0, Math.round(hz / (sampleRate / 2) * count)));
  const mean = (low: number, high: number) => {
    let sum = 0;
    for (let index = low; index <= high; index++) sum += spectrum[index];
    return sum / (high - low + 1) / 255;
  };
  return [mean(0, bin(200)), mean(bin(200), bin(2000)), mean(bin(2000), bin(20000)), mean(0, count - 1)];
}

/** One graph per player element. The analyser is a side branch; sound has a direct output. */
export class PlaybackMeter {
  private context?: AudioContext;
  private source?: MediaElementAudioSourceNode;
  private analyser?: AnalyserNode;
  private orbAnalyser?: AnalyserNode;
  private orbSpectrum = new Uint8Array(128);
  // The renderer holds this reference: FFT may update each animation frame
  // without increasing the 30 Hz Svelte/YIN reporting cadence.
  private orbAudio: [number, number, number, number] = [0, 0, 0, 0];
  private samples = new Float32Array(2048);
  private spectrum = new Uint8Array(1024);
  private decibels = new Float32Array(1024);
  private features = new AudioFeatureTracker();
  private raf = 0;
  private last = 0;
  private level = 0;
  private active = false;
  private unavailable = false;
  private disposed = false;
  private preparing?: Promise<void>;
  private visibilityChanged = () => {
    if (!this.active || !document.hidden) return;
    this.level = 0; this.orbAudio.fill(0); this.features.reset();
    this.report({ ...quietActivity(), playing: !this.audio.paused && !this.audio.ended,
      available: !!this.analyser && !this.unavailable && this.context?.state === 'running' });
  };
  constructor(private audio: HTMLAudioElement, private report: (activity: PlaybackActivity) => void) {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.visibilityChanged);
  }
  prepare(): Promise<void> {
    if (this.unavailable || this.disposed) return Promise.resolve();
    if (!this.preparing) this.preparing = this.connect().finally(() => { this.preparing = undefined; });
    return this.preparing;
  }
  private async connect() {
    try {
      this.context ??= new AudioContext();
      // Never take ownership of the media output before the context can render.
      // A suspended/unavailable analyser must not hold up native playback or mute it.
      if (this.context.state !== 'running') await this.context.resume();
      if (this.disposed || this.context.state !== 'running') return;
      if (!this.source) {
        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = 2048; this.analyser.smoothingTimeConstant = 0;
        this.source = this.context.createMediaElementSource(this.audio);
        this.source.connect(this.context.destination);
        this.source.connect(this.analyser);
      }
      if (!this.orbAnalyser) {
        const analyser = this.context.createAnalyser();
        // Homepage carousel hook: FFT 256 and frequency smoothing 0.8.
        // Keep the existing 2048/0 analyser and the single direct audio output.
        analyser.fftSize = 256; analyser.smoothingTimeConstant = .8;
        this.source.connect(analyser); this.orbAnalyser = analyser;
      }
    } catch { this.unavailable = !this.source; }
  }
  start() {
    if (this.active) return;
    this.active = true; this.last = 0;
    const frame = (now: number) => {
      if (!this.active) return;
      const playing = !this.audio.paused && !this.audio.ended;
      let available = !!this.analyser && !this.unavailable && this.context?.state === 'running';
      if (this.orbAnalyser && available && playing && !document.hidden) {
        try {
          this.orbAnalyser.getByteFrequencyData(this.orbSpectrum);
          const bands = averageOrbSpectrum(this.orbSpectrum, this.context?.sampleRate || 48000);
          for (let index = 0; index < 4; index++) this.orbAudio[index] = bands[index];
        } catch { this.orbAudio.fill(0); }
      } else this.orbAudio.fill(0);
      if (!this.last || now - this.last >= 1000 / 30) {
        const dt = this.last ? Math.max(0, (now - this.last) / 1000) : 1 / 30;
        this.last = now;
        const analyser = this.analyser, bands = Array<number>(24).fill(0);
        let features = quietFeatures();
        if (analyser && available && playing && !document.hidden) {
          try {
            analyser.getFloatTimeDomainData(this.samples); analyser.getByteFrequencyData(this.spectrum); analyser.getFloatFrequencyData(this.decibels);
            features = this.features.read(this.samples, this.decibels, this.context?.sampleRate || 48000, dt);
            const measured = Math.min(1, features.rms * 4);
            this.level += (measured - this.level) * (1 - Math.exp(-dt / (measured > this.level ? .035 : .12)));
            if (!measured) this.level = 0;
            const nyquist = (this.context?.sampleRate || 48000) / 2;
            for (let index = 0; index < bands.length; index++) {
              const low = Math.floor(60 * (Math.min(12000, nyquist) / 60) ** (index / bands.length) / nyquist * this.spectrum.length);
              const high = Math.min(this.spectrum.length, Math.max(low + 1, Math.ceil(60 * (Math.min(12000, nyquist) / 60) ** ((index + 1) / bands.length) / nyquist * this.spectrum.length)));
              let peak = 0; for (let bin = low; bin < high; bin++) peak = Math.max(peak, this.spectrum[bin] / 255);
              bands[index] = measured ? peak : 0;
            }
          } catch { available = false; this.level = 0; this.orbAudio.fill(0); bands.fill(0); features = quietFeatures(); this.features.reset(); }
        } else { this.level = 0; this.features.reset(); }
        this.report({ playing, level: this.level, bands, orbAudio: this.orbAudio, available, features });
      }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }
  stop() {
    this.active = false; cancelAnimationFrame(this.raf); this.level = 0; this.orbAudio.fill(0); this.features.reset();
    this.report({ ...quietActivity(), available: !this.disposed && !!this.analyser && !this.unavailable && this.context?.state === 'running' });
  }
  dispose() {
    this.disposed = true;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.stop(); this.source?.disconnect(); this.analyser?.disconnect(); this.orbAnalyser?.disconnect();
    void this.context?.close().catch(() => {});
  }
}
