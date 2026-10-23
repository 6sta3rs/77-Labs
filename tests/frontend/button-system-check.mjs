import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { parse } from 'svelte/compiler'

// Retired implementations must not return through a screen-specific class or alias.
const retired = /(?<![\w-])(?:button-primary|button-secondary|button-quiet|generate-button|icon-button)(?![\w-])/
const files = []
function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) scan(path)
    else if (/\.(svelte|css)$/.test(path)) files.push(path)
  }
}
scan('frontend/src')
let usages = 0
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  assert.equal(retired.test(source), false, `Starszy system przycisków: ${file}`)
  if (!file.endsWith('.svelte')) continue
  const ast = parse(source, { modern: true })
  function walk(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'Component' && node.name === 'Button') usages++
    if (node.type === 'RegularElement') {
      const attribute = node.attributes.find(item => item.type === 'Attribute' && item.name === 'class')
      if (attribute) assert.equal(/\bvs-button(?:\s|["'`}]|$)/.test(source.slice(attribute.start, attribute.end)), false, `Kopia wspólnego przycisku zamiast Button: ${file}`)
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'metadata' || key === 'parent') continue
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') walk(value)
    }
  }
  walk(ast.fragment)
}
assert.ok(usages > 0, 'Brak użyć wspólnego Button')
console.log(`PASS: ${files.length} plików bez starszych przycisków; ${usages} deklaracji wspólnego Button (pętle nie są liczone jako wiele elementów).`)
