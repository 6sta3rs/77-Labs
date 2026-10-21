// Execute the actual component script with controlled HTTP/lifecycle results.
// No browser, backend, native runtime, account read or inference.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { compile, parse } from 'svelte/compiler'

const root = new URL('../src/lib/', import.meta.url)
const aiSource = await readFile(new URL('AISettings.svelte', root), 'utf8')
const catalogueSource = await readFile(new URL('EngineCatalog.svelte', root), 'utf8')
const checks = []
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const saved = { enabled: true, model: 'qa-seven', intensity: 'natural', reactions: true }
const status = {
  installed: true, connected: true, authMode: 'chatgpt', plan: 'TESTFIXTURE', message: 'TESTFIXTURE', defaultModel: 'qa-seven',
  models: ['qa-one', 'qa-two', 'qa-three', 'qa-four', 'qa-five', 'qa-six', 'qa-seven'].map(id => ({ id, name: 'TESTFIXTURE ' + id, isDefault: id === 'qa-seven' })),
}
async function subject(overrides = {}, props = {}) {
  const lifecycle = [], calls = { reads: 0, statuses: 0, writes: [], tests: 0 }
  const dependencies = {
    onMount: callback => lifecycle.push(callback), $state: value => value,
    $props: () => props, $derived: Object.assign(value => value, { by: callback => callback() }),
    getAISettings: async () => { calls.reads++; return { ...saved } },
    getAIStatus: async () => { calls.statuses++; return structuredClone(status) },
    saveAISettings: async value => { calls.writes.push(value); return value },
    testAI: async () => { calls.tests++; return { model: 'qa-seven', input: ['TESTFIXTURE'], enhanced_blocks: ['TESTFIXTURE [pause]'], seconds: .1, provider: 'TESTFIXTURE' } },
    ...overrides,
  }
  let source = aiSource.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
  const tree = ts.createSourceFile('AISettings.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const item of [...tree.statements].reverse()) {
    if (ts.isImportDeclaration(item)) source = source.slice(0, item.pos) + source.slice(item.end)
  }
  source += '\nreturn {refresh,save,changeSettings,modelChoices,get settings(){return settings},get connection(){return connection},get loaded(){return loaded},get busy(){return busy},get result(){return result},get error(){return error},get message(){return message},get embedded(){return embedded}}'
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const value = new Function(...Object.keys(dependencies), code)(...Object.values(dependencies))
  const cleanups = []
  return { value, calls, mount() { for (const callback of lifecycle) { const cleanup = callback(); if (cleanup) cleanups.push(cleanup) } }, destroy() { cleanups.splice(0).reverse().forEach(callback => callback()) } }
}
async function check(name, run) { await run(); checks.push(name) }

