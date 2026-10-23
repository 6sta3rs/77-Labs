// Settings → Silnik: the "Uruchamianie i pamięć" tab, unread-value reporting, the long GPU report timeout and the timeout message.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { runesComponent, flush } from '../helpers/runes-component.mjs';

const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };

// settingsError: an expired status-read timer arrives as "Request cancelled" on the desktop transport.
{
  let source = await read('frontend/src/settings/system-settings.ts');
  for (const statement of [...ts.createSourceFile('s.ts', source, ts.ScriptTarget.Latest, true).statements].reverse()) if (ts.isImportDeclaration(statement)) source = source.slice(0, statement.pos) + source.slice(statement.end);
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/^export /gm, '');
  const context = vm.createContext({ translateUi: text => text, productionJson: async () => ({}), postJson: () => ({}), redactDiagnosticText: String, Error,
    userMessage: (cause, fallback) => cause instanceof Error && /anulowano|cancel/i.test(cause.message) ? 'Operację anulowano.' : fallback });
  vm.runInContext(js + '\nglobalThis.settingsError = settingsError;', context);
  const waited = 'Silnik nie odpowiedział w wymaganym czasie. Odśwież stan i spróbuj ponownie.';
  equal(context.settingsError(Object.assign(new Error('x'), { name: 'TimeoutError' })), waited);
  equal(context.settingsError(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })), waited, 'An AbortError that reaches a settings page is a lapsed timer.');
  equal(context.settingsError(new Error('Request cancelled')), waited, 'The desktop transport spells the same timeout this way.');
  equal(context.settingsError(new Error('Request canceled')), waited);
  ok(context.settingsError(new Error('Disk full')) !== waited, 'Other errors keep their own message.');
}

// Markup wiring that the no-DOM runes harness cannot render.
{
  const markup = await read('frontend/src/settings/pages/EnginePage.svelte');
  ok(markup.includes("onclick={() => onnavigate?.('models')}>{tr('Otwórz Modele')}"), 'The skipped-preload reason links to Modele.');
  ok(/c\.id === 'hf_token'[^]*onnavigate\?\.\('models', 'access'\)/.test(markup), 'The Hugging Face token diagnostics row links to Modele → Pobieranie i dostęp.');
}

