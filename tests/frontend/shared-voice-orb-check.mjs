import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

// Execute the real shared coordinator and renderer. The fake GL framebuffer
// carries a deterministic pixel token; copying it after a RAF has returned is
// rejected, modelling preserveDrawingBuffer=false. GPU fidelity is separate.
const dataModule = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const compile = code => ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const rendererModule = dataModule(compile(await readFile(new URL('../../frontend/src/playback/voice-orb.ts', import.meta.url), 'utf8')));
const sharedCode = compile(await readFile(new URL('../../frontend/src/playback/shared-voice-orb.ts', import.meta.url), 'utf8'))
  .replaceAll("'./voice-orb'", JSON.stringify(rendererModule));
const { SharedVoiceOrb } = await import(dataModule(sharedCode));
const { playbackVoiceId } = await import(dataModule(compile(await readFile(new URL('../../frontend/src/playback/playback-visual.ts', import.meta.url), 'utf8'))));
const checks = [];
function check(name, condition, detail) { checks.push({ name, passed: Boolean(condition), ...(detail === undefined ? {} : { detail }) }); }
const clone = value => JSON.parse(JSON.stringify(value));
let frameId = 0, canvasId = 0, resourceId = 0, drawId = 0;
const scheduled = new Map(), contexts = [], sourceCanvases = [];
globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = callback => { scheduled.set(++frameId, callback); return frameId; };
globalThis.cancelAnimationFrame = id => scheduled.delete(id);

function glFor(canvas) {
  const state = { canvas, uniforms: {}, created: [], deleted: new Set(), draws: 0, lost: false };
  const constants = new Map();
  const gl = new Proxy({}, { get: (_, name) => {
    if (name === 'isContextLost') return () => state.lost;
    if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => !state.failCompile;
    if (name === 'getAttribLocation') return () => 0;
    if (name === 'getUniformLocation') return (_, uniform) => uniform;
    if (name === 'uniform1f' || name === 'uniform1i') return (uniform, value) => { state.uniforms[uniform] = value; };
    if (/^uniform[234]fv$/.test(name)) return (uniform, value) => { state.uniforms[uniform] = Array.from(value); };
    if (/^uniform[234]f$/.test(name)) return (uniform, ...value) => { state.uniforms[uniform] = value; };
    if (String(name).startsWith('create')) return () => {
      const resource = { id: ++resourceId, kind: name };
      state.created.push(resource); return resource;
    };
    if (String(name).startsWith('delete')) return resource => { if (resource) state.deleted.add(resource.id); };
    if (name === 'drawArrays') return () => {
      state.draws++;
      canvas.framebuffer = { source: canvas.id, draw: ++drawId, uniforms: clone(state.uniforms) };
    };
    if (/^[A-Z_]+$/.test(String(name))) {
      if (!constants.has(name)) constants.set(name, constants.size + 1);
      return constants.get(name);
    }
    return () => {};
  } });
  state.gl = gl; contexts.push(state); return state;
}
class FakeCanvas {
  id = ++canvasId; width = 300; height = 150; dataset = {}; listeners = new Map(); framebuffer = null;
  mode; glState; lastImage; copies = [];
  constructor(edge = 144) { this.edge = edge; }
  getBoundingClientRect() { return { width: this.edge, height: this.edge }; }
  getContext(mode) {
    if (this.mode && this.mode !== mode) return null;
    this.mode = mode;
    if (mode === 'webgl') return (this.glState ??= glFor(this)).gl;
    if (mode === '2d') return this.context ??= {
      clearRect() {},
      drawImage: source => {
        assert.ok(source.framebuffer, 'A 2D subscriber tried copying an already-cleared WebGL buffer');
        this.lastImage = { source, pixelToken: clone(source.framebuffer) };
        this.copies.push(this.lastImage);
      },
    };
    return null;
  }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type) {
    let prevented = false;
    if (type === 'webglcontextlost' && this.glState) this.glState.lost = true;
    if (type === 'webglcontextrestored' && this.glState) this.glState.lost = false;
    for (const callback of [...(this.listeners.get(type) ?? [])]) callback({ preventDefault: () => { prevented = true; } });
    return prevented;
  }
}
globalThis.document = { createElement(tag) {
  assert.equal(tag, 'canvas');
  const canvas = new FakeCanvas(0); sourceCanvases.push(canvas); return canvas;
} };
function advance(now) {
  const callbacks = [...scheduled.values()]; scheduled.clear();
  for (const callback of callbacks) {
    callback(now);
    for (const canvas of sourceCanvases) canvas.framebuffer = null;
  }
}
function pump(start = 1000, count = 18) {
  for (let frame = 0; frame < count; frame++) advance(start + frame * 1000 / 60);
}
function counters() { return { loaded: 0, errors: 0, lost: 0 }; }
function callbacksFor(counts) { return { onload: () => counts.loaded++, onerror: () => counts.errors++, onlost: () => counts.lost++ }; }
const features = { rms: .15, spectralFlux: .12, spectralFlatness: .03, spectralCentroidHz: 1700,
  envelopeModulation: .1, pitchHz: 220, pitchConfidence: .99, pitchChange: 0, turbulence: .3 };
