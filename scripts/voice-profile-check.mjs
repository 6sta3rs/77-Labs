import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Real client code, controlled HTTP: never reads private data or starts a model.
async function load(filename, dependencies = {}, exposure = '') {
  let source = await readFile(new URL(`../src/lib/${filename}`, import.meta.url), 'utf8');
  if (filename.endsWith('.svelte')) source = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const node of [...parsed.statements].reverse()) {
    if (ts.isImportDeclaration(node)) source = source.slice(0, node.pos) + source.slice(node.end);
  }
  if (exposure) source += `\nreturn {${exposure}};`;
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exported = {};
  return new Function('exports', ...Object.keys(dependencies), code)(exported, ...Object.values(dependencies)) ?? exported;
}

const sent = [];
const audio = await load('voice-reference.ts');
const api = await load('api.ts', {
  isTauri: () => false,
  referenceFileError: audio.referenceFileError,
  fetch: async (path, options) => { sent.push({ path, options }); return Response.json({ id: 'qa-voice', name: 'QA English' }); },
});
const file = new File([new Uint8Array(2048)], 'reference.wav', { type: 'audio/wav' });
const abort = new AbortController();
await api.createVoice(' QA English ', file, ' Hello. ', { language: 'English', signal: abort.signal });
assert.equal(sent[0].options.body.get('language'), 'English', 'A clone must keep the chosen recording language.');
assert.equal(sent[0].options.body.get('name'), 'QA English');
assert.equal(sent[0].options.body.get('ref_text'), 'Hello.');
assert.equal(sent[0].options.signal, abort.signal, 'Closing a clone form must cancel its request.');
assert.equal(sent[0].options.body.get('kind'), 'clone');
const before = sent.length;
await assert.rejects(api.createVoice('QA invalid', new File(['x'], 'script.py'), 'hello'), /WAV|obsługiwany|nagran/i);
assert.equal(sent.length, before, 'Unsupported references must never be submitted.');
const cancelled = new AbortController(); cancelled.abort();
await assert.rejects(api.createVoice('QA cancelled', file, 'hello', { signal: cancelled.signal }), error => error.name === 'AbortError');
assert.equal(sent.length, before);

assert.match(audio.referenceFileError(new File([], 'empty.wav')), /pust|krótk/i);
assert.match(audio.referenceFileError(new File([new Uint8Array(2048)], 'payload.exe')), /format|WAV/i);
assert.equal(audio.referenceFileError(file), '');
assert.match(audio.referenceDurationWarning(2), /krótk/i);
assert.equal(audio.referenceDurationWarning(12), '');
assert.match(audio.referenceDurationWarning(90), /dług/i);

let creations = 0, callbacks = 0;
const props = Object.assign(() => ({ ready: true, oncancel() {}, oncreated: async () => { if (++callbacks === 1) throw new Error('QA library temporarily unavailable'); } }), { id: () => 'qa-clone' });
const form = await load('VoiceCloneForm.svelte', {
  $props: props, $state: value => value, onDestroy() {},
  createVoice: async () => { creations++; return { id: 'qa-created' }; },
}, 'save, setInput(value) { file = value; name = "QA retry" }, get error() { return error }');
form.setInput(file);
await form.save();
assert.match(form.error, /zapisany/);
await form.save();
assert.equal(callbacks, 2);
assert.equal(creations, 1, 'Retrying a failed library refresh must never create a second voice.');
console.log('Voice profile contracts: 18 checks passed.');
