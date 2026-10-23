import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source = await readFile(new URL('../../src/lib/ui/confirm.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  .replace("from 'svelte/store'", `from '${new URL('../../node_modules/svelte/src/store/index-client.js', import.meta.url).href}'`)
const { confirmDialog, pendingConfirm } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
let shown = null
pendingConfirm.subscribe(value => { shown = value })
const checks = []
const test = async (name, fn) => { try { await fn(); checks.push({ name, passed: true }) } catch (error) { checks.push({ name, passed: false, error: error.message }) } }
await test('Confirming resolves true and clears the dialog', async () => {
  const answer = confirmDialog({ message: 'Q?' }); assert.equal(shown.message, 'Q?'); shown.settle(true)
  assert.equal(await answer, true); assert.equal(shown, null)
})
await test('Cancelling resolves false', async () => { const answer = confirmDialog({ message: 'Q?' }); shown.settle(false); assert.equal(await answer, false) })
await test('A newer request cancels the pending one; stale settle is ignored', async () => {
  const first = confirmDialog({ message: 'A' }), stale = shown, second = confirmDialog({ message: 'B' })
  assert.equal(await first, false); stale.settle(true); assert.equal(shown.message, 'B'); shown.settle(true); assert.equal(await second, true)
})
const [dialog, app] = await Promise.all(['src/lib/ui/ConfirmDialog.svelte', 'src/App.svelte'].map(file => readFile(new URL('../../' + file, import.meta.url), 'utf8')))
await test('The dialog is an alertdialog that handles Escape and is mounted in the app', () => {
  assert.match(dialog, /role="alertdialog"/); assert.match(dialog, /oncancel=/); assert.match(app, /<ConfirmDialog\/>/)
})
for (const row of checks) console.log((row.passed ? 'PASS ' : 'FAIL ') + row.name + (row.error ? ': ' + row.error : ''))
console.log(`Confirm dialog: ${checks.filter(row => row.passed).length}/${checks.length}`)
if (checks.some(row => !row.passed)) process.exitCode = 1
