// Runs a component's REAL <script> with Svelte's client reactivity ($state, $derived, $effect) and no DOM.
// Imports are removed and supplied by the caller; props are a plain object; markup is not rendered.
// Use when a check depends on derived values or effect re-runs, which identity stubs cannot model.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import ts from 'typescript'
import { compileModule } from 'svelte/compiler'
import * as svelte from 'svelte/internal/client'
import { i18nDeps } from './i18n.mjs'
import { sourceUrl } from './source-url.mjs'

const out = new URL('../../.tmp/qa/runes/', import.meta.url)
let serial = 0
export const flush = () => svelte.flush()

export async function runesComponent(filename, { deps = {}, props = {}, exposure = '' } = {}) {
  let source = (await readFile(sourceUrl(filename), 'utf8')).match(/<script(?![^>]*module)[^>]*>([\s\S]*?)<\/script>/)[1]
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const node of [...parsed.statements].reverse()) if (ts.isImportDeclaration(node)) source = source.slice(0, node.pos) + source.slice(node.end)
  source = source.replace(/\$props\(\)/g, '__props').replace(/\$props\.id\(\)/g, "'qa'").replace(/\$uiLanguage/g, "'pl'")
  const body = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const destroyCallbacks = [], mounts = []
  const all = { onDestroy: fn => destroyCallbacks.push(fn), onMount: fn => mounts.push(fn), untrack: svelte.untrack, tick: svelte.tick, ...i18nDeps, ...deps }
  delete all.$uiLanguage
  const names = Object.keys(all)
  const module = `export function make(__deps, __props) { const { ${names.join(', ')} } = __deps; let __exposed;
    const __root = $effect.root(() => { ${body}\n __exposed = { ${exposure} }; });
    return { value: __exposed, root: __root }; }`
  const { js } = compileModule(module, { filename: filename + '.svelte.js', generate: 'client' })
  await mkdir(out, { recursive: true })
  const file = new URL(`${filename.replace(/\W/g, '_')}-${process.pid}-${serial++}.mjs`, out)
  await writeFile(file, js.code)
  const { make } = await import(file.href)
  const { value, root } = make(all, props)
  svelte.flush()
  for (const fn of mounts) { const cleanup = fn(); if (typeof cleanup === 'function') destroyCallbacks.push(cleanup) }
  return { value, destroy() { root(); destroyCallbacks.splice(0).reverse().forEach(fn => fn()) } }
}
