// Execute the real AI settings page script (editor tagging through the Codex/ChatGPT account) with
// controlled HTTP/lifecycle results. No browser, backend, native runtime, account read or inference.
// The old standalone AISettings.svelte was merged into settings/pages/AiPage.svelte. Contract changes
// adopted from the redesign: tagging fields save immediately on change (no explicit "save" button) and
// the tagging test is a separate action that never writes.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compile, parse } from 'svelte/compiler'
import { sourceUrl } from '../helpers/source-url.mjs'
import { runesComponent, flush } from '../helpers/runes-component.mjs'

const pages = ['AiPage.svelte', 'settings/pages/ModelPicker.svelte', 'ModelsPage.svelte']
const sources = Object.fromEntries(await Promise.all(pages.map(async name => [name, await readFile(sourceUrl(name), 'utf8')])))
const checks = []
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); flush() } }
const saved = { enabled: true, model: 'qa-seven', intensity: 'natural', reactions: true }
const status = {
  installed: true, connected: true, authMode: 'chatgpt', plan: 'TESTFIXTURE', message: 'TESTFIXTURE', defaultModel: 'qa-seven',
  models: ['qa-one', 'qa-two', 'qa-three', 'qa-four', 'qa-five', 'qa-six', 'qa-seven'].map(id => ({ id, name: 'TESTFIXTURE ' + id, isDefault: id === 'qa-seven' })),
}
const tested = { model: 'qa-seven', input: ['TESTFIXTURE'], enhanced_blocks: ['TESTFIXTURE [pause]'], seconds: .1, provider: 'TESTFIXTURE' }
const engineReads = { '/api/settings/llm-providers': { providers: [], active: null }, '/api/settings/llm-skills': { skills: [] },
  '/api/settings/dictation-refinement': {}, '/api/settings/asr-openai-compat': { base_url: '', model: '' }, '/next/settings/credentials': { fields: [] } }
const toasts = []
async function subject(overrides = {}) {
  const calls = { reads: 0, statuses: 0, writes: [], tests: 0, engine: [] }
  const deps = {
    toast: { ok: m => toasts.push(['ok', m]), bad: m => toasts.push(['bad', m]), warn: m => toasts.push(['warn', m]), info: m => toasts.push(['info', m]) },
    productionJson: async (path, options) => { calls.engine.push({ path, method: options?.method ?? 'GET' }); if (!(path in engineReads)) throw new Error('Unexpected ' + path); return structuredClone(engineReads[path]) },
    postJson: (body, signal) => ({ method: 'POST', body: JSON.stringify(body), signal }),
    putSettings: async () => assert.fail('No credential write expected'), settingsError: cause => cause?.message ?? String(cause),
    skillLabels: {}, connectionMessage: () => '',
    getAISettings: async () => { calls.reads++; return { ...saved } },
    getAIStatus: async () => { calls.statuses++; return structuredClone(status) },
    saveAISettings: async value => { calls.writes.push(value); return { ...value } },
    testAI: async () => { calls.tests++; return tested },
    ...overrides,
  }
  const page = await runesComponent('AiPage.svelte', { deps, props: { ready: true }, exposure: `refreshAi, saveTag, tagTest,
    get aiSet() { return aiSet }, get aiStat() { return aiStat }, get aiErr() { return aiErr }, get loaded() { return loaded },
    get tagGroups() { return tagGroups }, get tagModel() { return tagModel }, get tagMissing() { return tagMissing },
    get tagRes() { return tagRes }, get tagErr() { return tagErr }, get tagBusy() { return tagBusy }` })
  return { value: page.value, calls, destroy: page.destroy }
}
async function check(name, run) { await run(); checks.push(name) }

