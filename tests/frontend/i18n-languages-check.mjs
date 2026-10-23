// Guards the multi-language setup: registry rules, catalog quality, fallback chain and the `add` scaffold.
// A language is added at runtime for the behaviour checks (the registry is a plain array), then removed again.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { i18n } from '../helpers/i18n.mjs'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const { LANGUAGES, SOURCE_LANGUAGE, FALLBACK_LANGUAGE, createUiTranslator, setUiLanguage, getUiLanguage } = i18n
let passed = 0
const check = (name, run) => { run(); passed++; console.log(`PASS ${name}`) }
const placeholders = text => [...String(text).matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]).sort().join(',')
const english = LANGUAGES.find(entry => entry.code === FALLBACK_LANGUAGE).catalog

check('The registry has unique BCP 47 codes, valid locales, a catalog-less source language and an English fallback', () => {
  const codes = LANGUAGES.map(entry => entry.code)
  assert.equal(new Set(codes).size, codes.length)
  for (const entry of LANGUAGES) {
    assert.match(entry.code, /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, entry.code)
    assert.ok(entry.name.trim(), `${entry.code}: name`)
    assert.doesNotThrow(() => new Intl.Locale(entry.locale), `${entry.code}: locale`)
    assert.ok(!entry.dir || entry.dir === 'ltr' || entry.dir === 'rtl', `${entry.code}: dir`)
  }
  assert.equal(LANGUAGES.find(entry => entry.code === SOURCE_LANGUAGE).catalog, null)
  assert.ok(english && Object.keys(english).length > 1000)
})
check('Every catalog has only non-empty strings, keys that exist in English and the same {placeholders} as the Polish key', () => {
  const problems = []
  for (const entry of LANGUAGES.filter(item => item.catalog)) {
    for (const [key, value] of Object.entries(entry.catalog)) {
      if (typeof value !== 'string' || !value.trim()) problems.push(`${entry.code}: empty value for "${key}"`)
      else if (entry.code !== FALLBACK_LANGUAGE && !(key in english)) problems.push(`${entry.code}: key not in English: "${key}"`)
      else if (placeholders(key) !== placeholders(value)) problems.push(`${entry.code}: placeholders differ in "${key}"`)
    }
    if (entry.complete) for (const key of Object.keys(english)) if (typeof entry.catalog[key] !== 'string') problems.push(`${entry.code}: missing "${key}"`)
  }
  assert.deepEqual(problems.slice(0, 10), [])
})

const fake = { code: 'xx', name: 'Testowy', locale: 'de-DE', dir: 'rtl', catalog: { 'Zapisano': 'XX Saved' } }
check('A newly registered language is selectable, uses its own locale and direction, and persists like any other', () => {
  LANGUAGES.push(fake)
  try {
    const tr = createUiTranslator('xx')
    assert.equal(tr.language, 'xx'); assert.equal(tr.locale, 'de-DE')
    assert.equal(setUiLanguage('xx').ok, true)
    assert.equal(getUiLanguage(), 'xx'); assert.equal(document.documentElement.lang, 'xx'); assert.equal(document.documentElement.dir, 'rtl')
    assert.equal(setUiLanguage('pl').ok, true); assert.equal(document.documentElement.dir, 'ltr')
  } finally { LANGUAGES.pop() }
  assert.equal(setUiLanguage('xx').ok, false, 'removed languages are rejected again')
})
check('A missing key falls back to English, then to the Polish source; text in any catalog maps to the selected language', () => {
  LANGUAGES.push(fake)
  try {
    const tr = createUiTranslator('xx')
    assert.equal(tr('Zapisano'), 'XX Saved')
    const untranslated = Object.keys(english).find(key => !(key in fake.catalog) && !key.includes('{'))
    assert.equal(tr(untranslated), english[untranslated], 'falls back to English')
    assert.equal(tr('Tekst bez tłumaczenia 12345'), 'Tekst bez tłumaczenia 12345', 'falls back to the source')
    assert.equal(tr('Saved'), 'XX Saved', 'English text (for example from the engine) maps to the selected language')
    assert.equal(createUiTranslator('en')('Zapisano'), 'Saved', 'the other languages are unaffected')
  } finally { LANGUAGES.pop() }
})
check('`npm run i18n:add` creates a catalog and registers it before the marker; a second run is refused', () => {
  const temp = mkdtempSync(join(tmpdir(), 'i18n-add-'))
  try {
    mkdirSync(join(temp, 'frontend/src/i18n'), { recursive: true })
    cpSync(join(repo, 'frontend/src/i18n/languages.ts'), join(temp, 'frontend/src/i18n/languages.ts'))
    const run = (...args) => spawnSync(process.execPath, [join(repo, 'tools/dev/i18n-lang.mjs'), 'add', ...args], { env: { ...process.env, I18N_ROOT: temp }, encoding: 'utf8' })
    const first = run('de', 'Deutsch', 'de-DE')
    assert.equal(first.status, 0, first.stderr)
    const registry = readFileSync(join(temp, 'frontend/src/i18n/languages.ts'), 'utf8')
    assert.match(registry, /import \{ catalog as de \} from '\.\/de\/index'/)
    assert.match(registry, /\{ code: 'de', name: "Deutsch", locale: 'de-DE', catalog: de \},\n  \/\/ i18n:add-language-above/)
    assert.ok(existsSync(join(temp, 'frontend/src/i18n/de/index.ts')))
    assert.notEqual(run('de', 'Deutsch', 'de-DE').status, 0)
    assert.notEqual(run('XX', 'Bad', 'de-DE').status, 0)
    assert.equal(run('ar', 'العربية', 'ar-SA', 'rtl').status, 0)
    assert.match(readFileSync(join(temp, 'frontend/src/i18n/languages.ts'), 'utf8'), /locale: 'ar-SA', dir: 'rtl', catalog: ar/)
  } finally { rmSync(temp, { recursive: true, force: true }) }
})
console.log(`UI languages: ${passed}/5`)
