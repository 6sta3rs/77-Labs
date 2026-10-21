import { mkdir as ensureQaDirectory } from 'node:fs/promises';
await ensureQaDirectory(new URL('../.tmp/qa/', import.meta.url), { recursive: true });
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Run the real tracker, FFT averaging and renderer. GL records the controls
// delivered to the shader; pixel shape/choreography remain GPU/UI acceptance.
// Comparisons express direction, separation and timing, not an invented score.
const baselineIndex = process.argv.indexOf('--baseline');
const baseline = baselineIndex >= 0 ? process.argv[baselineIndex + 1] : undefined;
if (baselineIndex >= 0) assert.match(baseline ?? '', /^[a-f0-9]{7,40}$/i);
const root = new URL('../', import.meta.url);
const file = async path => baseline ? execFileSync('git', ['show', `${baseline}:${path}`], {
  cwd: fileURLToPath(root), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
}) : readFile(new URL(path, root), 'utf8');
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const transpile = code => ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const featureModule = moduleUrl(transpile(await file('src/lib/audio-features.ts')));
const { AudioFeatureTracker, quietFeatures } = await import(featureModule);
const { averageOrbSpectrum } = await import(moduleUrl(transpile(await file('src/lib/playback-meter.ts'))
  .replaceAll("'./audio-features'", JSON.stringify(featureModule))));
const rendererSource = await file('src/lib/voice-orb.ts');
const { VoiceOrbRenderer } = await import(moduleUrl(transpile(rendererSource)));
const variants = ['original', 'calm', 'storm', 'intonation'];
const checks = [], measurements = {};
const epsilon = 1e-5;
const check = (name, condition, detail) => checks.push({ name, passed: Boolean(condition), ...(detail === undefined ? {} : { detail }) });
const equal = (left, right, tolerance = epsilon) => left.length === right.length
  && left.every((value, index) => Number.isFinite(value) && Math.abs(value - right[index]) <= tolerance);
const magnitude = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
const isZero = values => values.every(value => Number.isFinite(value) && Math.abs(value) <= epsilon);
// Eight seconds gives even the retained 1.1 s legacy release more than seven
// time constants. Test a relative disappearance, not an arbitrary exact zero.
const decayed = (before, after) => after.every((value, index) => Number.isFinite(value)
  && Math.abs(value) <= Math.max(epsilon, Math.abs(before[index]) * .01));

let frameId = 0;
const callbacks = new Map();
globalThis.requestAnimationFrame = callback => { callbacks.set(++frameId, callback); return frameId; };
globalThis.cancelAnimationFrame = id => callbacks.delete(id);

function makeRenderer(variant, sensitivity = 1) {
  const values = {};
  const gl = new Proxy({}, { get: (_, name) => {
    if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => true;
    if (name === 'isContextLost') return () => false;
    if (name === 'getUniformLocation') return (_, key) => key;
    if (name === 'uniform1f' || name === 'uniform1i') return (key, value) => { values[key] = value; };
    if (/^uniform[234]fv$/.test(name)) return (key, value) => { values[key] = Array.from(value); };
    if (/^uniform[234]f$/.test(name)) return (key, ...value) => { values[key] = value; };
    if (String(name).startsWith('create')) return () => ({});
    if (/^[A-Z_]+$/.test(String(name))) return 1;
    return () => {};
  } });
  const canvas = { getContext: () => gl, dataset: {} };
  const renderer = new VoiceOrbRenderer(canvas);
  renderer.setVariant(variant); renderer.setSensitivity(sensitivity); renderer.setVoice('reactivity-fixture');
  return { renderer, values, canvas };
}
function input(renderer, item) {
  renderer.setLevel(item.level);
  renderer.setFeatures(item.features);
  renderer.setAudioBands?.(item.bands);
}
function snapshot(values) { return JSON.parse(JSON.stringify(values)); }
const bandsOf = values => values.reactiveBands ?? [0, 0, 0, 0];
const driveOf = values => values.reactiveDrive ?? values.level ?? 0;
const impulseOf = values => values.reactiveImpulse ?? values.turbulence ?? 0;
const responseOf = values => [driveOf(values), impulseOf(values), ...bandsOf(values)];
// Time and accumulated energy deliberately retain history. This vector checks
// only the instantaneous audio influence that sensitivity must eventually mute.
const activeOf = values => [values.level ?? 0, values.turbulence ?? 0, values.pitchStrength ?? 0, ...responseOf(values)];
function step(holder, item, seconds, rate = 30) {
  input(holder.renderer, item);
  for (let index = 0; index < Math.round(seconds * rate); index++) holder.renderer.draw(1 / rate);
  return snapshot(holder.values);
}

