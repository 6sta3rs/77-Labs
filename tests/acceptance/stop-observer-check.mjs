// Exact QA observer in a Node VM. No browser, native IPC, backend or ML.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('./release_cpu_smoke.py', import.meta.url), 'utf8')
const code = source.match(/STOP_RESPONSE_OBSERVER = r"""([\s\S]*?)"""/)?.[1]
assert.ok(code, 'Use the actual observer, rather than a duplicate implementation')
const tests = []
const unhandled = []
const onUnhandled = value => unhandled.push(value)
process.on('unhandledRejection', onUnhandled)
const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture(fetch, postMessage = () => undefined) {
  const window = { fetch, chrome: { webview: { postMessage } } }
  vm.runInNewContext(code, { window, URL, location: { href: 'http://tauri.localhost/' } })
  return window
}
async function check(name, run) {
  await run()
  tests.push(name)
}
function nativeResponse(value, kind = 'ok') {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json', 'Tauri-Response': kind } })
}
const stopUrl = 'http://ipc.localhost/runtime_stop'

await check('exact original promise/response/this/arguments, one dispatch, pending clone does not hold product body', async () => {
  const clone = deferred(), native = deferred(), context = {}, options = { method: 'POST', body: 'fixture' }
  const calls = []
  const response = nativeResponse({ state: 'stopped' })
  response.clone = () => ({ json: () => clone.promise })
  const window = fixture(function (...args) { calls.push({ self: this, args }); return native.promise })
  const forwarded = window.fetch.call(context, stopUrl, options)
  assert.strictEqual(forwarded, native.promise)
  assert.strictEqual(calls[0].self, context)
  assert.strictEqual(calls[0].args[0], stopUrl)
  assert.strictEqual(calls[0].args[1], options)
  assert.equal(calls.length, 1)
  native.resolve(response)
  assert.strictEqual(await forwarded, response)
  assert.deepEqual(await (await forwarded).json(), { state: 'stopped' })
  await flush()
  assert.equal(window.__qaNativeStops[0].pending, true)
  assert.equal(window.__qaNativeStops[0].exact_response_observed, false)
  clone.resolve({ state: 'stopped' }); await flush()
  assert.equal(window.__qaNativeStops[0].exact_response_observed, true)
  assert.equal(window.__qaNativeStops[0].ok, true)
})

await check('HTTP 200 Tauri error is an exact native denial', async () => {
  const response = nativeResponse('native guard denied', 'error'), promise = Promise.resolve(response)
  const window = fixture(() => promise)
  assert.strictEqual(window.fetch(stopUrl), promise)
  await flush()
  const row = window.__qaNativeStops[0]
  assert.equal(response.ok, true)
  assert.equal(row.pending, false)
  assert.equal(row.exact_response_observed, true)
  assert.equal(row.ok, false)
  assert.equal(row.error, 'native guard denied')
  assert.equal('value' in row, false)
})

for (const mode of ['clone_failed', 'decode_failed', 'unknown_tauri_response']) {
  await check(`${mode} remains an observer failure, original native response succeeds`, async () => {
    const response = nativeResponse({ state: 'stopped' }, mode === 'unknown_tauri_response' ? 'unexpected' : 'ok')
    if (mode === 'clone_failed') response.clone = () => { throw new Error('clone fixture') }
    if (mode === 'decode_failed') response.clone = () => ({ json: () => Promise.reject(new Error('decode fixture')) })
    const promise = Promise.resolve(response), window = fixture(() => promise)
    const forwarded = window.fetch(stopUrl)
    assert.strictEqual(forwarded, promise)
    assert.deepEqual(await (await forwarded).json(), { state: 'stopped' })
    await flush()
    const row = window.__qaNativeStops[0]
    assert.equal(row.pending, false)
    assert.equal(row.observation_error, mode)
    assert.equal(row.exact_response_observed, false)
    assert.equal('ok' in row, false)
  })
}

await check('fetch rejection preserves original reason and cannot fabricate native denial', async () => {
  const reason = new Error('native transport fixture'), native = deferred(), window = fixture(() => native.promise)
  const forwarded = window.fetch(stopUrl)
  assert.strictEqual(forwarded, native.promise)
  const received = forwarded.catch(error => error)
  native.reject(reason)
  assert.strictEqual(await received, reason)
  await flush()
  const row = window.__qaNativeStops[0]
  assert.equal(row.transport_error, 'fetch_rejected')
  assert.equal(row.exact_response_observed, false)
  assert.equal('ok' in row, false)
})

await check('sync fetch exception is forwarded unchanged', async () => {
  const reason = new Error('sync fixture'), window = fixture(() => { throw reason })
  assert.throws(() => window.fetch(stopUrl), value => value === reason)
  assert.equal(window.__qaNativeStops.length, 0)
})

await check('status proves dispatch, unrelated endpoints and malformed observer input do not create stop rows', async () => {
  const promise = Promise.resolve(nativeResponse({ state: 'stopped' })), seen = []
  const window = fixture(function (...args) { seen.push(args); return promise })
  for (const input of ['http://ipc.localhost/runtime_status', 'http://ipc.localhost/unrelated', 'http://127.0.0.1:4312/health', 'http://ipc.localhost/%FF', { get url() { throw new Error('observer-only malformed input') } }]) {
    assert.strictEqual(window.fetch(input), promise)
  }
  assert.equal(seen.length, 5)
  assert.equal(window.__qaRuntimeCalls.length, 1)
  assert.equal(window.__qaRuntimeCalls[0].command, 'runtime_status')
  assert.equal(window.__qaNativeStops.length, 0)
})

await check('postMessage forwards exact return/receiver/arguments; dispatch is not completion', async () => {
  const sentinel = {}, context = {}, calls = []
  const window = fixture(() => Promise.resolve(), function (...args) { calls.push({ self: this, args }); return sentinel })
  const raw = JSON.stringify({ cmd: 'runtime_stop', payload: 'not copied to evidence' }), extra = {}
  assert.strictEqual(window.chrome.webview.postMessage.call(context, raw, extra), sentinel)
  assert.strictEqual(calls[0].self, context)
  assert.strictEqual(calls[0].args[0], raw)
  assert.strictEqual(calls[0].args[1], extra)
  assert.equal(calls.length, 1)
  const row = window.__qaNativeStops[0]
  assert.equal(row.transport, 'postMessage')
  assert.equal(row.pending, true)
  assert.equal(row.exact_response_observed, false)
  assert.equal('ok' in row, false)
  assert.equal(JSON.stringify(window.__qaRuntimeCalls).includes('not copied'), false)
  assert.strictEqual(window.chrome.webview.postMessage('{invalid-json'), sentinel)
  assert.equal(window.__qaNativeStops.length, 1)
})

await flush()
assert.deepEqual(unhandled, [], 'Detached observer must handle every rejection')
process.off('unhandledRejection', onUnhandled)
tests.push('no unhandled observer rejection')
process.stdout.write(JSON.stringify({ passed: true, checks: tests.length, tests, native_started: false, network_used: false }, null, 2) + '\n')