// The real page script with live runes.
const calls = [];
let offloadFails = true;
const productionJson = async (path, options = {}) => {
  calls.push([path, options]);
  if (path === '/api/settings/perf/offload-after-generation') { if (offloadFails) throw new Error('boom'); return { enabled: false, env_pinned: false, device: 'cuda' }; }
  if (path === '/api/settings/cuda-device') return { value: 'auto', applied: 'auto', env_pinned: false, restart_required: false, devices: [{ index: 0, value: 'GPU-1', name: 'Card' }] };
  if (path === '/system/info') return { generate_timeout_s: 600, cpu_generate_timeout_s: 1800 };
  if (path === '/api/settings/gpu-report') return { platform: 'win32', gpus: [], torch: { kind: 'cuda', version: '2' }, state: 'accelerated', options: [], engines: [] };
  if (path === '/model/status') return { loaded: false, loading: false, status: 'idle' };
  if (path === '/next/tts/status') return { engines: [] };
  if (path === '/media-tools/status') return { ops: {} };
  if (path === '/history') return [];
  if (path === '/sysinfo') return { cpu: 1, ram: 1, total_ram: 16, gpu_utilization: null, vram: 0, total_vram: 0 };
  if (path.startsWith('/system/logs')) return { lines: [], exists: true };
  return {};
};
const saved = { autostart: [], preload: [] };
const snapshot = { memory: { data: { ram: 1, total_ram: 16, vram: 0, total_vram: 0 } }, models: { error: 'down' }, compute: {}, performance: { error: 'down' }, compile: {}, media: {} };
const warmupCalls = [];
const quiet = { ok() {}, bad() {}, warn() {}, info() {} };
const page = await runesComponent('EnginePage.svelte', {
  props: { runtime: { state: 'ready', message: '', port: 1, managed: true }, desktop: true, onstart() {}, onstop() {}, onrefresh() {} },
  exposure: 'get tabs(){return tabs}, get unread(){return unread}, get savedFlag(){return savedFlag}, get autostart(){return autostart}, get preload(){return preload}, get warmHint(){return warmHint}, setTab(value){tab=value}, reload, gpuCheck, changeAutostart, changePreload, loadModelNow',
  deps: {
    invoke: async () => null, toast: quiet, productionJson, postJson: body => ({ body }),
    computeChoices: () => [], diagnosticCheckLabels: {}, recentRuntimeErrors: async () => ({ errors: [] }), redactDiagnosticText: String, redactDiagnosticValue: value => value,
    runOfflineDiagnostics: async () => ({ checks: [] }),
    runtimeSnapshot: async () => snapshot,
    saveCompileDisabled: async () => ({}), saveComputeDevice: async () => ({}), savePerformance: async () => ({}), unloadRuntimeModel: async () => {},
    gpuEngineLabels: {}, gpuOptionLabels: {}, gpuStateLabels: {}, preflightCheckLabels: {}, putSettings: async () => ({}),
    settingsError: String, settingsTimeout: Number,
    readEngineIdleMinutes: () => 15, saveEngineIdleMinutes: async () => {}, engineIdleOptions: [5, 15, 30, 60, 0],
    readEngineAutostart: () => true, saveEngineAutostart: value => saved.autostart.push(value), readEnginePreload: () => true, saveEnginePreload: async value => { saved.preload.push(value); },
    readModelWarmup: body => ({ status: body.status }),
    get: () => ({ catalog: { tts: { active: 'omnivoice', backends: [{ id: 'omnivoice' }] } } }), engineCatalogSnapshot: {}, engineCatalog: async () => ({ tts: undefined }),
    modelsCatalog: async () => ({ models: [{ role: 'TTS', installed: false, engines: ['omnivoice'] }] }),
    warmupNote: (model, family, weights) => { warmupCalls.push([model, family, weights]); return { text: 'Pominięto: model nie jest pobrany' }; },
    runtimeInstaller: { status: async () => ({ state: 'idle' }) }, installingRuntime: () => false,
    engineInstallation: { catalog: async () => ({ root: '', engines: [] }), jobs: async () => ({ jobs: [] }) },
    runtimeInstallActive: () => false, runtimeInstallLabels: {}, runtimePhaseLabels: {}, runtimeSize: String, runtimeTransfer: () => '',
    openLicenseSource: async () => {}, validateLicenseSource() {}, byteLabel: String,
  },
});
const settle = async () => { for (let i = 0; i < 30; i++) { await new Promise(resolve => setImmediate(resolve)); flush(); } };
try {
  await settle();
  const view = page.value;
  assert.deepEqual(view.tabs.map(tab => tab[0]), ['stan', 'uruchamianie', 'obliczenia', 'srodowiska', 'dzienniki']); checks++;
  assert.deepEqual(view.tabs.map(tab => tab[1]).slice(0, 2), ['Stan', 'Uruchamianie i pamięć']); checks++;

  const labels = view.unread.map(item => `${item.tab}:${item.label}`).sort();
  assert.deepEqual(labels, ['obliczenia:presety szybkości i jakości', 'uruchamianie:przenoszenie modelu do RAM', 'uruchamianie:załadowane modele'], 'Failed reads are named instead of silently hiding their rows.'); checks++;
  offloadFails = false;
  snapshot.memory = { error: 'down' }; snapshot.models = { data: { models: [] } };
  await view.reload(); await settle();
  assert.deepEqual(view.unread.map(item => `${item.tab}:${item.label}`).sort(), ['obliczenia:presety szybkości i jakości', 'stan:zużycie pamięci i karty'], 'Failed memory and model reads are named too.'); checks++;
  snapshot.memory = { data: { ram: 1, total_ram: 16, vram: 0, total_vram: 0 } };
  await view.reload(); await settle();
  assert.deepEqual(view.unread.map(item => item.label), ['presety szybkości i jakości'], '"Spróbuj ponownie" re-reads and clears what now loads.'); checks++;

  // An idle voice model on a running engine: the reason (skipped preload) comes from the TTS engine and the model catalogue.
  equal(view.warmHint, undefined, 'No reason is shown before the Uruchamianie tab is open.');
  view.setTab('uruchamianie'); await settle();
  equal(view.warmHint?.text, 'Pominięto: model nie jest pobrany', 'The idle model row shows why the preload was skipped.');
  equal(warmupCalls.length, 1, 'The reason is derived once per idle period, not on every poll.');
  equal(warmupCalls[0][0].status, 'idle'); equal(warmupCalls[0][1].active, 'omnivoice'); equal(warmupCalls[0][2][0].role, 'TTS');
  view.setTab('stan'); await settle();

  const gpu = calls.length;
  view.gpuCheck(); await settle();
  const report = calls.slice(gpu).find(call => call[0] === '/api/settings/gpu-report');
  ok(report, 'The GPU check is requested.');
  equal(report[1].timeoutMs, 120_000, 'The GPU probe gets a long timeout instead of the 15 s status limit.');

  view.changeAutostart(false); await settle();
  assert.deepEqual(saved.autostart, [false]); checks++;
  equal(view.autostart, false);
  ok(view.savedFlag.auto, 'The inline "Zapisano" appears next to the autostart switch.');
  await view.changePreload(false); await settle();
  assert.deepEqual(saved.preload, [false]); checks++;
  ok(view.savedFlag.pre);
} finally { page.destroy(); }
console.log(`Engine page: ${checks} checks passed.`);
