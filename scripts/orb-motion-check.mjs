import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

let intersections = 0, mutations = 0, disconnected = 0;
const documentEvents = new EventTarget();
const media = new EventTarget(); media.matches = false;
const observed = new Set();
globalThis.document = Object.assign(documentEvents, { hidden: false, documentElement: { dataset: {} } });
globalThis.matchMedia = () => media;
globalThis.MutationObserver = class { constructor(callback) { mutations++; this.callback = callback; globalThis.mutation = this; } observe() {} disconnect() { disconnected++; } };
globalThis.IntersectionObserver = class { constructor(callback) { intersections++; this.callback = callback; globalThis.intersection = this; } observe(element) { observed.add(element); } unobserve(element) { observed.delete(element); } disconnect() { disconnected++; } };
const code = ts.transpileModule(await readFile(new URL('../src/lib/orb-motion.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { observeOrbMotion } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const elements = Array.from({ length: 20 }, () => ({})), states = [];
const dispose = elements.map((element, index) => observeOrbMotion(element, state => states[index] = state));
assert.deepEqual([intersections, mutations, observed.size], [1, 1, 20]);
assert.ok(states.every(state => !state.visible && !state.hidden && !state.reduced));
intersection.callback(elements.map(target => ({ target, isIntersecting: true, intersectionRect: { width: 10, height: 10 } })));
assert.ok(states.every(state => state.visible));
media.matches = true; media.dispatchEvent(new Event('change'));
assert.ok(states.every(state => state.reduced), 'System reduced motion applies to every orb');
media.matches = false; document.documentElement.dataset.reducedMotion = 'true'; mutation.callback();
assert.ok(states.every(state => state.reduced), 'App preference is retained when system motion is enabled');
document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
assert.ok(states.every(state => state.hidden));
for (const cleanup of dispose) cleanup();
assert.equal(observed.size, 0); assert.equal(disconnected, 2);
const fresh = observeOrbMotion({}, () => {});
assert.deepEqual([intersections, mutations], [2, 2], 'Subscriptions restart after full cleanup');
fresh();
console.log('Orb shared observation, system/app motion and cleanup: 9 checks passed');
