<script lang="ts">
  import { onMount } from 'svelte'
  import { Play, Pause } from '@lucide/svelte'
  import Button from '../ui/Button.svelte'
  import { request } from '../platform/api'
  import { durationLabel } from '../data'
  import { AudiobookPlayback, emptyBookPlayback, type BookAudioChunk } from './audiobook-playback'

  let audio: HTMLAudioElement
  let playback: AudiobookPlayback | undefined
  let book = $state(emptyBookPlayback())
  let pending: BookAudioChunk[] = []
  let complete = false
  // Text and length of each appended portion, indexed by sequence, for the read-along window.
  let portions = $state<{ text: string; duration: number }[]>([])
  const reading = $derived.by(() => {
    const index = book.current - 1, portion = portions[index]
    if (!portion?.text) return undefined
    const words = portion.text.split(/\s+/).filter(Boolean)
    const start = portions.slice(0, index).reduce((sum, item) => sum + item.duration, 0)
    // ponytail: word position is estimated from elapsed time; exact word timing needs forced alignment.
    const word = Math.min(words.length - 1, Math.floor(Math.max(0, book.time - start) / portion.duration * words.length))
    return { words, word }
  })
  onMount(() => {
    playback = new AudiobookPlayback(audio, async (path, signal) => {
      const response = await request(path, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) })
      if (!response.ok) throw new Error(`Nie można pobrać fragmentu (${response.status}).`)
      const blob = await response.blob()
      if (!blob.type.startsWith('audio/')) throw new Error('Silnik nie zwrócił nagrania audio.')
      return blob
    }, next => book = next)
    for (const chunk of pending) playback.append(chunk)
    pending = []
    if (complete) playback.finish()
    return () => { playback?.dispose(); playback = undefined }
  })
  export function append(chunk: BookAudioChunk) { if (chunk.sequence === portions.length) portions = [...portions, { text: chunk.text || '', duration: chunk.duration_s }]; if (playback) playback.append(chunk); else pending.push(chunk) }
  export function finish() { complete = true; playback?.finish() }
  export function reset() { complete = false; pending = []; portions = []; playback?.reset() }
  export function pause() { playback?.pause() }
</script>

<audio bind:this={audio} preload="auto"></audio>
{#if book.count}
  <section class="production-source book-live-player" aria-label="Odsłuch podczas generowania">
    <strong>Odsłuch audiobooka</strong>
    <p class="tool-workspace-note" role="status">{book.error || (book.loading ? 'Wczytywanie fragmentu…' : book.waiting ? 'Czekam na kolejny fragment…' : `Fragment ${book.current} z ${book.count} gotowych`)}{!book.error && !book.finished ? ' · Kolejne fragmenty dołączą automatycznie.' : ''}</p>
    <div class="production-inline">
      <Button variant="outline" aria-label={book.playing ? 'Wstrzymaj audiobook' : 'Odtwórz audiobook'} onclick={() => book.playing ? playback?.pause() : playback?.play()}>{#if book.playing}<Pause size={16}/>Wstrzymaj{:else}<Play size={16}/>Odtwórz{/if}</Button>
      <span>{durationLabel(book.time)} / {durationLabel(book.duration)}{!book.finished ? ' gotowe' : ''}</span>
    </div>
    {#if reading}<p class="book-reading" aria-label="Teraz czytany fragment">{#each reading.words as word, index}<span class:current={index === reading.word}>{word}</span>{' '}{/each}</p>{/if}
    <input type="range" aria-label="Pozycja gotowej części audiobooka" min="0" max={book.duration || 1} step="0.01" value={book.time} oninput={event => playback?.seek(event.currentTarget.valueAsNumber)}/>
  </section>
{/if}

<style>
  .book-live-player { display: grid; gap: 10px; }
  .book-live-player p { margin: 0; }
  .book-reading { max-height: 9em; overflow: auto; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius); font-size: var(--ui-text-15); line-height: 1.7; color: var(--muted); }
  .book-reading .current { color: var(--foreground); background: color-mix(in srgb, var(--foreground) 12%, transparent); border-radius: 4px; transition: background-color 150ms ease; }
  input { width: 100%; accent-color: var(--accent); }
</style>