const sampleRate = 48000, sampleCount = 2048;
function fft(samples) {
  const count = samples.length, real = new Float64Array(count), imaginary = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    const phase = 2 * Math.PI * index / count;
    real[index] = samples[index] * (.42 - .5 * Math.cos(phase) + .08 * Math.cos(phase * 2));
  }
  for (let index = 1, reversed = 0; index < count; index++) {
    let bit = count >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) [real[index], real[reversed]] = [real[reversed], real[index]];
  }
  for (let width = 2; width <= count; width *= 2) {
    for (let start = 0; start < count; start += width) for (let offset = 0; offset < width / 2; offset++) {
      const angle = -2 * Math.PI * offset / width, cosine = Math.cos(angle), sine = Math.sin(angle);
      const left = start + offset, right = left + width / 2;
      const a = real[right] * cosine - imaginary[right] * sine;
      const b = real[right] * sine + imaginary[right] * cosine;
      real[right] = real[left] - a; imaginary[right] = imaginary[left] - b;
      real[left] += a; imaginary[left] += b;
    }
  }
  return Float32Array.from({ length: count / 2 }, (_, index) => 20 * Math.log10(Math.max(1e-14, Math.hypot(real[index], imaginary[index]) / count)));
}
function noiseAt(index) {
  let value = Math.imul(index + 1234567, 0x45d9f3b);
  value ^= value >>> 16; value = Math.imul(value, 0x45d9f3b); value ^= value >>> 16;
  return (value >>> 0) / 4294967296 * 2 - 1;
}
const tone = amplitude => time => Math.SQRT2 * amplitude * Math.sin(2 * Math.PI * 220 * time);
const noise = time => .3 * noiseAt(Math.round(time * sampleRate));
const speech = time => {
  const local = time % .3, envelope = .04 + .18 * Math.sin(Math.PI * local / .3) ** 2;
  const frequency = Math.floor(time / .3) % 2 ? 180 : 130;
  return envelope * (Math.sin(2 * Math.PI * frequency * time) + .35 * Math.sin(2 * Math.PI * frequency * 3 * time));
};
function measured(signal, tracker = new AudioFeatureTracker(), time = 0) {
  const samples = Float32Array.from({ length: sampleCount }, (_, index) => signal(time + index / sampleRate));
  const features = tracker.read(samples, fft(samples), sampleRate, 1 / 30);
  const bytes = Uint8Array.from(fft(samples.slice(0, 256)), value => Math.round(Math.max(0, Math.min(255, (value + 100) / 70 * 255))));
  return { level: Math.min(1, features.rms * 4), features, bands: averageOrbSpectrum(bytes, sampleRate) };
}
const silence = { level: 0, features: undefined, bands: undefined };
const quietTone = measured(tone(.06)), normalTone = measured(tone(.14)), loudTone = measured(tone(.22));
const noiseTracker = new AudioFeatureTracker();
let steadyNoise;
for (let frame = 0; frame < 8; frame++) steadyNoise = measured(noise, noiseTracker, frame / 30);
check('Actual feature tracker leaves broadband noise without an invented pitch', steadyNoise.features.pitchHz === null && steadyNoise.features.pitchConfidence === 0, steadyNoise.features);

// Isolate the four-band path while holding all legacy features and RMS fixed.
// FFT impulses have equal peak/all values; rounded averaging preserves their
// low/mid/high location instead of reducing them to a single loudness value.
const probes = [0, 6, 43].map(bin => {
  const spectrum = new Uint8Array(128); spectrum[bin] = 255;
  return { ...normalTone, bands: averageOrbSpectrum(spectrum, sampleRate) };
});
const speechTracker = new AudioFeatureTracker();
const speechFrames = Array.from({ length: 36 }, (_, frame) => measured(speech, speechTracker, frame / 30));
check('Speech fixture contains measured envelope or spectrum changes', speechFrames.some(item => item.features.envelopeModulation > 0 || item.features.spectralFlux > 0));

