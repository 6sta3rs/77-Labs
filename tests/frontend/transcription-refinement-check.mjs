import { i18nDeps, i18nRequire } from '../helpers/i18n.mjs';
// Real transport/helper contracts with controlled data. No backend, ASR or LLM.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { compile } from 'svelte/compiler';

const root = new URL('../../', import.meta.url);
const source = await readFile(new URL('frontend/src/tools/transcription/transcription.ts', root), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const helpers = {}; new Function('exports','require',compiled)(helpers,i18nRequire);
const { normalizeTranscription, transcriptionOutputText, exportTranscription, refinementNotice, readTranscriptionHistory, saveTranscriptionHistory, TRANSCRIPTION_HISTORY_KEY } = helpers;
const checks = [];
const test = async (name, run) => { await run(); checks.push(name); };
const segments = [{ start: 0.25, end: 1.5, text: 'Yyy, ja myślę.' }, { start: 1.7, end: 3.2, text: 'To działa, działa.' }];
const raw = { text: 'Yyy, ja myślę. To działa, działa.', segments, language: 'pl' };
const suggestion = 'Myślę, że to działa.';
const response = normalizeTranscription({ ...raw, refined_text: suggestion }, true);
const accepted = { ...response.refinement, applied: true };
const canonical = segments.map(row => row.text).join('\n');

await test('OFF preserves the old response/history shape', () => {
  assert.equal(normalizeTranscription(raw).refinement, undefined);
});
await test('A real suggestion preserves raw recognition and timed cues', () => {
  assert.deepEqual(response.segments, segments);
  assert.equal(response.refinement.originalText, raw.text);
  assert.equal(response.refinement.refinedText, suggestion);
  assert.equal(response.refinement.applied, false);
  assert.equal(response.refinement.status, 'suggested');
});
await test('Suggestion is never applied automatically', () => {
  assert.equal(transcriptionOutputText(response.text, response.segments, response.refinement), canonical);
  assert.equal(exportTranscription(response.text, response.segments, 'txt', response.refinement), canonical);
});
await test('Explicit apply affects TXT/editor output, never SRT/VTT alignment', () => {
  assert.equal(transcriptionOutputText(response.text, response.segments, accepted), suggestion);
  assert.equal(exportTranscription(response.text, response.segments, 'txt', accepted), suggestion);
  for (const format of ['srt', 'vtt']) {
    assert.equal(exportTranscription(response.text, response.segments, format, accepted), exportTranscription(raw.text, segments, format));
    assert.ok(!exportTranscription(response.text, response.segments, format, accepted).includes(suggestion));
  }
});
await test('Undo returns current segment edits, not a stale pre-edit copy', () => {
  const edited = response.segments.map((row, index) => index ? row : { ...row, text: 'Moja poprawka.', end: 1.6 });
  assert.equal(transcriptionOutputText(response.text, edited, { ...accepted, applied: false }), 'Moja poprawka.\nTo działa, działa.');
  assert.match(exportTranscription(response.text, edited, 'srt', accepted), /00:00:00,250 --> 00:00:01,600\nMoja poprawka\./);
  assert.deepEqual(segments, raw.segments);
});
await test('Free-text edits before and after apply are preserved exactly on undo', () => {
  const beforeApply = '  Ręcznie poprawiłem ASR.\nZachowaj spacje.  ';
  const afterApply = beforeApply + '\nJeszcze jedna poprawka.';
  assert.equal(transcriptionOutputText(beforeApply, [], response.refinement), beforeApply);
  assert.equal(transcriptionOutputText(beforeApply, [], accepted), suggestion);
  assert.equal(transcriptionOutputText(afterApply, [], accepted), suggestion);
  assert.equal(transcriptionOutputText(afterApply, [], { ...accepted, applied: false }), afterApply);
});
await test('Missing/same/empty/invalid suggestion is an honest pass-through', () => {
  for (const extra of [{}, { refined_text: raw.text }, { refined_text: '' }, { refined_text: 123 }]) {
    const result = normalizeTranscription({ ...raw, ...extra }, true);
    assert.equal(result.refinement.status, 'not_returned');
    assert.equal(result.refinement.applied, false);
    assert.match(refinementNotice(result.refinement), /brak zmian albo niedostępną/);
    assert.equal(transcriptionOutputText(result.text, result.segments, result.refinement), canonical);
  }
});
await test('Explicit unavailable is visible without exposing provider diagnostics', () => {
  for (const unavailable of [true, 'refinement_unavailable: private-provider.example']) {
    const result = normalizeTranscription({ ...raw, refinement_unavailable: unavailable }, true);
    assert.equal(result.refinement.status, 'unavailable');
    assert.match(refinementNotice(result.refinement), /niedostępna/);
    assert.ok(!refinementNotice(result.refinement).includes('private-provider'));
  }
});
await test('Invalid timing keeps the complete original and never fabricates cues', () => {
  const result = normalizeTranscription({ ...raw, segments: [{ start: null, end: null, text: raw.text }], refined_text: suggestion }, true);
  assert.deepEqual(result.segments, []);
  assert.equal(result.text, raw.text);
  assert.equal(result.refinement.originalText, raw.text);
  assert.throws(() => exportTranscription(result.text, [], 'srt', accepted), /Brak segmentów/);
});

const map = new Map();
const storage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
const date = '2026-10-20T12:00:00.000Z';
const row = { id: 'qa-refinement', name: 'public-fixture.wav', text: response.text, segments: response.segments, language: 'pl', mode: 'accurate', created: date, updated: date, refinement: accepted };
await test('History v1 round-trips choice, exact original, suggestion and cue timing', () => {
  saveTranscriptionHistory(storage, [row]);
  const restored = readTranscriptionHistory(storage).results[0];
  assert.deepEqual(restored, row);
  assert.equal(transcriptionOutputText(restored.text, restored.segments, restored.refinement), suggestion);
  assert.equal(exportTranscription(restored.text, restored.segments, 'srt', restored.refinement), exportTranscription(raw.text, segments, 'srt'));
});
await test('Returned history objects do not alias live refinement/segments', () => {
  const saved = saveTranscriptionHistory(storage, [row]);
  saved.results[0].refinement.applied = false;
  saved.results[0].segments[0].text = 'zmiana';
  assert.equal(row.refinement.applied, true);
  assert.equal(row.segments[0].text, segments[0].text);
});
await test('Legacy histories require no migration or new fields', () => {
  const { refinement, ...legacy } = row;
  map.set(TRANSCRIPTION_HISTORY_KEY, JSON.stringify({ version: 1, results: [legacy] }));
  const restored = readTranscriptionHistory(storage).results[0];
  assert.equal(restored.refinement, undefined);
  assert.equal(restored.text, canonical);
});
await test('Corrupt refinement cannot overwrite an existing history', () => {
  const before = map.get(TRANSCRIPTION_HISTORY_KEY);
  for (const refinement of [{}, { ...accepted, refinedText: '' }, { ...accepted, status: 'unavailable' }, null]) {
    assert.throws(() => saveTranscriptionHistory(storage, [{ ...row, refinement }]));
    assert.equal(map.get(TRANSCRIPTION_HISTORY_KEY), before);
  }
});

const apiSource = await readFile(new URL('frontend/src/platform/api.ts', root), 'utf8');
const ast = ts.createSourceFile('api.ts', apiSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'transcribe');
assert.ok(fn);
const fnCode = ts.transpileModule(fn.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const transport = [];
const api = {}; new Function('exports', 'json', fnCode)(api, async (path, options) => { transport.push({ path, options }); return { ...raw, refined_text: suggestion }; });
const file = new File(['controlled fixture, not processed audio'], 'fixture.wav', { type: 'audio/wav' });
await test('Existing callers explicitly send refine=false with no new request', async () => {
  const signal = new AbortController().signal;
  const answer = await api.transcribe(file, 'reference', 'auto', signal);
  assert.equal(transport.length, 1);
  assert.equal(transport[0].path, '/transcribe');
  assert.equal(transport[0].options.body.get('refine'), 'false');
  assert.equal(transport[0].options.body.get('language'), null);
  assert.equal(transport[0].options.signal, signal);
  assert.equal(answer.refined_text, suggestion);
});
await test('Explicit opt-in sends true and preserves ordinary multipart fields', async () => {
  await api.transcribe(file, 'accurate', 'pl', undefined, { refine: true });
  const form = transport[1].options.body;
  assert.equal(form.get('refine'), 'true');
  assert.equal(form.get('mode'), 'accurate');
  assert.equal(form.get('language'), 'pl');
  assert.equal(form.get('audio').name, file.name);
  assert.deepEqual([...form.keys()], ['audio', 'mode', 'refine', 'language']);
});
await test('Svelte compiles the real comparison/choice/export UI without warnings', async () => {
  const component = await readFile(new URL('frontend/src/tools/transcription/TranscriptionWorkspace.svelte', root), 'utf8');
  const result = compile(component, { filename: 'TranscriptionWorkspace.svelte', generate: 'client' });
  assert.deepEqual(result.warnings, []);
  assert.match(component, /refine = \$state\(false\)/);
  assert.match(component, /Cofnij użycie redakcji/);
  assert.match(component, /exportTranscription\(text, segments, format, refinement\)/);
  assert.ok(!component.includes('/api/settings/dictation-refinement'), 'The opt-in must not configure a provider or enable global automatic refinement.');
});
console.log(`Transcription refinement: ${checks.length}/${checks.length} PASS (real multipart/helper/history contracts, no backend/ASR/LLM).`);
