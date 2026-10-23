// Static guard: Polish-looking user-visible literals in src/**/*.svelte and the demo fixtures must have an English key.
// Ratchet: tests/frontend/i18n-baseline.json lists the misses that are still tolerated ({ "file": ["text", ...] }).
// New misses fail; fixed ones are reported so the baseline can be lowered. Regenerate: node tests/frontend/i18n-coverage-check.mjs --update
// Two rules: (1) heuristic - Polish-looking literals (diacritics, known Polish words, placeholder strings) need a key;
// (2) exact - any string literal that is the first argument of tr(...) needs a key (identity keys count), unless allow-listed.
// It finds literals without a key, not raw render sinks (a keyed string rendered without tr() is not detected).
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { parse } from 'svelte/compiler'

const root = fileURLToPath(new URL('../../', import.meta.url)), modules = new Map()
const baselineFile = path.join(root, 'tests/frontend/i18n-baseline.json')
const tsFixtures = ['src/lib/gallery/tts-demo.ts', 'src/lib/gallery/extra-tts-demo.ts']
async function moduleUrl(file) {
  if (modules.has(file)) return modules.get(file)
  let code = ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const s of [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1])) {
    if (!s.startsWith('.')) continue
    const url = await moduleUrl(path.resolve(path.dirname(file), s + (path.extname(s) ? '' : '.ts')))
    code = code.replaceAll(`'${s}'`, `'${url}'`).replaceAll(`"${s}"`, `"${url}"`)
  }
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  modules.set(file, url); return url
}
globalThis.localStorage = { getItem: () => null, setItem() {} }
globalThis.document = { documentElement: { lang: '', dataset: {} }, title: '' }
const en = (await import(await moduleUrl(path.join(root, 'src/lib/i18n/index.ts')))).createUiTranslator('en')
const keys = new Set()
for (const file of (await readdir(path.join(root, 'src/lib/i18n/en'))).filter(f => /\.ts$/.test(f) && f !== 'index.ts'))
  for (const key of Object.keys(Object.values(await import(await moduleUrl(path.join(root, 'src/lib/i18n/en', file))))[0])) keys.add(key)
const covered = s => en(s) !== s || en(s.trim()) !== s.trim()

const PL = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/
const SKIP_ATTR = /^(class|style|id|href|src|type|name|for|role|d|viewBox|fill|stroke|width|height|target|rel|lang|dir|inputmode|autocomplete|accept|pattern|loading|decoding|slot|popover|data-.*|on.*|variant|size|mode|kind|tone|icon|key|value)$/
// Proper names, units, protocols and deliberately English example prompts: not translatable text.
const ALLOW = new Set(['Seventy Seven Labs', 'Seventy Seven Labs ·', 'Signal Bloom', 'Signal Bloom ·', 'Michał', 'Amazon Translate', 'Google Cloud Translation', 'Microsoft Translator', 'OpenAI (ChatGPT)',
  'Apple (MPS)', 'CPU (s)', 'GPU (s)', 'Intel (XPU)', 'NVIDIA CUDA 12.8', 'Tailscale Serve', 'Ctrl K', 'GET /health', 'hf_…', 'Hz ·', 'A warm female voice with low pitch', 'A female, elderly voice with low pitch',
  'Clear and friendly conversational voice', '{ "version": 1, "name": "Mój motyw", "appearance": "dark", "colors": { "accent": "#346bf1" } }',
  'zadań', 'Audiobook (ACX)', 'https://…', 'icon / tooltip', 'name / reset', 'OmniVoice · k2-fsa', 'Cześć. To jest próbka zaprojektowanego głosu.']) // last: the sample sentence is spoken Polish text, not UI // 'zadań' is the plural fragment of a keyed template literal
