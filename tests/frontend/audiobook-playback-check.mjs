import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../../src/lib/playback/audiobook-playback.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const exports = {}; new Function('exports', code)(exports)
const { AudiobookPlayback } = exports
class AudioFixture extends EventTarget {
  paused = true; ended = false; currentTime = 0; src = ''; error = null; playCount = 0
  async play() { this.playCount++; this.paused = false; this.ended = false; this.dispatchEvent(new Event('playing')) }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')) }
  load() {}
  removeAttribute() { this.src = '' }
  end() { this.paused = true; this.ended = true; this.dispatchEvent(new Event('ended')) }
}
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const chunk = sequence => ({ sequence, output: `longform_cache/${sequence}.wav`, duration_s: 1, title: 'QA', chapter_index: 0 })
const audio = new AudioFixture(), states = [], requests = []
const player = new AudiobookPlayback(audio, async path => { requests.push(path); return new Blob(['fixture'], { type: 'audio/wav' }) }, state => states.push(state))
const state = () => states.at(-1)
player.append(chunk(0)); await player.play(); await settle()
assert.equal(state().playing, true); assert.equal(audio.playCount, 1)
audio.currentTime = 0.4; audio.dispatchEvent(new Event('timeupdate'))
const firstSource = audio.src
player.append(chunk(1)); await settle()
assert.equal(audio.src, firstSource, 'Appending must not replace/restart currently playing audio.')
assert.equal(state().time, 0.4); assert.equal(state().duration, 2)
audio.end(); await settle(); assert.equal(state().current, 2); assert.equal(audio.playCount, 2)
audio.end(); await settle(); assert.equal(state().waiting, true); assert.equal(state().playing, true)
player.append(chunk(2)); await settle(); assert.equal(state().current, 3); assert.equal(audio.playCount, 3)
audio.end(); player.pause(); player.append(chunk(3)); await settle()
assert.equal(audio.playCount, 3, 'A late portion must respect pause while waiting.')
await player.play(); await settle(); assert.equal(state().current, 4)
player.seek(0.25); await settle(); assert.equal(state().current, 1); assert.equal(audio.currentTime, 0.25)
player.finish(); assert.equal(state().finished, true)
player.seek(3.5); await settle(); audio.end(); await settle(); assert.equal(state().playing, false)
await player.play(); await settle(); assert.equal(state().current, 1, 'Completed recording can replay from its start.')
player.append(chunk(1)); assert.equal(state().count, 4, 'Duplicates do not add repeated audio.')
player.reset(); assert.equal(state().count, 0); assert.equal(audio.src, '')
player.append(chunk(1)); assert.match(state().error, /Brakuje fragmentu/)
player.dispose()

// Reset and source changes must invalidate in-flight downloads and playback.
let resolveDownload
const delayed = new AudiobookPlayback(new AudioFixture(), () => new Promise(resolve => resolveDownload = resolve), () => {})
delayed.append(chunk(0)); const playing = delayed.play(); delayed.reset(); resolveDownload(new Blob(['late'])); await playing
delayed.dispose()
const brokenAudio = new AudioFixture()
const broken = new AudiobookPlayback(brokenAudio, async () => { throw new Error('HTTP 503') }, state => states.push(state))
broken.append(chunk(0)); await broken.play(); assert.match(state().error, /Nie można wczytać/); assert.equal(state().playing, false); broken.dispose()
// A long book must not retain decoded/audio blobs for all earlier portions.
const createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL, liveUrls = new Set()
let maximum = 0
URL.createObjectURL = blob => { const url = createUrl(blob); liveUrls.add(url); maximum = Math.max(maximum, liveUrls.size); return url }
URL.revokeObjectURL = url => { liveUrls.delete(url); revokeUrl(url) }
try {
  const longAudio = new AudioFixture(), longBook = new AudiobookPlayback(longAudio, async () => new Blob(['fixture']), () => {})
  for (let i = 0; i < 200; i++) longBook.append(chunk(i))
  await settle(); await longBook.play(); await settle()
  for (let i = 0; i < 199; i++) { longAudio.end(); await settle() }
  assert.ok(maximum <= 3, `Current, next and a retiring URL at most; got ${maximum}.`)
  assert.ok(liveUrls.size <= 2)
  longBook.dispose(); assert.equal(liveUrls.size, 0)
} finally { URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl }
console.log('Audiobook playback PASS: early playback, append without restart, queue, wait/resume, manual pause, seek, replay, duplicates, gaps, reset, download failure, bounded blobs for 200 portions.')
