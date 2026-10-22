import { i18nDeps, i18nRequire } from '../helpers/i18n.mjs';
import { sourceUrl } from '../helpers/source-url.mjs';
import { runesComponent, flush } from '../helpers/runes-component.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function pureHelpers(filename) { const source=await readFile(sourceUrl(filename),'utf8');const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const result={};new Function('exports','require',code)(result,i18nRequire);return result; }
const licenseContracts=await pureHelpers('model-licenses.ts'),speechContracts=await pureHelpers('speech-settings.ts');

// Execute the actual TypeScript/component script with controlled transports and
// lifecycle hooks. No backend, private data, browser, timers or model is started.
const root = new URL('../../src/lib/', import.meta.url);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
async function execute(filename, dependencies = {}, exposure = '') {
  dependencies = {
    prepareRequest: async () => {}, profileLanguages: [], routeBackendPath: path => path, synchronizeRemoteRouting: async () => {}, publishRemoteState: () => {},
    currentGeneralPreferences: () => ({ reviewMode: true, translationQuality: 'fast' }),
    assertModelLicenseResponse:licenseContracts.assertModelLicenseResponse,requiredLicenseRepos:licenseContracts.requiredLicenseRepos,
    activeDownload: job => !!job && ['starting', 'planning', 'downloading', 'verifying', 'cancelling'].includes(job.state),
    modelFamily: role => ({ tts: 'tts', asr: 'asr', llm: 'llm' }[role.toLowerCase()] || 'other'),
    engineLicenses: {},
    modelManagement: {
      status: async () => ({ jobs: [], storage: { configured: 'C:/fixture/models', effective: 'C:/fixture/models', restart_required: false, inference_offline: true, active_downloads: 0 } }),
      tokenState: async () => ({ active: null, sources: [] }),
    },
    ...dependencies,
  };
  let source = await readFile(sourceUrl(filename), 'utf8');
  if (filename.endsWith('.svelte')) source = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const node of [...parsed.statements].reverse()) {
    if (ts.isImportDeclaration(node)) source = source.slice(0, node.pos) + source.slice(node.end);
  }
  source += exposure ? `\nreturn { ${exposure} };` : '';
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exported = {};
  const result = new Function('exports', ...Object.keys({...i18nDeps,...dependencies}), code)(exported, ...Object.values({...i18nDeps,...dependencies}));
  return result ?? exported;
}
async function component(filename, deps = {}, props = {}, exposure = '') {
  const mount = [], destroy = [], effects = [], effectCleanups = [];
  const componentProps = Object.assign(() => props, { id: () => 'async-qa' });
  const value = await execute(filename, {
    $state: value => value, $derived: Object.assign(value => value, { by: compute => compute() }), $props: componentProps,
    $effect: effect => effects.push(effect), onMount: fn => mount.push(fn),
    onDestroy: fn => destroy.push(fn), untrack: fn => fn(), ...deps,
  }, exposure);
  const cleanupEffects = () => effectCleanups.splice(0).reverse().forEach(fn => fn());
  return { value, mount: () => mount.forEach(fn => { const cleanup = fn(); if (typeof cleanup === 'function') destroy.push(cleanup); }), cleanupEffects,
    effect: () => { cleanupEffects(); for (const fn of effects) { const cleanup = fn(); if (cleanup) effectCleanups.push(cleanup); } },
    destroy: () => { cleanupEffects(); destroy.splice(0).reverse().forEach(fn => fn()); } };
}

