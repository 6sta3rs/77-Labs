// Interface languages: status, translator hand-off and scaffolding for a new language (docs/features/i18n.md).
//   node tools/dev/i18n-lang.mjs status                       coverage of every registered language against English
//   node tools/dev/i18n-lang.mjs missing <code>               writes .tmp/i18n/<code>-missing.json ({ "Polish source": "English reference" })
//   node tools/dev/i18n-lang.mjs add <code> "<Name>" <locale> [rtl]   creates frontend/src/i18n/<code>/index.ts and registers it
// Set I18N_ROOT to run `add` against another checkout (the test does).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const root = process.env.I18N_ROOT ? resolve(process.env.I18N_ROOT) : repo
const [command = 'status', ...args] = process.argv.slice(2)
const fail = message => { console.error(message); process.exit(1) }
const MARKER = '// i18n:add-language-above'

function add([code, name, locale, direction]) {
  if (!code || !name || !locale) fail('Usage: add <code> "<Name>" <locale> [rtl]   e.g. add de "Deutsch" de-DE')
  if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code)) fail(`Invalid language code "${code}" (use a BCP 47 code such as de, pt-BR, zh-Hans).`)
  try { new Intl.Locale(locale) } catch { fail(`Invalid locale "${locale}" (for example de-DE).`) }
  if (direction && direction !== 'rtl' && direction !== 'ltr') fail('The optional last argument must be rtl or ltr.')
  const registryFile = resolve(root, 'frontend/src/i18n/languages.ts')
  const folder = resolve(root, 'frontend/src/i18n', code)
  let registry = readFileSync(registryFile, 'utf8')
  if (!registry.includes(MARKER)) fail(`The marker "${MARKER}" is missing in languages.ts; add the language by hand.`)
  if (existsSync(folder) || registry.includes(`code: '${code}'`)) fail(`Language "${code}" already exists.`)
  const identifier = code.replace(/[^A-Za-z0-9]/g, '')
  mkdirSync(folder, { recursive: true })
  writeFileSync(resolve(folder, 'index.ts'), `// ${name} catalog: Polish source text -> ${name}. A missing key falls back to English, then to Polish.\n` +
    `// Get the list to translate with: npm run i18n:missing -- ${code}\n` +
    `export const catalog: Record<string, string> = {\n}\n`)
  const importLine = `import { catalog as ${identifier} } from './${code}/index'\n`
  registry = registry.replace(/(import \{ catalog as en \} from '\.\/en\/index'\n)/, `$1${importLine}`)
  if (!registry.includes(importLine)) fail('Could not find the English import in languages.ts; add the language by hand.')
  const dir = direction === 'rtl' ? ", dir: 'rtl'" : ''
  registry = registry.replace(`  ${MARKER}`, `  { code: '${code}', name: ${JSON.stringify(name)}, locale: '${locale}'${dir}, catalog: ${identifier} },\n  ${MARKER}`)
  writeFileSync(registryFile, registry)
  console.log(`Added ${code} (${name}). Next: npm run i18n:missing -- ${code}, translate frontend/src/i18n/${code}/index.ts, npm run i18n:status.`)
}

if (command === 'add') add(args)
else if (command === 'status' || command === 'missing') {
  const { i18n } = await import('../../tests/helpers/i18n.mjs')
  const { LANGUAGES, FALLBACK_LANGUAGE } = i18n
  const english = LANGUAGES.find(entry => entry.code === FALLBACK_LANGUAGE)?.catalog
  if (!english) fail('The fallback language has no catalog.')
  const keys = Object.keys(english)
  if (command === 'status') {
    console.log(`Reference: ${FALLBACK_LANGUAGE} (${keys.length} keys). Missing keys fall back to ${FALLBACK_LANGUAGE}, then to the Polish source.\n`)
    console.log('code      name            translated   missing  coverage  orphans  required')
    for (const entry of LANGUAGES) {
      if (!entry.catalog) { console.log(`${entry.code.padEnd(9)} ${entry.name.padEnd(15)} (source language, the strings in the code)`); continue }
      const own = Object.keys(entry.catalog), done = keys.filter(key => typeof entry.catalog[key] === 'string' && entry.catalog[key] !== '').length
      const orphans = own.filter(key => !(key in english)).length
      console.log(`${entry.code.padEnd(9)} ${entry.name.padEnd(15)} ${String(done).padStart(10)} ${String(keys.length - done).padStart(9)} ${(100 * done / keys.length).toFixed(1).padStart(8)}% ${String(orphans).padStart(8)}  ${entry.complete ? 'complete' : 'partial ok'}`)
    }
  } else {
    const entry = LANGUAGES.find(item => item.code === args[0])
    if (!entry || !entry.catalog) fail(`Unknown language "${args[0] ?? ''}". Registered: ${LANGUAGES.filter(item => item.catalog).map(item => item.code).join(', ')}`)
    const todo = Object.fromEntries(keys.filter(key => typeof entry.catalog[key] !== 'string' || entry.catalog[key] === '').map(key => [key, english[key]]))
    const file = resolve(repo, '.tmp/i18n', `${entry.code}-missing.json`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(todo, null, 2) + '\n')
    console.log(`${Object.keys(todo).length} strings to translate into ${entry.name}: .tmp/i18n/${entry.code}-missing.json (Polish source -> English reference). Put the result in frontend/src/i18n/${entry.code}/index.ts.`)
  }
} else fail(`Unknown command "${command}". Use status, missing or add.`)
