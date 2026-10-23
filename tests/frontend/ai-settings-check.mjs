// Execute the real AI settings page script (editor tagging through the Codex/ChatGPT account) with
// controlled HTTP/lifecycle results. No browser, backend, native runtime, account read or inference.
// The old standalone AISettings.svelte was merged into settings/pages/AiPage.svelte. Contract changes
// adopted from the redesign: tagging fields save immediately on change (no explicit "save" button) and
// the tagging test is a separate action that never writes.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { compile, parse } from 'svelte/compiler'
import { sourceUrl } from '../helpers/source-url.mjs'
import { runesComponent, flush } from '../helpers/runes-component.mjs'

// The harness strips imports, so the shared provider helper (models/llm-usable.ts) is transpiled here and passed in as a dependency.
const { usableProvider, modelOnlyProvider, HIDDEN_LLM_PROVIDERS } = await import('data:text/javascript,' + encodeURIComponent(ts.transpileModule(await readFile(sourceUrl('models/llm-usable.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText))
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
  '/api/settings/dictation-refinement': {}, '/api/settings/asr-openai-compat': { base_url: '', model: '' }, '/next/settings/credentials': { fields: [] }, '/next/settings/added-llm-providers': { ids: [] } }
const toasts = []
async function subject(overrides = {}, reads = {}) {
  const calls = { reads: 0, statuses: 0, writes: [], tests: 0, engine: [] }
  const deps = {
    toast: { ok: m => toasts.push(['ok', m]), bad: m => toasts.push(['bad', m]), warn: m => toasts.push(['warn', m]), info: m => toasts.push(['info', m]) },
    productionJson: async (path, options) => { calls.engine.push({ path, method: options?.method ?? 'GET' }); const table = { ...engineReads, ...reads }; if (!(path in table)) throw new Error('Unexpected ' + path); const value = table[path]; return structuredClone(typeof value === 'function' ? await value(options) : value) },
    postJson: (body, signal) => ({ method: 'POST', body: JSON.stringify(body), signal }),
    putSettings: async () => assert.fail('No credential write expected'), settingsError: cause => cause?.message ?? String(cause),
    skillLabels: {}, connectionMessage: () => '', HIDDEN: HIDDEN_LLM_PROVIDERS, modelOnlyProvider,
    getAISettings: async () => { calls.reads++; return { ...saved } },
    getAIStatus: async () => { calls.statuses++; return structuredClone(status) },
    saveAISettings: async value => { calls.writes.push(value); return { ...value } },
    testAI: async () => { calls.tests++; return tested },
    ...overrides,
  }
  const page = await runesComponent('AiPage.svelte', { deps, props: { ready: true }, exposure: `refreshAi, saveTag, tagTest,
    get aiSet() { return aiSet }, get aiStat() { return aiStat }, get aiErr() { return aiErr }, get loaded() { return loaded },
    get tagGroups() { return tagGroups }, get tagModel() { return tagModel }, get tagMissing() { return tagMissing },
    get tagRes() { return tagRes }, get tagErr() { return tagErr }, get tagBusy() { return tagBusy },
    get got() { return got }, get blocked() { return blocked }, get rows() { return rows }, get added() { return added }, get pickGroups() { return pickGroups }, get attention() { return attention }, fetchLists, setAdded, setDef, stOf` })
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

const provider = (over = {}) => ({ id: 'p', display_name: 'P', local: false, base_url: 'https://api.example.test/v1', model: '', has_key: true, has_api_key: true, configured: false, transport: 'openai', supports_model_listing: true, ...over })
await check('each section renders as soon as its own read arrives; the intent waits only for the provider read', async () => {
  const slow = deferred()
  const context = await subject({}, { '/api/settings/llm-skills': () => slow.promise })
  await settle()
  assert.equal(context.value.got.prov, true); assert.equal(context.value.got.skills, false); assert.equal(context.value.loaded, false)
  assert.equal(context.value.got.creds, true)
  slow.resolve({ skills: [] }); await settle()
  assert.equal(context.value.got.skills, true); assert.equal(context.value.loaded, true)
  context.destroy()
})
await check('a failed read still marks its section as settled so it can show the error instead of a spinner', async () => {
  const context = await subject({}, { '/api/settings/asr-openai-compat': () => { throw new Error('TESTFIXTURE asr down') } })
  await settle()
  assert.equal(context.value.got.asr, true); assert.equal(context.value.loaded, true)
  context.destroy()
})
await check('Codex alone does not unblock AI functions; a keyed provider that only lacks a default model does and lists its models', async () => {
  const codexOnly = await subject(); await settle()
  assert.equal(codexOnly.value.blocked, true, 'ChatGPT (Codex) serves tagging only')
  codexOnly.destroy()
  const listed = []
  const context = await subject({}, {
    '/api/settings/llm-providers': { active: null, providers: [provider({ id: 'together', display_name: 'Together' }), provider({ id: 'nokey', has_key: false, has_api_key: false })] },
    '/api/settings/llm-providers/together/models': () => { listed.push('together'); return { ok: true, models: ['m-1', 'embed-x'] } } })
  await settle()
  const row = context.value.rows.find(r => r.id === 'together')
  assert.ok(row, 'a keyed provider appears in the list')
  assert.deepEqual(context.value.stOf(row), ['warn', 'Wybierz model'])
  assert.equal(context.value.blocked, false, 'the model-only provider is pickable')
  context.value.fetchLists(); await settle()
  assert.deepEqual(listed, ['together'])
  const group = context.value.pickGroups.find(g => g.id === 'together')
  assert.equal(group.state, ''); assert.deepEqual(group.models, ['m-1'])
  context.destroy()
})
await check('Claude Code and the other CLI agents are not offered', async () => {
  const context = await subject({}, { '/api/settings/llm-providers': { active: 'claude-code', providers: [provider({ id: 'claude-code', transport: 'cli', configured: true, has_api_key: false, base_url: '' }), provider({ id: 'a', configured: true, model: 'x' })] } })
  await settle()
  assert.deepEqual(context.value.rows.map(r => r.id).filter(id => id !== 'chatgpt'), ['a'])
  context.destroy()
})
await check('the added-provider list is stored by the engine, migrated once from localStorage and restored when the write fails', async () => {
  const store = new Map([['voicestudio.ai.providers.v1', JSON.stringify(['ollama', 'bogus'])]])
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) }
  const puts = []
  const reads = { '/api/settings/llm-providers': { active: null, providers: [provider({ id: 'ollama', local: true })] }, '/next/settings/added-llm-providers': { ids: [] } }
  try {
    let context = await subject({ putSettings: async (path, body) => { puts.push([path, body]); return { ids: body.ids } } }, reads)
    await settle()
    assert.deepEqual(puts, [['/next/settings/added-llm-providers', { ids: ['ollama'] }]], 'unknown legacy ids are not sent')
    assert.deepEqual(context.value.added, ['ollama']); assert.equal(store.has('voicestudio.ai.providers.v1'), false)
    context.destroy()
    context = await subject({ putSettings: async () => { throw new Error('TESTFIXTURE refused') } }, { ...reads, '/next/settings/added-llm-providers': { ids: ['ollama'] } })
    await settle(); store.clear()
    await context.value.setAdded(['ollama', 'openai'])
    assert.deepEqual(context.value.added, ['ollama'], 'a refused write restores the previous list')
    context.destroy()
  } finally { delete globalThis.localStorage }
})
await check('no active provider is not "attention"; sdk providers without an address are model-only; the notice uses the same usable definition', async () => {
  const context = await subject({}, { '/api/settings/llm-providers': { active: null, providers: [provider({ id: 'together' }), provider({ id: 'sdk', transport: 'sdk', base_url: '' })] } })
  await settle()
  assert.equal(context.value.blocked, false); assert.equal(context.value.attention, false, 'with nothing active the badge says "Wybierz model", not "Dostawca niedostępny"')
  assert.deepEqual(context.value.stOf(context.value.rows.find(r => r.id === 'sdk')), ['warn', 'Wybierz model'])
  context.destroy()
  assert.equal(usableProvider(provider({ id: 'ollama', local: true, configured: true, has_api_key: false })), true, 'a configured local provider counts without being active')
  assert.equal(usableProvider(provider({ id: 'claude-code', configured: true })), false)
  assert.equal(usableProvider(provider({ id: 'x', has_key: false, has_api_key: false })), false)
})
await check('picking a default model saves it on the provider before the provider is activated', async () => {
  const prov = { providers: [provider({ id: 'together' })], active: null }
  const context = await subject({}, { '/api/settings/llm-providers': prov, '/api/settings/llm-providers/together': prov, '/api/settings/llm-providers/active': prov })
  await settle(); const before = context.calls.engine.length
  context.value.setDef('together', 'm-1'); await settle()
  assert.deepEqual(context.calls.engine.slice(before).filter(c => c.method !== 'GET').map(c => `${c.method} ${c.path}`), ['PUT /api/settings/llm-providers/together', 'POST /api/settings/llm-providers/active'])
  context.destroy()
})
await check('a failed read of the added list keeps persisting (only a missing route is session-only); interleaved failed adds return to the last confirmed list', async () => {
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
  try {
    const puts = [], base = { '/api/settings/llm-providers': { active: null, providers: [provider({ id: 'ollama', local: true }), provider({ id: 'lmstudio', local: true })] } }
    let context = await subject({ putSettings: async (path, body) => { puts.push(body.ids); return { ids: body.ids } } }, { ...base, '/next/settings/added-llm-providers': () => { throw new Error('Silnik nie odpowiedział') } })
    await settle(); await context.value.setAdded(['ollama'])
    assert.deepEqual(puts, [['ollama']], 'a timeout must not stop persistence'); context.destroy()
    puts.length = 0
    context = await subject({ putSettings: async (path, body) => { puts.push(body.ids); return { ids: body.ids } } }, { ...base, '/next/settings/added-llm-providers': () => { throw new Error('Not Found') } })
    await settle(); await context.value.setAdded(['ollama'])
    assert.deepEqual(puts, [], 'a missing route is session-only'); assert.deepEqual(context.value.added, ['ollama']); context.destroy()
    context = await subject({ putSettings: async () => { throw new Error('TESTFIXTURE refused') } }, { ...base, '/next/settings/added-llm-providers': { ids: ['x'] } })
    await settle()
    const first = context.value.setAdded(['x', 'ollama']), second = context.value.setAdded(['x', 'ollama', 'lmstudio'])
    assert.deepEqual([await first, await second], [false, false]); assert.deepEqual(context.value.added, ['x'])
    context.destroy()
  } finally { delete globalThis.localStorage }
})
await check('markup: manual model entry exists in the full picker, the tagging switch keeps its state without Codex, the shared-model note is shown', async () => {
  const picker = sources['settings/pages/ModelPicker.svelte']
  const full = picker.slice(picker.indexOf('{#if full}'), picker.indexOf('{:else}\n  <div class="mp">'))
  assert.match(full, /startManual/); assert.match(full, /manualRow/)
  const page = sources['AiPage.svelte']
  assert.match(page, /checked=\{!!aiSet\?\.enabled\} disabled=\{!aiSet \|\| tagSaving \|\| tagBusy \|\| \(!gptOk && !aiSet\.enabled\)\}/)
  assert.match(page, /Włączone, ale Codex niezalogowany/); assert.match(page, /Silnik przechowuje jeden model na dostawcę/)
})

process.stdout.write(JSON.stringify({ passed: true, checks: checks.length, tests: checks, backendUsed: false, inferencePerformed: false }, null, 2) + '\n')
