import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import postcss from 'postcss'

const root = fileURLToPath(new URL('../../', import.meta.url))
const cache = new Map()
async function moduleUrl(file) {
  if (cache.has(file)) return cache.get(file)
  let js = ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const specifier of [...js.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => match[1])) {
    if (!specifier.startsWith('.')) continue
    const target = path.resolve(path.dirname(file), specifier + (path.extname(specifier) ? '' : '.ts'))
    js = js.replaceAll(`'${specifier}'`, `'${await moduleUrl(target)}'`).replaceAll(`"${specifier}"`, `"${await moduleUrl(target)}"`)
  }
  const url = 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
  cache.set(file, url)
  return url
}
function rgb(css) {
  if (/^#[0-9a-f]{6}$/i.test(css)) return [1, 3, 5].map(i => parseInt(css.slice(i, i + 2), 16) / 255)
  const match = css.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/)
  assert.ok(match, `Color parser supports palette literals: ${css}`)
  const [L, C, H] = match.slice(1).map(Number), a = C * Math.cos(H * Math.PI / 180), b = C * Math.sin(H * Math.PI / 180)
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.2914855480 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.7076147010 * s].map(v => Math.max(0, Math.min(1, v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055)))
}
const lum = value => value.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05)
const mix = (a, b, alpha) => a.map((v, i) => alpha * v + (1 - alpha) * b[i])
let tokens = new Map()
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} })
globalThis.document = {
  documentElement: { style: { setProperty: (key, value) => tokens.set(key, value) }, dataset: {} },
  createElement() { let css = '#000000'; return { getContext: () => ({ clearRect() {}, get fillStyle() { return css }, set fillStyle(value) { css = value }, fillRect() {}, getImageData: () => ({ data: [...rgb(css).map(v => Math.round(v * 255)), 255] }) }) } },
}
const { applyAppearance, defaultAppearance } = await import(await moduleUrl(path.join(root, 'src/lib/settings/appearance.ts')))
const { builtInThemes } = await import(await moduleUrl(path.join(root, 'src/lib/themes/library.ts')))
const buttonCss = await readFile(path.join(root, 'src/lib/ui/button-tooltip.css'), 'utf8')
const globalCss = await readFile(path.join(root, 'src/styles.css'), 'utf8')
const fieldCss = await readFile(path.join(root, 'src/lib/ui/group-filter.css'), 'utf8')
const controlCss = await readFile(path.join(root, 'src/lib/styles/ui.css'), 'utf8')
const selectComponent = await readFile(path.join(root, 'src/lib/ui/Select.svelte'), 'utf8')
const filterComponent = await readFile(path.join(root, 'src/lib/ui/FilterChip.svelte'), 'utf8')
const checks = []
const minimums = { primaryHover: Infinity, destructive: Infinity, overlayMuted: Infinity, overlayPlaceholder: Infinity, switchThumb: Infinity }
function test(name, fn) { try { fn(); checks.push({ name, passed: true }) } catch (error) { checks.push({ name, passed: false, error: error.message }) } }
function styles(theme, mode, glassOpacity = 95) { tokens = new Map(); applyAppearance({ ...defaultAppearance, mode, theme: theme.id, lightTheme: theme.id, darkTheme: theme.id, glassOpacity }); return tokens }
test('Primary hover keeps the semantic foreground instead of global canvas text', () => {
  const ast = postcss.parse(globalCss)
  ast.walkRules(rule => {
    if (rule.nodes.some(node => node.prop === 'color' && node.value === 'var(--foreground)')) for (const selector of rule.selector.split(',')) {
      if (/(?:^|\s)(?:button|a):hover/.test(selector)) assert.match(selector, /:not\(\.vs-button\)/, `Global selector still matches shared Button: ${selector}`)
    }
  })
  for (const theme of builtInThemes) for (const mode of ['light', 'dark']) {
    const t = styles(theme, mode)
    const value = ratio(rgb(t.get('--primary-foreground')), rgb(t.get('--primary-hover')))
    minimums.primaryHover = Math.min(minimums.primaryHover, value)
    assert.ok(value >= 4.5, `${theme.label}/${mode}: intended hover contrast`)
  }
})
test('Destructive text and opaque hover pass AA in every palette', () => {
  assert.ok(/background:var\(--destructive-button-background/.test(buttonCss), 'Destructive does not use its contrast-safe background role')
  assert.ok(/color:var\(--destructive-button-foreground/.test(buttonCss), 'Destructive does not use its paired foreground role')
  for (const theme of builtInThemes) for (const mode of ['light', 'dark']) {
    const t = styles(theme, mode), fg = rgb(t.get('--destructive-button-foreground') || '#ffffff')
    for (const key of ['--destructive-button-background', '--destructive-button-hover']) {
      const value = ratio(fg, rgb(t.get(key) || t.get('--destructive')))
      minimums.destructive = Math.min(minimums.destructive, value)
      assert.ok(value >= 4.5, `${theme.label}/${mode} ${key}`)
    }
  }
})
test('Overlay muted descriptions pass AA over active surfaces at glass 70/95/100', () => {
  for (const theme of builtInThemes) for (const mode of ['light', 'dark']) for (const alpha of [.7, .95, 1]) {
    const t = styles(theme, mode, alpha * 100), colors = mode === theme.appearance ? theme.colors : theme.variants[mode]
    for (const role of ['--overlay-muted', '--overlay-placeholder']) for (const surface of ['surfaceOverlay', 'surfaceRaised']) {
      const fg = rgb(t.get(role) || t.get('--muted'))
      const bg = mix(rgb(colors[surface]), rgb(colors.canvas), alpha)
      const value = ratio(fg, bg), key = role === '--overlay-muted' ? 'overlayMuted' : 'overlayPlaceholder'
      minimums[key] = Math.min(minimums[key], value)
      assert.ok(value >= 4.5, `${theme.label}/${mode}/${alpha}/${surface}/${role}: ${value.toFixed(3)}`)
    }
  }
})
test('Switch ON uses independent blue and a contrasting thumb in all palettes', () => {
  assert.ok(/\.vs-switch\[aria-checked=true\]\{[^}]*background:var\(--switch-on-background\)/.test(controlCss), 'Switch ON still reuses neutral selection')
  for (const theme of builtInThemes) for (const mode of ['light', 'dark']) {
    const t = styles(theme, mode)
    assert.equal(t.get('--switch-on-background'), '#2563eb', `${theme.label}/${mode}`)
    const value = ratio(rgb(t.get('--switch-on-foreground')), rgb(t.get('--switch-on-background')))
    minimums.switchThumb = Math.min(minimums.switchThumb, value)
    assert.ok(value >= 4.5)
  }
})
test('FilterChip geometry rules match the actual Select trigger class receiver', () => {
  // The component sends class="vs-chip-select" to Select; Select puts className
  // on its button, while its parent only owns class="vs-select".
  assert.ok(/class="vs-chip-select"/.test(filterComponent), 'FilterChip trigger class changed: review the selector contract')
  assert.ok(/<button[^>]+class=\{`vs-select-trigger \$\{className\}`\}/s.test(selectComponent), 'Select className no longer belongs to its trigger: review the selector contract')
  const rules = []
  postcss.parse(fieldCss).walkRules(rule => {
    if (rule.selector.includes('vs-chip-select') && rule.nodes.some(node => node.prop === 'padding')) rules.push(rule.selector)
  })
  assert.ok(rules.some(selector => /\.vs-select-trigger\.vs-chip-select|\.vs-chip-select\.vs-select-trigger/.test(selector)), `No geometry rule matches button.vs-select-trigger.vs-chip-select: ${rules}`)
  assert.ok(!rules.some(selector => /\.vs-chip-select\s*>\s*\.vs-select-trigger/.test(selector)), 'Class receiver is still treated as a wrapper')
})
test('Retired model/voice selector CSS has no orphan declarations', () => {
  assert.ok(!/\.(?:model-select|model-mark|voice-options)(?![-\w])/.test(globalCss), 'Retired selector rules are still present')
})
for (const row of checks) console.log(`${row.passed ? 'PASS' : 'FAIL'} ${row.name}${row.error ? ': ' + row.error : ''}`)
console.log(`UI colors/contracts: ${checks.filter(row => row.passed).length}/${checks.length}`)
console.log('Minimum contrast: ' + Object.entries(minimums).map(([name, value]) => `${name}=${value.toFixed(3)}`).join(', '))
if (checks.some(row => !row.passed)) process.exitCode = 1
