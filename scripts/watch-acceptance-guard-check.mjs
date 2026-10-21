// Exercise the actual prepared harness guard against controlled IPC/DOM ports.
// Does not launch the harness, EXE, browser, native API or any backend process.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('runtime/watch_folder_acceptance.py', import.meta.url), 'utf8');
const code = source.match(/GUARD = r"""([\s\S]*?)"""/)[1];
const ipc = [], http = [], binary = new ArrayBuffer(16), callbacks = new Map(); let nextCallback = 0;
const bridge = { runCallback: (key, value) => callbacks.get(key)?.(value) };
const host = { postMessage: raw => { const message = JSON.parse(raw); ipc.push(message.cmd); bridge.runCallback(message.callback, message.payload); } };
const window = { __TAURI_INTERNALS__: bridge, chrome: { webview: host }, fetch: async input => {
  const url = new URL(String(input)); http.push(String(input));
  if (url.hostname !== 'ipc.localhost') return 'own-asset';
  const command = decodeURIComponent(url.pathname.slice(1)); ipc.push(command);
  return new Response(command === 'watch_folder_read' ? binary : JSON.stringify({native: true}), {headers: {
    'Content-Type': command === 'watch_folder_read' ? 'application/octet-stream' : 'application/json', 'Tauri-Response': 'ok'
  }});
} };
// Reproduce actual immutable Tauri/Wry surfaces. No successful operation is
// replaced by the guard: allowed transport replies retain their real bytes.
Object.defineProperty(bridge, 'invoke', { value: async (command, args = {}) => {
  const response = await window.fetch('http://ipc.localhost/' + encodeURIComponent(command), {method: 'POST'});
  if (response.headers.get('Tauri-Response') !== 'ok') throw new Error(await response.json());
  return response.headers.get('Content-Type') === 'application/octet-stream' ? response.arrayBuffer() : response.json();
} });
Object.defineProperty(window, 'ipc', { value: Object.freeze({postMessage: raw => window.chrome.webview.postMessage(raw)}) });
const navigator = { mediaDevices: { getUserMedia: () => { throw Error('Physical microphone must never be reached'); } } };
const location = { href: 'http://tauri.localhost/', origin: 'http://tauri.localhost' };
const install = new Function('window', 'navigator', 'location', code);
install(window, navigator, location); const invoke = window.__TAURI_INTERNALS__.invoke;
assert.deepEqual(await invoke('watch_folder_read', { key: 'fixture' }), binary);
await invoke('watch_folder_status', {}); assert.deepEqual(ipc, ['watch_folder_read', 'watch_folder_status']);
for (const command of ['runtime_start', 'runtime_acquire', 'installer_start', 'installer_activate', 'plugin:http|fetch', 'plugin:http|fetch_send', 'watch_folder_pick']) await assert.rejects(invoke(command, {}), /refuses/);
assert.deepEqual(ipc, ['watch_folder_read', 'watch_folder_status'], 'Blocked dispatch must never reach native IPC');
assert.equal(await window.fetch('http://tauri.localhost/assets/app.js'), 'own-asset');
for (const url of ['http://127.0.0.1:4312/generate', 'https://external.example/data']) assert.throws(() => window.fetch(url), /denied/);
assert.equal(http.length, 3); await assert.rejects(navigator.mediaDevices.getUserMedia(), /disabled/);
function fallback(command, args) { return new Promise((resolve, reject) => {
  const callback = ++nextCallback, error = ++nextCallback; callbacks.set(callback, resolve); callbacks.set(error, value => reject(new Error(value)));
  window.ipc.postMessage(JSON.stringify({cmd: command, callback, error, payload: args}));
}); }
assert.deepEqual(await fallback('watch_folder_status', {actual: 'fallback'}), {actual: 'fallback'});
await assert.rejects(fallback('runtime_start', {}), /refuses/);
assert.deepEqual(ipc, ['watch_folder_read', 'watch_folder_status', 'watch_folder_status'], 'Fallback cannot bypass the same native allowlist');
assert.equal(Object.getOwnPropertyDescriptor(bridge, 'invoke').writable, false);
install(window, navigator, location); assert.equal(window.__TAURI_INTERNALS__.invoke, invoke, 'Guard installation must be idempotent');
console.log('Watch EXE acceptance guard: immutable Tauri/Wry IPC retained, actual fetch/fallback bytes forwarded; start/download/HTTP/picker/microphone blocked before dispatch; install idempotent.');