const bands = [.35, .18, .04, .12];
function feed(view, variant = 'storm') {
  view.setVoice('shared-voice'); view.setVariant(variant); view.setSensitivity(1);
  view.setLevel(.6); view.setFeatures(features); view.setAudioBands(bands);
}

const firstCanvas = new FakeCanvas(40), firstCounts = counters();
const first = new SharedVoiceOrb('main-playback', firstCanvas, callbacksFor(firstCounts));
feed(first); first.resize(); first.start(); pump();
const common = firstCanvas.lastImage.source, commonState = common.glState;
const beforeJoin = clone(commonState.uniforms), glCount = contexts.length;
const secondCanvas = new FakeCanvas(144), secondCounts = counters();
const second = new SharedVoiceOrb('main-playback', secondCanvas, callbacksFor(secondCounts));
feed(second); second.resize(); second.start();
check('Two views use one WebGL source and two 2D presentations', contexts.length === glCount && firstCanvas.mode === '2d' && secondCanvas.mode === '2d'
  && firstCanvas.lastImage.source === secondCanvas.lastImage.source, { glContexts: contexts.length, sources: [firstCanvas.lastImage.source.id, secondCanvas.lastImage.source.id] });
check('Late join preserves accumulated phase and energy instead of starting again at zero', beforeJoin.time > 0
  && commonState.uniforms.time === beforeJoin.time && commonState.uniforms.energy === beforeJoin.energy,
  { before: [beforeJoin.time, beforeJoin.energy], after: [commonState.uniforms.time, commonState.uniforms.energy] });
check('Both views receive the identical frame and pixel source synchronously', firstCanvas.dataset.sharedFrame === secondCanvas.dataset.sharedFrame
  && JSON.stringify(firstCanvas.lastImage.pixelToken) === JSON.stringify(secondCanvas.lastImage.pixelToken));
check('Procedural readiness is reported to every subscriber', firstCounts.loaded === 1 && secondCounts.loaded === 1);
check('Late join does not duplicate the RAF loop', scheduled.size === 1);
pump(1400, 6);
check('Live frames keep the two source tokens identical after buffer clearing', firstCanvas.dataset.sharedFrame === secondCanvas.dataset.sharedFrame
  && JSON.stringify(firstCanvas.lastImage.pixelToken) === JSON.stringify(secondCanvas.lastImage.pixelToken));

const beforeHidden = commonState.uniforms.reactiveDrive;
first.stop(); first.setLevel(0); first.setFeatures(); first.setAudioBands(); first.setVoice('hidden-voice');
pump(1550, 6);
check('A hidden or reduced subscriber cannot zero the active subscriber inputs', commonState.uniforms.reactiveDrive >= beforeHidden
  && commonState.uniforms.level > 0 && second.running && scheduled.size === 1,
  { before: beforeHidden, after: commonState.uniforms.reactiveDrive, level: commonState.uniforms.level });
first.draw();
check('An explicit reduced-motion still frame uses the active source without silencing it', commonState.uniforms.level > 0
  && JSON.stringify(firstCanvas.lastImage.pixelToken) === JSON.stringify(secondCanvas.lastImage.pixelToken));
const beforeStop = commonState.draws;
second.stop(); pump(1800, 4);
check('Stopping the last visible subscriber cancels the common RAF and hidden rendering', scheduled.size === 0 && commonState.draws === beforeStop);
feed(first); first.start(); pump(2000, 6);
const beforeRejoin = commonState.uniforms.time;
feed(second); second.start();
check('Showing a stopped subscriber joins the current phase', commonState.uniforms.time === beforeRejoin
  && firstCanvas.dataset.sharedFrame === secondCanvas.dataset.sharedFrame);
