<script lang="ts">
  import { uiLanguage, createUiTranslator } from '../i18n'
  const tr = $derived(createUiTranslator($uiLanguage))

  import { onMount } from 'svelte'
  import { Play, Pause } from '@lucide/svelte'
  import Button from '../ui/Button.svelte'
  import { request } from '../platform/api'
  import { durationLabel } from '../data'
  import { AudiobookPlayback, emptyBookPlayback, type BookAudioChunk } from './audiobook-playback'
  import { readingAt } from './read-along'

  let audio: HTMLAudioElement
  let playback: AudiobookPlayback | undefined
  let book = $state(emptyBookPlayback())
  let pending: BookAudioChunk[] = []
  let complete = false
  // Text and length of each appended portion, indexed by sequence, for the read-along window.
  let portions = $state<{ text: string; duration: number }[]>([])
  const reading = $derived(readingAt(portions, book.current, book.time))
  onMount(() => {
    playback = new AudiobookPlayback(audio, async (path, signal) => {
      const response = await request(path, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) })
      if (!response.ok) throw new Error(tr('Nie można pobrać fragmentu ({status}).', { status: response.status }))
      const blob = await response.blob()
      if (!blob.type.startsWith('audio/')) throw new Error(tr('Silnik nie zwrócił nagrania audio.'))
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
  <section class="production-source book-live-player" aria-label={tr("Odsłuch podczas generowania")}>
    <strong>{tr("Odsłuch audiobooka")}</strong>
    <p class="tool-workspace-note" role="status">{book.error || (book.loading ? tr('Wczytywanie fragmentu…') : book.waiting ? tr('Czekam na kolejny fragment…') : tr('Fragment {current} z {count} gotowych', { current: book.current, count: book.count }))}{!book.error && !book.finished ? " " + tr("· Kolejne fragmenty dołączą automatycznie.") : ''}</p>
    <div class="production-inline">
      <Button variant="outline" aria-label={book.playing ? tr("Wstrzymaj audiobook") : tr("Odtwórz audiobook")} onclick={() => book.playing ? playback?.pause() : playback?.play()}>{#if book.playing}<Pause size={16}/>{tr("Wstrzymaj")}{:else}<Play size={16}/>{tr("Odtwórz")}{/if}</Button>
      <span>{durationLabel(book.time)} / {durationLabel(book.duration)}{!book.finished ? " " + tr("gotowe") : ''}</span>
    </div>
    {#if reading}<p class="book-reading" aria-label={tr("Teraz czytany fragment")}>{#each reading.words as word, index}<span class:current={index === reading.word}>{word}</span>{' '}{/each}</p>{/if}
    <input type="range" aria-label={tr("Pozycja gotowej części audiobooka")} min="0" max={book.duration || 1} step="0.01" value={book.time} oninput={event => playback?.seek(event.currentTarget.valueAsNumber)}/>
  </section>
{/if}

<style>
  .book-live-player { display: grid; gap: 10px; }
  .book-live-player p { margin: 0; }
  .book-reading { max-height: 9em; overflow: auto; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius); font-size: var(--ui-text-15); line-height: 1.7; color: var(--muted); }
  .book-reading .current { color: var(--foreground); background: color-mix(in srgb, var(--foreground) 12%, transparent); border-radius: 4px; transition: background-color 150ms ease; }
  input { width: 100%; accent-color: var(--accent); }
</style>