async function appModels(deps) {
  const source = (await readFile(sourceUrl('../App.svelte'), 'utf8')).match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  const parsed = ts.createSourceFile('App.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set(['refreshEngine', 'loadPickerModels', 'chooseInstalledModel', 'readEngineFamily', 'disposeModelRequests']);
  const statements = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)
    || ts.isVariableStatement(node) && /\b(engineCatalogEpoch|engineCatalogController|modelSelectionController|modelSelectionPending|modelLoadEpoch|modelRequestsDisposed)\b/.test(node.getText(parsed)));
  const fixture = `let ttsFamily = { active: 'old', backends: [] }; let language = 'Polish';
    let generationCapabilities={wav_bits:[],preset_voice:false,design_recipe:false};let speechSettings={};const generationBackend={id:'fixture'};
    const demoMode = false;
    let choosingModel = true, modelLoading = false, modelError = '';
    const generationLanguages = ['Auto', 'Polish', 'English'];
    const ttsModelItems = [{ id: 'new', installed: true, available: true }];`;
  const exposure = `return { refreshEngine, loadPickerModels, chooseInstalledModel, ${source.includes('function disposeModelRequests') ? 'disposeModelRequests,' : ''}
    get family() { return ttsFamily }, get loading() { return modelLoading }, get error() { return modelError } };`;
  const code = ts.transpileModule(fixture + statements.map(node => node.getText(parsed)).join('\n') + exposure,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const values = { notify() {}, productionJson:async()=>undefined, resetPresetForEngine:value=>value,preferredSpeechLanguage:speechContracts.preferredSpeechLanguage,scheduleProjectSave(){}, ...deps };
  return new Function(...Object.keys({...i18nDeps,...values}), code)(...Object.values({...i18nDeps,...values}));
}

// Settings → Modele (ModelsPage) owns the engine catalogue since the settings redesign; run its real script with live runes.
const quiet = { ok() {}, bad() {}, warn() {}, info() {} };
async function modelsPage(deps = {}, props = {}) {
  return runesComponent('ModelsPage.svelte', { props: { ready: true, onchange: async () => {}, onnavigate() {}, ...props }, deps: {
    toast: quiet, modelsCatalog: async () => ({ models: [] }), productionJson: async () => ({}), request: async () => ({}),
    readOnboardingPlan: async () => ({ models: [] }), canSelectEngine: () => true, engineReadinessLabel: () => '', needsEngineVerification: () => false,
    activeDownload: () => false, byteLabel: String, downloadPercent: () => 0, engineLicenses: {}, modelFamily: () => 'other',
    modelManagement: { status: async () => ({ jobs: [], storage: {} }) }, requiredLicenseRepos: () => [], validModelRepo: () => true,
    openLicenseSource: async () => {}, hfMirrorAddress: String, putSettings: async () => ({}), settingsError: cause => String(cause?.message ?? cause),
    ...deps }, exposure: 'refresh, select, get catalog() { return catalog }' });
}
const flushed = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); flush(); } };

const checks = [];
const test = (name, run) => checks.push({ name, run });

test('SSE: abort cancels its reader and never publishes a late frame', async () => {
  const packet = deferred(); let cancelled = 0; let released = 0; let reads = 0; const events = [];
  const reader = { read: () => reads++ ? Promise.resolve({ done: true }) : packet.promise, cancel: () => { cancelled++; packet.resolve({ done: true }); return Promise.resolve(); }, releaseLock: () => released++ };
  const { productionStream } = await execute('production.ts', { request: async () => ({ ok: true, body: { getReader: () => reader } }) });
  const abort = new AbortController();
  const running = productionStream('/tasks/stream/qa', { signal: abort.signal }, event => events.push(event)).then(() => 'resolved', error => error.name);
  await settle(); abort.abort();
  packet.resolve({ done: false, value: new TextEncoder().encode('data: {"type":"done"}\n\n') });
  assert.equal(await running, 'AbortError');
  assert.equal(events.length, 0, 'Leaving a view must not publish a late completion.');
  assert.equal(cancelled, 1, 'The stream reader must be cancelled, not just unlocked.');
  assert.equal(released, 1);
});

test('SSE: malformed events cancel transport instead of leaking it', async () => {
  let cancelled = 0; let read = false;
  const reader = { read: async () => read ? { done: true } : (read = true, { done: false, value: new TextEncoder().encode('data: {broken}\n\n') }), cancel: async () => { cancelled++; }, releaseLock() {} };
  const { productionStream } = await execute('production.ts', { request: async () => ({ ok: true, body: { getReader: () => reader } }) });
  await assert.rejects(productionStream('/qa', {}, () => {}));
  assert.equal(cancelled, 1);
});

