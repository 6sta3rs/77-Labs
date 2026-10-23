// No fixed Polish locale in display formatting: numbers, dates and counts follow the selected interface language
// (`tr.locale` in components, `currentLocale()` in modules). Matching and sorting of Polish source text may stay Polish.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', 'frontend/src'], { encoding: 'utf8' }).split('\n').filter(file => /\.(ts|svelte)$/.test(file));
// Where a Polish locale literal is intended, and why.
const ALLOWED_LITERAL = new Map([
  ['frontend/src/i18n/languages.ts', 'the registry that defines each language and its locale'],
  ['frontend/src/i18n/index.ts', 'fallback locale of an unknown language'],
  ['frontend/src/projects/history-view.ts', 'default argument; the component passes tr.locale, the isolated tests use the default'],
  ['frontend/src/voices/voice-metadata.ts', 'default argument; callers pass tr.locale'],
  ['frontend/src/voices/voice-picker.ts', 'default argument; callers pass tr.locale'],
]);
const FORMATTING = [
  /toLocale(?:Date|Time)?String\(\s*['"]pl/,
  /new Intl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat|ListFormat)\(\s*['"]pl/,
];
const problems = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const pattern of FORMATTING) if (pattern.test(text)) problems.push(`${file}: formatting with a fixed Polish locale (${pattern})`);
  if (/['"]pl-PL['"]/.test(text) && !ALLOWED_LITERAL.has(file)) problems.push(`${file}: 'pl-PL' literal outside the allow-list`);
}
assert.deepEqual(problems, []);
for (const file of ALLOWED_LITERAL.keys()) assert.ok(/['"]pl-PL['"]/.test(readFileSync(file, 'utf8')), `${file} no longer needs its allow-list entry`);
// Plural forms come from CLDR rules.
const { polishPlural } = await import('data:text/javascript,' + encodeURIComponent(readFileSync('frontend/src/i18n/plural.ts', 'utf8').replace(/: (number|string)/g, '')));
assert.deepEqual([0, 1, 2, 4, 5, 12, 14, 22, 25].map(n => polishPlural(n, 'a', 'b', 'c')), ['c', 'a', 'b', 'b', 'c', 'c', 'c', 'b', 'c']);
console.log(`PASS no fixed Polish locale in display formatting (${files.length} files scanned, ${ALLOWED_LITERAL.size} allow-listed literals)`);