await check('AI page, its model picker and the models page compile without warnings', async () => {
  for (const [filename, source] of Object.entries(sources)) assert.deepEqual(compile(source, { filename, generate: 'client' }).warnings, [], filename)
})
await check('initial mount only reads: one settings read, one status read, no writes or inference', async () => {
  const context = await subject(); await settle()
  assert.equal(context.value.loaded, true)
  assert.equal(context.calls.reads, 1); assert.equal(context.calls.statuses, 1)
  assert.deepEqual(context.calls.writes, []); assert.equal(context.calls.tests, 0)
  assert.ok(context.calls.engine.every(call => call.method === 'GET'), 'Opening the page must not write engine settings.')
  assert.deepEqual(context.value.aiSet, saved)
  context.destroy()
})
await check('model choice exposes exactly the live Codex models; each change writes once and never runs inference', async () => {
  // Changed contract: the redesign saves immediately on change instead of on an explicit save button.
  const context = await subject(); await settle()
  assert.deepEqual(context.value.tagGroups.flatMap(group => group.models), status.models.map(row => row.id))
  await context.value.saveTag({ model: 'qa-two' }, 'tagModel')
  await context.value.saveTag({ intensity: 'subtle' }, 'tagInt')
  await context.value.saveTag({ reactions: false }, 'tagReact')
  assert.deepEqual(context.calls.writes, [{ ...saved, model: 'qa-two' }, { ...saved, model: 'qa-two', intensity: 'subtle' }, { ...saved, model: 'qa-two', intensity: 'subtle', reactions: false }])
  assert.equal(context.calls.tests, 0)
  context.destroy()
})
await check('writes and inference are serialised: no second write or test during a delayed PUT, no write during inference', async () => {
  const write = deferred(), inference = deferred(), writes = [], tests = []
  const context = await subject({ saveAISettings: (value, signal) => { writes.push({ value, signal }); return write.promise }, testAI: signal => { tests.push(signal); return inference.promise } })
  await settle()
  const pending = context.value.saveTag({ intensity: 'expressive' }, 'tagInt')
  void context.value.saveTag({ reactions: false }, 'tagReact')
  void context.value.tagTest(); await settle()
  assert.equal(writes.length, 1, 'A second field change must not race the pending PUT.')
  assert.equal(tests.length, 0, 'Inference must not run against settings that are still being saved.')
  write.resolve({ ...saved, intensity: 'expressive' }); await pending
  assert.deepEqual(context.value.aiSet, { ...saved, intensity: 'expressive' })
  const running = context.value.tagTest(); await settle()
  assert.equal(tests.length, 1); assert.equal(context.value.tagBusy, true)
  void context.value.saveTag({ model: 'qa-one' }, 'tagModel'); await settle()
  assert.equal(writes.length, 1, 'Settings must not change while the tagging test runs.')
  inference.resolve(tested); await running
  assert.equal(context.value.tagBusy, false)
  context.destroy()
})
await check('a failed write restores the previous settings', async () => {
  const context = await subject({ saveAISettings: async () => { throw new Error('TESTFIXTURE rejected') } }); await settle()
  await context.value.saveTag({ intensity: 'subtle' }, 'tagInt')
  assert.deepEqual(context.value.aiSet, saved)
  context.destroy()
})
await check('closing the page aborts both pending account reads and ignores late transport results', async () => {
  const wait = deferred(), signals = []
  const context = await subject({ getAISettings: signal => { signals.push(signal); return wait.promise }, getAIStatus: signal => { signals.push(signal); return wait.promise } })
  await settle(); assert.equal(signals.length, 2)
  context.destroy()
  assert.ok(signals.every(signal => signal.aborted))
  wait.resolve(saved); await settle()
  assert.equal(context.value.aiSet, undefined); assert.equal(context.value.aiErr, '')
})
await check('closing during a delayed PUT aborts it and never starts inference', async () => {
  const wait = deferred(), signals = [], tests = []
  const context = await subject({ saveAISettings: (_value, signal) => { signals.push(signal); return wait.promise }, testAI: async () => { tests.push(true) } })
  await settle()
  const action = context.value.saveTag({ intensity: 'expressive' }, 'tagInt'); context.destroy()
  assert.equal(signals[0].aborted, true)
  wait.resolve({ ...saved, intensity: 'expressive' }); await action
  assert.deepEqual(tests, []); assert.equal(context.value.tagRes, null); assert.equal(context.value.tagErr, '')
})
await check('closing in-flight inference discards late results and errors', async () => {
  for (const outcome of ['resolve', 'reject']) {
    const wait = deferred(), signals = []
    const context = await subject({ testAI: signal => { signals.push(signal); return wait.promise } })
    await settle()
    const action = context.value.tagTest(); await settle(); context.destroy()
    assert.equal(signals[0].aborted, true)
    if (outcome === 'resolve') wait.resolve({ ...tested, enhanced_blocks: ['late'] }); else wait.reject(new Error('late failure'))
    await action
    assert.equal(context.value.tagRes, null); assert.equal(context.value.tagErr, '')
  }
})
await check('failed refresh clears the stale connected state and preserves saved settings without writing', async () => {
  let failure = false
  const context = await subject({ getAIStatus: async () => { if (failure) throw new Error('TESTFIXTURE offline'); return structuredClone(status) } })
  await settle(); assert.equal(context.value.aiStat.connected, true)
  failure = true; await context.value.refreshAi()
  assert.equal(context.value.aiStat, undefined)
  assert.equal(context.value.aiErr, 'TESTFIXTURE offline')
  assert.deepEqual(context.value.aiSet, saved); assert.deepEqual(context.calls.writes, [])
  context.destroy()
})
await check('unadvertised saved model stays visible, is flagged, and blocks unverified inference without a silent fallback', async () => {
  const context = await subject({ getAISettings: async () => ({ ...saved, model: 'old-choice' }) }); await settle()
  assert.equal(context.value.aiSet.model, 'old-choice')
  assert.equal(context.value.tagModel, 'old-choice')
  assert.equal(context.value.tagMissing, true)
  assert.ok(!context.value.tagGroups[0].models.includes('old-choice'), 'The picker offers only advertised models.')
  await context.value.tagTest()
  assert.equal(context.calls.tests, 0); assert.match(context.value.tagErr, /wybierz model/)
  assert.deepEqual(context.calls.writes, [])
  await context.value.saveTag({ model: '' }, 'tagModel')
  assert.equal(context.value.aiSet.model, ''); assert.equal(context.value.tagMissing, false)
  context.destroy()
})
await check('tagging settings exist once, on the AI page "Funkcje AI" tab, and no longer inside the model catalogue', async () => {
  let count = 0
  const src = sources['AiPage.svelte']
  function walk(node, path = []) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'RegularElement' && node.name === 'section' && node.attributes.some(a => a.name === 'aria-label' && JSON.stringify(a.value).includes('Tagowanie w edytorze'))) {
      count++
      // {#if tab === 'llm'} … {:else if tab === 'trans'} … {:else} (Funkcje AI): the section sits in the final else branch.
      assert.ok(path.some(([parent, key]) => parent.type === 'IfBlock' && key === 'alternate' && src.slice(parent.test.start, parent.test.end) === "tab === 'trans'"))
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'parent') continue
      if (Array.isArray(child)) child.forEach(item => walk(item, [...path, [node, key]]))
      else if (child && typeof child === 'object') walk(child, [...path, [node, key]])
    }
  }
  walk(parse(sources['AiPage.svelte'], { modern: true }).fragment)
  assert.equal(count, 1)
  assert.ok(!/AISettings|saveAISettings|testAI/.test(sources['ModelsPage.svelte']))
})

process.stdout.write(JSON.stringify({ passed: true, checks: checks.length, tests: checks, backendUsed: false, inferencePerformed: false }, null, 2) + '\n')
