import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const src = readFileSync('frontend/src/i18n/plural.ts', 'utf8').replace(/export /g, '').replace(/: (number|string)/g, '')
const polishPlural = new Function(`${src}; return polishPlural`)()
const f = n => polishPlural(n, 'plik', 'pliki', 'plików')
for (const [n, w] of [[1, 'plik'], [2, 'pliki'], [4, 'pliki'], [5, 'plików'], [12, 'plików'], [14, 'plików'], [22, 'pliki'], [25, 'plików'], [0, 'plików']]) assert.equal(f(n), w, String(n))
console.log('plural-check: ok')
