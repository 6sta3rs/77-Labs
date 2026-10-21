/** Native metadata polling must neither start nor keep the inference server warm. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';

let source = await readFile(new URL('../../src/lib/platform/api.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('api.ts', source, ts.ScriptTarget.Latest, true);
for (const statement of [...ast.statements].reverse()) if (ts.isImportDeclaration(statement)) source = source.slice(0, statement.pos) + source.slice(statement.end);
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/^export /gm, '');
let starts = 0, leases = [], releases = 0, calls = [];
const context = vm.createContext({ Headers, Response, AbortSignal, crypto, routeBackendPath: path => path, synchronizeRemoteRouting: async () => {}, publishRemoteState: () => {}, getRuntimeStatus: async () => ({state:'ready'}), isTauri: () => true, isDesktop: () => true,
  ensureRuntime: async () => { starts++; }, invoke: async () => [],
  acquireRuntime: async (_signal, keepWarm) => { leases.push(keepWarm); return async () => { releases++; }; },
  desktopFetch: async (url, options) => { calls.push({ url, options }); return new Response('{}', { headers: { 'Content-Type': 'application/json' } }); },
});
vm.runInContext(js + '\nglobalThis.client={request,prepareRequest,isRuntimeMonitor,runtimeMonitorPaths};', context);
const client = context.client;
for (const path of client.runtimeMonitorPaths) {
  await client.prepareRequest(path + '?qa=1');
  await client.request(path + '?qa=1');
}
assert.equal(starts, 0);
assert.ok(leases.length > 0 && leases.every(keepWarm => !keepWarm));
assert.equal(releases, leases.length);
await client.prepareRequest('/next/models/storage', undefined, 'PUT');
await client.request('/next/models/storage', { method: 'PUT', body: '{}' });
assert.equal(starts, 1);
assert.equal(leases.at(-1), true);
assert.equal(calls.at(-1).options.headers.get('X-VoiceStudio-CSRF'), '1');
assert.equal(calls.at(-1).options.headers.get('Origin'), 'http://tauri.localhost');
assert.equal(client.isRuntimeMonitor('/archetypes/preview'), false);
assert.equal(client.isRuntimeMonitor('/mcp'), false);
const server = spawnSync('python', ['-S', '-c', 'import sys,json;sys.path.insert(0,"scripts/runtime/app");import activity;print(json.dumps(sorted(activity.MONITORS)))'], { encoding: 'utf8' });
assert.equal(server.status, 0, server.stderr);
assert.deepEqual(JSON.parse(server.stdout), [...client.runtimeMonitorPaths].sort());
console.log('Runtime idle: PASS (metadata does not start/keep warm; mutations do; exact client/server paths; native CSRF/Origin preserved).');
