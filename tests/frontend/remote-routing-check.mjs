import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import vm from 'node:vm';
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const routing = await import('data:text/javascript;base64,' + Buffer.from(transpile(await readFile(new URL('../../src/lib/platform/remote-routing.ts', import.meta.url), 'utf8'))).toString('base64'));
let source = await readFile(new URL('../../src/lib/platform/api.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('api.ts', source, ts.ScriptTarget.Latest, true);
for (const statement of [...ast.statements].reverse()) if (ts.isImportDeclaration(statement)) source = source.slice(0, statement.pos) + source.slice(statement.end);
let nativeReads = 0, calls = [], bridgeRunning = false, remoteSelected = false;
const context = vm.createContext({ Headers, Response, AbortSignal, crypto, routeBackendPath: routing.routeBackendPath,
  synchronizeRemoteRouting: routing.synchronizeRemoteRouting, setRemoteRouting: routing.setRemoteRouting,
  publishRemoteState: value => routing.setRemoteRouting(value.active), getRuntimeStatus: async () => ({state:bridgeRunning?'ready':'stopped'}),
  isTauri: () => true, isDesktop: () => true, invoke: async () => { nativeReads++; return []; },
  acquireRuntime: async () => async () => {},
  desktopFetch: async (url, options) => { if(url.endsWith('/next/remote/state')) return new Response(JSON.stringify({active:remoteSelected})); calls.push({url, options}); return new Response('{}'); },
});
vm.runInContext(transpile(source).replace(/^export /gm, '') + '\nglobalThis.client={request};', context);
await context.client.request('/profiles');
assert.equal(nativeReads, 1);
assert.equal(calls.length, 0);
routing.remoteRouting.active = true;
bridgeRunning = true; remoteSelected = true;
await context.client.request('/profiles');
await context.client.request('/profiles/remote-id/image');
assert.equal(nativeReads, 1, 'Remote profiles and portraits must never hit local SQLite/files');
assert.equal(calls[0].url, 'http://127.0.0.1:4312/next/remote/proxy/profiles');
assert.equal(calls[1].url, 'http://127.0.0.1:4312/next/remote/proxy/profiles/remote-id/image');
assert.equal(calls[0].options.headers.get('X-VoiceStudio-CSRF'), '1');
await context.client.request('/health');
await context.client.request('/next/remote/local', {method:'POST'});
assert.equal(calls[2].url, 'http://127.0.0.1:4312/health');
assert.equal(calls[3].url, 'http://127.0.0.1:4312/next/remote/local');
const dictation = await import('data:text/javascript;base64,' + Buffer.from(transpile(await readFile(new URL('../../src/lib/tools/dictation/dictation.ts', import.meta.url), 'utf8'))).toString('base64'));
const ws = new URL(dictation.dictationSocketUrl(true, '', 'whisper-tiny', 16000, true));
assert.equal(ws.pathname, '/next/remote/ws');
assert.equal(ws.searchParams.get('path'), '/ws/transcribe');
assert.equal(ws.searchParams.get('sr'), '16000');
assert.equal(ws.searchParams.has('token'), false);
routing.remoteRouting.active = false;
await context.client.request('/generate', {method:'POST',body:'fixture'});
assert.equal(calls.at(-1).url,'http://127.0.0.1:4312/next/remote/proxy/generate','Renderer reload must synchronize the still-remote bridge before posting');
let complete; const delayed = new Promise(resolve => complete=resolve);
const synchronizing = routing.synchronizeRemoteRouting(()=>delayed,value=>routing.setRemoteRouting(value.active));
routing.setRemoteRouting(true); complete({active:false}); await synchronizing;
assert.equal(routing.remoteRouting.active,true,'An old handshake cannot undo a newer explicit connection');
routing.remoteRouting.active = false;
assert.equal(routing.routeBackendPath('/generate'), '/generate');
console.log('Remote routing: 15 assertions passed (real native request, reload and response races, profile isolation, local recovery and WS).');
