import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../../frontend/src/tools/studio-tools.ts', import.meta.url), 'utf8');
// Exercise the pure formatter without importing desktop transports into Node.
const formatter = source.slice(source.indexOf('export type TranscriptSegment'));
const js = ts.transpileModule(formatter, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { subtitleText } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const segments = [{ start: 0, end: 1.2, text: ' Cześć! ' }, { start: 3599.9996, end: 3601, text: 'Godzina.' }];
assert.equal(subtitleText(segments, 'srt'), '1\n00:00:00,000 --> 00:00:01,200\nCześć!\n\n2\n01:00:00,000 --> 01:00:01,000\nGodzina.\n');
assert.equal(subtitleText(segments, 'vtt'), 'WEBVTT\n\n00:00:00.000 --> 00:00:01.200\nCześć!\n\n01:00:00.000 --> 01:00:01.000\nGodzina.\n');
assert.equal(subtitleText([{ start: 2, end: 1, text: 'bad' }, { start: NaN, end: 1, text: 'bad' }, { start: 0, end: Infinity, text: 'bad' }, { start: 0, end: 1, text: '  ' }], 'srt'), '');
assert.equal(subtitleText([], 'vtt'), 'WEBVTT\n\n');
assert.match(subtitleText([{ start: -1, end: 1, text: 'Tekst\ndrugi wiersz' }], 'srt'), /^1\n00:00:00,000 --> 00:00:01,000\nTekst\ndrugi wiersz\n$/);
console.log('Subtitles: 5 checks passed (SRT, WebVTT, rounding across hours, invalid segments and multiline text).');
