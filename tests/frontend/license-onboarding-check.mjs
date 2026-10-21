import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

async function module(path, dependencies = {}) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const result = {}
  new Function('exports', 'require', code)(result, name => { assert.ok(name in dependencies, name); return dependencies[name] })
  return result
}
const licenses = await module('../../src/lib/models/model-licenses.ts')
const helpers = await module('../../src/lib/models/license-onboarding.ts', { './model-licenses': licenses })
const model = { repo_id: 'fixture/model', license: 'TESTFIXTURE', category: 'unknown', required: true, accepted: false, state: 'not_accepted', fingerprint: `v2:${'a'.repeat(64)}` }
const plan = { schema: 1, source: 'TESTFIXTURE', engine: { id: 'omnivoice', model_id: 'fixture/model' }, models: [model] }
const complete = { ...plan, models: [{ ...model, accepted: true, state: 'accepted' }] }
const entries = new Map()
const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) }
assert.equal(helpers.completedOnboarding(storage), false)
helpers.rememberOnboarding(storage, plan)
assert.equal(helpers.completedOnboarding(storage), false, 'Pending terms must never create a completed hint.')
helpers.rememberOnboarding(storage, complete)
assert.equal(helpers.completedOnboarding(storage), true)
assert.equal(entries.size, 1)
assert.ok(!entries.get(helpers.onboardingStorageKey).includes('accepted'), 'UI storage must not pretend to store consent.')
helpers.rememberOnboarding(storage, { ...plan, models: [{ ...model, state: 'withdrawn' }] })
assert.equal(helpers.completedOnboarding(storage), false, 'An authoritative revocation invalidates the local completion hint.')
assert.notEqual(helpers.onboardingPlanKey(plan), helpers.onboardingPlanKey({ ...plan, source: 'new-engine-version' }))
assert.notEqual(helpers.onboardingPlanKey(plan), helpers.onboardingPlanKey({ ...plan, models: [{ ...model, fingerprint: `v2:${'b'.repeat(64)}` }] }))
for (const raw of [null, {}, { ...plan, schema: 2 }, { ...plan, engine: { id: 'unknown / model' } }, { ...plan, models: [model, model] }, { ...plan, models: [{ ...model, accepted: true }] }, { ...plan, models: [{ ...model, required: false }] }, { ...plan, models: [{ ...model, fingerprint: 'old' }] }]) assert.throws(() => helpers.parseOnboardingPlan(raw))
for (const raw of [{ ...plan, engine: { id: 123 } }, { ...plan, models: [] }, { ...plan, models: [{ ...model, state: 'not_required' }] }]) assert.throws(() => helpers.parseOnboardingPlan(raw))
assert.deepEqual(helpers.parseOnboardingPlan(complete), complete)
assert.deepEqual(helpers.pendingLicenses(complete), [])
for (const status of [404, 501]) await assert.rejects(helpers.readOnboardingPlan(async () => new Response('', { status }), new AbortController().signal), /Zaktualizuj/)
await assert.rejects(helpers.readOnboardingPlan(async () => Response.json({ detail: 'Nieznana tożsamość modelu.' }, { status: 503 }), new AbortController().signal), /Nieznana tożsamość/)
await assert.rejects(helpers.readOnboardingPlan(async () => Response.json({ detail: { code: 'selection_unknown', message: 'Nie ustalono składników tego checkpointu.' } }, { status: 503 }), new AbortController().signal), /Nie ustalono składników/)
await assert.rejects(helpers.readOnboardingPlan(async () => new Response('not-json'), new AbortController().signal), /odczytać planu/)
const abort = new AbortController()
await assert.rejects(helpers.readOnboardingPlan(async () => { abort.abort(); return Response.json(complete) }, abort.signal), error => error.name === 'AbortError')
let calls = 0
assert.deepEqual(await helpers.readOnboardingPlan(async (path, options) => { calls++; assert.equal(path, '/next/models/onboarding'); assert.equal(options.method, undefined); return Response.json(plan) }, new AbortController().signal), plan)
assert.equal(calls, 1, 'Loading the plan performs one read and no mutation.')
console.log('License onboarding PASS: strict plan, per-model pending state, completion hint invalidation, version/fingerprint identity, unsupported/offline contracts and aborted reads. Fictional data only.')
