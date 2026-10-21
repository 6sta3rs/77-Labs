<script lang="ts">
  import GenerationCard from '../tts/GenerationCard.svelte'
  import { audioPeaks } from '../projects/library'
  import { idlePlaybackState, type PlaybackState, type PlaybackStatus } from './playback-state'

  // Styled replacement for <audio controls>: the same waveform card as Studio recordings.
  let { src, title = 'Odsłuch', meta = '', filename, onerror, onduration }: {
    src: string; title?: string; meta?: string
    /** When set, a download button is shown. */
    filename?: string
    onerror?: (message: string) => void; onduration?: (seconds: number) => void
  } = $props()
  // ponytail: waveforms are decoded in the page; huge files fall back to a plain progress line.
  const MAX_PEAK_BYTES = 40 * 1024 * 1024
  let audio = $state<HTMLAudioElement>()
  let playback = $state<PlaybackState>(idlePlaybackState())
  let peaks = $state<number[]>()
  let duration = $state(0)
  const playing = $derived(playback.status === 'playing')

  function publish(status: PlaybackStatus = playback.status, error?: string) {
    if (!audio) return
    if (Number.isFinite(audio.duration) && audio.duration > 0) duration = audio.duration
    playback = { status, currentTime: audio.currentTime || 0, duration, ...(error ? { error } : {}) }
  }
  $effect(() => {
    const url = src
    playback = idlePlaybackState(); peaks = undefined; duration = 0
    if (!url) return
    const abort = new AbortController()
    fetch(url, { signal: abort.signal })
      .then(response => response.ok ? response.blob() : undefined)
      .then(blob => blob && blob.size <= MAX_PEAK_BYTES ? audioPeaks(blob) : undefined)
      .then(next => { if (!abort.signal.aborted && next?.length) peaks = next })
      .catch(() => { /* No waveform: the card shows a progress line instead. */ })
    return () => abort.abort()
  })
  // Smooth progress: timeupdate fires only ~4×/s.
  $effect(() => {
    if (!playing) return
    let frame = requestAnimationFrame(function tick() { publish(); frame = requestAnimationFrame(tick) })
    return () => cancelAnimationFrame(frame)
  })
  // One preview plays at a time.
  $effect(() => {
    const other = (event: Event) => { if ((event as CustomEvent).detail !== audio) audio?.pause() }
    window.addEventListener('audio-preview:play', other)
    return () => window.removeEventListener('audio-preview:play', other)
  })
  function toggle() {
    if (!audio) return
    if (playback.status === 'playing' || playback.status === 'loading') { audio.pause(); return }
    if (audio.ended) audio.currentTime = 0
    window.dispatchEvent(new CustomEvent('audio-preview:play', { detail: audio }))
    publish('loading')
    audio.play().catch((error: unknown) => { if ((error as Error)?.name !== 'AbortError') failed() })
  }
  function seek(seconds: number) {
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(duration || seconds, seconds)); publish()
  }
  function failed() {
    const message = 'Nie można odtworzyć tego pliku. Możesz go pobrać i sprawdzić.'
    publish('error', message); onerror?.(message)
  }
</script>

<audio bind:this={audio} {src} preload="metadata" hidden
  onloadedmetadata={() => { publish(); if (duration) onduration?.(duration) }}
  onplaying={() => publish('playing')} onwaiting={() => publish('loading')}
  onpause={() => publish(audio?.ended ? 'ended' : 'paused')} onended={() => publish('ended')}
  ontimeupdate={() => publish()} onseeked={() => publish()} onerror={failed}></audio>
<GenerationCard recording={{ id: src, title, text: '', voice: meta, created: '', kind: 'audio', url: src, filename, duration, peaks }}
  index={1} {title} state={playback} downloadable={!!filename} onplay={toggle} onseek={seek}/>
