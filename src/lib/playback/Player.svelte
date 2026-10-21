<script lang="ts">
  import Button from '../ui/Button.svelte';
  import { untrack } from 'svelte'
  import VoiceOrb from './VoiceOrb.svelte'
  import type { OrbVariant } from './voice-orb'
  import { playbackVoiceId } from './playback-visual'
  import { PlaybackMeter, quietActivity, type PlaybackActivity } from './playback-meter'
  import { idlePlaybackState, playbackStatusLabel, type PlaybackState, type PlaybackStatus } from './playback-state'
  import { Play, Pause, Download, Upload, LoaderCircle } from '@lucide/svelte'
  import SkipIcon from '../ui/SkipIcon.svelte'
  import { durationLabel, type Render } from '../data'
  let { recording, onimport, onactivity, onstate, orbVariant = 'storm', orbVoiceId, orbSyncGroup, orbSuspended = false }: {
    recording?: Render; onimport: () => void
    onactivity?: (activity: PlaybackActivity) => void; onstate?: (state: PlaybackState) => void
    orbVariant?: OrbVariant; orbVoiceId?: string; orbSyncGroup?: string; orbSuspended?: boolean
  } = $props()
  let audio = $state<HTMLAudioElement>(undefined!)
  let activity = $state.raw<PlaybackActivity>(quietActivity())
  let playback = $state<PlaybackState>(idlePlaybackState())
  let wantsPlayback = $state(false)
  let meter: PlaybackMeter | undefined
  let playRequest = 0, sourceUrl: string | undefined
  const orbVoice = $derived(orbVoiceId || playbackVoiceId(recording))
  function report(value: PlaybackActivity) {
    const next = { ...value, voiceId: orbVoice }
    activity = next; onactivity?.(next)
  }
  function matchesSource(element = audio, requireCurrent = true) {
    return !!element && element === audio && !!recording?.url && sourceUrl === recording.url && element.getAttribute('src') === sourceUrl
      && (!requireCurrent || !element.currentSrc || element.currentSrc === new URL(sourceUrl, document.baseURI).href)
  }
  function publish(status: PlaybackStatus = playback.status, error = playback.error) {
    if (!matchesSource(audio, false)) return
    const loaded = matchesSource()
    const duration = loaded && Number.isFinite(audio.duration) ? Math.max(0, audio.duration) : playback.duration
    playback = { status, currentTime: loaded && Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : playback.currentTime, duration, ...(error ? { error } : {}) }
    onstate?.({ ...playback })
  }
  // timeupdate fires only ~4×/s; while playing, publish every frame so waveforms and seek bars move smoothly.
  const playing = $derived(playback.status === 'playing')
  $effect(() => {
    if (!playing) return
    let frame = requestAnimationFrame(function tick() { publish(); frame = requestAnimationFrame(tick) })
    return () => cancelAnimationFrame(frame)
  })
  $effect(() => {
    const element = audio
    if (!element) return
    const current = new PlaybackMeter(element, report); meter = current
    return () => { element.pause(); current.dispose(); if (meter === current) meter = undefined }
  })
  $effect(() => {
    const url = recording?.url
    untrack(() => {
      ++playRequest; sourceUrl = url; wantsPlayback = false; meter?.stop()
      playback = { status: url ? 'loading' : 'idle', currentTime: 0, duration: recording?.duration ?? 0 }
      onstate?.({ ...playback })
    })
  })
  export async function play() {
    const element = audio
    if (!matchesSource(element, false)) return
    if (wantsPlayback && playback.status === 'playing') return
    const request = ++playRequest, source = sourceUrl
    wantsPlayback = true; publish('loading', '')
    try {
      // Start native playback in the user gesture; visual analysis never gates audio.
      const pending = element.play()
      void meter?.prepare()
      await pending
      if (request !== playRequest || element !== audio || source !== sourceUrl) {
        if (element === audio && source === sourceUrl && !wantsPlayback) element.pause()
        return
      }
      if (!element.paused && element.readyState >= 3) started()
    } catch (reason) {
      if (request !== playRequest || element !== audio || source !== sourceUrl || (reason as Error).name === 'AbortError') return
      wantsPlayback = false; meter?.stop()
      publish('error', (reason as Error).name === 'NotAllowedError' ? 'Przeglądarka zablokowała start. Kliknij odtwarzanie ponownie.' : 'Nie można odtworzyć tego pliku.')
    }
  }
  export function pause() {
    ++playRequest; wantsPlayback = false
    audio?.pause(); meter?.stop()
    if (matchesSource(audio, false)) publish(matchesSource() && audio.ended ? 'ended' : 'paused')
  }
  export async function toggle() { if (wantsPlayback || (matchesSource() && !audio.paused)) pause(); else await play() }
  export function seek(seconds: number) {
    if (!matchesSource() || !Number.isFinite(seconds)) return
    const limit = Number.isFinite(audio.duration) ? audio.duration : playback.duration
    if (limit <= 0) return
    audio.currentTime = Math.max(0, Math.min(limit, seconds)); publish()
  }
  function started() {
    if (!matchesSource() || !wantsPlayback || audio.paused) return
    publish('playing', ''); report({ ...quietActivity(), playing: true }); meter?.start(); void meter?.prepare()
  }
  function paused() {
    if (!matchesSource() || !audio.paused) return
    ++playRequest; wantsPlayback = false; meter?.stop(); publish(audio.ended ? 'ended' : 'paused')
  }
  function ended() { if (matchesSource() && audio.ended) { ++playRequest; wantsPlayback = false; meter?.stop(); publish('ended') } }
  function ready() {
    if (!matchesSource()) return
    publish(wantsPlayback ? (audio.paused ? 'loading' : 'playing') : playback.status === 'ended' ? 'ended' : playback.currentTime > 0 ? 'paused' : 'idle')
  }
  function waiting() { if (matchesSource() && wantsPlayback) { meter?.stop(); publish('loading') } }
  function seeked() { if (matchesSource()) { if (wantsPlayback && !audio.paused) started(); else publish(audio.ended ? 'ended' : playback.currentTime > 0 ? 'paused' : 'idle') } }
  function failed() { if (matchesSource()) { ++playRequest; wantsPlayback = false; meter?.stop(); publish('error', 'Ten plik nie jest obsługiwany lub nie można go wczytać.') } }
