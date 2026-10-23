// No Polish letters in the values of the English catalogs: a Polish control label quoted inside an English sentence
// ("Zmień" instead of "Change") shows up in the English window. Product and theme names that really contain Polish letters go to ALLOWED.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../../frontend/src/i18n/en/', import.meta.url);
const polish = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
const ALLOWED = [/Róża/];
const found = [];
for (const file of readdirSync(dir).filter(name => name.endsWith('.ts'))) {
  for (const line of readFileSync(new URL(file, dir), 'utf8').split('\n')) {
    const cut = Math.max(line.lastIndexOf("': '"), line.lastIndexOf('": "'));
    if (cut < 0) continue;
    const value = line.slice(cut + 4);
    if (polish.test(value) && !ALLOWED.some(pattern => pattern.test(value))) found.push(`${file}: ${value.slice(0, 120)}`);
  }
}
assert.deepEqual(found, []);
console.log('PASS the English catalogs contain no Polish letters outside the allow-list');
