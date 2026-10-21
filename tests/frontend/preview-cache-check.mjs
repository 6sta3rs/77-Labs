import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { compile } from 'svelte/compiler'

const source = await readFile(new URL('../../src/lib/playback/preview-cache.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const exports = {}
new Function('exports', 'require', code)(exports, () => ({ productionJson: () => { throw new Error('Unexpected network call') }, postJson: value => ({ body: JSON.stringify(value) }) }))
const { generatePreviewSeries } = exports
const calls = [], progress = []
const fixture = async id => { calls.push(id); return { id, state: { id } } }
const done = await generatePreviewSeries(['first', 'second', 'first'], { stop: () => false, progress: (...value) => progress.push(value) }, fixture)
assert.deepEqual(calls, ['first', 'second'])
assert.deepEqual(done, { completed: 2, total: 2, stopped: false })
assert.deepEqual(progress.map(value => value.slice(0, 3)), [[1, 2, 'first'], [2, 2, 'second']])
let stop = false
const stopped = await generatePreviewSeries(['first', 'second'], { stop: () => stop, progress: () => { stop = true } }, fixture)
assert.deepEqual(stopped, { completed: 1, total: 2, stopped: true })
let attempted = 0
await assert.rejects(generatePreviewSeries(['first', 'second'], { stop: () => false, progress() { throw new Error('Progress after failed generation') } }, async () => { attempted++; throw new Error('license fixture') }), /license fixture/)
assert.equal(attempted, 1)
let resolve
const waits = new Promise(done => { resolve = done })
let reported = false
const pending = generatePreviewSeries(['first'], { stop: () => false, progress: () => { reported = true } }, async id => { await waits; return { id, state: {} } })
await Promise.resolve()
assert.equal(reported, false)
resolve(); await pending
assert.equal(reported, true)
const component = await readFile(new URL('../../src/lib/playback/PreviewCacheSettings.svelte', import.meta.url), 'utf8')
const compiled = compile(component, { filename: 'PreviewCacheSettings.svelte', generate: 'client' })
assert.equal(compiled.warnings.length, 0, JSON.stringify(compiled.warnings))
console.log('PASS: preview series deduplication, completed-only progress, stop-after-current, error/secret-free control flow; Svelte component compiled with zero warnings. No backend, model or external request started.')
