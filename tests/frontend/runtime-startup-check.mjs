import strict from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { i18n } from '../helpers/i18n.mjs';

let checks = 0;
const assert = new Proxy(strict, { get: (target, key) => typeof target[key] === 'function' ? (...args) => { checks++; return target[key](...args); } : target[key] });
const source = await readFile(new URL('../../frontend/src/platform/runtime.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(invoke = async () => { throw new Error('Unexpected invoke'); }) {
  const exports = {};
  // The one-time idle-minutes sync is covered by engine-idle-check.mjs; these checks follow the lease flow.
  const lease = invoke; invoke = async (command, args) => ['runtime_set_idle_minutes', 'runtime_set_preload'].includes(command) ? undefined : lease(command, args);
  new Function('exports', 'require', 'window', 'CustomEvent', code)(exports, specifier => specifier.endsWith('/i18n') ? i18n : { invoke, isTauri: () => true }, { dispatchEvent() {} }, class { constructor(type, options) { this.type = type; this.detail = options.detail; } });
  return exports;
}
const { RuntimeStartupDeadline } = load();
const starting = (progress = {}) => ({ state: 'starting', managed: true, port: 4312, message: 'fixture', startup: { runId: 'own-current-run', phase: 'preparing', revision: 0, copiedPages: 0, totalPages: null, copiedBytes: 0, totalBytes: null, files: null, backupComplete: false, logReadError: false, ...progress } });
const clock = new RuntimeStartupDeadline(0);
assert.equal(clock.expired(304_999), false);
assert.equal(clock.expired(305_000), true);
clock.observe(starting({ phase: 'backup_plan' }), 170_000);
assert.equal(clock.expired(305_000), true, 'Planning and a heartbeat cannot buy more time.');
clock.observe(starting({ phase: 'backup_database', revision: 1, copiedPages: 5, totalPages: 10 }), 170_000);
assert.equal(clock.expired(474_999), false);
for (const progress of [
  { phase: 'backup_database', revision: 2, copiedPages: 5, totalPages: 10 },
  { phase: 'backup_database', revision: 2, copiedPages: 4, totalPages: 10 },
  { phase: 'backup_database', revision: 2, copiedPages: 6, totalPages: 11 },
  { phase: 'backup_files', revision: 2, copiedPages: 5, totalPages: 10, copiedBytes: -1, totalBytes: 10 },
  { phase: 'backup_files', revision: 2, copiedPages: 5, totalPages: 10, copiedBytes: Number.MAX_SAFE_INTEGER + 1, totalBytes: Number.MAX_SAFE_INTEGER + 1 },
  { phase: 'untrusted_heartbeat', revision: 2, copiedPages: 5, totalPages: 10, copiedBytes: 5, totalBytes: 10 },
]) { clock.observe(starting(progress), 350_000); assert.equal(clock.expired(475_000), true); }
clock.observe(starting({ phase: 'backup_database', revision: 2, copiedPages: 10, totalPages: 10 }), 350_000);
assert.equal(clock.expired(654_999), false);
clock.observe(starting({ phase: 'backup_files', revision: 3, copiedPages: 10, totalPages: 10, copiedBytes: 40, totalBytes: 80 }), 500_000);
assert.equal(clock.expired(804_999), false);
clock.observe(starting({ phase: 'backup_files', revision: 4, copiedPages: 10, totalPages: 10, copiedBytes: 40, totalBytes: 80 }), 680_000);
assert.equal(clock.expired(805_000), true, 'Same counter even with a fresh revision is stalled.');
const completed = starting({ phase: 'backend_starting', revision: 4, copiedPages: 10, totalPages: 10, copiedBytes: 200, totalBytes: 200, files: 2, backupComplete: true });
clock.observe(completed, 680_000);
assert.equal(clock.expired(984_999), false, 'Receipt starts a separate ordinary backend budget.');
clock.observe(completed, 860_000);
assert.equal(clock.expired(985_000), true, 'Receipt is accepted only once.');
assert.throws(() => clock.observe(starting({ runId: 'restarted-foreign-session' }), 860_000), /Sesja/);
const absent = new RuntimeStartupDeadline(0);
absent.observe({ state: 'starting' }, 180_000);
absent.observe(starting({ runId: '', revision: 100, copiedBytes: 100 }), 180_000);
assert.equal(absent.expired(305_000), true, 'Missing or malformed provenance cannot extend waiting.');

const relocation = new RuntimeStartupDeadline(0);
relocation.observe(starting({ phase: 'relocation_files', revision: 1, copiedBytes: 100, totalBytes: 200 }), 170_000);
assert.equal(relocation.expired(474_999), false, 'Actual DATA copying renews the UI deadline.');
for (const progress of [
  { phase: 'relocation_files', revision: 2, copiedBytes: 100, totalBytes: 200 },
  { phase: 'relocation_files', revision: 2, copiedBytes: 99, totalBytes: 200 },
  { phase: 'relocation_files', revision: 2, copiedBytes: 101, totalBytes: 201 },
  { phase: 'relocation_files', revision: 2, copiedBytes: 201, totalBytes: 200 },
  { phase: 'relocation_database', revision: 2, copiedPages: 1, totalPages: 10, copiedBytes: 100, totalBytes: 200, backupComplete: true },
]) { relocation.observe(starting(progress), 350_000); assert.equal(relocation.expired(475_000), true, 'Stalled or malformed relocation cannot extend waiting.'); }
relocation.observe(starting({ phase: 'relocation_database', revision: 2, copiedPages: 5, totalPages: 10, copiedBytes: 100, totalBytes: 200 }), 350_000);
assert.equal(relocation.expired(654_999), false, 'Actual relocated SQLite pages renew independently of bytes.');
relocation.observe(starting({ phase: 'relocation_files', revision: 3, copiedPages: 10, totalPages: 10, copiedBytes: 200, totalBytes: 200 }), 500_000);
assert.equal(relocation.expired(804_999), false);
relocation.observe(starting({ phase: 'preparing', revision: 4 }), 680_000);
assert.equal(relocation.expired(805_000), true, 'The counter reset itself is not copied data.');
relocation.observe(starting({ phase: 'relocation_files', revision: 5, copiedPages: 10, totalPages: 10, copiedBytes: 201, totalBytes: 200 }), 680_000);
assert.equal(relocation.expired(805_000), true, 'Closed relocation cannot be replayed.');
relocation.observe(starting({ phase: 'backup_database', revision: 5, copiedPages: 1, totalPages: 5 }), 681_000);
assert.equal(relocation.expired(985_999), false, 'Backup counters may be smaller than relocation counters.');
relocation.observe(starting({ phase: 'backup_files', revision: 6, copiedPages: 5, totalPages: 5, copiedBytes: 10, totalBytes: 20 }), 850_000);
assert.equal(relocation.expired(1_154_999), false);
relocation.observe(starting({ phase: 'backend_starting', revision: 7, copiedPages: 5, totalPages: 5, copiedBytes: 25, totalBytes: 25, files: 2, backupComplete: true }), 1_030_000);
assert.equal(relocation.expired(1_334_999), false);
const missedReset = new RuntimeStartupDeadline(0);
missedReset.observe(starting({ phase: 'relocation_files', revision: 2, copiedBytes: 1000, totalBytes: 2000 }), 170_000);
missedReset.observe(starting({ phase: 'backup_database', revision: 5, copiedPages: 1, totalPages: 2 }), 350_000);
assert.equal(missedReset.expired(654_999), false, 'Polling may miss relocation completion and the backup plan.');
missedReset.observe(starting({ phase: 'relocation_files', revision: 6, copiedBytes: 1100, totalBytes: 2000 }), 530_000);
assert.equal(missedReset.expired(655_000), true, 'Relocation cannot resume after the backup phase began.');

const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const ready = { state: 'ready', managed: true, message: 'ready', port: 4312 };
{
  const calls = [];
  const runtime = load(async (command, args) => { calls.push([command, args]); return command === 'runtime_acquire' ? { lease: 1, status: ready } : undefined; });
  const release = await runtime.acquireRuntime();
  await release(); await release();
  assert.deepEqual(calls.map(([name]) => name), ['runtime_acquire', 'runtime_release']);
  assert.deepEqual(calls[1][1], { lease: 1, cancelStartup: false });
}
{
  const calls = [], status = defer();
  const runtime = load(async (command, args) => { calls.push([command, args]); if (command === 'runtime_acquire') return { lease: 2, status: starting() }; if (command === 'runtime_status') return status.promise; });
  const controller = new AbortController();
  const pending = runtime.acquireRuntime(controller.signal);
  await tick();
  controller.abort(new DOMException('fixture cancelled', 'AbortError'));
  await assert.rejects(pending, /fixture cancelled/);
  assert.deepEqual(calls.find(([name]) => name === 'runtime_release')[1], { lease: 2, cancelStartup: true });
  status.resolve({ state: 'stopped', message: 'cancelled', port: 4312, managed: false });
  await tick();
  assert.equal(calls.filter(([name]) => name === 'runtime_release').length, 1);
}
{
  const calls = [], status = defer(); let lease = 10;
  const runtime = load(async (command, args) => { calls.push([command, args]); if (command === 'runtime_acquire') return { lease: ++lease, status: starting() }; if (command === 'runtime_status') return status.promise; });
  const controller = new AbortController();
  const first = runtime.acquireRuntime(controller.signal);
  const second = runtime.acquireRuntime();
  await tick();
  controller.abort(new DOMException('first cancelled', 'AbortError'));
  await assert.rejects(first, /first cancelled/);
  status.resolve(ready);
  const releaseSecond = await second;
  await releaseSecond();
  assert.equal(calls.filter(([name]) => name === 'runtime_status').length, 1, 'Waiters share the readiness poll, not the individual cancellation.');
  assert.deepEqual(calls.filter(([name]) => name === 'runtime_release').map(([, args]) => args), [{ lease: 11, cancelStartup: true }, { lease: 12, cancelStartup: false }]);
}
{
  const calls = [];
  const runtime = load(async (command, args) => { calls.push([command, args]); if (command === 'runtime_acquire') return { lease: 20, status: starting() }; if (command === 'runtime_status') return { state: 'error', message: 'backup fixture failure', port: 4312, managed: false }; });
  await assert.rejects(runtime.acquireRuntime(), /backup fixture failure/);
  assert.deepEqual(calls.find(([name]) => name === 'runtime_release')[1], { lease: 20, cancelStartup: false });
}
console.log(`PASS: ${checks} runtime startup/deadline/abort checks; no backend, model or private backup started.`);
