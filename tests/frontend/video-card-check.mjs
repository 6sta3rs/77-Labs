import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const read = file => readFile(new URL(`../../${file}`, import.meta.url), 'utf8')
const card = await read('frontend/src/ui/VideoCard.svelte')
for (const key of ['Odtwórz', 'Wstrzymaj', 'Głośność', 'Wycisz', 'Pełny ekran', 'Pozycja nagrania']) assert.ok(card.includes(`tr("${key}")`), `VideoCard label: ${key}`)
for (const part of ['onkeydown', 'requestFullscreen', '<Slider', 'bind:currentTime', 'bind:muted']) assert.ok(card.includes(part), `VideoCard uses ${part}`)
assert.ok(!/<video[^>]*\scontrols/.test(card), 'VideoCard must not enable native controls')
for (const file of ['frontend/src/tools/StudioTools.svelte', 'frontend/src/tools/production/ProductionWorkspace.svelte']) {
  const source = await read(file)
  assert.ok(!/<video[^>]*\scontrols/.test(source), `${file} has native video controls`)
  assert.ok(source.includes('<VideoCard'), `${file} uses VideoCard`)
}
console.log('video-card-check: ok')
