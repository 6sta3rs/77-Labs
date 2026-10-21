import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'svelte/compiler'
import ts from 'typescript'

const attributes = new Set(['aria-label', 'aria-description', 'title', 'placeholder', 'label', 'description', 'content', 'alt'])
export function uiCandidates(source, filename = 'Component.svelte') {
  const ast = parse(source, { modern: true, filename })
  const candidates = []
  function visit(node, attribute) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(child => visit(child, attribute)); return }
    if (node.type === 'Attribute') {
      if (attributes.has(node.name) && Array.isArray(node.value) && node.value.length === 1 && node.value[0].type === 'Text') {
        const text = node.value[0]
        if (/[\p{L}]/u.test(text.data)) candidates.push({ kind: 'attribute', name: node.name, source: text.data, start: node.start, end: node.end })
      }
      return
    }
    if (node.type === 'Text') {
      const text = node.data.trim().replace(/\s+/g, ' ')
      if (/[\p{L}]/u.test(text)) candidates.push({ kind: 'text', source: text, start: node.start, end: node.end })
      return
    }
    // Do not rewrite JS expressions, script/style contents, comments, or user
    // values. Those need semantic review; this pass only owns static markup.
    if (['ExpressionTag', 'HtmlTag', 'Script', 'StyleSheet', 'Comment'].includes(node.type)) return
    for (const [key, child] of Object.entries(node)) {
      if (key === 'expression' || key === 'metadata' || key === 'parent') continue
      visit(child, attribute)
    }
  }
  visit(ast.fragment)
  return { ast, candidates }
}
export function wrapStaticUi(source, filename, importPath) {
  const { ast, candidates } = uiCandidates(source, filename)
  const edits = candidates.map(item => {
    if (item.kind === 'attribute') return { ...item, replacement: `${item.name}={tr(${JSON.stringify(item.source)})}` }
    const raw = source.slice(item.start, item.end)
    const leading = raw.match(/^\s*/)[0], trailing = raw.match(/\s*$/)[0]
    return { ...item, replacement: `${leading}{tr(${JSON.stringify(item.source)})}${trailing}` }
  })
  if (importPath && !source.includes('createUiTranslator')) {
    const setup = `\n  import { uiLanguage, createUiTranslator } from ${JSON.stringify(importPath)}\n  const tr = $derived(createUiTranslator($uiLanguage))\n`
    if (ast.instance) {
      const start = source.indexOf('>', ast.instance.start) + 1
      edits.push({ start, end: start, replacement: setup })
    } else edits.push({ start: 0, end: 0, replacement: `<script lang="ts">${setup}</script>\n` })
  }
  let output = source
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end)
  parse(output, { modern: true, filename })
  return { source: output, candidates }
}
/** Return reviewable template rewrites; protocol/user-content templates are not applied automatically. */
export function templateCandidates(source, filename = 'Component.svelte') {
  const ast = parse(source, { modern: true, filename })
  if (!ast.instance) return []
  const start = source.indexOf('>', ast.instance.start) + 1
  const end = source.lastIndexOf('</script>', ast.instance.end)
  const script = source.slice(start, end)
  const tree = ts.createSourceFile('component.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const result = []
  function visit(node) {
    if (ts.isTemplateExpression(node)) {
      let key = node.head.text
      const args = []
      node.templateSpans.forEach((span, index) => {
        key += `{value${index}}${span.literal.text}`
        args.push(`value${index}: (${span.expression.getText(tree)})`)
      })
      result.push({ kind: 'template', source: key, start: start + node.getStart(tree), end: start + node.end,
        replacement: `tr(${JSON.stringify(key)}, { ${args.join(', ')} })` })
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return result
}
export function wrapUiTemplates(source, filename, reviewedKeys) {
  const edits = templateCandidates(source, filename).filter(item => reviewedKeys.has(item.source))
  let output = source
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end)
  parse(output, { modern: true, filename })
  return { source: output, candidates: edits }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), write = args.includes('--write')
  const importIndex = args.indexOf('--import'), importPath = importIndex >= 0 ? args[importIndex + 1] : undefined
  const files = args.filter((arg, index) => !arg.startsWith('--') && !(importIndex >= 0 && index === importIndex + 1))
  if (!files.length) throw new Error('Usage: node scripts/dev/i18n-svelte.mjs [--write --import ./i18n] Component.svelte ...')
  for (const filename of files) {
    const original = await readFile(filename, 'utf8')
    const result = args.includes('--templates') ? { candidates: templateCandidates(original, filename) } : write ? wrapStaticUi(original, filename, importPath) : uiCandidates(original, filename)
    if (write) await writeFile(filename, result.source, 'utf8')
    console.log(JSON.stringify({ file: filename, candidates: result.candidates }, null, 2))
  }
}