// Strings passed to tr() that are deliberately identical in both languages and have no key.
const TR_ALLOW = new Set(['OK', 'Audio', 'WAV', 'MP3', 'FLAC', 'JSON'])
// Polish words that carry no diacritics (single words and short phrases would otherwise look like English).
const PL_WORDS = new Set(['nie', 'jest', 'dla', 'oraz', 'lub', 'czy', 'przy', 'jak', 'tak', 'ten', 'przez', 'bez', 'zapisz', 'anuluj', 'dodaj', 'usun', 'wybierz', 'gotowe', 'pobierz',
  'otworz', 'zamknij', 'szukaj', 'wyczysc', 'tekst', 'nagranie', 'nagrania', 'plik', 'pliki', 'glos', 'glosu', 'glosy', 'ustawienia', 'wszystkie', 'brak', 'blad', 'wynik', 'wyniki', 'zadanie', 'zadania'])
// PascalCase component names and dotted paths only: "GenerationCard / Player", not "Upload / wyszukiwarka / modal / komunikat".
const IDENTIFIERS = /^[A-Z][A-Za-z0-9]*(?: [/·] [A-Z][A-Za-z0-9.-]*)+$/ // "GenerationCard / Player"
function candidate(s) {
  const t = s.replace(/\s+/g, ' ').trim()
  if (ALLOW.has(t) || IDENTIFIERS.test(t) || FILENAME.test(t)) return false
  if (t.length < 2 || !/\p{L}{2}/u.test(t)) return false
  if (/^[\w./:#@%$-]+$/.test(t) && !/^[A-ZŁŚŻŹĆ][a-ząćęłńóśźż]+$/.test(t)) return false // identifiers, css, urls
  const plWord = t.toLowerCase().split(/[^\p{L}]+/u).some(w => PL_WORDS.has(w))
  if (/[{};=<>]|=>|\bfunction\b/.test(t) && !PL.test(t) && !plWord) return false
  if (PL.test(t) || plWord) return true
  return /^[A-ZŁŚŻŹĆ]/.test(t) && /\s/.test(t) || /…$/.test(t) // English-looking single words are not flagged; multi-word capitalised phrases are
}

const out = [], trLiterals = []
const polishEvidence = t => PL.test(t) || t.toLowerCase().split(/[^\p{L}]+/u).some(w => PL_WORDS.has(w))
const FILENAME = /^[\w{}-]+\.(?:\{\}|\w{2,4})$/ // "nagranie-{}.wav": generated download names stay as they are
function walk(node, parents, file, lineOf) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const n of node) walk(n, parents, file, lineOf); return }
  const t = node.type
  if (typeof t === 'string' && t.startsWith('TS')) return
  if (t === 'ImportDeclaration' || (t === 'ExportNamedDeclaration' && node.source)) return
  const here = [...parents, node], parent = parents.at(-1)
  if (t === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'tr') {
    const a = node.arguments?.[0]
    if (a?.type === 'Literal' && typeof a.value === 'string') trLiterals.push({ file, line: lineOf(a.start ?? 0), text: a.value })
    else if (a?.type === 'TemplateLiteral' && !a.expressions.length) trLiterals.push({ file, line: lineOf(a.start ?? 0), text: a.quasis[0].value.cooked ?? a.quasis[0].value.raw })
  }
  if (t === 'Literal' && typeof node.value === 'string') {
    const skip = (parent?.type === 'Property' && parent.key === node) || (parent?.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(parent.operator)) || parent?.type === 'SwitchCase' || parent?.type === 'ImportExpression'
    if (!skip) out.push({ file, line: lineOf(node.start ?? 0), text: node.value })
    return
  }
  if (t === 'TemplateLiteral') {
    out.push({ file, line: lineOf(node.start ?? 0), text: node.quasis.map(q => q.value.cooked ?? q.value.raw).join('{}') })
    for (const e of node.expressions) walk(e, here, file, lineOf)
    return
  }
  if (t === 'Text' && typeof node.data === 'string') {
    if (parent?.type === 'Attribute' && SKIP_ATTR.test(parent.name)) return
    out.push({ file, line: lineOf(node.start), text: node.data }); return
  }
  for (const k of Object.keys(node)) {
    if (['loc', 'metadata', 'type', 'start', 'end'].includes(k) || (t === 'Property' && k === 'key' && !node.computed)) continue
    walk(node[k], here, file, lineOf)
  }
}
function lines(src) {
  const starts = [0]; for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1)
  return pos => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= pos) lo = m; else hi = m - 1 } return lo + 1 }
}
async function scan(rel) {
  const src = await readFile(path.join(root, rel), 'utf8'), lineOf = lines(src)
  if (rel.endsWith('.svelte')) {
    const ast = parse(src, { modern: true })
    for (const k of ['instance', 'module']) if (ast[k]) walk(ast[k].content, [], rel, lineOf)
    walk(ast.fragment, [], rel, lineOf)
    return
  }
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.ES2022, true)
  const visit = n => {
    const p = n.parent
    if (ts.isStringLiteralLike(n) && !ts.isImportDeclaration(p) && !ts.isLiteralTypeNode(p) && !(ts.isPropertyAssignment(p) && p.name === n) && !ts.isExternalModuleReference(p))
      out.push({ file: rel, line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, text: n.text })
    ts.forEachChild(n, visit)
  }
  visit(sf)
}
async function svelteFiles(dir) {
  const result = []
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) result.push(...await svelteFiles(rel))
    else if (entry.name.endsWith('.svelte')) result.push(rel)
  }
  return result
}

