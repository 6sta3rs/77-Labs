import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function module(name, deps) {
  let source = await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const node of [...parsed.statements].reverse()) if (ts.isImportDeclaration(node)) source = source.slice(0, node.pos) + source.slice(node.end);
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('exports', ...Object.keys(deps), code)(exports, ...Object.values(deps));
  return exports;
}
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const status = state => ({ state, message: state, port: 4312, managed: state !== 'stopped' });
let checks = 0;
async function test(name, run) { await run(); checks++; console.log(`PASS ${name}`); }

await test('Concurrent cold requests share readiness; cancelling one keeps the other alive', async () => {
  let lease = 0, polls = 0; const released = [], ready = deferred();
  const runtime = await module('runtime', { isTauri: () => true, window: new EventTarget(), invoke: async (command, args) => {
    if (command === 'runtime_acquire') return { lease: ++lease, status: status('starting') };
    if (command === 'runtime_status') { polls++; return ready.promise; }
    if (command === 'runtime_release') { released.push(args.lease); }
  } });
  const abort = new AbortController();
  const a = runtime.acquireRuntime(abort.signal).then(() => 'unexpected', error => error.name);
  const b = runtime.acquireRuntime();
  await settle(); abort.abort(); await settle();
  assert.equal(await a, 'AbortError');
  assert.deepEqual(released, [1]);
  ready.resolve(status('ready'));
  const release = await b; await release(); await release();
  assert.equal(polls, 1); assert.deepEqual(released, [1, 2]);
});

await test('Startup errors release their Rust lease', async () => {
  let released = 0;
  const runtime = await module('runtime', { isTauri: () => true, window: new EventTarget(), invoke: async command => {
    if (command === 'runtime_acquire') return { lease: 1, status: status('error') };
    if (command === 'runtime_release') released++;
  } });
  await assert.rejects(runtime.acquireRuntime(), /error/); assert.equal(released, 1);
});

await test('Cold profile and portrait reads use Rust without starting the engine', async () => {
  const calls = [];
  const api = await module('api', { isTauri: () => true, isDesktop: () => true, invoke: async (command) => {
    calls.push(command); return command === 'library_profiles' ? [{ id: 'a', name: 'Test', ref_text: 'Reference' }] : new Uint8Array([1, 2]).buffer;
  }, acquireRuntime: () => { throw new Error('Unexpected Python start'); }, ensureRuntime: () => { throw new Error('Unexpected Python start'); } });
  assert.equal((await (await api.request('/profiles')).json())[0].ref_text, 'Reference');
  assert.equal((await (await api.request('/profiles/a/image')).blob()).type, 'image/jpeg');
  assert.deepEqual(calls, ['library_profiles', 'library_portrait']);
});

await test('A failed request releases its lease; monitoring does not request a start', async () => {
  let active = 0; const keepWarm = [];
  const api = await module('api', { isTauri: () => true, acquireRuntime: async (signal, warm) => { keepWarm.push(warm); active++; return async () => { active--; }; },
    desktopFetch: async () => { assert.equal(active, 1); throw new Error('Transport failed'); } });
  await assert.rejects(api.request('/generate', { method: 'POST' }), /Transport failed/);
  assert.equal(active, 0);
  await assert.rejects(api.request('/sysinfo'), /Transport failed/);
  assert.deepEqual(keepWarm, [true, false]); assert.equal(active, 0);
});

await test('Metadata/monitor preflight stays cold; task preflight waits for readiness', async () => {
  let starts = 0;
  const api = await module('api', { isTauri: () => true, isDesktop: () => true, ensureRuntime: async () => { starts++; } });
  for (const path of ['/profiles', '/sysinfo', '/health', '/model/status', '/batch/jobs?limit=10']) await api.prepareRequest(path);
  assert.equal(starts, 0); await api.prepareRequest('/engines'); assert.equal(starts, 1);
});

await test('Browser preview keeps its existing transport', async () => {
  const api = await module('api', { isTauri: () => false, fetch: async path => new Response(path) });
  assert.equal(await (await api.request('/profiles')).text(), '/backend/profiles');
});
console.log(`${checks}/${checks} runtime client checks passed`);
