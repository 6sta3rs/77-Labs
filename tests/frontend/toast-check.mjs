/** Toast queue: one shared typed store, errors never auto-dismiss and render as role=alert with a close button. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const store = ts.transpileModule(await readFile(new URL('../../src/lib/ui/toast.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace("from 'svelte/store'", "from '" + new URL('../../node_modules/svelte/src/store/index-client.js', import.meta.url).href + "'");
const { toast, toasts, dismiss } = await import('data:text/javascript;base64,' + Buffer.from(store).toString('base64'));
const read = () => { let v; toasts.subscribe(x => v = x)(); return v; };
toast.bad('a'); toast.ok('b'); toast.warn('c'); toast.info('d');
assert.deepEqual(read().map(t => t.kind), ['ok', 'warn', 'info'], 'at most 3 kept, newest last');
dismiss(read()[0].id); assert.equal(read().length, 2);

const view = await readFile(new URL('../../src/lib/ui/Toaster.svelte', import.meta.url), 'utf8');
assert.match(view, /role=\{t\.kind === 'bad' \? 'alert' : 'status'\}/);
assert.match(view, /t\.kind === 'bad' \? 0/, 'errors have no timer');
assert.match(view, /Zamknij powiadomienie/);
const app = await readFile(new URL('../../src/App.svelte', import.meta.url), 'utf8');
assert.ok(!/class="toast"/.test(app) && !/setTimeout\(\(\)=>toast=''/.test(app), 'App must use the shared toast store, not a private timer');
console.log('PASS toast queue');