test('JSON: cancelled reads cannot publish transport results that ignore abort', async () => {
  const data = deferred(); const abort = new AbortController();
  const { productionJson } = await execute('production.ts', { request: async () => ({ ok: true, json: () => data.promise }) });
  const result = productionJson('/qa', { signal: abort.signal });
  await settle(); abort.abort(); data.resolve({ stale: true });
  await assert.rejects(result, error => error.name === 'AbortError');
});

test('Engine catalog: repeated refreshes do not overlap', async () => {
  const wait = deferred(); let reads = 0;
  const subject = await modelsPage({ engineCatalog: () => { reads++; return wait.promise; } });
  const first = subject.value.refresh(); const second = subject.value.refresh();
  assert.equal(reads, 1, 'Opening the page and rapid refresh clicks must share one request.');
  wait.resolve({}); await Promise.all([first, second]); subject.destroy();
});

test('AI settings: closing the view aborts its pending reads', async () => {
  // The Codex/ChatGPT reads moved from AISettings.svelte to the AI settings page; they start after the engine reads.
  const wait = deferred(); const signals = [];
  const subject = await runesComponent('AiPage.svelte', { props: { ready: true }, deps: {
    toast: quiet, productionJson: async path => path === '/api/settings/llm-providers' ? { providers: [] } : path === '/api/settings/llm-skills' ? { skills: [] } : path === '/next/settings/credentials' ? { fields: [] } : {},
    postJson: body => ({ body }), putSettings: async () => ({}), settingsError: String, skillLabels: {}, connectionMessage: () => '',
    saveAISettings: async () => assert.fail('No write expected'), testAI: async () => assert.fail('No inference expected'),
    getAISettings: signal => { signals.push(signal); return wait.promise; },
    getAIStatus: signal => { signals.push(signal); return wait.promise; },
  }, exposure: 'get aiSet() { return aiSet }, get aiErr() { return aiErr }' });
  await flushed(); subject.destroy();
  assert.equal(signals.length, 2);
  assert.ok(signals.every(signal => signal?.aborted), 'Both settings and status reads must be cancelled.');
  wait.resolve({ enabled: false }); await flushed();
  assert.equal(subject.value.aiSet, undefined, 'Closed views must ignore late results.');
  assert.equal(subject.value.aiErr, '');
});

test('Production: audiobook view only loads its own library endpoints', async () => {
  const paths = [];
  const subject = await component('ProductionWorkspace.svelte', { profiles: async () => [], productionJson: async path => { paths.push(path); return path.startsWith('/longform') || path === '/audiobook/jobs' ? { jobs: [] } : []; } }, { ready: true, kind: 'audiobooks', onnotify() {} }, 'refresh');
  await subject.value.refresh();
  assert.deepEqual(paths.sort(), ['/audiobook/jobs', '/longform/jobs?limit=30', '/projects']); subject.destroy();
});

test('Production: dubbing view only loads its own library endpoints', async () => {
  const paths = [];
  const subject = await component('ProductionWorkspace.svelte', { profiles: async () => [], productionJson: async path => { paths.push(path); return path.startsWith('/longform') ? { jobs: [] } : []; } }, { ready: true, kind: 'dubbing', onnotify() {} }, 'refresh');
  await subject.value.refresh();
  assert.deepEqual(paths, ['/dub/history']); subject.destroy();
});

