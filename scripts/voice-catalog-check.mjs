// Run: node scripts/voice-catalog-check.mjs
// Execute real catalog state and API functions with an inert, controlled transport.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { get, writable } from 'svelte/store';
import ts from 'typescript';

const root = new URL('../src/lib/', import.meta.url);
async function execute(filename, dependencies = {}) {
  let source = await readFile(new URL(filename, root), 'utf8');
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const node of [...parsed.statements].reverse()) {
    if (ts.isImportDeclaration(node)) source = source.slice(0, node.pos) + source.slice(node.end);
  }
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exported = {};
  new Function('exports', ...Object.keys(dependencies), code)(exported, ...Object.values(dependencies));
  return exported;
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const catalog = active => ({
  tts: { active, backends: [{ id: active, available: true, supported_language_names: ['English'] }] },
  asr: { active: 'qa-asr', backends: [] }, llm: { active: 'qa-llm', backends: [] },
});
async function harness() {
  const calls = [];
  const state = await execute('engine-catalog-state.ts', { writable });
  const unexpectedTransport = () => { throw new Error('Unexpected real request: test transport must stay inert.'); };
  const { postJson } = await execute('production.ts', { request: unexpectedTransport, prepareRequest: unexpectedTransport });
  const productionJson = (path, options) => {
    const pending = deferred(); calls.push({ path, options, ...pending }); return pending.promise;
  };
  const api = await execute('studio-tools.ts', { ...state, productionJson, postJson, request: unexpectedTransport });
  return { ...state, ...api, calls, snapshot: () => get(state.engineCatalogSnapshot) };
}
const checks = [];
const test = (name, run) => checks.push({ name, run });

test('An empty catalog cache and subscriptions never start transport', async () => {
  const subject = await harness();
  const values = [];
  const unsubscribe = subject.engineCatalogSnapshot.subscribe(value => values.push(value));
  assert.deepEqual(values, [undefined]);
  assert.equal(subject.snapshot(), undefined);
  subject.beginCatalogRead(); subject.invalidateCatalogReads();
  assert.equal(subject.calls.length, 0);
  unsubscribe();
});

test('Only a matching read revision publishes a confirmed snapshot and timestamp', async () => {
  const subject = await harness(), value = catalog('first');
  const old = subject.beginCatalogRead(), current = subject.beginCatalogRead();
  assert.equal(subject.publishEngineCatalog(value, old), false);
  assert.equal(subject.snapshot(), undefined);
  const before = Date.now();
  assert.equal(subject.publishEngineCatalog(value, current), true);
  assert.equal(subject.snapshot().catalog, value);
  assert.ok(subject.snapshot().checkedAt >= before && subject.snapshot().checkedAt <= Date.now());
});

test('engineCatalog publishes only after a successful explicit catalog request', async () => {
  const subject = await harness(), value = catalog('confirmed');
  const pending = subject.engineCatalog();
  assert.equal(subject.calls.length, 1);
  assert.equal(subject.calls[0].path, '/engines');
  assert.equal(subject.snapshot(), undefined);
  subject.calls[0].resolve(value);
  assert.equal(await pending, value);
  assert.equal(subject.snapshot().catalog, value);
});

test('A slower older GET cannot overwrite a later confirmed GET', async () => {
  const subject = await harness(), oldValue = catalog('old'), newValue = catalog('new');
  const oldRead = subject.engineCatalog(), newRead = subject.engineCatalog();
  subject.calls[1].resolve(newValue); await newRead;
  const confirmed = subject.snapshot();
  subject.calls[0].resolve(oldValue);
  await assert.rejects(oldRead, error => error.name === 'AbortError', 'Consumers must not receive an obsolete catalog.');
  assert.equal(subject.snapshot(), confirmed);
  assert.equal(subject.snapshot().catalog.tts.active, 'new');
});

test('Selecting an engine invalidates old reads and waits for a confirming catalog', async () => {
  const subject = await harness(), oldRead = subject.engineCatalog();
  const choosing = subject.selectEngine('tts', 'new');
  assert.equal(subject.calls[1].path, '/engines/select');
  assert.equal(subject.calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(subject.calls[1].options.body), { family: 'tts', backend_id: 'new' });
  subject.calls[0].resolve(catalog('old'));
  await assert.rejects(oldRead, error => error.name === 'AbortError');
  assert.equal(subject.snapshot(), undefined);
  subject.calls[1].resolve({ active: 'new', env_override: false }); await choosing;
  assert.equal(subject.snapshot(), undefined, 'A selection response is not a confirmed full catalog.');
  const confirmation = subject.engineCatalog(), value = catalog('new');
  subject.calls[2].resolve(value); await confirmation;
  assert.equal(subject.snapshot().catalog, value);
});

test('Failed catalog requests preserve the last confirmed snapshot', async () => {
  const subject = await harness(), confirmed = catalog('confirmed');
  subject.publishEngineCatalog(confirmed, subject.beginCatalogRead());
  const snapshot = subject.snapshot(), pending = subject.engineCatalog();
  subject.calls[0].reject(new Error('Controlled catalog error'));
  await assert.rejects(pending, /Controlled catalog error/);
  assert.equal(subject.snapshot(), snapshot);
});

test('A superseded read stays invalid even if the newer request fails', async () => {
  const subject = await harness(), confirmed = catalog('confirmed');
  subject.publishEngineCatalog(confirmed, subject.beginCatalogRead());
  const snapshot = subject.snapshot(), oldRead = subject.engineCatalog(), newRead = subject.engineCatalog();
  subject.calls[1].reject(new Error('New read failed'));
  await assert.rejects(newRead, /New read failed/);
  subject.calls[0].resolve(catalog('stale'));
  await assert.rejects(oldRead, error => error.name === 'AbortError');
  assert.equal(subject.snapshot(), snapshot);
});

test('Cancellation prevents publishing even when the controlled transport ignores abort', async () => {
  const subject = await harness(), abort = new AbortController();
  const pending = subject.engineCatalog(abort.signal);
  assert.equal(subject.calls[0].options.signal, abort.signal);
  abort.abort(); subject.calls[0].resolve(catalog('cancelled'));
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(subject.snapshot(), undefined);
});

test('Failed selections cannot revive an invalidated pre-selection GET', async () => {
  const subject = await harness(), confirmed = catalog('confirmed');
  subject.publishEngineCatalog(confirmed, subject.beginCatalogRead());
  const snapshot = subject.snapshot(), oldRead = subject.engineCatalog();
  const choosing = subject.selectEngine('tts', 'unavailable');
  subject.calls[1].reject(new Error('Selection rejected'));
  await assert.rejects(choosing, /Selection rejected/);
  subject.calls[0].resolve(catalog('stale'));
  await assert.rejects(oldRead, error => error.name === 'AbortError');
  assert.equal(subject.snapshot(), snapshot);
});

test('All subscribed consumers observe the same confirmed state without extra requests', async () => {
  const subject = await harness(), a = [], b = [];
  const stopA = subject.engineCatalogSnapshot.subscribe(value => a.push(value));
  const stopB = subject.engineCatalogSnapshot.subscribe(value => b.push(value));
  const pending = subject.engineCatalog(); subject.calls[0].resolve(catalog('shared')); await pending;
  assert.equal(a.length, 2); assert.equal(b.length, 2);
  assert.equal(a[1], b[1]); assert.equal(a[1], subject.snapshot());
  stopA(); stopB();
  assert.equal(subject.calls.length, 1);
});

let failures = 0;
for (const { name, run } of checks) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
}
console.log(`Voice catalog: ${checks.length - failures}/${checks.length} passed.`);
if (failures) process.exitCode = 1;