for (const file of [...await svelteFiles('src'), ...tsFixtures].sort()) await scan(file)
const found = {}
for (const row of out) {
  const text = row.text.replace(/\s+/g, ' ').trim()
  if (!candidate(text) || covered(text) || covered(row.text)) continue // raw text too: keys may contain newlines
  ;(found[row.file] ??= new Map()).set(text, row.line)
}
for (const row of trLiterals) { // rule 2: tr('literal') must have a key
  const text = row.text.replace(/\s+/g, ' ').trim()
  // Exempt: no real words, code identifiers, and single English-looking tokens (units, format and component names).
  if (!text || TR_ALLOW.has(text) || ALLOW.has(text) || !/\p{L}{2}/u.test(text) || IDENTIFIERS.test(text) || keys.has(row.text) || keys.has(text)) continue
  if (!/\s/.test(text) && !polishEvidence(text)) continue
  ;(found[row.file] ??= new Map()).set(text, row.line)
}
const current = Object.fromEntries(Object.entries(found).map(([file, texts]) => [file, [...texts.keys()].sort()]))
const total = map => Object.values(map).reduce((sum, list) => sum + list.length, 0)

if (process.argv.includes('--update')) {
  await writeFile(baselineFile, JSON.stringify(current, null, 1) + '\n')
  console.log(`Baseline written: ${total(current)} entries in ${Object.keys(current).length} files`); process.exit(0)
}
if (process.argv.includes('--list')) {
  for (const [file, texts] of Object.entries(current)) console.log(`${String(texts.length).padStart(4)}  ${file}`)
  console.log(`${String(total(current)).padStart(4)}  TOTAL`); process.exit(0)
}
let baseline = {}
try { baseline = JSON.parse(await readFile(baselineFile, 'utf8')) } catch { /* missing baseline: everything is new */ }
const fresh = [], stale = []
for (const [file, texts] of Object.entries(current)) for (const text of texts)
  if (!baseline[file]?.includes(text)) fresh.push(`${file}:${found[file].get(text)}  ${text}`)
for (const [file, texts] of Object.entries(baseline)) for (const text of texts)
  if (!current[file]?.includes(text)) stale.push(`${file}  ${text}`)
if (stale.length) console.log(`NOTE ${stale.length} baseline entries are now translated or gone; lower the baseline with --update`)
if (fresh.length) {
  console.error(`FAIL ${fresh.length} Polish UI string(s) without an English key (add them to src/lib/i18n/en/*.ts):`)
  for (const line of fresh.slice(0, 80)) console.error(`  ${line}`)
  process.exit(1)
}
console.log(`PASS i18n coverage: ${total(current)} known misses (baseline ${total(baseline)}), no new ones`)
