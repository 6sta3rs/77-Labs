import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const code = ts.transpileModule(await readFile(new URL('../../src/lib/playback/voice-orb.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { VoiceOrbRenderer } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
let nextId = 0, drawn = 0;
const callbacks = new Map();
globalThis.requestAnimationFrame = callback => { const id = ++nextId; callbacks.set(id, callback); return id; };
globalThis.cancelAnimationFrame = id => callbacks.delete(id);
const gl = new Proxy({}, {
  get: (_, name) => {
    if (name === 'isContextLost') return () => false;
    if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => true;
    if (name === 'drawArrays') return () => drawn++;
    if (String(name).startsWith('create') || name === 'getUniformLocation') return () => ({});
    if (/^[A-Z_]+$/.test(String(name))) return 1;
    return () => {};
  },
});
const canvas = { getContext: () => gl, dataset: {}, width: 100, height: 100 };
const measurements = [];
for (const rate of [60, 75, 90, 120, 144]) {
  const current = new VoiceOrbRenderer(canvas);
  drawn = 0; current.start();
  for (let frame = 0; frame <= rate; frame++) {
    const queued = [...callbacks.values()]; callbacks.clear();
    for (const callback of queued) callback(1000 + frame * 1000 / rate);
  }
  measurements.push({ displayHz: rate, drawnFrames: drawn });
  current.dispose();
}
console.log(JSON.stringify(measurements));
assert.ok(measurements.every(result => result.drawnFrames >= 30 && result.drawnFrames <= 31), 'Display refresh rates must retain the 30 FPS animation clock');
const renderer = new VoiceOrbRenderer(canvas); renderer.start();
renderer.stop(); assert.equal(callbacks.size, 0, 'Stopping releases its scheduled frame');
renderer.start(); renderer.start(); assert.equal(callbacks.size, 1, 'Repeated starts schedule only one frame');
renderer.dispose(); assert.equal(callbacks.size, 0, 'Disposal releases the frame loop');
renderer.start(); assert.equal(callbacks.size, 0, 'Disposed renderers cannot restart');
console.log('VoiceOrb timing and cleanup: 9 checks passed');

const landingMeasurements = [];
for (const rate of [60, 75, 90, 120, 144]) {
  const current = new VoiceOrbRenderer(canvas);
  current.setVariant('landing');
  drawn = 0; current.start();
  for (let frame = 0; frame <= rate; frame++) {
    const queued = [...callbacks.values()]; callbacks.clear();
    for (const callback of queued) callback(1000 + frame * 1000 / rate);
  }
  landingMeasurements.push({ displayHz: rate, drawnFrames: drawn });
  assert.ok(drawn >= 30 && drawn <= 31, 'The saved legacy style uses the procedural 30 FPS clock');
  current.dispose();
}
assert.equal(callbacks.size, 0, 'The legacy style releases all scheduled frames');
console.log(JSON.stringify(landingMeasurements));
console.log('Legacy style procedural clock: 6 checks passed');

// No external image or texture loading is needed for any saved style.
const { normalizeOrbVariant } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
assert.equal(normalizeOrbVariant('elevenlabs'), 'landing', 'A previous style name retains a safe procedural alias');
assert.equal(normalizeOrbVariant('landing'), 'landing');
assert.equal(normalizeOrbVariant('unknown', 'storm'), 'storm');
assert.equal(normalizeOrbVariant(null), 'original');
console.log('Legacy style migration: 4 checks passed');