test('General preferences: a failed browser save preserves the previous live value', async () => {
  const store = await import('svelte/store'); const exported = {}; let stored = '', fail = false;
  const source = await readFile(sourceUrl('general-settings.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', 'localStorage', code)(() => store, exported, { getItem: () => stored, setItem: (_key, value) => { if (fail) throw new Error('quota'); stored = value; } });
  exported.saveGeneralPreferences({ reviewMode: false, translationQuality: 'autofit' });
  assert.deepEqual(exported.currentGeneralPreferences(), { reviewMode: false, translationQuality: 'autofit' });
  fail = true;
  assert.throws(() => exported.saveGeneralPreferences({ reviewMode: true, translationQuality: 'fast' }));
  assert.deepEqual(exported.currentGeneralPreferences(), { reviewMode: false, translationQuality: 'autofit' });
  assert.deepEqual(JSON.parse(stored), { reviewMode: false, translationQuality: 'autofit' });
});

for (const reviewMode of [true, false]) {
  test(`Dubbing review mode ${reviewMode ? 'on pauses after preparation' : 'off advances through ASR and translation without audio render'}`, async () => {
    const paths = [], payloads = [];
    const subject = await component('ProductionWorkspace.svelte', {
      currentGeneralPreferences: () => ({ reviewMode, translationQuality: 'autofit' }),
      productionJson: async (path, options) => {
        paths.push(path); payloads.push(options?.body);
        if (path === '/dub/ingest-url') return { job_id: 'review-fixture', task_id: 'prepare-fixture' };
        if (path.startsWith('/dub/transcribe/')) return { segments: [{ id: 'one', text: 'Hello', start: 0, end: 1 }] };
        if (path === '/dub/translate') return { translated: [{ id: 'one', text: 'Cześć' }] };
        if (path === '/engines/translation') return { active: 'argos' };
        if (path === '/engines/translation/argos/packs/status') return { pairs: [{ installed: true }] };
        throw new Error('Unexpected route: ' + path);
      },
      productionStream: async (_path, _options, receive) => receive({ type: 'ready' }),
      postJson: (body, signal) => ({ body: JSON.stringify(body), signal }),
    }, { ready: true, kind: 'dubbing', onnotify() {} }, "uploadDub, source(){ sourceMode='url'; ingestUrl='https://example.invalid/fixture' }, get status(){ return { error, prepared, translated, quality } }");
    subject.value.source(); await subject.value.uploadDub();
    assert.equal(subject.value.status.error, '');
    assert.equal(subject.value.status.prepared, true);
    assert.equal(subject.value.status.translated, !reviewMode);
    assert.deepEqual(paths, reviewMode ? ['/dub/ingest-url'] : ['/dub/ingest-url', '/dub/transcribe/review-fixture', '/engines/translation', '/engines/translation/argos/packs/status', '/dub/translate']);
    if (!reviewMode) {
      const translation = JSON.parse(payloads[paths.indexOf('/dub/translate')]);
      assert.equal(translation.quality, 'autofit');
      assert.equal(translation.provider, 'argos', 'The engine selected in settings is sent, not the backend Google default.');
    }
    assert.ok(paths.every(path => !path.includes('/generate')));
    subject.destroy();
  });
}

test('Dubbing review mode off never translates after ASR cancellation', async () => {
  const paths = []; let abort;
  const subject = await component('ProductionWorkspace.svelte', {
    currentGeneralPreferences: () => ({ reviewMode: false, translationQuality: 'fast' }),
    productionJson: async path => { paths.push(path); if (path === '/dub/ingest-url') return { job_id: 'cancel-fixture', task_id: 'prepare' }; abort(); return { segments: [{ id: 'one', text: 'Hello', start: 0, end: 1 }] }; },
    productionStream: async (_path, _options, receive) => receive({ type: 'ready' }), postJson: body => ({ body: JSON.stringify(body) }),
  }, { ready: true, kind: 'dubbing', onnotify() {} }, "uploadDub, abort(){ controller.abort() }, source(){ sourceMode='url'; ingestUrl='https://example.invalid/fixture' }, get status(){ return { translated, busy } }");
  abort = () => subject.value.abort(); subject.value.source(); await subject.value.uploadDub();
  assert.deepEqual(paths, ['/dub/ingest-url', '/dub/transcribe/cancel-fixture']);
  assert.equal(subject.value.status.translated, false); assert.equal(subject.value.status.busy, false);
  subject.destroy();
});

test('Model picker: selection waits for a catalog refresh', async () => {
  const wait = deferred(); let selections = 0;
  const model = { id: 'qa', name: 'QA', languages: [], installed: true, available: true };
  const picker = await execute('model-picker.ts');
  const subject = await component('models/ModelPicker.svelte', picker, { models: [model], onrefresh: () => wait.promise, onselect: async () => { selections++; } }, 'refresh, select');
  const refreshing = subject.value.refresh();
  await subject.value.select(model);
  assert.equal(selections, 0, 'A user must not select from a catalog being replaced.');
  wait.resolve(); await refreshing; subject.destroy();
});

test('Model picker: late selection never closes a new view', async () => {
  const wait = deferred(); let closes = 0;
  const model = { id: 'qa', name: 'QA', languages: [], installed: true, available: true };
  const picker = await execute('model-picker.ts');
  const subject = await component('models/ModelPicker.svelte', picker, { models: [model], onselect: () => wait.promise, onclose: () => closes++ }, 'select');
  const selecting = subject.value.select(model);
  subject.destroy(); wait.resolve(); await selecting;
  assert.equal(closes, 0, 'Unmounted picker must not invoke its parent close callback.');
});

test('Device telemetry: timer waits for the previous response', async () => {
  const timers = new Map(), listeners = new Map(); const wait = deferred(); let reads = 0, timerId = 0;
  const doc = { hidden: false, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const subject = await component('DeviceStatus.svelte', {
    isDesktop: () => true, simulatedDevice: () => ({ stats: {}, phase: 'QA' }),
    productionJson: () => { reads++; return wait.promise; }, document: doc,
    window: { addEventListener() {}, removeEventListener() {} },
    setTimeout: fn => (timers.set(++timerId, fn), timerId), clearTimeout: id => timers.delete(id),
    setInterval: fn => (timers.set(++timerId, fn), timerId), clearInterval: id => timers.delete(id),
  }, { state: 'ready', onmodels() {} }, 'setOpen(value) { open = value }');
  subject.value.setOpen(true); subject.effect();
  assert.equal(reads, 1);
  assert.equal(timers.size, 0, 'Slow telemetry must not keep ticking a polling timer.');
  wait.resolve({}); await settle();
  assert.equal(timers.size, 1);
  doc.hidden = true; listeners.get('visibilitychange')?.();
  assert.equal(timers.size, 0, 'Hidden pages must stop polling.');
  doc.hidden = false; listeners.get('visibilitychange')?.(); await settle();
  assert.equal(reads, 2, 'Returning to the page refreshes immediately.');
  subject.destroy(); assert.equal(timers.size, 0);
});

test('SSE: fragmented UTF-8, CRLF, heartbeat and final frames remain intact', async () => {
  const bytes = new TextEncoder().encode(': heartbeat\r\ndata: {"type":"progress",\r\ndata: "message":"Zażółć"}\r\n\r\ndata: {"type":"done"}');
  let offset = 0, cancelled = 0, released = 0; const events = [];
  const reader = { read: async () => offset < bytes.length ? { value: bytes.slice(offset, ++offset), done: false } : { done: true }, cancel: async () => cancelled++, releaseLock: () => released++ };
  const { productionStream } = await execute('production.ts', { request: async () => ({ ok: true, body: { getReader: () => reader } }) });
  await productionStream('/qa', {}, event => events.push(event));
  assert.deepEqual(events, [{ type: 'progress', message: 'Zażółć' }, { type: 'done' }]);
  assert.equal(cancelled, 0); assert.equal(released, 1);
});

test('JSON: read deadline and parent cancellation work together without limiting renders', async () => {
  const deadline = new AbortController(), parent = new AbortController(); const timeouts = [], signals = [];
  const { productionJson } = await execute('production.ts', {
    AbortSignal: { timeout: ms => (timeouts.push(ms), deadline.signal), any: signals => AbortSignal.any(signals) },
    request: async (_path, options) => { signals.push(options.signal); return { ok: true, json: async () => ({}) }; },
  });
  await productionJson('/qa', { signal: parent.signal });
  assert.deepEqual(timeouts, [15000]); assert.notEqual(signals[0], parent.signal);
  parent.abort(); assert.equal(signals[0].aborted, true);
  await productionJson('/render', { method: 'POST' }); assert.deepEqual(timeouts, [15000]);
  await assert.rejects(productionJson('/qa', { signal: parent.signal }), error => error.name === 'AbortError');
  assert.equal(signals.length, 2, 'An already cancelled read must not be sent.');
});

test('API: profiles and health retain deadlines and accept caller cancellation', async () => {
  const signals = [];
  const api = await execute('api.ts', { isTauri: () => false, fetch: async (_path, options) => { signals.push(options.signal); return { ok: true, json: async () => [] }; } });
  const parent = new AbortController();
  await api.health(parent.signal); await api.profiles(parent.signal);
  parent.abort(); assert.ok(signals.every(signal => signal.aborted));
  await assert.rejects(api.profiles(parent.signal), error => error.name === 'AbortError');
  assert.equal(signals.length, 2);
});

test('AI transport: supplying a lifecycle signal retains the request deadline', async () => {
  const ms = [], signals = [];
  const ai = await execute('ai.ts', {
    AbortSignal: { timeout: value => (ms.push(value), new AbortController().signal), any: values => AbortSignal.any(values) },
    request: async (_path, options) => { signals.push(options.signal); return { ok: true, json: async () => ({}) }; },
  });
  const parent = new AbortController();
  await ai.getAISettings(parent.signal); await ai.testAI(parent.signal);
  assert.deepEqual(ms, [20000, 155000]); parent.abort(); assert.ok(signals.every(signal => signal.aborted));
});

test('Engine catalog: a pre-selection read cannot overwrite confirmed selection', async () => {
  const stale = deferred(), fresh = deferred(); let reads = 0, changes = 0;
  const subject = await modelsPage({
    engineCatalog: () => reads++ === 0 ? stale.promise : fresh.promise,
    selectEngine: async () => ({ active: 'new', env_override: false }),
  }, { onchange: async () => { changes++; } });
  const selecting = subject.value.select('tts', { id: 'new' }); await flushed();
  assert.equal(reads, 2);
  fresh.resolve({ tts: { active: 'new', backends: [] } }); await selecting;
  stale.resolve({ tts: { active: 'old', backends: [] } }); await flushed();
  assert.equal(subject.value.catalog.tts.active, 'new'); assert.equal(changes, 1); subject.destroy();
});

test('Engine catalog: closing during selection prevents late follow-up work', async () => {
  const selection = deferred(); let changes = 0, reads = 0; let signal;
  const subject = await modelsPage({
    engineCatalog: async () => { reads++; return { tts: { active: 'old', backends: [] } }; },
    selectEngine: (_family, _id, value) => { signal = value; return selection.promise; },
  }, { onchange: async () => { changes++; } });
  await flushed(); const running = subject.value.select('tts', { id: 'new' }); subject.destroy();
  assert.equal(signal.aborted, true);
  selection.resolve({ active: 'new', env_override: false }); await running;
  assert.equal(reads, 1); assert.equal(changes, 0);
});

test('Voice manager: late audio after closing cannot allocate a Blob URL', async () => {
  const audio = deferred(); let created = 0;
  const subject = await component('VoiceManager.svelte', {
    request: async () => ({ ok: true, blob: () => audio.promise }),
    URL: { createObjectURL: () => (created++, 'blob:qa'), revokeObjectURL() {} },
  }, { ready: true, onchange: async () => {} }, 'preview, choose, get audioUrl() { return audioUrl }');
  subject.value.choose('qa'); const pending = subject.value.preview(); await settle();
  subject.destroy(); audio.resolve(new Blob(['QA'], { type: 'audio/wav' })); await pending;
  assert.equal(created, 0); assert.equal(subject.value.audioUrl, '');
});

for (const filename of ['VoiceManager.svelte', 'ProductionWorkspace.svelte']) {
  test(`${filename}: old cleanup cannot unlock a new operation after reconnect`, async () => {
    const first = deferred(), second = deferred();
    const subject = await component(filename, { ...(filename === 'ProductionWorkspace.svelte' ? { profiles: async () => [] } : {}), productionJson: async path => path.startsWith('/longform') ? { jobs: [] } : [] },
      { ready: true, kind: 'audiobooks', onchange: async () => {}, onnotify() {} },
      'work, setReady(value) { ready = value }, get busy() { return busy }');
    subject.effect(); await settle();
    const old = subject.value.work(async signal => { await first.promise; signal.throwIfAborted(); });
    subject.value.setReady(false); subject.effect(); subject.value.setReady(true); subject.effect(); await settle();
    const current = subject.value.work(async signal => { await second.promise; signal.throwIfAborted(); });
    first.resolve(); await old; assert.equal(subject.value.busy, true);
    second.resolve(); await current; assert.equal(subject.value.busy, false); subject.destroy();
  });
}

test('Dubbing translation: complete results have linear lookup cost and preserve source text', async () => {
  const count = 1000; let lookups = 0;
  const translated = Array.from({ length: count }, (_, id) => ({ get id() { lookups++; return String(id); }, text: `Tłumaczenie ${id}` })).reverse();
  const source = Array.from({ length: count }, (_, id) => ({ id, start: id, end: id + 1, text: `Oryginał ${id}` }));
  const subject = await component('ProductionWorkspace.svelte', {
    productionJson: async () => ({ translated }), postJson: body => body,
  }, { ready: true, kind: 'dubbing', onnotify() {} }, 'translateDub, setSegments(value) { segments = value }, get segments() { return segments }');
  subject.value.setSegments(source); await subject.value.translateDub();
  assert.ok(lookups <= count * 2, `Expected linear lookup count, got ${lookups}.`);
  assert.equal(subject.value.segments[0].text, 'Tłumaczenie 0');
  assert.equal(subject.value.segments[0].text_original, 'Oryginał 0');
  subject.destroy();
});

test('Dubbing translation: incomplete results leave source unchanged and report the failure', async () => {
  const source = [{ id: 0, start: 0, end: 1, text: 'Pierwszy' }, { id: 1, start: 1, end: 2, text: 'Drugi' }];
  const subject = await component('ProductionWorkspace.svelte', {
    productionJson: async () => ({ translated: [{ id: '0', text: 'First' }] }), postJson: body => body,
  }, { ready: true, kind: 'dubbing', onnotify() {} }, 'translateDub, setSegments(value) { segments = value }, get segments() { return segments }, get error() { return error }, get translated() { return translated }');
  subject.value.setSegments(source); await subject.value.translateDub();
  assert.deepEqual(subject.value.segments, source);
  assert.equal(subject.value.translated, false);
  assert.match(subject.value.error, /Nie wszystkie segmenty/);
  subject.destroy();
});

test('App catalog: a background snapshot cannot undo a confirmed selection', async () => {
  const stale = deferred(); let reads = 0;
  const subject = await appModels({ engineCatalog: () => reads++ === 0 ? stale.promise : Promise.resolve({ tts: { active: 'new', backends: [] } }), selectEngine: async () => ({ active: 'new', env_override: false }) });
  const refreshing = subject.refreshEngine(); await subject.chooseInstalledModel('new');
  stale.resolve({ tts: { active: 'old', backends: [] } }); await refreshing;
  assert.equal(subject.family.active, 'new');
});

test('App catalog: the old dialog request cannot complete a newer loading state', async () => {
  const stale = deferred(), fresh = deferred(); let reads = 0;
  const subject = await appModels({ engineCatalog: () => reads++ === 0 ? stale.promise : fresh.promise });
  const first = subject.loadPickerModels(); const second = subject.loadPickerModels();
  stale.resolve({ tts: { active: 'old-dialog', backends: [] } }); await first;
  const stillLoading = subject.loading;
  fresh.resolve({ tts: { active: 'new-dialog', backends: [] } }); await second;
  assert.equal(stillLoading, true); assert.equal(subject.family.active, 'new-dialog'); assert.equal(subject.error, '');
});

test('App catalog: background refresh waits for an in-flight selection', async () => {
  const selected = deferred(); let reads = 0;
  const subject = await appModels({ engineCatalog: async () => { reads++; return { tts: { active: 'new', backends: [] } }; }, selectEngine: () => selected.promise });
  const selecting = subject.chooseInstalledModel('new'); const refreshing = subject.refreshEngine();
  await settle(); const earlyReads = reads;
  selected.resolve({ active: 'new', env_override: false }); await Promise.all([selecting, refreshing]);
  assert.equal(earlyReads, 0); assert.equal(reads, 1); assert.equal(subject.family.active, 'new');
});

test('App catalog: a reopened picker waits for the previous selection to settle', async () => {
  const selected = deferred(); let reads = 0;
  const subject = await appModels({ engineCatalog: async () => { reads++; return { tts: { active: 'new', backends: [] } }; }, selectEngine: () => selected.promise });
  const selecting = subject.chooseInstalledModel('new'); const loading = subject.loadPickerModels();
  await settle(); const earlyReads = reads;
  selected.resolve({ active: 'new', env_override: false }); await Promise.all([selecting, loading]);
  assert.equal(earlyReads, 0); assert.equal(subject.family.active, 'new'); assert.equal(subject.loading, false);
});

test('App catalog: closing App cancels reads and writes and ignores late responses', async () => {
  const read = deferred(), write = deferred(); const signals = []; let reads = 0;
  const subject = await appModels({
    engineCatalog: signal => { reads++; signals.push(signal); return read.promise; },
    selectEngine: (_family, _id, signal) => { signals.push(signal); return write.promise; },
  });
  const refresh = subject.refreshEngine(); const selection = subject.chooseInstalledModel('new').catch(error => error.name);
  subject.disposeModelRequests(); assert.ok(signals.every(signal => signal.aborted));
  read.resolve({ tts: { active: 'late-read', backends: [] } }); write.resolve({ active: 'new', env_override: false });
  await refresh; assert.equal(await selection, 'AbortError'); assert.equal(reads, 1); assert.equal(subject.family.active, 'old');
});

test('App catalog: selection failure releases the next attempt', async () => {
  let writes = 0;
  const subject = await appModels({ engineCatalog: async () => ({ tts: { active: 'new', backends: [] } }),
    selectEngine: async () => { if (++writes === 1) throw Error('Kontrolowany błąd wyboru'); return { active: 'new', env_override: false }; } });
  await assert.rejects(subject.chooseInstalledModel('new'), /Kontrolowany błąd/);
  await subject.chooseInstalledModel('new'); assert.equal(writes, 2); assert.equal(subject.family.active, 'new');
});

test('App catalog: a superseded dialog error cannot overwrite a newer successful load', async () => {
  const stale = deferred(), fresh = deferred(); let reads = 0;
  const subject = await appModels({ engineCatalog: () => reads++ === 0 ? stale.promise : fresh.promise });
  const first = subject.loadPickerModels(); const second = subject.loadPickerModels();
  fresh.resolve({ tts: { active: 'new-dialog', backends: [] } }); await second;
  stale.reject(Error('Błąd starego okna')); await first;
  assert.equal(subject.error, ''); assert.equal(subject.family.active, 'new-dialog'); assert.equal(subject.loading, false);
});

let failed = 0;
for (const { name, run } of checks) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n  ${error.message}`); }
}
console.log(`Async UI: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exitCode = 1;
