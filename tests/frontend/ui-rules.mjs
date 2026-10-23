// Static guard for docs/uwagi-ui.md rule 2: no native browser controls on screens.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

// The gallery and the ui/ implementations legitimately wrap natives; translations only contain strings.
const skip = p => [['lib', 'gallery'], ['lib', 'ui'], ['lib', 'i18n']].some(parts => p.startsWith(['src', ...parts].join(sep) + sep))
const files = []
const walk = dir => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path)
    else if (/\.(svelte|ts)$/.test(name) && !skip(path)) files.push(path)
  }
}
walk('src')

// Tag text from "<name" to its closing ">" (ignores ">" inside {...} expressions).
function* tags(text, name) {
  for (let i = text.indexOf(name); i >= 0; i = text.indexOf(name, i + 1)) {
    let depth = 0, j = i
    for (; j < text.length; j++) {
      const c = text[j]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    yield [i, text.slice(i, j + 1)]
  }
}
const hasType = (tag, type) => new RegExp(`\\btype=["']?${type}`).test(tag)
// A file input hidden behind another control is not a visible native control.
const hiddenInput = tag => /\shidden(\s|\/|>)|class="[^"]*\b(hidden|sr-only|vs-native-control)\b/.test(tag)

const found = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const add = (index, message) => found.push(`${relative('.', file)}:${text.slice(0, index).split('\n').length}  ${message}`)
  for (const [i, tag] of tags(text, '<audio')) if (/\scontrols\b/.test(tag)) add(i, '<audio controls> (use the app player)')
  for (const [i, tag] of tags(text, '<video')) if (/\scontrols\b/.test(tag)) add(i, '<video controls> (use VideoCard)')
  for (const [i, tag] of tags(text, '<input')) {
    if (hasType(tag, 'file') && !hiddenInput(tag)) add(i, 'visible type="file" input (use FilePicker)')
    if (hasType(tag, 'number')) add(i, 'raw type="number" input (use Input type="number")')
  }
  for (const match of text.matchAll(/(?<![\w.$])(confirm|alert|prompt)\(/g)) add(match.index, `native ${match[1]}() (use ConfirmDialog/toast)`)
}
if (found.length) { console.error(`UI rule 2 violations (${found.length}):\n${found.join('\n')}`); process.exit(1) }
console.log(`ui-rules: ${files.length} files clean`)
