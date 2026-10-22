import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = await readFile(new URL('../../src/lib/playback/voice-orb.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { VoiceOrbRenderer, orbPreviewFrame, orbPreviewIdentity, voiceIdentity, orbPalettes, setOrbPalette } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const checks = [];
const check = (name, condition, detail) => checks.push({ name, passed: Boolean(condition), detail });
let nextId = 0;
const frames = new Map();
globalThis.requestAnimationFrame = callback => { frames.set(++nextId, callback); return nextId; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
let audioCreated = 0;
globalThis.AudioContext = globalThis.Audio = class {
  constructor() { audioCreated++; throw new Error('A visual preview must not create audio objects'); }
};
function create(preview, variant = 'original', voiceId = 'settings-preview-test') {
  const values = {};
  const allocations = {}, metrics = { contextRequests: 0, allocations };
  const gl = new Proxy({}, { get: (_, name) => {
    if (name === 'isContextLost') return () => false;
    if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => true;
    if (name === 'getUniformLocation') return (_, key) => key;
    if (name === 'uniform1f' || name === 'uniform1i') return (key, value) => { values[key] = value; };
    if (/^uniform[234]fv$/.test(name)) return (key, value) => { values[key] = Array.from(value); };
    if (/^uniform[234]f$/.test(name)) return (key, ...value) => { values[key] = value; };
    if (String(name).startsWith('create')) return () => { allocations[name] = (allocations[name] ?? 0) + 1; return {}; };
    if (/^[A-Z_]+$/.test(String(name))) return 1;
    return () => {};
  } });
  const canvas = { getContext: () => { metrics.contextRequests++; return gl; }, dataset: {} };
  const renderer = preview === undefined ? new VoiceOrbRenderer(canvas) : new VoiceOrbRenderer(canvas, undefined, preview);
  renderer.setVoice(voiceId); renderer.setVariant(variant);
  renderer.setLevel(0); renderer.setFeatures(); renderer.setAudioBands();
  return { renderer, values, canvas, metrics };
}
function advance(holder, count) { for (let frame = 0; frame < count; frame++) holder.renderer.draw(1 / 30); }
const snapshot = values => JSON.parse(JSON.stringify(values));
const equal = (left, right, tolerance = 1e-7) => left.length === right.length && left.every((value, index) => Number.isFinite(value) && Math.abs(value - right[index]) <= tolerance);
const bounded = values => values.every(value => Number.isFinite(value) && value >= -1e-7 && value <= 1 + 1e-7);
const palette = values => [...(values.darkColor ?? []), ...(values.midColor ?? []), ...(values.lightColor ?? [])];
const controls = values => [values.level ?? 0, values.pitch ?? 0, values.pitchStrength ?? 0, values.reactiveDrive ?? 0,
  values.reactiveImpulse ?? 0, ...(values.reactiveBands ?? []), ...(values.uAudioAverage ?? [])];
const influence = values => [values.level ?? 0, values.pitchStrength ?? 0, values.reactiveDrive ?? 0, values.reactiveImpulse ?? 0,
  ...(values.reactiveBands ?? []), ...(values.uAudioAverage ?? []), ...(values.uCumulativeAudio ?? [])];
const realBands = [.35, .18, .04, .12];
function feedReal(holder) {
  holder.renderer.setLevel(.6); holder.renderer.setAudioBands(realBands);
  holder.renderer.setFeatures({ rms: .15, spectralFlux: .1, spectralFlatness: .2, spectralCentroidHz: 2000,
    envelopeModulation: .12, pitchHz: 220, pitchConfidence: .99, pitchChange: .1, turbulence: .3 });
}

const initial = create(true);
advance(initial, 12);
check('Explicit visual preview supplies nonzero reactive drive without audio', initial.values.reactiveDrive > 0,
  { drive: initial.values.reactiveDrive, bands: initial.values.reactiveBands, pitchStrength: initial.values.pitchStrength });
initial.renderer.dispose();

for (const variant of ['original', 'calm', 'storm', 'intonation', 'landing']) {
  const preview = create(true, variant), ordinary = create(undefined, variant), explicitlyOff = create(false, variant);
  advance(preview, 12); advance(ordinary, 12); advance(explicitlyOff, 12);
  const first = snapshot(preview.values);
  check(`${variant}: demonstration activates bands and voiced motion without an audio source`,
    first.reactiveDrive > 0 && first.pitchStrength > 0 && first.reactiveBands?.some(value => value > 0), first);
  check(`${variant}: omitted and false preview flags keep ordinary silence quiet`,
    influence(ordinary.values).every(value => value === 0) && influence(explicitlyOff.values).every(value => value === 0)
    && ordinary.values.time > 0 && explicitlyOff.values.time > 0);
  const previewIdentity = orbPreviewIdentity('settings-preview-test', variant);
  const ordinaryIdentity = voiceIdentity('settings-preview-test');
  check(`${variant}: demonstration retains the voice seed and uses its style palette`,
    previewIdentity.seed === ordinaryIdentity.seed && preview.values.seed === ordinary.values.seed
      && equal(palette(preview.values), previewIdentity.rgb.flat()), { seed: preview.values.seed, palette: palette(preview.values) });
  check(`${variant}: default and false modes retain the ordinary voice identity`,
    equal(palette(ordinary.values), ordinaryIdentity.rgb.flat()) && equal(palette(explicitlyOff.values), ordinaryIdentity.rgb.flat())
      && explicitlyOff.values.seed === ordinary.values.seed);
  // Every orb (incl. the fluid "Płyn" variant) is drawn in its palette, not only demonstrations (UI-038).
  check(`${variant}: palette remapping is always on`, preview.values.previewPalette === 1
    && ordinary.values.previewPalette === 1 && explicitlyOff.values.previewPalette === 1);
  const beforeZeroTime = [...controls(preview.values), preview.values.time, preview.values.energy];
  preview.renderer.draw(0);
  check(`${variant}: zero-time redraw cannot advance the demonstration or its simulation`,
    equal(beforeZeroTime, [...controls(preview.values), preview.values.time, preview.values.energy]));
  const samples = [controls(preview.values)];
  for (let frame = 0; frame < 60; frame++) { advance(preview, 1); samples.push(controls(preview.values)); }
  check(`${variant}: demonstration controls vary over two seconds rather than only advancing idle time`,
    samples[0].some((value, channel) => samples.some(sample => Math.abs(sample[channel] - value) > 1e-5)));
  check(`${variant}: emitted demonstration controls remain finite and normalized`, samples.every(bounded));
  const repeat = create(true, variant); advance(repeat, 72);
  check(`${variant}: the same clock and settings produce the same demonstration controls`, equal(controls(preview.values), controls(repeat.values)));
  preview.renderer.start();
  check(`${variant}: the demonstration uses only the renderer's cancellable RAF`, frames.size === 1 && preview.renderer.running);
  preview.renderer.stop();
  check(`${variant}: stop releases its demonstration clock`, frames.size === 0 && !preview.renderer.running);
  feedReal(ordinary); feedReal(explicitlyOff); advance(ordinary, 12); advance(explicitlyOff, 12);
  check(`${variant}: normal real-input behavior is identical for default and explicitly false preview`,
    equal([...controls(ordinary.values), ordinary.values.time, ordinary.values.energy],
      [...controls(explicitlyOff.values), explicitlyOff.values.time, explicitlyOff.values.energy]) && influence(ordinary.values).some(value => value > 0));
  preview.renderer.dispose(); ordinary.renderer.dispose(); explicitlyOff.renderer.dispose(); repeat.renderer.dispose();
}

const normalizedFeatureNames = ['rms', 'spectralFlux', 'spectralFlatness', 'envelopeModulation', 'pitchConfidence', 'pitchChange', 'turbulence'];
for (const seconds of [NaN, Infinity, -Infinity, -5, 0, .4, 2, 30, 3600]) {
  const frame = orbPreviewFrame(seconds);
  check(`Pure demonstration at ${String(seconds)} seconds stays finite, bounded and within the pitch range`,
    bounded([frame.level, ...frame.bands, ...normalizedFeatureNames.map(name => frame.features[name])])
      && Number.isFinite(frame.features.spectralCentroidHz) && frame.features.spectralCentroidHz >= 0
      && Number.isFinite(frame.features.pitchHz) && frame.features.pitchHz >= 65 && frame.features.pitchHz <= 800, frame);
}
check('Invalid or negative demonstration times select the deterministic initial frame',
  [NaN, Infinity, -Infinity, -5].every(value => JSON.stringify(orbPreviewFrame(value)) === JSON.stringify(orbPreviewFrame(0))));
const externalInput = [...realBands], isolated = create(true);
isolated.renderer.setAudioBands(externalInput); advance(isolated, 12);
check('The demonstration never mutates a caller-owned real FFT array', equal(externalInput, realBands));
isolated.renderer.dispose();

const styleVariants = ['original', 'calm', 'storm', 'intonation', 'landing'];
const voices = ['settings-preview-test', 'voice-a', 'voice-b', 'polski-głos', ''];
const realIdentitiesBefore = voices.map(id => voiceIdentity(id));
const helperPalettes = [];
for (const variant of styleVariants) {
  const expectedPalette = orbPreviewIdentity(voices[0], variant).rgb.flat();
  helperPalettes.push(JSON.stringify(expectedPalette));
  check(`${variant}: preview palette depends on style while every voice retains its own seed`, voices.every(id => {
    const identity = orbPreviewIdentity(id, variant), real = voiceIdentity(id);
    return identity.seed === real.seed && equal(identity.rgb.flat(), expectedPalette) && bounded(identity.rgb.flat());
  }));
}
check('Five demonstration styles have five distinct palette triples', new Set(helperPalettes).size === styleVariants.length);
const landingColors = orbPreviewIdentity('settings-preview-test', 'landing').rgb;
check('The flow demonstration uses cyan highlights', landingColors.slice(1).every(([red, green, blue]) => green > red && blue > red), landingColors);
check('Preview identity lookup cannot mutate ordinary voice identities',
  JSON.stringify(voices.map(id => voiceIdentity(id))) === JSON.stringify(realIdentitiesBefore));

const switched = create(true, 'original');
advance(switched, 12);
const beforeSwitchResources = JSON.stringify(switched.metrics), beforeSwitchTime = switched.values.time, beforeSwitchSeed = switched.values.seed;
const switchedPalettes = [];
for (const variant of [...styleVariants, 'original']) {
  switched.renderer.setVariant(variant);
  const rgb = palette(switched.values), expected = orbPreviewIdentity('settings-preview-test', variant);
  switchedPalettes.push(JSON.stringify(rgb));
  check(`An existing preview immediately recolors after switching to ${variant}`, equal(rgb, expected.rgb.flat())
    && switched.values.seed === beforeSwitchSeed && switched.values.previewPalette === 1, { rgb, seed: switched.values.seed });
}
check('Style switching exposes five distinct palettes and restores Original on return', new Set(switchedPalettes.slice(0, 5)).size === 5
  && switchedPalettes[0] === switchedPalettes.at(-1));
check('Palette switching reuses the existing context, program and simulation time', JSON.stringify(switched.metrics) === beforeSwitchResources
  && switched.values.time === beforeSwitchTime);
switched.renderer.setVariant('storm'); switched.renderer.setVoice('another-voice');
check('Changing the preview voice preserves its selected style palette and updates only its seed',
  equal(palette(switched.values), orbPreviewIdentity('another-voice', 'storm').rgb.flat())
    && switched.values.seed === (voiceIdentity('another-voice').seed % 10000) / 97);
switched.renderer.dispose();
check('All demonstrations finish without creating audio objects or leaving RAF callbacks', audioCreated === 0 && frames.size === 0);

{
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const before = voiceIdentity('palette-choice-test').colors;
  const fire = orbPalettes.find(item => item.id === 'ogien');
  setOrbPalette('ogien');
  const pinned = voiceIdentity('palette-choice-test'), pinnedPreview = orbPreviewIdentity('palette-choice-test', 'landing');
  setOrbPalette('not-a-palette');
  const fallback = voiceIdentity('palette-choice-test').colors;
  setOrbPalette('voice');
  check('A pinned orb palette colours real and preview orbs; unknown ids fall back to the voice palette',
    same(pinned.colors, fire.colors) && same(pinnedPreview.colors, fire.colors) && pinned.seed === voiceIdentity('palette-choice-test').seed
      && same(fallback, before) && same(voiceIdentity('palette-choice-test').colors, before));
}

const result = { passed: checks.filter(item => item.passed).length, total: checks.length,
  limits: 'Exercises real renderer palette/control uniforms; actual GPU pixels require UI acceptance.', checks };
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0) {
  const path = process.argv[outputIndex + 1]; assert.ok(path, '--output needs a JSON path');
  await writeFile(path, JSON.stringify(result, null, 2) + '\n', 'utf8'); console.log(`${result.passed}/${result.total} — ${path}`);
} else console.log(JSON.stringify(result, null, 2));
if (checks.some(item => !item.passed)) process.exitCode = 1;
