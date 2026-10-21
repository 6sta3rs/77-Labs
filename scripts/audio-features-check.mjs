import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';

// Test the actual TypeScript helper without building the UI or starting audio hardware.
const api = {};
const source = readFileSync(new URL('../src/lib/audio-features.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function('exports', compiled)(api);
const { AudioFeatureTracker, quietFeatures } = api;
const size = 2048, sampleRate = 48000, frameRate = 30;
let assertions = 0;
function check(condition, message) { assert(condition, message); assertions++; }

/** Radix-2 FFT with the Web Audio AnalyserNode Blackman window.
 * This independently supplies float dB inputs, not hand-picked feature values.
 * It does not test a browser's actual AnalyserNode or audio output.
 */
function spectrum(samples) {
  const length = samples.length;
  const real = new Float64Array(length), imaginary = new Float64Array(length);
  for (let index = 0; index < length; index++) {
    const phase = 2 * Math.PI * index / length;
    real[index] = samples[index] * (.42 - .5 * Math.cos(phase) + .08 * Math.cos(2 * phase));
  }
  for (let index = 1, reversed = 0; index < length; index++) {
    let bit = length >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) [real[index], real[reversed]] = [real[reversed], real[index]];
  }
  for (let width = 2; width <= length; width *= 2) {
    const angle = -2 * Math.PI / width;
    for (let start = 0; start < length; start += width) {
      for (let offset = 0; offset < width / 2; offset++) {
        const cosine = Math.cos(angle * offset), sine = Math.sin(angle * offset);
        const left = start + offset, right = left + width / 2;
        const realPart = real[right] * cosine - imaginary[right] * sine;
        const imaginaryPart = real[right] * sine + imaginary[right] * cosine;
        real[right] = real[left] - realPart; imaginary[right] = imaginary[left] - imaginaryPart;
        real[left] += realPart; imaginary[left] += imaginaryPart;
      }
    }
  }
  return Float32Array.from({ length: length / 2 }, (_, index) =>
    20 * Math.log10(Math.max(1e-14, Math.hypot(real[index], imaginary[index]) / length)));
}

let randomSeed = 1234567;
function random() {
  randomSeed ^= randomSeed << 13; randomSeed ^= randomSeed >>> 17; randomSeed ^= randomSeed << 5;
  return (randomSeed >>> 0) / 4294967296 * 2 - 1;
}
const signals = {
  sine: time => .2 * Math.sin(2 * Math.PI * 220 * time),
  chirp: time => .2 * Math.sin(2 * Math.PI * (110 * time + 80 * time * time)),
  noise: () => .2 * random(),
  modulated: time => {
    const phase = 2 * Math.PI * (145 * time - 35 / (2 * Math.PI * 1.8) * Math.cos(2 * Math.PI * 1.8 * time));
    const envelope = .08 + .12 * (.5 + .5 * Math.sin(2 * Math.PI * 3.7 * time));
    return envelope * (.6 * Math.sin(phase) + .3 * Math.sin(phase * 2) + .1 * Math.sin(phase * 3));
  },
};
const normalized = ['spectralFlux', 'spectralFlatness', 'envelopeModulation', 'pitchConfidence', 'pitchChange', 'turbulence'];
const mean = (rows, name) => rows.reduce((sum, row) => sum + row[name], 0) / rows.length;
const stats = {}, benchmarkFrames = [];

for (const [name, signal] of Object.entries(signals)) {
  const tracker = new AudioFeatureTracker(), rows = [];
  for (let frame = 0; frame < 60; frame++) {
    const samples = Float32Array.from({ length: size }, (_, index) => signal(frame / frameRate + index / sampleRate));
    const decibels = spectrum(samples);
    const features = tracker.read(samples, decibels, sampleRate, 1 / frameRate);
    for (const field of normalized) check(Number.isFinite(features[field]) && features[field] >= 0 && features[field] <= 1, `${name}: ${field} outside 0..1`);
    check(Number.isFinite(features.rms) && features.rms > 0, `${name}: invalid RMS`);
    check(Number.isFinite(features.spectralCentroidHz), `${name}: invalid centroid`);
    rows.push(features);
    if (name === 'sine') benchmarkFrames.push([samples, decibels]);
  }
  const settled = rows.slice(5);
  const pitches = settled.filter(row => row.pitchHz !== null).map(row => row.pitchHz);
  stats[name] = {
    turbulence: mean(settled, 'turbulence'), spectralFlux: mean(settled, 'spectralFlux'),
    flatness: mean(settled, 'spectralFlatness'), envelopeModulation: mean(settled, 'envelopeModulation'),
    voicedFrames: pitches.length, pitchMin: pitches.length ? Math.min(...pitches) : null,
    pitchMax: pitches.length ? Math.max(...pitches) : null,
  };
  if (name === 'sine') {
    check(settled.every(row => row.pitchHz && Math.abs(row.pitchHz - 220) < 2), 'Steady 220 Hz pitch must remain accurate');
    check(stats[name].turbulence < .03, 'Steady tone must remain calm');
    check(Math.abs(mean(settled, 'spectralCentroidHz') - 220) < 30, 'Steady tone centroid must be near 220 Hz');
  }
  if (name === 'noise') {
    check(settled.every(row => row.pitchHz === null && row.pitchConfidence === 0), 'Noise must not invent a voiced pitch');
    check(stats[name].flatness > .7, 'Broadband noise must have high flatness');
  }
  assert.deepEqual(tracker.read(new Float32Array(size), new Float32Array(size / 2), sampleRate), quietFeatures()); assertions++;
  const [samples, decibels] = benchmarkFrames[0];
  check(tracker.read(samples, decibels, sampleRate).spectralFlux === 0, 'Silence must clear the previous spectrum');
}

for (const name of ['chirp', 'noise', 'modulated']) {
  check(stats[name].turbulence > stats.sine.turbulence * 8, `${name} must respond more strongly than a steady tone`);
}
check(stats.chirp.spectralFlux > stats.sine.spectralFlux * 8, 'Pitch sweep must produce spectral change');
check(stats.modulated.envelopeModulation > stats.sine.envelopeModulation * 4, 'Amplitude modulation must produce envelope change');

// Pure gain changes should not masquerade as changing spectral shape.
{
  const tracker = new AudioFeatureTracker();
  const samples = Float32Array.from({ length: size }, (_, index) => signals.sine(index / sampleRate));
  tracker.read(samples, spectrum(samples), sampleRate);
  const quieter = samples.map(value => value * .5);
  const result = tracker.read(quieter, spectrum(quieter), sampleRate);
  check(result.spectralFlux < .00001, 'Normalized flux must reject a pure gain change');
  check(result.envelopeModulation > .45, 'Envelope must preserve an actual gain change');
}

const pitchCases = [];
for (const rate of [44100, 48000]) {
  for (const hz of [70, 110, 220, 440, 760]) {
    const samples = Float32Array.from({ length: size }, (_, index) => .2 * Math.sin(2 * Math.PI * hz * index / rate));
    const result = new AudioFeatureTracker().read(samples, spectrum(samples), rate);
    check(result.pitchHz !== null && Math.abs(result.pitchHz - hz) / hz < .02, `${rate} Hz sample rate: ${hz} Hz pitch outside 2% tolerance`);
    check(result.pitchConfidence >= .85, 'Clean voiced test must have sufficient periodicity');
    pitchCases.push({ sampleRate: rate, expectedHz: hz, measuredHz: Number(result.pitchHz.toFixed(3)) });
  }
}

// Timing is informational: no hardware-dependent pass threshold.
const benchmark = new AudioFeatureTracker();
const started = performance.now();
for (let index = 0; index < 1000; index++) {
  const [samples, decibels] = benchmarkFrames[index % benchmarkFrames.length];
  benchmark.read(samples, decibels, sampleRate, 1 / frameRate);
}
const meanFeatureMs = (performance.now() - started) / 1000;
console.log(JSON.stringify({ pass: true, assertions, stats, pitchCases, meanFeatureMs,
  scope: 'Synthetic signal processing only; browser analyser, shader, audio output and emotion recognition are not tested.' }, null, 2));
