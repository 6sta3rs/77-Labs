<script lang="ts">
  import { Play, Pause, Volume2, VolumeX, Maximize } from '@lucide/svelte'
  import { uiLanguage, createUiTranslator } from '../i18n'
  import Button from './Button.svelte'
  import Slider from './Slider.svelte'

  // Styled replacement for the native video controls; keyboard: Space/K play, arrows seek 5 s, M mute, F fullscreen.
  let { src, title = 'Podgląd wideo', video = $bindable() }: { src: string; title?: string; video?: HTMLVideoElement } = $props()
  const tr = $derived(createUiTranslator($uiLanguage))
  let box = $state<HTMLElement>()
  let time = $state(0), duration = $state(0), paused = $state(true), muted = $state(false), volume = $state(1), failed = $state(false)
  const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
  const toggle = () => { if (!video) return; if (video.paused) video.play().catch(() => failed = true); else video.pause() }
  const seek = (to: number) => { if (video) video.currentTime = Math.max(0, Math.min(duration || to, to)) }
  const fullscreen = () => document.fullscreenElement ? document.exitFullscreen() : box?.requestFullscreen?.()
  function keys(event: KeyboardEvent) {
    if (event.target !== box || event.ctrlKey || event.metaKey || event.altKey) return
    const key = event.key.toLowerCase(), act: Record<string, () => void> = {
      ' ': toggle, k: toggle, arrowleft: () => seek(time - 5), arrowright: () => seek(time + 5),
      m: () => muted = !muted, f: fullscreen,
    }
    if (act[key]) { event.preventDefault(); act[key]() }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div class="video-card" bind:this={box} role="group" tabindex="0" aria-label={tr(title)} onkeydown={keys}>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={video} {src} preload="metadata" playsinline bind:currentTime={time} bind:duration bind:paused bind:muted bind:volume
    onclick={toggle} onerror={() => failed = true} onloadedmetadata={() => failed = false}></video>
  {#if failed}<p class="video-card-error" role="alert">{tr("Nie można odtworzyć tego pliku. Możesz go pobrać i sprawdzić.")}</p>{/if}
  <div class="video-card-bar">
    <Button variant="ghost" size="icon-xs" aria-label={paused ? tr("Odtwórz") : tr("Wstrzymaj")} onclick={toggle}>
      {#if paused}<Play size={15}/>{:else}<Pause size={15}/>{/if}
    </Button>
    <span class="video-card-time">{clock(time)} / {clock(duration || 0)}</span>
    <div class="video-card-seek"><Slider size="compact" valueDisplay="tooltip" label={tr("Pozycja nagrania")} value={time} min={0} max={duration || 0} step={.1} disabled={!duration} valueLabel={clock(time)} onchange={seek}/></div>
    <Button variant="ghost" size="icon-xs" aria-label={muted || volume === 0 ? tr("Włącz dźwięk") : tr("Wycisz")} onclick={() => muted = !muted}>
      {#if muted || volume === 0}<VolumeX size={15}/>{:else}<Volume2 size={15}/>{/if}
    </Button>
    <div class="video-card-volume"><Slider size="compact" valueDisplay="tooltip" label={tr("Głośność")} value={muted ? 0 : volume} min={0} max={1} step={.05} valueLabel={Math.round((muted ? 0 : volume) * 100) + '%'} onchange={value => { volume = value; muted = false }}/></div>
    <Button variant="ghost" size="icon-xs" aria-label={tr("Pełny ekran")} onclick={fullscreen}><Maximize size={15}/></Button>
  </div>
</div>

<style>
  .video-card { display: grid; gap: 8px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 8px; min-width: 0; width: 100%; outline-offset: 2px }
  .video-card:fullscreen { background: #000; align-content: center }
  video { width: 100%; max-height: 320px; border-radius: 8px; background: #000; cursor: pointer }
  .video-card:fullscreen video { max-height: calc(100vh - 70px) }
  .video-card-bar { display: flex; align-items: center; gap: 8px }
  .video-card-time { font-size: var(--ui-text-11); color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap }
  .video-card-seek { flex: 1; min-width: 80px }
  .video-card-volume { width: 90px }
  .video-card-error { margin: 0; font-size: var(--ui-text-12); color: var(--danger) }
</style>