for (const variant of variants) {
  const holder = makeRenderer(variant);
  const idle = step(holder, silence, 1);
  check(`${variant}: silence keeps audio influence at zero and retains idle drift`, isZero(activeOf(idle)) && idle.time > 0, { active: activeOf(idle), time: idle.time });
  const beforeZeroTime = responseOf(idle).concat(idle.time, idle.energy, idle.level, idle.pitchStrength);
  input(holder.renderer, loudTone); holder.renderer.draw(0);
  const afterZeroTime = responseOf(holder.values).concat(holder.values.time, holder.values.energy, holder.values.level, holder.values.pitchStrength);
  check(`${variant}: dt=0 cannot advance phase or jump to a newly supplied audio target`, equal(beforeZeroTime, afterZeroTime), { before: beforeZeroTime, after: afterZeroTime });
  holder.renderer.dispose();

  const bandStates = probes.map(probe => {
    const target = makeRenderer(variant), state = step(target, probe, 3);
    target.renderer.dispose(); return state;
  });
  for (const [left, right] of [[0, 1], [1, 2], [0, 2]]) {
    const actualLeft = bandsOf(bandStates[left]), actualRight = bandsOf(bandStates[right]);
    check(`${variant}: equal-RMS band probes ${left}/${right} remain distinct at the shader`,
      !equal(actualLeft, actualRight) && magnitude(actualLeft) > 0 && magnitude(actualRight) > 0,
      { input: [probes[left].bands, probes[right].bands], actual: [actualLeft, actualRight], legacyLevels: [bandStates[left].level, bandStates[right].level] });
  }
  const normal = makeRenderer(variant), quiet = makeRenderer(variant), louder = makeRenderer(variant);
  const normalState = step(normal, normalTone, 3), quietState = step(quiet, quietTone, 3), loudState = step(louder, loudTone, 3);
  check(`${variant}: sustained audio preserves a nonzero drive instead of depending only on changes`, driveOf(normalState) > driveOf(idle), { idle: driveOf(idle), steady: driveOf(normalState) });
  check(`${variant}: louder measured audio gives more drive than a quiet signal`, driveOf(loudState) > driveOf(quietState) + epsilon,
    { input: [quietTone.level, loudTone.level], actual: [driveOf(quietState), driveOf(loudState)] });
  const earlyHolder = makeRenderer(variant), early = step(earlyHolder, normalTone, .2);
  measurements[variant] = { idle, quiet: quietState, normal: normalState, loud: loudState, early, probes: bandStates };
  earlyHolder.renderer.dispose(); quiet.renderer.dispose(); louder.renderer.dispose();

  const beforePause = driveOf(normalState);
  const release = step(normal, silence, 1 / 30);
  check(`${variant}: pause starts a smooth release rather than keeping or snapping the drive`, driveOf(release) > 0 && driveOf(release) < beforePause,
    { before: beforePause, after: driveOf(release) });
  const settled = step(normal, silence, 8);
  check(`${variant}: pause eventually removes drive, impulse, bands and voiced confidence`, decayed(activeOf(normalState), activeOf(settled)), { before: activeOf(normalState), after: activeOf(settled) });
  normal.renderer.dispose();

  const voiceToNoise = makeRenderer(variant);
  const voiced = step(voiceToNoise, normalTone, 3), unvoiced = step(voiceToNoise, steadyNoise, 3);
  check(`${variant}: broadband noise releases previously voiced pitch confidence`, (unvoiced.pitchStrength ?? 0) < (voiced.pitchStrength ?? 0), { voiced: voiced.pitchStrength, noise: unvoiced.pitchStrength });
  voiceToNoise.renderer.dispose();

  const pulseHolder = makeRenderer(variant);
  step(pulseHolder, silence, .3);
  let peakDrive = 0, peakImpulse = 0;
  for (const item of speechFrames) {
    input(pulseHolder.renderer, item); pulseHolder.renderer.draw(1 / 30);
    peakDrive = Math.max(peakDrive, driveOf(pulseHolder.values));
    peakImpulse = Math.max(peakImpulse, impulseOf(pulseHolder.values));
  }
  check(`${variant}: measured speech attacks reach the shader as more impulse than a settled tone`, peakDrive > 0 && peakImpulse > impulseOf(normalState) + epsilon,
    { speechDrive: peakDrive, speechImpulse: peakImpulse, settledImpulse: impulseOf(normalState) });
  pulseHolder.renderer.dispose();

  const muted = makeRenderer(variant);
  const beforeMute = step(muted, loudTone, 3); muted.renderer.setSensitivity(0);
  const mutedState = step(muted, loudTone, 10);
  check(`${variant}: zero sensitivity eventually silences new controls and legacy level/pitch`, decayed(activeOf(beforeMute), activeOf(mutedState)), { before: activeOf(beforeMute), after: activeOf(mutedState) });
  muted.renderer.dispose();
  const halfSensitive = makeRenderer(variant, .5), fullySensitive = makeRenderer(variant, 1);
  const halfState = step(halfSensitive, quietTone, 3), fullState = step(fullySensitive, quietTone, 3);
  check(`${variant}: intermediate sensitivity gives a smaller positive response`, driveOf(halfState) > 0 && driveOf(halfState) < driveOf(fullState) - epsilon,
    { half: driveOf(halfState), full: driveOf(fullState) });
  halfSensitive.renderer.dispose(); fullySensitive.renderer.dispose();

  const invalid = makeRenderer(variant), beforeInvalid = step(invalid, normalTone, 1);
  const invalidInput = { level: NaN, bands: [NaN, Infinity, -1, NaN],
    features: { ...quietFeatures(), turbulence: NaN, spectralCentroidHz: Infinity, spectralFlux: NaN,
      envelopeModulation: Infinity, pitchHz: -100, pitchConfidence: 1 } };
  const invalidState = step(invalid, invalidInput, 10);
  const finiteControls = Object.values(invalidState).flat().every(value => Number.isFinite(value));
  check(`${variant}: invalid audio values release to silence without poisoning shader uniforms`, finiteControls && decayed(activeOf(beforeInvalid), activeOf(invalidState)),
    { finiteControls, before: activeOf(beforeInvalid), after: activeOf(invalidState), pitch: invalidState.pitch, time: invalidState.time });
  invalid.renderer.dispose();

  const cadence = [30, 60, 120].map(rate => {
    const target = makeRenderer(variant), state = step(target, normalTone, .2, rate);
    target.renderer.dispose(); return { rate, state, response: [state.level ?? 0, driveOf(state), ...bandsOf(state)] };
  });
  check(`${variant}: the same attack duration is independent of update cadence`, cadence.every(item => equal(item.response, cadence[0].response, 1e-4)), cadence.map(({ rate, response }) => ({ rate, response })));

  const refresh = [];
  for (const hz of [60, 75, 120, 144]) {
    const target = makeRenderer(variant); input(target.renderer, normalTone); target.renderer.start();
    for (let frame = 0; frame <= hz; frame++) {
      const pending = [...callbacks.values()]; callbacks.clear();
      for (const callback of pending) callback(1000 + frame * 1000 / hz);
    }
    refresh.push({ hz, frames: Number(target.canvas.dataset.frames ?? 0), drive: driveOf(target.values) });
    target.renderer.dispose();
  }
  check(`${variant}: display refresh preserves the 30 Hz shader clock without leaked callbacks`, refresh.every(item => item.frames >= 30 && item.frames <= 31) && callbacks.size === 0, refresh);
}

