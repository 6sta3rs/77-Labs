import { i18nDeps, i18nRequire } from '../helpers/i18n.mjs';
import { mkdir as ensureQaDirectory } from 'node:fs/promises';
await ensureQaDirectory(new URL('../../.tmp/qa/', import.meta.url), { recursive: true });
import { sourceUrl } from '../helpers/source-url.mjs';
// Real public PCM WAV + actual automation/audio processing modules. The only
// controlled port is browser decoding; EXE acceptance exercises WebView2's real
// decoder separately. No backend, model, network or native process is started.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';

async function load(name, dependencies, exposure = '') {
  let source = await readFile(sourceUrl(`${name}`), 'utf8');
  if (name.endsWith('.svelte')) source = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  const parsed = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const node of [...parsed.statements].reverse()) if (ts.isImportDeclaration(node)) source = source.slice(0, node.pos) + source.slice(node.end);
  if (exposure) source += `\nreturn { ${exposure} };`;
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = {}; const returned = new Function('exports', ...Object.keys({...i18nDeps,...dependencies}), code)(result, ...Object.values({...i18nDeps,...dependencies})); return returned ?? result;
}
const hash = data => createHash('sha256').update(data).digest('hex');
const sourceFile = new URL('../../public/demo/interface-tone.wav', import.meta.url), source = await readFile(sourceFile), sourceHash = hash(source);
let backendCalls = 0;
const forbidden = async () => { backendCalls++; throw Error('Unexpected backend operation'); };
function decode(bytes) {
  const view = new DataView(bytes); assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
  let offset = 12, data;
  while (offset + 8 <= view.byteLength) { const size = view.getUint32(offset + 4, true), id = new TextDecoder().decode(bytes.slice(offset, offset + 4)); if (id === 'data') { data = { offset: offset + 8, size }; break; } offset += 8 + size + size % 2; }
  assert.equal(view.getUint16(20, true), 1); assert.equal(view.getUint16(34, true), 16);
  const count = view.getUint16(22, true), frames = data.size / 2 / count;
  const channels = Array.from({ length: count }, () => new Float32Array(frames));
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < count; channel++) channels[channel][frame] = view.getInt16(data.offset + (frame * count + channel) * 2, true) / 32768;
  return { channels, sampleRate: view.getUint32(24, true), frames };
}
const previousDecoder = globalThis.OfflineAudioContext;
globalThis.OfflineAudioContext = class {
  async decodeAudioData(bytes) { const pcm = decode(bytes); return { length: pcm.frames, numberOfChannels: pcm.channels.length, sampleRate: pcm.sampleRate, getChannelData: index => pcm.channels[index] }; }
};
try {
  const audio = await load('audio-lab.ts', { request: forbidden, productionJson: forbidden, referenceFileError: () => '', inspectReference: async () => 3.43 });
  const automation = await load('automation.ts', { ...audio, generate: forbidden, request: forbidden, prepareRequest: forbidden, productionJson: forbidden, postJson: forbidden });
  const recipe = (audioEdit, inputKind = 'audio') => ({ schema: 1, id: 'local-audio', name: 'QA lokalny WAV', inputKind, updatedAt: 1, steps: [{ id: 'edit', kind: 'edit-audio', ...(audioEdit === undefined ? {} : { audioEdit }) }] });
  const input = () => ({ kind: 'audio', name: 'public-probe.wav', blob: new Blob([source], { type: 'audio/wav' }) });
  const checks = [];
  function check(name, condition) { assert(condition, name); checks.push({ name, passed: true }); }
  check('Default local edit is normalize -3 dBFS without trim or fades', JSON.stringify(automation.validateRecipe(recipe()).steps[0].audioEdit) === JSON.stringify(automation.defaultAutomationAudioEdit()));
  const old = { schema: 1, id: 'old', name: 'Starszy przepis', inputKind: 'audio', updatedAt: 1, steps: [{ id: 'asr', kind: 'transcribe' }] };
  check('Existing schema-1 recipe remains compatible', automation.validateRecipe(old).steps[0].kind === 'transcribe');
  check('Pure local recipe can run cold while model steps require runtime readiness', automation.automationCanRun(recipe(), false) && !automation.automationNeedsRuntime(recipe()) && !automation.automationCanRun(old, false));
  assert.throws(() => automation.validateRecipe(recipe(undefined, 'text')));
  for (const bad of [{ start: -1 }, { start: 300 }, { end: 301 }, { start: 2, end: 1 }, { normalize: 'yes' }, { targetDb: 1 }, { gainDb: -61 }, { fadeInMs: -1 }, { fadeOutMs: Infinity }, { end: 1, fadeInMs: 1001 }, { start: Number.NaN }, 'code', []]) assert.throws(() => automation.validateRecipe(recipe(bad)));
  check('Invalid imported ranges/types are rejected before any processing', backendCalls === 0);
  const selected = automation.validateRecipe(recipe({ ...automation.defaultAutomationAudioEdit(), start: 0.3, end: 2.3, fadeInMs: 15, fadeOutMs: 15 }));
  const result = await automation.automationOperations['edit-audio'](input(), selected.steps[0]);
  const bytes = Buffer.from(await result.blob.arrayBuffer()), pcm = decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const peak = Math.max(...pcm.channels[0].map(Math.abs));
  check('Actual returned file is PCM16 WAV, 2 seconds, mono 24 kHz', result.blob.type === 'audio/wav' && bytes.length === 96044 && pcm.frames === 48000 && pcm.sampleRate === 24000 && pcm.channels.length === 1);
  check('Normalization target and 15 ms fade endpoints reach encoded output', Math.abs(20 * Math.log10(peak) + 3) < .01 && pcm.channels[0][0] === 0 && pcm.channels[0].at(-1) === 0);
  await assert.rejects(automation.automationOperations['edit-audio'](input(), recipe({ ...automation.defaultAutomationAudioEdit(), end: 10 }).steps[0]), /zakres/);
  check('A trim beyond the actual decoded source is refused', backendCalls === 0);
  const rows = new Map();
  const store = { recipes: async () => [], runs: async () => [...rows.values()], putRun: async run => rows.set(run.id, structuredClone(run)), removeRun: async id => rows.delete(id), putRecipe: async () => {}, removeRecipe: async () => {} };
  const service = automation.createAutomationService({ store, id: () => 'local-run' });
  await service.enqueue(selected, input());
  for (let trial = 0; trial < 100 && service.snapshot().runs.some(automation.activeAutomationRun); trial++) await new Promise(resolve => setImmediate(resolve));
  const saved = rows.get('local-run');
  check('Actual queue completes and persists the real WAV Blob without backend dispatch', saved.status === 'done' && saved.completedSteps === 1 && saved.result.blob instanceof Blob && backendCalls === 0);
  const coldRows = new Map(), mounts = [], effects = [], cleanups = [];
  const coldStore = { ...store, runs: async () => [...coldRows.values()], putRun: async run => coldRows.set(run.id, structuredClone(run)) };
  const coldService = automation.createAutomationService({ store: coldStore, id: () => 'cold-local-run' });
  const derived = Object.assign(value => value, { by: fn => fn() });
  const props = Object.assign(() => ({ ready: false }), { id: () => 'cold-automation' });
  let profileReads = 0;
  const component = await load('AutomationWorkspace.svelte', { ...automation, automation: coldService, $state: value => value, userMessage: (cause, fallback) => cause?.message || fallback, $derived: derived, $props: props, $effect: fn => effects.push(fn), onMount: fn => mounts.push(fn), profiles: async () => { profileReads++; throw Error('Cold local view must not read backend profiles'); }, productionLanguages: [], watchFolder: { subscribe(fn) { fn({ enabled: false }); return () => {}; } } }, 'template, chooseFiles, run, get loaded(){return loaded}, get error(){return error}');
  for (const mount of mounts) { const stop = mount(); if (stop) cleanups.push(stop); }
  for (let trial = 0; trial < 40 && !component.loaded; trial++) await Promise.resolve();
  for (const effect of effects) { const stop = effect(); if (stop) cleanups.push(stop); }
  component.template('audio'); component.chooseFiles([new File([source], 'cold-public.wav', { type: 'audio/wav' })]);
  for (const effect of effects) { const stop = effect(); if (stop) cleanups.push(stop); }
  await component.run();
  for (let trial = 0; trial < 100 && coldService.snapshot().runs.some(automation.activeAutomationRun); trial++) await new Promise(resolve => setImmediate(resolve));
  check('Actual component at ready=false runs local WAV without profile/catalog/backend reads', component.loaded && !component.error && coldRows.get('cold-local-run')?.status === 'done' && profileReads === 0 && backendCalls === 0);
  cleanups.reverse().forEach(stop => stop());
  check('Public source file remains byte-identical', hash(await readFile(sourceFile)) === sourceHash);
  const root = new URL('../../.tmp/automation-audio/', import.meta.url); await mkdir(root, { recursive: true }); await writeFile(new URL('processed.wav', root), bytes);
  await writeFile(new URL('../../.tmp/qa/automation-audio-cpu.json', import.meta.url), JSON.stringify({ source: 'public/demo/interface-tone.wav', sourceSha256: sourceHash, output: '.tmp/automation-audio/processed.wav', outputSha256: hash(bytes), frames: pcm.frames, sampleRate: pcm.sampleRate, duration: pcm.frames / pcm.sampleRate, peakDbfs: 20 * Math.log10(peak), backendCalls, coldComponent: { ready: false, profileReads, backendCalls, status: coldRows.get('cold-local-run')?.status }, decoder: 'Controlled browser PCM decoding port; actual decodeAudioFile, processAudio and encodeAudioWav modules executed', checks }, null, 2) + '\n');
  console.log(`Automation local audio: ${checks.length}/${checks.length} PASS; real WAV saved, backend calls ${backendCalls}.`);
} finally { if (previousDecoder === undefined) delete globalThis.OfflineAudioContext; else globalThis.OfflineAudioContext = previousDecoder; }