const beforeDispose = commonState.deleted.size;
first.dispose();
check('Disposing one subscriber keeps the other source and clock alive', scheduled.size === 1 && second.running && commonState.deleted.size === beforeDispose);
second.dispose(); second.dispose();
check('The last dispose releases the RAF, GL resources and context listener', scheduled.size === 0
  && commonState.created.every(resource => commonState.deleted.has(resource.id))
  && (common.listeners.get('webglcontextlost')?.size ?? 0) === 0
  && (common.listeners.get('webglcontextrestored')?.size ?? 0) === 0);
const replacement = new SharedVoiceOrb('main-playback', new FakeCanvas(40), callbacksFor(counters()));
check('The released group is removed so a new subscriber receives a fresh source', contexts.length === glCount + 1);
replacement.dispose();

// Saved legacy variants use the same texture-free coordinator, including
// context loss, restoration and hidden-view behavior.
const legacyCountsA = counters(), legacyCountsB = counters();
const legacyCanvasA = new FakeCanvas(144), legacyCanvasB = new FakeCanvas(40);
const legacyA = new SharedVoiceOrb('legacy-playback', legacyCanvasA, callbacksFor(legacyCountsA));
const legacyB = new SharedVoiceOrb('legacy-playback', legacyCanvasB, callbacksFor(legacyCountsB));
feed(legacyA, 'landing'); feed(legacyB, 'landing'); legacyA.resize(); legacyB.resize(); legacyA.start(); legacyB.start(); pump(2500, 6);
const legacySource = legacyCanvasA.lastImage.source, legacyState = legacySource.glState;
check('Legacy style subscribers share the original procedural shader', legacyState.uniforms.variant === 0
  && legacyState.uniforms.reactiveDrive > 0 && legacyCountsA.loaded === 1 && legacyCountsB.loaded === 1);
check('Legacy style frames share one source and clock', JSON.stringify(legacyCanvasA.lastImage.pixelToken) === JSON.stringify(legacyCanvasB.lastImage.pixelToken)
  && scheduled.size === 1);
const cancelled = legacySource.emit('webglcontextlost');
check('Context loss notifies every subscriber and releases the shared clock', cancelled
  && legacyCountsA.lost === 1 && legacyCountsB.lost === 1 && legacyCountsA.errors === 0 && legacyCountsB.errors === 0 && scheduled.size === 0);
legacySource.emit('webglcontextlost');
check('Repeated context loss cannot duplicate fallback notifications', legacyCountsA.lost === 1 && legacyCountsB.lost === 1);
const lostResources = legacyState.created.length;
pump(2800, 4);
check('A lost context waits for a native restore event without retrying', legacyState.created.length === lostResources && scheduled.size === 0);
const restoredSourceCount = contexts.length;
legacySource.emit('webglcontextrestored'); pump(3000, 6);
check('Native restoration recreates a renderer on the same source context', contexts.length === restoredSourceCount
  && legacyState.created.length > lostResources && scheduled.size === 1);
check('Restoration reports readiness again to every retained subscriber', legacyCountsA.loaded === 2 && legacyCountsB.loaded === 2
  && legacyCountsA.errors === 0 && legacyCountsB.errors === 0);
check('Restored presentations resume identical frames from the original source', legacyCanvasA.lastImage.source === legacySource
  && legacyCanvasB.lastImage.source === legacySource && legacyCanvasA.dataset.sharedFrame === legacyCanvasB.dataset.sharedFrame
  && JSON.stringify(legacyCanvasA.lastImage.pixelToken) === JSON.stringify(legacyCanvasB.lastImage.pixelToken));
const afterRestoreResources = legacyState.created.length;
legacySource.emit('webglcontextrestored');
check('Duplicate restore does not allocate resources or duplicate the clock', legacyState.created.length === afterRestoreResources && scheduled.size === 1);
legacyA.dispose(); legacyB.dispose();
check('Final dispose releases all resources and native context listeners', scheduled.size === 0
  && legacyState.created.every(resource => legacyState.deleted.has(resource.id))
  && (legacySource.listeners.get('webglcontextlost')?.size ?? 0) === 0
  && (legacySource.listeners.get('webglcontextrestored')?.size ?? 0) === 0);