await check('both real Svelte components compile without new warnings', async () => {
  for (const [filename, source] of [['AISettings.svelte', aiSource], ['EngineCatalog.svelte', catalogueSource]]) {
    const output = compile(source, { filename, generate: 'client' })
    assert.deepEqual(output.warnings, [])
  }
})
await check('same component supports standalone and embedded with read-only initial mount', async () => {
  for (const embedded of [undefined, true]) {
    const context = await subject({}, embedded === undefined ? {} : { embedded })
    context.mount(); await settle()
    assert.equal(context.value.embedded, Boolean(embedded))
    assert.equal(context.value.loaded, true)
    assert.equal(context.calls.reads, 1); assert.equal(context.calls.statuses, 1)
    assert.deepEqual(context.calls.writes, []); assert.equal(context.calls.tests, 0)
    context.destroy()
  }
})
await check('selector exposes exactly live metadata models and changes persist only on explicit save', async () => {
  const context = await subject(); await context.value.refresh()
  const choices = context.value.modelChoices()
  assert.deepEqual(choices.slice(1).map(row => row.value), status.models.map(row => row.id))
  context.value.changeSettings({ model: 'qa-two', intensity: 'subtle', reactions: false })
  assert.deepEqual(context.calls.writes, [])
  await context.value.save()
  assert.deepEqual(context.calls.writes, [{ ...saved, model: 'qa-two', intensity: 'subtle', reactions: false }])
  assert.equal(context.calls.tests, 0)
  context.destroy()
})
await check('all fields and repeated writes are blocked throughout delayed PUT and inference', async () => {
  const write = deferred(), inference = deferred(), writes = [], tests = []
  const context = await subject({ saveAISettings: (value, signal) => { writes.push({ value, signal }); return write.promise }, testAI: signal => { tests.push(signal); return inference.promise } })
  context.mount(); await settle()
  const action = context.value.save(true)
  context.value.changeSettings({ model: 'qa-two', intensity: 'expressive', reactions: false, enabled: false })
  await context.value.save(true)
  assert.equal(context.value.busy, true); assert.equal(writes.length, 1)
  assert.deepEqual(context.value.settings, saved)
  write.resolve({ ...saved }); await settle()
  assert.equal(tests.length, 1)
  context.value.changeSettings({ model: 'qa-one', intensity: 'subtle', reactions: false })
  assert.deepEqual(context.value.settings, saved)
  inference.resolve({ model: 'qa-seven', input: ['TESTFIXTURE'], enhanced_blocks: ['TESTFIXTURE [pause]'], seconds: .1, provider: 'TESTFIXTURE' })
  await action
  assert.equal(context.value.busy, false)
  context.value.changeSettings({ reactions: false })
  assert.equal(context.value.settings.reactions, false)
  context.destroy()
})
await check('closing initial read aborts both requests and ignores late transport results', async () => {
  const wait = deferred(), signals = []
  const context = await subject({ getAISettings: signal => { signals.push(signal); return wait.promise }, getAIStatus: signal => { signals.push(signal); return wait.promise } })
  context.mount(); context.destroy()
  assert.ok(signals.every(signal => signal.aborted))
  wait.resolve(saved); await settle()
  assert.equal(context.value.loaded, false); assert.equal(context.value.error, '')
})
await check('closing delayed PUT never starts the requested inference or publishes stale settings', async () => {
  const wait = deferred(), signals = [], tests = []
  const context = await subject({ saveAISettings: (_value, signal) => { signals.push(signal); return wait.promise }, testAI: async () => { tests.push(true) } })
  context.mount(); await settle()
  const action = context.value.save(true); context.destroy()
  assert.equal(signals[0].aborted, true)
  wait.resolve({ ...saved, intensity: 'expressive' }); await action
  assert.deepEqual(tests, []); assert.deepEqual(context.value.settings, saved)
  assert.equal(context.value.result, undefined); assert.equal(context.value.error, '')
})
await check('closing in-flight inference discards late results and errors', async () => {
  const wait = deferred(), signals = []
  const context = await subject({ testAI: signal => { signals.push(signal); return wait.promise } })
  context.mount(); await settle()
  const action = context.value.save(true); await settle(); context.destroy()
  assert.equal(signals[0].aborted, true)
  wait.resolve({ model: 'qa-seven', enhanced_blocks: ['late'], input: ['late'], seconds: 1, provider: 'TESTFIXTURE' }); await action
  assert.equal(context.value.result, undefined); assert.equal(context.value.error, '')
})
await check('failed refresh clears stale connected label and preserves saved settings without writing', async () => {
  let failure = false
  const context = await subject({ getAIStatus: async () => { if (failure) throw new Error('TESTFIXTURE offline'); return structuredClone(status) } })
  await context.value.refresh(); assert.equal(context.value.connection.connected, true)
  failure = true; await context.value.refresh()
  assert.equal(context.value.connection, undefined)
  assert.equal(context.value.error, 'TESTFIXTURE offline')
  assert.deepEqual(context.value.settings, saved); assert.deepEqual(context.calls.writes, [])
  context.destroy()
})
await check('unadvertised saved model stays visible, no silent fallback or unverified inference', async () => {
  const context = await subject({ getAISettings: async () => ({ ...saved, model: 'old-choice' }) })
  await context.value.refresh()
  assert.equal(context.value.settings.model, 'old-choice')
  assert.equal(context.value.modelChoices().find(row => row.value === 'old-choice').disabled, true)
  context.value.changeSettings({ model: 'not-advertised' })
  assert.equal(context.value.settings.model, 'old-choice')
  await context.value.save(true)
  assert.equal(context.calls.tests, 0); assert.deepEqual(context.calls.writes, [])
  context.value.changeSettings({ model: '' })
  assert.equal(context.value.settings.model, '')
  context.destroy()
})
await check('AI settings instance appears only beneath the LLM family condition', async () => {
  const tree = parse(catalogueSource, { modern: true })
  let count = 0
  function walk(node, parents = []) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'Component' && node.name === 'AISettings') {
      count++
      assert.ok(parents.some(parent => parent.type === 'IfBlock' && parent.test.type === 'BinaryExpression'
        && parent.test.operator === '===' && parent.test.left.name === 'family' && parent.test.right.value === 'llm'))
      assert.ok(node.attributes.some(attribute => attribute.name === 'embedded'))
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'parent') continue
      if (Array.isArray(child)) child.forEach(item => walk(item, [...parents, node]))
      else if (child && typeof child === 'object') walk(child, [...parents, node])
    }
  }
  walk(tree)
  assert.equal(count, 1)
})

process.stdout.write(JSON.stringify({ passed: true, checks: checks.length, tests: checks, backendUsed: false, inferencePerformed: false }, null, 2) + '\n')
