import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// Exercise the actual library, appearance reader and v1 serializer without a
// browser profile. Color parsing itself remains covered by the browser checks.
const root = fileURLToPath(new URL('../', import.meta.url))
const modules = new Map()
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
const stored = new Map()
globalThis.localStorage = {
  getItem: key => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, String(value)),
}
globalThis.CSS = { supports: (property, value) => property === 'color' && /^(?:#[\da-f]+|oklch\()/i.test(value) }
const upstream = await import(await moduleUrl(path.join(root, 'src/lib/themes/t3-palettes.ts')))
const library = await import(await moduleUrl(path.join(root, 'src/lib/themes/library.ts')))
const appearance = await import(await moduleUrl(path.join(root, 'src/lib/appearance.ts')))
let passed = 0
function test(name, run) { run(); passed++; console.log(`PASS ${name}`) }
const appearanceKey = 'voicestudio.appearance.v2'
const expectedColors = {
  studio: { light: upstream.T3_CODE_LIGHT_THEME_COLORS, dark: upstream.T3_CODE_DARK_THEME_COLORS },
  rose: { light: upstream.T3_CHAT_THEME.colors, dark: upstream.T3_CHAT_THEME.variants.dark },
}

test('Public names keep both legacy IDs and the original upstream definitions', () => {
  assert.equal(library.getTheme('studio').label, 'Labs')
  assert.equal(library.getTheme('rose').label, 'R\u00f3\u017ca')
  assert.equal(upstream.T3_CHAT_THEME.id, 't3-chat')
  assert.equal(upstream.T3_CHAT_THEME.label, 'T3 Chat')
  assert.deepEqual(library.builtInThemes.map(theme => theme.id), ['studio', 'rose', 'grove', 'ocean', 'ember', 'iris'])
})
for (const id of ['studio', 'rose']) {
  test(`${id}: legacy saved preferences resolve and save with exactly the same light/dark colors`, () => {
    localStorage.setItem(appearanceKey, JSON.stringify({ theme: id, mode: 'dark' }))
    const loaded = appearance.loadAppearance()
    assert.equal(loaded.theme, id)
    assert.equal(loaded.lightTheme, id)
    assert.equal(loaded.darkTheme, id)
    for (const mode of ['light', 'dark']) {
      assert.deepEqual(appearance.themeColors(loaded[`${mode}Theme`], mode), expectedColors[id][mode])
    }
    assert.equal(appearance.saveAppearance(loaded), true)
    assert.deepEqual(JSON.parse(localStorage.getItem(appearanceKey)), loaded)
  })
}
test('Existing mixed assignments survive loading without a palette reset', () => {
  localStorage.setItem(appearanceKey, JSON.stringify({ theme: 'studio', lightTheme: 'rose', darkTheme: 'studio', mode: 'system' }))
  const loaded = appearance.loadAppearance()
  assert.equal(loaded.mode, 'system')
  assert.equal(loaded.lightTheme, 'rose')
  assert.equal(loaded.darkTheme, 'studio')
  assert.deepEqual(appearance.themeColors(loaded.lightTheme, 'light'), expectedColors.rose.light)
  assert.deepEqual(appearance.themeColors(loaded.darkTheme, 'dark'), expectedColors.studio.dark)
})
test('External v1 JSON keeps its name, ID and overrides through parsing, export and persistence', () => {
  const external = { version: 1, id: 'external-compatible', name: 'T3 Code import', appearance: 'dark',
    colors: { canvas: '#123456', accent: '#789abc' }, variants: { light: { canvas: '#f1f2f3' } } }
  const parsed = library.parseThemeFile(JSON.stringify(external))
  assert.equal(parsed.id, external.id)
  assert.equal(parsed.label, external.name)
  assert.deepEqual(parsed.colors, { ...expectedColors.studio.dark, ...external.colors })
  assert.deepEqual(parsed.variants.light, { ...expectedColors.studio.light, ...external.variants.light })
  const exported = library.serializeTheme(parsed)
  assert.equal(JSON.parse(exported).version, 1)
  assert.deepEqual(library.parseThemeFile(exported), parsed)
  library.saveCustomTheme(parsed)
  const persisted = JSON.parse(localStorage.getItem(library.THEME_LIBRARY_KEY))
  assert.deepEqual(library.parseThemeFile(JSON.stringify(persisted[0])), parsed)
  assert.equal(library.getTheme(parsed.id).label, external.name)
})
test('Duplicating a renamed built-in exports an editable v1 theme without mutating its source', () => {
  const source = library.getTheme('rose'), before = JSON.stringify(source)
  const duplicate = library.duplicateTheme(source)
  assert.notEqual(duplicate.id, source.id)
  const roundTrip = library.parseThemeFile(library.serializeTheme(duplicate))
  assert.equal(roundTrip.id, duplicate.id)
  assert.equal(roundTrip.label, duplicate.label)
  assert.equal(roundTrip.appearance, duplicate.appearance)
  assert.deepEqual(roundTrip.colors, duplicate.colors)
  assert.deepEqual(roundTrip.variants, duplicate.variants)
  duplicate.colors.canvas = '#abcdef'
  assert.equal(JSON.stringify(source), before)
})
test('Legacy built-in IDs remain reserved and unsupported schema versions are rejected', () => {
  const base = { version: 1, name: 'Example', appearance: 'dark', colors: { canvas: '#123456' } }
  for (const id of ['studio', 'rose', 't3-code', 't3-chat']) {
    assert.throws(() => library.parseThemeFile(JSON.stringify({ ...base, id })))
  }
  assert.throws(() => library.parseThemeFile(JSON.stringify({ ...base, version: 2 })), /version: 1/)
})
console.log(`Theme compatibility: ${passed}/${passed}`)
