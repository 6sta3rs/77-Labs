import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = (await readFile(new URL('../../src/lib/tts/ai.ts', import.meta.url), 'utf8')).replace(/^import .*$/m, '')
const exports = {}
new Function('exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exports)
const { bookTextChunks } = exports

for (const text of ['a'.repeat(4000) + '\n\n'.repeat(1), ('a'.repeat(4000) + '\n\n').repeat(7), 'b'.repeat(25000), ('l'.repeat(900) + '\n').repeat(30)]) {
  const chunks = bookTextChunks(text)
  assert.equal(chunks.join(''), text, 'Chunks must reassemble the exact text.')
  assert.ok(chunks.every(chunk => chunk.length <= 10000), 'Every chunk stays under the AI limit.')
}
console.log('Book text chunks PASS: exact reassembly and 10 000-character limit for paragraphs, long lines and unbroken text.')
