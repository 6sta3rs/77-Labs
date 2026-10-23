import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../../frontend/src/tts/tags.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { autoTagText, tokenizeSpeech, insertAtSelection, audioTags } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

const narration = 'Wyobraź sobie… koty.\n\nA potem... dalszy ciąg.';
const tagged = autoTagText(narration);
assert.equal(tagged, 'Wyobraź sobie…[pause] koty.[pause]\n\nA potem...[pause] dalszy ciąg.');
assert.equal(autoTagText(tagged), tagged, 'Repeated automatic pauses must be idempotent.');
assert.equal(tagged.replaceAll('[pause]', ''), narration, 'Every original character must survive pause insertion.');
assert.equal(autoTagText('... [pause 250ms]\n\nDalej'), '... [pause 250ms]\n\nDalej', 'An explicit pause must not be duplicated.');
assert.equal(autoTagText('\n\nAkapit\n\n'), '\n\nAkapit\n\n', 'Do not tag leading and trailing empty paragraphs.');
assert.equal(autoTagText('Tekst\r\n\r\nDalszy tekst'), 'Tekst[pause]\r\n\r\nDalszy tekst', 'Preserve Windows line endings.');
assert.equal(autoTagText('...\n\nDalej'), '...[pause]\n\nDalej', 'One boundary must not receive two pauses.');
assert.equal(autoTagText('Tekst\n\n\n\nDalej'), 'Tekst[pause]\n\n\n\nDalej', 'Consecutive blank paragraphs are a single pause boundary.');
assert.equal(autoTagText('Zwykły tekst. Bez emocji!'), 'Zwykły tekst. Bez emocji!');
assert.deepEqual(insertAtSelection('Jeden dwa', '[sigh]', 6, 9), { text: 'Jeden [sigh]', caret: 12 });
assert.deepEqual(tokenizeSpeech('<img src=x> [sigh] [thoughtful]'), [
  { text: '<img src=x> ', isTag: false },
  { text: '[sigh]', isTag: true },
  { text: ' ', isTag: false },
  { text: '[thoughtful]', isTag: false },
]);
assert.equal(new Set(audioTags.map(tag => tag.value)).size, audioTags.length);
assert.ok(!tagged.includes('[laughter]') && !tagged.includes('[sigh]'));
console.log('Tag helpers: 13 assertions passed (idempotence, text preservation, Windows newlines, known tags and insertion).');