const calmAttack = driveOf(measurements.calm.early) / Math.max(epsilon, driveOf(measurements.calm.normal));
const stormAttack = driveOf(measurements.storm.early) / Math.max(epsilon, driveOf(measurements.storm.normal));
check('Style character: Calm rises more slowly than Storm for the same measured attack', calmAttack < stormAttack - epsilon, { calmAttack, stormAttack });

const result = { revision: baseline ?? 'working-tree', rendererSha256: createHash('sha256').update(rendererSource).digest('hex'),
  limits: 'Records real renderer uniforms with stub GL; visual character and GPU compilation require the product acceptance.',
  passed: checks.filter(item => item.passed).length, total: checks.length, checks };
// Keep all assertion evidence, with numeric vectors on one line for comparison.
const serialized = JSON.stringify(result, null, 2).replace(/\[\n\s*((?:(?:-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|null),\n\s*)*(?:-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|null))\n\s*\]/g,
  (_, values) => `[${values.replace(/,\n\s*/g, ', ')}]`) + '\n';
if (process.argv.includes('--write-before')) {
  assert.equal(baseline, '86384eb', 'The before report must use the explicitly pinned baseline');
  await writeFile(new URL('.tmp/qa/orb-reactivity-before.json', root), serialized, 'utf8');
}
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0) {
  const path = process.argv[outputIndex + 1];
  assert.ok(path && !path.startsWith('--'), '--output needs a JSON path');
  await writeFile(path, serialized, 'utf8');
  console.log(`${result.passed}/${result.total} — ${path}`);
} else if (process.argv.includes('--summary')) console.log(`Orb reactivity: ${result.passed}/${result.total} checks passed`);
else console.log(serialized.trimEnd());
if (checks.some(item => !item.passed)) process.exitCode = 1;