</script>

{#if recording?.url}
<footer class="player" aria-label="Odtwarzacz audio" data-playback-state={playback.status}>
  <div class="player-identity"><VoiceOrb voiceId={orbVoice} size={40} variant={orbVariant} syncGroup={orbSyncGroup} suspended={orbSuspended} features={activity.features} orbAudio={activity.orbAudio} level={activity.level} bands={activity.bands} playing={activity.playing}/><div class="player-copy"><strong>{recording?.voice || 'Brak nagrania'}</strong><span aria-live="polite" aria-atomic="true">{playback.error || recording?.title || 'Wygeneruj mowę lub wczytaj plik audio'}</span><small class="player-state" role="status">{recording?.url ? playbackStatusLabel(playback.status) : 'Brak nagrania'}</small></div></div>
  <div class="player-center"><div class="player-controls"><Button variant="ghost" size="icon" class="skip-button" aria-label="Cofnij o 10 sekund" disabled={!recording?.url || playback.duration <= 0} onclick={() => seek(playback.currentTime - 10)}><SkipIcon direction="back"/></Button><button class="play-button" data-loading={playback.status === 'loading' || undefined} aria-label={wantsPlayback ? playback.status === 'loading' ? 'Anuluj wczytywanie audio' : 'Wstrzymaj' : 'Odtwórz'} disabled={!recording?.url} onclick={toggle}>{#if playback.status === 'loading'}<LoaderCircle size={19} class="player-loading"/>{:else if wantsPlayback}<Pause size={19} fill="currentColor"/>{:else}<Play size={19} fill="currentColor"/>{/if}</button><Button variant="ghost" size="icon" class="skip-button" aria-label="Przewiń o 10 sekund" disabled={!recording?.url || playback.duration <= 0} onclick={() => seek(playback.currentTime + 10)}><SkipIcon direction="forward"/></Button></div><div class="player-progress"><span>{durationLabel(playback.currentTime)}</span><input aria-label="Pozycja nagrania" aria-valuetext={`${durationLabel(playback.currentTime)} z ${durationLabel(playback.duration)}`} type="range" min="0" max={playback.duration || 1} step="0.01" value={playback.currentTime} disabled={!recording?.url || playback.duration <= 0} style={`--progress:${playback.duration ? playback.currentTime / playback.duration * 100 : 0}%`} oninput={event => seek(Number(event.currentTarget.value))}/><span>{durationLabel(playback.duration)}</span></div></div>
  <div class="player-end">{#if recording?.url}<Button variant="ghost" size="icon-xs" href={recording.url} download={recording.filename || 'narracja.wav'} aria-label="Pobierz nagranie"><Download size={19}/></Button>{:else}<Button variant="ghost" size="icon-xs" onclick={onimport} aria-label="Wczytaj nagranie"><Upload size={18}/></Button>{/if}{#if recording?.filename}<span class="format-label">{recording.filename.split('.').at(-1)?.toUpperCase()}</span>{/if}</div>
  {#if recording?.url}<audio bind:this={audio} src={recording.url} preload="metadata"
    onloadstart={() => { if (matchesSource()) publish('loading', '') }} onloadedmetadata={ready} ondurationchange={() => { if (matchesSource()) publish() }}
    oncanplay={ready} onplay={() => { if (matchesSource() && wantsPlayback) publish('loading', '') }} onplaying={started}
    ontimeupdate={() => { if (matchesSource()) publish() }} onpause={paused} onwaiting={waiting} onseeking={waiting} onseeked={seeked} onended={ended} onerror={failed}></audio>{/if}
</footer>
{/if}

<style>
  .player{animation:player-enter 240ms cubic-bezier(.2,.8,.2,1) both;flex-shrink:0}@keyframes player-enter{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}@media(prefers-reduced-motion:reduce){.player{animation:none}}:global([data-reduced-motion=true]) .player{animation:none}

  .player-identity{display:flex;align-items:center;gap:12px;min-width:0}.player-copy{min-width:0}.player-copy>span{display:block;font-size:var(--ui-text-10);color:var(--muted);margin-top:4px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.player-state{display:block;color:var(--muted);font-size:var(--ui-text-9);line-height:1.4;margin-top:3px}.player-controls :global(.player-loading){animation:player-spin 1s linear infinite}@keyframes player-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.player-controls :global(.player-loading){animation:none}}:global([data-reduced-motion=true]) .player-controls :global(.player-loading){animation:none}
</style>
