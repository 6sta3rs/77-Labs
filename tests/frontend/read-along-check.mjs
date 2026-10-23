import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../../src/lib/playback/read-along.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const exports = {}; new Function('exports', code)(exports)
const { wordWeight, wordAtTime, readingAt } = exports

// Longer words and sentence ends weigh more.
assert.ok(wordWeight('internationalization') > wordWeight('a'))
assert.ok(wordWeight('end.') > wordWeight('end'))
assert.ok(wordWeight('end,') > wordWeight('end') && wordWeight('end,') < wordWeight('end.'))
assert.equal(wordWeight('...'), 5)

// Edges: start, end, overrun, empty, bad duration.
const words = ['Ala', 'ma', 'kota.', 'Kot', 'ma', 'Alę.']
assert.equal(wordAtTime(words, 0, 6), 0)
assert.equal(wordAtTime(words, 6, 6), words.length - 1)
assert.equal(wordAtTime(words, 99, 6), words.length - 1)
assert.equal(wordAtTime(words, -1, 6), 0)
assert.equal(wordAtTime([], 1, 6), -1)
assert.equal(wordAtTime(words, 1, 0), 0)

// Monotonic over time, and a long word holds the highlight longer than a short one.
let last = 0
for (let t = 0; t <= 6; t += 0.05) { const w = wordAtTime(words, t, 6); assert.ok(w >= last); last = w }
const held = word => { let n = 0; const list = ['x', word, 'x']; for (let t = 0; t < 10; t += 0.01) if (wordAtTime(list, t, 10) === 1) n++; return n }
assert.ok(held('extraordinarily') > held('go'))

// Uses each portion's own measured duration, not a global average.
const portions = [{ text: 'one two three four', duration: 2 }, { text: 'alpha beta', duration: 10 }]
assert.deepEqual(readingAt(portions, 1, 0)?.word, 0)
assert.equal(readingAt(portions, 1, 1.99)?.word, 3)
assert.equal(readingAt(portions, 2, 2)?.word, 0)
assert.equal(readingAt(portions, 2, 8)?.word, 1)
assert.equal(readingAt(portions, 3, 1), undefined)
assert.equal(readingAt([{ text: '', duration: 1 }], 1, 0), undefined)
console.log('read-along check passed')