const hiddenCountsA = counters(), hiddenCountsB = counters();
const hiddenA = new SharedVoiceOrb('hidden-source', new FakeCanvas(40), callbacksFor(hiddenCountsA));
const hiddenB = new SharedVoiceOrb('hidden-source', new FakeCanvas(144), callbacksFor(hiddenCountsB));
const hiddenSource = sourceCanvases.at(-1), beforeHiddenRestore = hiddenSource.glState.draws;
hiddenSource.emit('webglcontextlost'); hiddenSource.emit('webglcontextrestored');
check('Restoration while all views are stopped keeps GPU frames and RAF stopped', hiddenSource.glState.draws === beforeHiddenRestore && scheduled.size === 0);
check('Hidden subscribers receive restored readiness without being disposed', hiddenCountsA.loaded === 2 && hiddenCountsB.loaded === 2
  && hiddenCountsA.lost === 1 && hiddenCountsB.lost === 1 && hiddenCountsA.errors === 0 && hiddenCountsB.errors === 0);
hiddenA.dispose(); hiddenB.dispose();

const retryCountsA = counters(), retryCountsB = counters();
const retryCanvasA = new FakeCanvas(40), retryCanvasB = new FakeCanvas(144);
const retryA = new SharedVoiceOrb('failed-restore', retryCanvasA, callbacksFor(retryCountsA));
const retryB = new SharedVoiceOrb('failed-restore', retryCanvasB, callbacksFor(retryCountsB));
feed(retryA); feed(retryB); retryA.start(); retryB.start();
const retrySource = retryCanvasA.lastImage.source;
retrySource.emit('webglcontextlost'); retrySource.glState.failCompile = true;
retrySource.emit('webglcontextrestored');
check('An unsuccessful restore becomes one permanent error for both views', retryCountsA.errors === 1 && retryCountsB.errors === 1 && scheduled.size === 0);
const failedResources = retrySource.glState.created.length;
retrySource.glState.failCompile = false; retrySource.emit('webglcontextrestored'); retryA.start(); pump(3500, 4);
check('Failed restoration never spins or retries after further native events', retrySource.glState.created.length === failedResources
  && retryCountsA.errors === 1 && retryCountsB.errors === 1 && scheduled.size === 0);
retryA.dispose(); retryB.dispose();

const record = patch => ({ id: 'recording', url: 'blob:public-test', voice: 'Etykieta nagrania', ...patch });
check('Identity prefers the stored recording voiceId over speaker metadata', playbackVoiceId(record({ voiceId: 'recorded', blocks: [{ voiceId: 'editor' }] }), 'selected') === 'recorded');
check('Several blocks of one voice preserve a single voice identity', playbackVoiceId(record({ blocks: [{ voiceId: 'speaker' }, { voiceId: 'speaker' }] })) === 'speaker');
check('Distinct speakers use the stable recording label', playbackVoiceId(record({ blocks: [{ voiceId: 'one' }, { voiceId: 'two' }] })) === 'Etykieta nagrania');
check('An imported recording without voice metadata uses its label', playbackVoiceId(record({ voice: 'Wczytane nagranie' })) === 'Wczytane nagranie');
check('No playable recording uses the selected editor fallback', playbackVoiceId(undefined, 'selected') === 'selected'
  && playbackVoiceId(record({ url: undefined, voiceId: 'stale' }), 'selected') === 'selected');
check('Missing labels and empty speaker metadata retain a valid fallback', playbackVoiceId(record({ voice: '', blocks: [{ voiceId: '' }] }), 'selected') === 'selected');
check('All test groups release every scheduled frame', scheduled.size === 0);

const result = { passed: checks.filter(item => item.passed).length, total: checks.length,
  limits: 'Tests the real coordinator/renderer with deterministic fake GL and 2D tokens; browser GPU pixels require UI acceptance.', checks };
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0) {
  const path = process.argv[outputIndex + 1]; assert.ok(path, '--output needs a JSON path');
  await writeFile(path, JSON.stringify(result, null, 2) + '\n', 'utf8'); console.log(`${result.passed}/${result.total} — ${path}`);
} else console.log(JSON.stringify(result, null, 2));
if (checks.some(item => !item.passed)) process.exitCode = 1;
