<script lang="ts">
  import { onMount } from 'svelte'
  import { Play, Pause } from '@lucide/svelte'
  import Button from './ui/Button.svelte'
  import { request } from './api'
  import { durationLabel } from './data'
  import { AudiobookPlayback, emptyBookPlayback, type BookAudioChunk } from './audiobook-playback'

  let audio: HTMLAudioElement
  let playback: AudiobookPlayback | undefined
  let state = $state(emptyBookPlayback())
  let pending: BookAudioChunk[] = []
  let complete = false
  onMount(() => {
    playback = new AudiobookPlayback(audio, async (path, signal) => {
      const response = await request(path, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) })
      if (!response.ok) throw new Error(`Nie można pobrać fragmentu (${response.status}).`)
      const blob = await response.blob()
      if (!blob.type.startsWith('audio/')) throw new Error('Silnik nie zwrócił nagrania audio.')
      return blob
    }, next => state = next)
    for (const chunk of pending) playback.append(chunk)
    pending = []
    if (complete) playback.finish()
    return () => { playback?.dispose(); playback = undefined }
  })
  export function append(chunk: BookAudioChunk) { if (playback) playback.append(chunk); else pending.push(chunk) }
  export function finish() { complete = true; playback?.finish() }
  export function reset() { complete = false; pending = []; playback?.reset() }
  export function pause() { playback?.pause() }
</script>

<audio bind:this={audio} preload="auto"></audio>
{#if state.count}
  <section class="production-source book-live-player" aria-label="Odsłuch podczas generowania">
    <strong>Odsłuch audiobooka</strong>
    <p class="tool-workspace-note" role="status">{state.error || (state.loading ? 'Wczytywanie fragmentu…' : state.waiting ? 'Czekam na kolejny fragment…' : `Fragment ${state.current} z ${state.count} gotowych`)}{!state.error && !state.finished ? ' · Kolejne fragmenty dołączą automatycznie.' : ''}</p>
    <div class="production-inline">
      <Button variant="outline" aria-label={state.playing ? 'Wstrzymaj audiobook' : 'Odtwórz audiobook'} onclick={() => state.playing ? playback?.pause() : playback?.play()}>{#if state.playing}<Pause size={16}/>Wstrzymaj{:else}<Play size={16}/>Odtwórz{/if}</Button>
      <span>{durationLabel(state.time)} / {durationLabel(state.duration)}{!state.finished ? ' gotowe' : ''}</span>
    </div>
    <input type="range" aria-label="Pozycja gotowej części audiobooka" min="0" max={state.duration || 1} step="0.01" value={state.time} oninput={event => playback?.seek(event.currentTarget.valueAsNumber)}/>
  </section>
{/if}

<style>
  .book-live-player { display: grid; gap: 10px; }
  .book-live-player p { margin: 0; }
  input { width: 100%; accent-color: var(--accent); }
</style>
