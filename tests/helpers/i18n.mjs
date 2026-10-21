// Loads the REAL src/lib/i18n/index.ts (with its en-* dictionaries) for harnesses
// that run single source files in isolation. Polish stays the active language.
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
    const url = await moduleUrl(path.resolve(path.dirname(file), specifier + (path.extname(specifier) ? '' : '.ts')))
    code = code.replaceAll(`'${specifier}'`, `'${url}'`).replaceAll(`"${specifier}"`, `"${url}"`)
  }
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  modules.set(file, url)
  return url
}
// In-memory storage/document so persistence never leaks between tests or to disk.
globalThis.localStorage ??= { getItem: () => null, setItem() {} }
globalThis.document ??= { documentElement: { lang: '', dataset: {} }, title: '' }

export const i18nUrl = await moduleUrl(path.join(root, 'src/lib/i18n/index.ts'))
export const i18n = await import(i18nUrl)
export const i18nDeps = {
  createUiTranslator: i18n.createUiTranslator, uiLanguage: i18n.uiLanguage, translateUi: i18n.translateUi,
  getUiLanguage: i18n.getUiLanguage, $uiLanguage: 'pl',  // components declare their own `tr`, so it is not injected
}
/** Injectable `require` for CommonJS-transpiled code run through new Function. */
export function i18nRequire(specifier) {
  if (/\/i18n(\/index)?$/.test(specifier)) return i18n
  throw new Error(`Unexpected require: ${specifier}`)
}
/** Rewrites relative i18n specifiers in ESM code to the module's data URL. */
export const rewriteI18nImports = code => code.replace(/(['"])(?:\.\.?\/)+i18n(?:\/index)?\1/g, `$1${i18nUrl}$1`)
