import { readFileSync } from 'node:fs';
import ts from 'typescript';
globalThis.cancelAnimationFrame = () => {};
const source = ts.transpileModule(readFileSync('frontend/src/playback/voice-orb.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { VoiceOrbRenderer } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const values = {};
const gl = new Proxy({ getShaderParameter: () => true, getProgramParameter: () => true,
  getUniformLocation: (_, name) => name, uniform1f: (name, value) => values[name] = value,
  isContextLost: () => false }, { get: (object, name) => object[name] ?? (() => ({})) });
const canvas = { getContext: () => gl, dataset: {} };
const features = (turbulence, pitchHz = null) => ({ turbulence, spectralCentroidHz: 3000, pitchHz, pitchConfidence: pitchHz ? 1 : 0 });
const checks = [];
function assert(name, condition, detail) { checks.push({ name, passed: !!condition, detail }); }
for (const variant of ['calm', 'storm', 'intonation']) {
  const renderer = new VoiceOrbRenderer(canvas);
  renderer.setVariant(variant); renderer.setLevel(0); renderer.setFeatures(features(0));
  for (let i = 0; i < 30; i++) renderer.draw(1 / 30);
  const idleTime = values.time;
  assert(`${variant}: ciągły dryf w bezczynności`, idleTime > .3, idleTime);
  renderer.setLevel(.8); renderer.setFeatures(features(1, 400));
  renderer.draw();
  assert(`${variant}: przerysowanie bez czasu nie skacze do nowego sygnału`, values.turbulence === 0 && values.pitchStrength === 0, { turbulence: values.turbulence, pitchStrength: values.pitchStrength });
  renderer.draw(1 / 30);
  assert(`${variant}: łagodny pierwszy krok audio`, values.turbulence > 0 && values.turbulence < .1, values.turbulence);
  for (let i = 0; i < 29; i++) renderer.draw(1 / 30);
  assert(`${variant}: reakcja narasta w czasie`, values.turbulence > .6 && values.turbulence < .95, values.turbulence);
  const beforeRelease = values.turbulence;
  renderer.setLevel(0); renderer.setFeatures(); renderer.draw(1 / 30);
  assert(`${variant}: płynne wyciszenie po pauzie`, values.turbulence > beforeRelease * .9 && values.turbulence < beforeRelease, values.turbulence);
  for (let i = 0; i < 180; i++) renderer.draw(1 / 30);
  assert(`${variant}: reakcja wraca do bezczynności`, values.turbulence < .01 && values.pitchStrength < .01, values.turbulence);
}
function sustainedTone(level, pitchHz) {
  const renderer = new VoiceOrbRenderer(canvas);
  renderer.setVariant('storm'); renderer.setLevel(level); renderer.setFeatures(features(0, pitchHz));
  for (let i = 0; i < 120; i++) renderer.draw(1 / 30);
  const start = values.time;
  for (let i = 0; i < 30; i++) renderer.draw(1 / 30);
  const result = { drive: values.turbulence, speed: values.time - start };
  renderer.dispose(); return result;
}
const silent = sustainedTone(0, null), low = sustainedTone(.55, 110), high = sustainedTone(.55, 660), loud = sustainedTone(.9, 110);
assert('Burza: stały ton podtrzymuje energię ruchu', low.drive > .35 && low.speed > silent.speed * 1.4, { silent, low });
assert('Burza: wysokość stałego tonu zmienia charakter ruchu', high.drive > low.drive + .03 && high.speed > low.speed, { low, high });
assert('Burza: głośniejszy stały ton zwiększa dynamikę', loud.drive > low.drive + .2 && loud.speed > low.speed, { low, loud });
console.log(JSON.stringify({ passed: checks.filter(row => row.passed).length, total: checks.length, checks }, null, 2));
if (checks.some(row => !row.passed)) process.exitCode = 1;
