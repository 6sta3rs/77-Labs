/** Download speed/ETA: smoothed over a few samples, reset on restart, formatted like the Models page rows. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../../frontend/src/models/download-eta.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { nextEta, rateText, etaTime } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const MB = 1024 * 1024;

let state = nextEta([], 0, 100 * MB, 0);
assert.equal(state.speed, undefined, 'a single sample has no speed');
state = nextEta(state.samples, 5 * MB, 100 * MB, 500);
assert.equal(state.speed, undefined, 'under one second of data is not trusted');
state = nextEta(state.samples, 10 * MB, 100 * MB, 1000);
assert.equal(state.speed, 10 * MB);
assert.equal(state.eta, 9);
for (let i = 2; i <= 12; i++) state = nextEta(state.samples, i * 10 * MB, 100 * MB, i * 1000);
assert.equal(state.samples.length, 6, 'window is bounded');
assert.equal(state.speed, 10 * MB);
state = nextEta(state.samples, 125 * MB, 100 * MB, 13000);
assert.equal(state.eta, undefined, 'no ETA once past the total');
state = nextEta(state.samples, 1 * MB, 100 * MB, 14000);
assert.equal(state.samples.length, 1, 'a smaller byte count restarts the window');
assert.equal(nextEta(state.samples, 2 * MB, null, 15000).eta, undefined, 'unknown total gives no ETA');
const stalled = nextEta([{ t: 0, bytes: MB }], MB, 10 * MB, 5000);
assert.equal(stalled.speed, undefined, 'no progress gives no speed');

const tr = (text, params = {}) => text.replace(/\{(\w+)\}/g, (_, key) => params[key]);
assert.equal(etaTime(20, tr), '20 s');
assert.equal(etaTime(180, tr), '3 min');
assert.equal(etaTime(3 * 3600 + 120, tr), '3 h 2 min');
assert.equal(rateText({ speed: 12.4 * MB, eta: 180 }, tr, b => `${(b / MB).toFixed(1)} MB`), '12.4 MB/s · pozostało ok. 3 min');
assert.equal(rateText({ speed: MB }, tr, b => `${b / MB} MB`), '1 MB/s');
assert.equal(rateText(undefined, tr, String), '');
console.log('PASS download ETA');
