/** Acoustic measurements only: none of these fields estimates an emotion.
 * Definitions: https://meyda.js.org/audio-features
 * Analyser dB/windowing: https://www.w3.org/TR/webaudio-1.1/#fft-windowing-and-smoothing-over-time
 */
export type AudioFeatures = {
  rms: number
  spectralFlux: number
  spectralFlatness: number
  spectralCentroidHz: number
  envelopeModulation: number
  pitchHz: number | null
  pitchConfidence: number
  pitchChange: number
  /** A visualization mix of spectral/envelope/pitch changes, not a scientific unit. */
  turbulence: number
}

export const quietFeatures = (): AudioFeatures => ({ rms: 0, spectralFlux: 0, spectralFlatness: 0,
  spectralCentroidHz: 0, envelopeModulation: 0, pitchHz: null, pitchConfidence: 0, pitchChange: 0, turbulence: 0 })
const unit = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))

/** Reuses buffers. Spectra are float dB from AnalyserNode (Blackman window, no averaging).
 * Flux is L1 distance between normalized magnitude spectra / 2. Flatness uses magnitudes.
 * Pitch uses a small YIN-style cumulative mean normalized difference estimator, 65–800 Hz.
 * It deliberately returns null for uncertain/unvoiced frames; no F0 is invented for noise.
 */
export class AudioFeatureTracker {
  private previous = new Float32Array(0)
  private magnitudes = new Float32Array(0)
  private downsampled = new Float32Array(1024)
  private difference = new Float32Array(512)
  private previousRms: number | null = null
  private previousPitch: number | null = null
  private initialized = false

  reset() { this.previous.fill(0); this.previousRms = null; this.previousPitch = null; this.initialized = false }

  private pitch(samples: Float32Array, sampleRate: number): { hz: number | null; confidence: number } {
    const stride = Math.max(1, Math.floor(sampleRate / 12000))
    const rate = sampleRate / stride
    const length = Math.min(this.downsampled.length, Math.floor(samples.length / stride))
    let mean = 0
    for (let index = 0; index < length; index++) {
      let value = 0
      // A short box filter before decimation limits high-frequency aliasing.
      for (let offset = 0; offset < stride; offset++) value += samples[index * stride + offset]
      this.downsampled[index] = value / stride; mean += this.downsampled[index]
    }
    mean /= Math.max(1, length)
    for (let index = 0; index < length; index++) this.downsampled[index] -= mean
    const maxLag = Math.min(Math.floor(rate / 65), Math.floor(length / 2) - 1, this.difference.length - 2)
    const minLag = Math.max(2, Math.floor(rate / 800))
    const window = length - maxLag - 1
    if (maxLag <= minLag || window < 64) return { hz: null, confidence: 0 }
    let cumulative = 0
    this.difference[0] = 1
    for (let lag = 1; lag <= maxLag + 1; lag++) {
      let sum = 0
      for (let index = 0; index < window; index++) {
        const delta = this.downsampled[index] - this.downsampled[index + lag]
        sum += delta * delta
      }
      cumulative += sum
      this.difference[lag] = cumulative > 1e-12 ? sum * lag / cumulative : 1
    }
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (this.difference[lag] >= .15) continue
      while (lag < maxLag && this.difference[lag + 1] < this.difference[lag]) lag++
      const left = this.difference[lag - 1], center = this.difference[lag], right = this.difference[lag + 1]
      const denominator = left - 2 * center + right
      const correction = Math.abs(denominator) > 1e-9 ? Math.max(-.5, Math.min(.5, .5 * (left - right) / denominator)) : 0
      const hz = rate / (lag + correction)
      return hz >= 65 && hz <= 800 ? { hz, confidence: unit(1 - center) } : { hz: null, confidence: 0 }
    }
    return { hz: null, confidence: 0 }
  }

  read(samples: Float32Array, decibels: Float32Array, sampleRate: number, dt = 1 / 30): AudioFeatures {
    let power = 0
    for (const value of samples) power += value * value
    const rms = Math.sqrt(power / Math.max(1, samples.length))
    // -60 dBFS gate: no stale spectral memory or pitch through silence.
    if (!Number.isFinite(rms) || rms < .001 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
      this.reset(); return quietFeatures()
    }
    if (this.previous.length !== decibels.length) {
      this.previous = new Float32Array(decibels.length); this.magnitudes = new Float32Array(decibels.length); this.initialized = false
    }
    const binHz = sampleRate / (decibels.length * 2)
    const low = Math.max(1, Math.ceil(60 / binHz))
    const high = Math.min(decibels.length, Math.floor(Math.min(10000, sampleRate / 2) / binHz) + 1)
    let total = 0, weighted = 0, logarithms = 0
    for (let bin = low; bin < high; bin++) {
      const magnitude = Number.isFinite(decibels[bin]) ? Math.pow(10, decibels[bin] / 20) : 0
      this.magnitudes[bin] = magnitude
      total += magnitude; weighted += magnitude * bin * binHz
      logarithms += Math.log(Math.max(1e-12, magnitude))
    }
    if (total < 1e-10 || high <= low) { this.reset(); return quietFeatures() }
    let distance = 0
    for (let bin = low; bin < high; bin++) {
      const normalized = this.magnitudes[bin] / total
      if (this.initialized) distance += Math.abs(normalized - this.previous[bin])
      this.previous[bin] = normalized
    }
    const frameScale = (1 / 30) / Math.max(1 / 120, Math.min(.25, dt))
    const spectralFlux = unit(distance * .5 * frameScale)
    const spectralFlatness = unit(Math.exp(logarithms / (high - low)) / (total / (high - low)))
    const envelopeModulation = this.previousRms === null ? 0 : unit(Math.abs(rms - this.previousRms) / Math.max(.02, rms, this.previousRms) * frameScale)
    const pitch = spectralFlatness < .65 ? this.pitch(samples, sampleRate) : { hz: null, confidence: 0 }
    const pitchChange = pitch.hz && this.previousPitch ? unit(Math.abs(Math.log2(pitch.hz / this.previousPitch)) * 4 * frameScale) : 0
    const turbulence = unit(spectralFlux * 4 + envelopeModulation * 1.2 + pitchChange * .25 + spectralFlatness * .1)
    this.previousRms = rms; this.previousPitch = pitch.hz; this.initialized = true
    return { rms, spectralFlux, spectralFlatness, spectralCentroidHz: weighted / total,
      envelopeModulation, pitchHz: pitch.hz, pitchConfidence: pitch.confidence, pitchChange, turbulence }
  }
}
