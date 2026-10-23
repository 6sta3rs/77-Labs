import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url)), modules = new Map()
async function moduleUrl(file) {
  if (modules.has(file)) return modules.get(file)
  let code = ts.transpileModule(await readFile(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  for (const specifier of [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => match[1])) {
    if (!specifier.startsWith('.')) continue
    const target = path.resolve(path.dirname(file), specifier + (path.extname(specifier) ? '' : '.ts'))
    const url = await moduleUrl(target)
    code = code.replaceAll(`'${specifier}'`, `'${url}'`).replaceAll(`"${specifier}"`, `"${url}"`)
  }
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  modules.set(file, url)
  return url
}
const stored = new Map(), writes = [], published = []
let readFailure = false, writeFailure = false, requests = 0
const storage = {
  getItem(key) { if (readFailure) throw new Error('Read denied'); return stored.get(key) ?? null },
  setItem(key, value) { if (writeFailure) throw new Error('Quota exceeded'); writes.push([key, value]); stored.set(key, String(value)) },
}
globalThis.localStorage = storage
globalThis.document = { documentElement: { lang: '', dataset: {} }, title: '' }
globalThis.fetch = () => { requests++; throw new Error('UI language must not call a backend') }
const core = await import(await moduleUrl(path.join(root, 'frontend/src/i18n/index.ts')))
const { uiLanguage, getUiLanguage, setUiLanguage, initUiLanguage, createUiTranslator, translateUi, UI_LANGUAGE_KEY } = core
let passed = 0
const check = (name, run) => { run(); passed++; console.log(`PASS ${name}`) }
const originalPayload = { speechLanguage: 'pl', model: 'omnivoice', text: 'Treść narracji pozostaje po polsku.', project: 'Mój projekt' }
const payloadSnapshot = JSON.stringify(originalPayload)
const unsubscribe = uiLanguage.subscribe(value => published.push(value))

check('Polish is the default and readable subscribers receive it immediately', () => {
  assert.equal(getUiLanguage(), 'pl'); assert.deepEqual(published, ['pl'])
  assert.equal(initUiLanguage().ok, true)
  assert.equal(document.documentElement.lang, 'pl')
  assert.equal(document.title, 'Seventy Seven Labs')
  assert.equal(writes.length, 0)
})
check('English is persisted under the UI-only key before subscribers are notified', () => {
  const before = published.length
  assert.equal(setUiLanguage('en').ok, true)
  assert.equal(stored.get(UI_LANGUAGE_KEY), 'en')
  assert.equal(getUiLanguage(), 'en'); assert.equal(document.documentElement.lang, 'en')
  assert.equal(published.length, before + 1); assert.equal(published.at(-1), 'en')
  assert.equal(translateUi('Język interfejsu'), 'Interface language')
})
check('Reload restores the saved preference without writing another setting', () => {
  const before = writes.length
  assert.equal(initUiLanguage().language, 'en')
  assert.equal(writes.length, before)
})
check('A bound translator retains its language and locale after the global preference changes', () => {
  const tr = createUiTranslator('en')
  assert.equal(tr.language, 'en'); assert.equal(tr.locale, 'en-US')
  setUiLanguage('pl')
  assert.equal(tr('Zapisz'), 'Save')
  assert.equal(createUiTranslator('pl').locale, 'pl-PL')
  assert.equal(translateUi('Zapisz'), 'Zapisz')
})
check('Interpolation keeps user content literal and supports zero, empty text and missing placeholders', () => {
  const tr = createUiTranslator('en')
  assert.equal(tr('Usuń motyw {name}', { name: originalPayload.project }), 'Delete theme Mój projekt')
  assert.equal(tr('Usuń motyw {name}', { name: 'Polski' }), 'Delete theme Polski')
  assert.equal(tr('Odczytano {count} modeli.', { count: 0 }), 'Read 0 models.')
  assert.equal(tr('Model: {name}', { name: '' }), 'Model: ')
  assert.equal(tr('Model: {name}'), 'Model: {name}')
  assert.equal(tr('Unregistered {name}', { name: '$& <value>' }), 'Unregistered $& <value>')
})
check('Existing interpolated status text translates both ways without rebuilding its state', () => {
  const en = createUiTranslator('en'), pl = createUiTranslator('pl')
  assert.equal(en('Odczytano 7 modeli.'), 'Read 7 models.')
  assert.equal(pl('Read 7 models.'), 'Odczytano 7 modeli.')
  assert.equal(en('Odczytano 7 modeli (lista ograniczona przez serwer).'), 'Read 7 models (list limited by the server).')
  assert.equal(pl('Read 7 models (list limited by the server).'), 'Odczytano 7 modeli (lista ograniczona przez serwer).')
  assert.equal(pl('Interface language'), 'Język interfejsu')
  assert.equal(en(originalPayload.text), originalPayload.text)
})
check('The gallery and dictation titles follow the selected interface language', () => {
  document.documentElement.dataset.page = 'controls'; setUiLanguage('en')
  assert.match(document.title, /^Controls [—-] Seventy Seven Labs$/)
  document.documentElement.dataset.page = 'dictation-widget'; setUiLanguage('pl')
  assert.equal(document.title, 'Dyktowanie — Seventy Seven Labs')
  setUiLanguage('en'); assert.match(document.title, /^Dictation [—-] Seventy Seven Labs$/)
})
check('Malformed and unsupported stored values safely fall back to Polish', () => {
  const before = writes.length
  for (const value of ['fr', 'en-US', '"en"', '{', 'null', '']) {
    stored.set(UI_LANGUAGE_KEY, value)
    assert.equal(initUiLanguage().language, 'pl')
  }
  assert.equal(writes.length, before)
})
check('A storage read failure reports a clear error and selects the Polish fallback', () => {
  readFailure = true
  const result = initUiLanguage(); readFailure = false
  assert.equal(result.ok, false); assert.match(result.error, /Nie udało się odczytać/)
  assert.equal(getUiLanguage(), 'pl')
})
check('A failed save preserves the active language, storage and subscriber state', () => {
  setUiLanguage('pl')
  const before = published.length, beforeWrites = writes.length
  writeFailure = true
  const result = setUiLanguage('en'); writeFailure = false
  assert.equal(result.ok, false); assert.match(result.error, /Poprzedni język/)
  assert.equal(getUiLanguage(), 'pl'); assert.equal(stored.get(UI_LANGUAGE_KEY), 'pl')
  assert.equal(published.length, before); assert.equal(writes.length, beforeWrites)
  assert.equal(document.documentElement.lang, 'pl')
})
check('Invalid runtime values are rejected without writing or publishing them', () => {
  const before = writes.length, beforePublished = published.length
  assert.equal(setUiLanguage('fr').ok, false)
  assert.equal(writes.length, before); assert.equal(published.length, beforePublished)
})
check('Missing browser storage cannot falsely report that a new preference was saved', () => {
  delete globalThis.localStorage
  const result = setUiLanguage('en')
  globalThis.localStorage = storage
  assert.equal(result.ok, false); assert.equal(getUiLanguage(), 'pl')
})
check('Unsubscribing releases the listener while further language changes remain functional', () => {
  const before = published.length
  unsubscribe(); setUiLanguage('en'); setUiLanguage('pl')
  assert.equal(published.length, before)
})
check('Changing the interface never writes speech settings, edits content or contacts the backend', () => {
  assert.equal(JSON.stringify(originalPayload), payloadSnapshot)
  assert.equal(requests, 0)
  assert.ok(writes.length > 0 && writes.every(([key]) => key === UI_LANGUAGE_KEY))
})
console.log(`UI language core: ${passed}/${passed}`)
