import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function load(file, dependencies) {
  let source = await readFile(new URL(`../src/lib/${file}`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const node of [...parsed.statements].reverse()) if (ts.isImportDeclaration(node)) source = source.slice(0, node.pos) + source.slice(node.end);
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = {};
  new Function('exports', ...Object.keys(dependencies), code)(result, ...Object.values(dependencies));
  return result;
}
const api = await load('automation.ts', { generate: () => { throw Error('No ML'); }, request: () => { throw Error('No HTTP'); }, prepareRequest: () => {}, productionJson: () => { throw Error('No HTTP'); }, postJson: () => {} });
const watch = await load('watch-folder.ts', { invoke: () => { throw Error('No native calls without fixture'); }, isDesktop: () => true, ...api });
const recipe = () => ({ schema: 1, id: 'saved-audio', name: 'Audio do tekstu', inputKind: 'audio', updatedAt: 1, steps: [{ id: 'asr', kind: 'transcribe' }] });
const key = 'a'.repeat(64);
const bytes = new Uint8Array(48); bytes.set(new TextEncoder().encode('RIFF')); bytes.set(new TextEncoder().encode('WAVE'), 8);
const deferred = () => { let resolve; const promise = new Promise(yes => resolve = yes); return { promise, resolve }; };
const tests = [], test = (name, callback) => tests.push({ name, callback });
function storage() {
  const runs = new Map(), receipts = new Map();
  return { runs: async () => structuredClone([...runs.values()]), recipes: async () => [], putRun: async run => runs.set(run.id, structuredClone(run)), removeRun: async id => runs.delete(id), putRecipe: async () => {}, removeRecipe: async () => {},
    async putWatchedRun(run, sourceKey) {
      if (receipts.has(sourceKey)) return { runId: receipts.get(sourceKey), inserted: false };
      receipts.set(sourceKey, run.id); runs.set(run.id, structuredClone(run)); return { runId: run.id, inserted: true };
    }, receipts };
}
function fixture({ store = storage(), operation, read, acknowledge } = {}) {
  const seen = { starts: 0, reads: 0, acknowledgements: 0, stops: 0, operations: 0 };
  let file = { key, name: 'jawna-probka.wav', size: bytes.length, modifiedNs: '1234' };
  let status = { ...watch.emptyWatchStatus(), path: 'C:\\fixture', recipeId: recipe().id };
  const bridge = {
    status: async () => structuredClone(status),
    async start(path, recipeId) { seen.starts++; status = { ...status, enabled: true, state: 'watching', path, recipeId, pending: [file] }; return structuredClone(status); },
    async stop() { seen.stops++; status = { ...status, enabled: false, state: 'off', pending: [] }; return structuredClone(status); },
    async read(value) { seen.reads++; assert.equal(value, file.key); return read ? read() : bytes.slice().buffer; },
    async acknowledge(value, id) { seen.acknowledgements++; assert.equal(value, file.key); assert.equal(id, `watch-${value}`); if (acknowledge) await acknowledge(); status.pending = []; return structuredClone(status); },
    pick: async () => 'C:\\fixture',
  };
  const queue = api.createAutomationService({ store, now: () => 100, operations: { transcribe: async input => { seen.operations++; assert(input.blob instanceof Blob); assert.deepEqual(new Uint8Array(await input.blob.arrayBuffer()), bytes); return operation ? operation(input) : { kind: 'text', text: 'Jawny tekst.' }; } } });
  const service = watch.createWatchFolderService({ bridge, queue, now: () => 10, schedule: () => 1, unschedule: () => {} });
  return { seen, bridge, queue, service, store, setFile: value => file = value, setNative: value => Object.assign(status, value) };
}
async function idle(queue) { for (let i = 0; i < 100; i++) { if (!queue.snapshot().runs.some(api.activeAutomationRun)) return; await new Promise(resolve => setImmediate(resolve)); } throw Error('Fixture queue stayed active'); }

test('Source stays OFF until an explicit action and restores only the selection', async () => {
  const f = fixture(); await f.service.initialize(); assert.equal(f.seen.starts, 0); assert.equal(f.seen.reads, 0); assert.equal(f.service.snapshot().enabled, false); assert.equal(f.service.snapshot().path, 'C:\\fixture');
  await assert.rejects(f.service.start('C:\\fixture', { ...recipe(), inputKind: 'text', steps: [{ id: 'tts', kind: 'speak', voiceId: 'voice' }] }), /audio/);
});
test('Active local-only source does not require a cold backend', async () => {
  const pending = deferred(), f = fixture({ read: () => pending.promise });
  const local = { ...recipe(), steps: [{ id: 'local', kind: 'edit-audio' }] };
  await f.service.start('C:\\fixture', local);
  const ticking = f.service.tick();
  assert.equal(f.service.requiresRuntime(), false);
  await f.service.stop(); pending.resolve(bytes.slice().buffer); await ticking;
  assert.equal(f.seen.operations, 0); assert.equal(f.seen.acknowledgements, 0);
});
test('Actual Blob is persisted before native acknowledgement and source survives unsubscribing', async () => {
  const f = fixture({ acknowledge: async () => { assert.equal((await f.store.runs()).length, 1); assert(f.store.receipts.has(key)); } });
  const unsubscribe = f.service.subscribe(() => {}); await f.service.start('C:\\fixture', recipe()); unsubscribe(); await f.service.tick(); await idle(f.queue);
  assert.equal(f.seen.operations, 1); assert.equal(f.seen.acknowledgements, 1); assert.equal(f.service.snapshot().enabled, true); await f.service.stop();
});
test('Crash gap before native ack is retried without repeating the operation', async () => {
  let failure = true;
  const f = fixture({ acknowledge: async () => { if (failure) throw Error('Fixture failed ack'); } });
  await f.service.start('C:\\fixture', recipe()); await f.service.tick(); await idle(f.queue);
  assert.equal(f.service.snapshot().state, 'error'); assert.equal(f.seen.operations, 1);
  failure = false; await f.service.start('C:\\fixture', recipe()); await f.service.tick(); await idle(f.queue);
  assert.equal(f.seen.operations, 1); assert.equal(f.seen.acknowledgements, 2); await f.service.stop();
});
test('Durable receipt survives deleting history and constructing a fresh queue', async () => {
  const first = fixture(); await first.service.start('C:\\fixture', recipe()); await first.service.tick(); await idle(first.queue); await first.service.stop();
  await first.queue.removeRun(`watch-${key}`);
  const reopened = fixture({ store: first.store }); await reopened.service.start('C:\\fixture', recipe()); await reopened.service.tick();
  assert.equal(reopened.seen.operations, 0); assert.equal((await first.store.runs()).length, 0); assert.equal(reopened.seen.acknowledgements, 1); await reopened.service.stop();
});
test('Changed fingerprint is a distinct version; same fingerprint is never replayed', async () => {
  const f = fixture(); await f.service.start('C:\\fixture', recipe()); await f.service.tick(); await idle(f.queue); await f.service.stop();
  f.setFile({ key: 'b'.repeat(64), name: 'jawna-probka.wav', size: bytes.length, modifiedNs: '5678' });
  await f.service.start('C:\\fixture', recipe()); await f.service.tick(); await idle(f.queue); assert.equal(f.seen.operations, 2); await f.service.stop();
});
test('Stop during native read fences the result and does not enqueue or acknowledge it', async () => {
  const pending = deferred(), f = fixture({ read: () => pending.promise }); await f.service.start('C:\\fixture', recipe());
  const ticking = f.service.tick(); await f.service.stop(); pending.resolve(bytes.slice().buffer); await ticking;
  assert.equal(f.seen.operations, 0); assert.equal(f.seen.acknowledgements, 0); assert.equal((await f.store.runs()).length, 0);
});
test('Changed size, invalid extension and storage errors stop ingestion without acknowledging', async () => {
  const short = fixture({ read: async () => new ArrayBuffer(1) }); await short.service.start('C:\\fixture', recipe()); await short.service.tick(); assert.equal(short.service.snapshot().state, 'error'); assert.equal(short.seen.acknowledgements, 0);
  const executable = fixture(); executable.setFile({ key, name: 'recording.wav.exe', size: bytes.length, modifiedNs: '1' }); await executable.service.start('C:\\fixture', recipe()); await executable.service.tick(); assert.equal(executable.seen.reads, 0); assert.equal(executable.seen.operations, 0);
  const store = storage(); store.putWatchedRun = async () => { throw Error('Fixture storage unavailable'); };
  const quota = fixture({ store }); await quota.service.start('C:\\fixture', recipe()); await quota.service.tick(); assert.equal(quota.service.snapshot().state, 'error'); assert.equal(quota.seen.operations, 0); assert.equal(quota.seen.acknowledgements, 0);
});
test('Uncertain engine completion pauses the source instead of dispatching another input', async () => {
  const f = fixture({ operation: async () => { throw new DOMException('Disconnected fixture', 'AbortError'); } });
  await f.service.start('C:\\fixture', recipe()); await f.service.tick(); await idle(f.queue); await f.service.tick();
  assert.equal(f.service.snapshot().enabled, false); assert.match(f.service.snapshot().message, /potwierdzenie/); assert.equal(f.seen.operations, 1);
});
test('Reloaded webview disables an orphaned native selection and requires a new explicit start', async () => {
  const f = fixture(); f.setNative({ enabled: true, state: 'watching' }); await f.service.initialize(); assert.equal(f.seen.stops, 1); assert.equal(f.seen.operations, 0); assert.equal(f.service.snapshot().enabled, false);
});
test('Backpressure leaves the native file unacknowledged until queue capacity is available', async () => {
  const f = fixture(); let full = true;
  f.queue.snapshot = () => ({ recipes: [], runs: full ? Array.from({ length: 10 }, () => ({ status: 'queued' })) : [] });
  await f.service.start('C:\\fixture', recipe()); await f.service.tick(); assert.equal(f.seen.reads, 0); full = false; await f.service.tick(); await idle(f.queue); assert.equal(f.seen.acknowledgements, 1); await f.service.stop();
});
test('Production IndexedDB port atomically commits input and receipt and rolls both back on failure', async () => {
  // A controlled transaction driver exercises the actual IndexedDB port's
  // request callbacks, store selection, duplicate lookup and abort handling.
  const tables = new Map([['recipes', new Map()], ['runs', new Map()], ['watchReceipts', new Map()]]);
  let failReceipt = false;
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = { open(_name, version) {
    assert.equal(version, 2);
    const opened = { result: { close() {}, transaction(names, mode) {
      assert.deepEqual(names, ['runs', 'watchReceipts']); assert.equal(mode, 'readwrite');
      const staged = new Map(names.map(name => [name, new Map(tables.get(name))]));
      const transaction = { objectStore(name) {
        assert(staged.has(name));
        return { get(key) { const request = {}; pending++; queueMicrotask(() => { request.result = staged.get(name).get(key); request.onsuccess?.(); complete(); }); return request; },
          put(value) { pending++; queueMicrotask(() => {
            if (name === 'watchReceipts' && failReceipt) { aborted = true; transaction.onabort?.(); }
            else staged.get(name).set(name === 'watchReceipts' ? value.sourceKey : value.id, structuredClone(value));
            complete();
          }); return {}; } };
      } };
      let pending = 0, aborted = false;
      function complete() { if (--pending === 0) queueMicrotask(() => { if (!aborted) { for (const [name, rows] of staged) tables.set(name, rows); transaction.oncomplete?.(); } }); }
      return transaction;
    } } };
    queueMicrotask(() => opened.onsuccess?.()); return opened;
  } };
  try {
    const run = { id: `watch-${key}`, input: { kind: 'audio', blob: new Blob([bytes]), name: 'fixture.wav' } };
    assert.deepEqual(await api.automationStore.putWatchedRun(run, key), { runId: run.id, inserted: true });
    assert(tables.get('runs').get(run.id).input.blob instanceof Blob); assert.equal(tables.get('watchReceipts').get(key).runId, run.id);
    tables.get('runs').delete(run.id);
    assert.deepEqual(await api.automationStore.putWatchedRun(run, key), { runId: run.id, inserted: false }); assert.equal(tables.get('runs').size, 0);
    failReceipt = true; const otherKey = 'c'.repeat(64);
    await assert.rejects(api.automationStore.putWatchedRun({ ...run, id: `watch-${otherKey}` }, otherKey));
    assert.equal(tables.get('runs').size, 0); assert.equal(tables.get('watchReceipts').size, 1);
  } finally { if (previous === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = previous; }
});

let failed = 0;
for (const { name, callback } of tests) { try { await callback(); console.log(`PASS ${name}`); } catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); } }
console.log(`${tests.length - failed}/${tests.length} watch-folder checks passed. No native picker, network, ML or private files used.`);
if (failed) process.exitCode = 1;
