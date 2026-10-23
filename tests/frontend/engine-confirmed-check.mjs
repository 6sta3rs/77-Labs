/** A generation that succeeded confirms its engine for good; ASR model rows for Faster-Whisper are selectable per model. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const src = async name => readFile(new URL(`../../src/lib/models/${name}`, import.meta.url), 'utf8');
function load(text, deps = {}) {
  const exports = {};
  const code = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', code)(exports, name => { assert.ok(name in deps, `Unexpected dependency ${name}`); return deps[name]; });
  return exports;
}
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
let snapshot;
const state = load(await src('engine-catalog-state.ts'), { 'svelte/store': { writable: initial => { snapshot = initial; return { set: value => { snapshot = value; }, update: fn => { snapshot = fn(snapshot); } }; } } });
const readiness = load(await src('engine-readiness.ts'), { '../i18n': { translateUi: text => text } });
const picker = load(await src('model-picker.ts'), { './engine-readiness': readiness });

const detected = { id: 'kitten', available: false, availability_check: 'dependencies_detected', can_verify: true, inference_verified: false, routing_status: 'unavailable', installed: null };
const catalog = { tts: { active: 'kitten', backends: [detected, { ...detected, id: 'other' }] }, asr: { active: '', backends: [] }, llm: { active: '', backends: [] } };

assert.equal(readiness.needsEngineVerification(detected), true);
assert.equal(state.publishEngineCatalog(catalog, 0), true);
assert.equal(snapshot.catalog.tts.backends[0].inference_verified, false, 'nothing is confirmed before a generation succeeds');

state.markEngineConfirmed('kitten');
let [kitten, other] = snapshot.catalog.tts.backends;
assert.equal(kitten.inference_verified, true, 'the current snapshot is updated at once');
assert.equal(other.inference_verified, false, 'only the engine that generated is confirmed');
assert.equal(readiness.needsEngineVerification(kitten), false, 'no second "Sprawdź i użyj" badge next to "Aktywny"');
assert.equal(readiness.canSelectEngine(kitten), true, 'a confirmed engine stays selectable although the catalogue is metadata-only');
assert.equal(readiness.engineReadinessLabel(kitten), 'Sprawdzony — wygenerował nagranie');
const item = picker.normalizeTtsModels(snapshot.catalog.tts).find(model => model.id === 'kitten');
assert.equal(picker.canSelectModel(item), true);
assert.equal(item.available && item.installed, true);

state.publishEngineCatalog(catalog, 0); // a fresh catalogue read keeps the confirmation
assert.equal(snapshot.catalog.tts.backends[0].inference_verified, true);
assert.deepEqual(state.withConfirmed(catalog).asr, catalog.asr, 'families without confirmed engines keep their content');
assert.deepEqual(JSON.parse(storage.get('studio.confirmedEngines')), ['tts:kitten'], 'persisted for the next launch');

// A confirmation is never applied to an engine the catalogue now reports as not installed, and a failed generation withdraws it.
state.markEngineConfirmed('other');
const gone = { ...catalog, tts: { active: '', backends: [{ ...detected, installed: false }, { ...detected, id: 'other', availability_check: 'missing_dependencies' }] } };
assert.deepEqual(state.withConfirmed(gone).tts.backends.map(engine => engine.inference_verified), [false, false], 'missing engines stay unconfirmed');
state.unmarkEngineConfirmed('other');
assert.equal(state.withConfirmed(catalog).tts.backends[1].inference_verified, false, 'a failed generation withdraws the confirmation');
assert.deepEqual(JSON.parse(storage.get('studio.confirmedEngines')), ['tts:kitten'], 'the withdrawal is persisted');

// Faster-Whisper model rows.
const turbo = 'deepdml/faster-whisper-large-v3-turbo-ct2', systran = 'Systran/faster-whisper-large-v3';
assert.equal(picker.isFasterWhisperModel(turbo), true);
assert.equal(picker.isFasterWhisperModel(systran), true);
assert.equal(picker.isFasterWhisperModel('Systran/faster-distil-whisper-large-v3'), true);
assert.equal(picker.isFasterWhisperModel('openai/whisper-large-v3'), false);
assert.equal(picker.isFasterWhisperModel('mlx-community/whisper-large-v3-mlx'), false);
assert.equal(picker.isActiveAsrModel({ active: 'faster-whisper', active_model: turbo }, turbo), true);
assert.equal(picker.isActiveAsrModel({ active: 'faster-whisper', active_model: turbo }, systran), false);
assert.equal(picker.isActiveAsrModel({ active: 'faster-whisper' }, systran), true, 'no stored pick means the engine default');
assert.equal(picker.isActiveAsrModel({ active: 'whisperx', active_model: turbo }, turbo), false, 'only engines that take model_id');
assert.equal(picker.isActiveAsrModel({ active: '' }, systran), false, 'auto selection: nothing is claimed');

// selectEngine sends model_id only when a model is chosen.
const bodies = [];
const tools = load((await readFile(new URL('../../src/lib/tools/studio-tools.ts', import.meta.url), 'utf8')), {
  '../i18n': { translateUi: text => text },
  './production/production': { postJson: body => ({ body }), productionJson: async (path, options) => { bodies.push([path, options?.body]); return {}; } },
  '../platform/api': {}, '../models/engine-catalog-state': { beginCatalogRead: () => 1, invalidateCatalogReads() {}, publishEngineCatalog: () => true, withConfirmed: value => value },
});
await tools.selectEngine('asr', 'faster-whisper', undefined, turbo);
await tools.selectEngine('tts', 'kitten');
assert.deepEqual(bodies[0][1], { family: 'asr', backend_id: 'faster-whisper', model_id: turbo });
assert.deepEqual(bodies[1][1], { family: 'tts', backend_id: 'kitten' });
console.log('PASS confirmed engines and Faster-Whisper model selection');
