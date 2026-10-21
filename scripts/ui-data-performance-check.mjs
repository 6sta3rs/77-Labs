// Fast regression loop: run with `node scripts/ui-data-performance-check.mjs`.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';

async function load(name) {
  const source = await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
}
const tags = await load('tags');
const history = await load('history-view');
const errors = [];
const check = async (name, action) => { try { await action(); console.log(`PASS ${name}`); } catch (error) { errors.push(error); console.error(`FAIL ${name}: ${error.message}`); } };

await check('Unclosed tag candidates do not block editing', () => {
  const text = '['.repeat(30000), started = performance.now();
  assert.deepEqual(tags.tokenizeSpeech(text), [{ text, isTag: false }]);
  const elapsed = performance.now() - started;
  console.log(`Unclosed 30000-character tag: ${elapsed.toFixed(2)} ms`);
  assert.ok(elapsed < 100, `Tokenization stalled for ${elapsed.toFixed(2)} ms (budget 100 ms)`);
});

await check('Tokenization preserves the complete closed-token grammar', () => {
  // Compare against the existing grammar, including invalid nested brackets.
  const original = text => text.split(/(\[[^\]\r\n]+\])/g).filter(Boolean).map(text => ({ text, isTag: tags.audioTags.some(tag => tag.value === text) }));
  let seed = 5791;
  const symbols = ['[', ']', '\r', '\n', ' ', 'a', '[pause]', '[sigh]', '[unknown]'];
  for (let sample = 0; sample < 500; sample++) {
    let text = '';
    for (let i = 0; i < 40; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; text += symbols[seed % symbols.length]; }
    assert.deepEqual(tags.tokenizeSpeech(text), original(text));
  }
});

await check('Large history groups without scanning every previous day', () => {
  const now = Date.UTC(2026, 9, 19, 12), count = 4000;
  const rows = Array.from({ length: count }, (_, index) => ({ id: `qa-${index}`, title: 'QA', text: '', voice: 'QA', kind: 'audio', created: new Date(now - index * 86400000).toISOString() }));
  const originalFind = Array.prototype.find;
  let visits = 0, groups;
  const started = performance.now();
  try {
    Array.prototype.find = function(predicate, receiver) { return originalFind.call(this, (value, index, list) => { visits++; return predicate.call(receiver, value, index, list); }); };
    groups = history.groupRecordings(rows, now);
  } finally { Array.prototype.find = originalFind; }
  console.log(`History ${count} dates: ${(performance.now() - started).toFixed(2)} ms, ${visits} linear-search visits`);
  assert.equal(groups.length, count);
  assert.equal(groups.flatMap(group => group.rows).length, count);
  assert.equal(groups[0].rows[0].id, 'qa-0');
  assert.ok(visits <= count * 10, `${visits} repeated day comparisons for ${count} dates`);
});

await check('Relative dates reuse the Polish formatter across history rows', () => {
  const original = Intl.RelativeTimeFormat;
  let created = 0;
  try {
    Intl.RelativeTimeFormat = class extends original { constructor(...args) { super(...args); created++; } };
    const now = Date.UTC(2026, 9, 19, 12);
    for (let index = 1; index <= 1000; index++) assert.ok(history.relativeRecordingTime(new Date(now - index * 60000).toISOString(), now));
  } finally { Intl.RelativeTimeFormat = original; }
  assert.ok(created <= 1, `${created} locale formatters constructed for one history refresh`);
});

await check('Audio analysis remains optional when a decoder cannot be created or closed', async () => {
  const { audioPeaks } = await load('library');
  const original = globalThis.AudioContext;
  try {
    globalThis.AudioContext = class { constructor() { throw new Error('AudioContext unavailable'); } };
    assert.deepEqual(await audioPeaks(new Blob()), []);
    globalThis.AudioContext = class {
      async decodeAudioData() { return { duration: 1, getChannelData: () => new Float32Array([.5, -.25, .1]) }; }
      async close() { throw new Error('Already closed'); }
    };
    let duration = 0;
    assert.equal((await audioPeaks(new Blob(), value => duration = value)).length, 48);
    assert.equal(duration, 1);
  } finally { if (original === undefined) delete globalThis.AudioContext; else globalThis.AudioContext = original; }
});

if (errors.length) { console.error(`${errors.length} UI data regression(s)`); process.exitCode = 1; }
else console.log('UI data performance: all 5 regression groups passed.');
