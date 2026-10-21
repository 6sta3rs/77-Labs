<script lang="ts">
  import { uiLanguage, createUiTranslator } from '../i18n'
  const tr = $derived(createUiTranslator($uiLanguage))
  import Button from '../ui/Button.svelte';
  import { Play, Pause, Download, ArrowUpRight, LoaderCircle, Star } from '@lucide/svelte'
  import type { Render } from '../data'
  import { durationLabel } from '../data'
  import { playbackStatusLabel, type PlaybackState } from '../playback/playback-state'
  let { recording, index, onplay, onrestore, onstar, state, generating = false, progress, onseek, generationLabel, title, downloadable = true }: {
    recording: Render; index: number; onplay: () => void; onrestore?: () => void
    state?: PlaybackState; generating?: boolean; progress?: number; onseek?: (seconds: number) => void; generationLabel?: string; onstar?: () => void
    /** Custom heading instead of „Nagranie N” (used by AudioPreview). */
    title?: string; downloadable?: boolean
  } = $props()
  const duration = $derived(state?.duration || recording.duration || 0)
  const currentTime = $derived(Math.max(0, Math.min(duration, state?.currentTime || 0)))
  const played = $derived(duration > 0 ? currentTime / duration * 100 : 0)
  const generationProgress = $derived(typeof progress === 'number' && Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : undefined)
  const loading = $derived(state?.status === 'loading')
  // Bars breathe while audio loads or a new recording is being generated.
  const waiting = $derived(generating || loading)
  // Enough bars for the widest card; the row clips, so spacing stays as dense as a real waveform.
  const placeholderBars = Array.from({ length: 160 }, (_, i) => 0.3 + ((i * 37) % 11) / 16)
  const status = $derived(generating ? generationLabel || tr('Generowanie nagrania…') : state ? tr(playbackStatusLabel(state.status)) : tr('Gotowe do odtwarzania'))
  const subject = $derived(title ? `„${title}”` : tr('nagranie {index}', { index }))
  const buttonLabel = $derived(generating ? tr('Trwa generowanie nagrania') : loading ? tr('Anuluj wczytywanie: {subject}', { subject }) : state?.status === 'playing' ? tr('Wstrzymaj {subject}', { subject }) : state?.status === 'paused' ? tr('Wznów {subject}', { subject }) : tr('Odtwórz {subject}', { subject }))
</script>

<article class="generation-card" data-playback-state={generating ? 'generating' : state?.status ?? 'idle'}>
  <span class="generation-label">{generating ? tr('Nowe nagranie') : title ?? tr('Nagranie {index}', { index })}</span>
  <div class="generation-controls">
    <button class="mini-play" aria-label={buttonLabel} disabled={generating || !recording.url} onclick={onplay}>
      {#if state?.status === 'playing'}<Pause size={14} fill="currentColor"/>{:else}<Play size={14} fill="currentColor"/>{/if}
    </button>
    <div class="generation-wave" class:seekable={!!onseek && !generating && duration > 0} class:waiting>
      {#if recording.peaks?.length}
        <div class="mini-wave wave-base" aria-hidden="true">{#each recording.peaks as peak, i}<i style:height={`${Math.max(3, peak * 27)}px`} style:--i={i}></i>{/each}</div>
        <div class="mini-wave wave-played" aria-hidden="true" style={`clip-path:inset(0 ${100 - played}% 0 0)`}>{#each recording.peaks as peak}<i style:height={`${Math.max(3, peak * 27)}px`}></i>{/each}</div>
      {:else if waiting}
        <div class="mini-wave wave-base wave-placeholder" aria-hidden="true">{#each placeholderBars as height, i}<i style:height={`${height * 22}px`} style:--i={i}></i>{/each}</div>
      {:else}
        <div class="wave-track" aria-hidden="true"><span style:width={`${played}%`}></span></div>
      {/if}
      {#if onseek && !generating && duration > 0}
        <input class="generation-seek" type="range" min="0" max={duration} step="0.01" value={currentTime}
          aria-label={tr('Pozycja nagrania {index}', { index })} aria-valuetext={tr('{current} z {total}', { current: durationLabel(currentTime), total: durationLabel(duration) })}
          oninput={event => onseek?.(Number(event.currentTarget.value))}/>
      {/if}
    </div>
    {#if waiting}<LoaderCircle size={18} class="generation-loading generation-side-spinner" aria-hidden="true"/>{:else}<span class="generation-time">{#if state}{durationLabel(currentTime)} / {/if}{durationLabel(duration)}</span>{/if}
    {#if onstar && !waiting}<Button variant="ghost" size="icon-xs" aria-label={tr('{action} nagrania {index}', { action: recording.starred ? tr('Usuń gwiazdkę') : tr('Zachowaj'), index })} aria-pressed={!!recording.starred} title={tr('Nagrania z gwiazdką pozostają poza limitem historii')} onclick={onstar}><Star size={15} fill={recording.starred?'currentColor':'none'}/></Button>{/if}
    {#if onrestore && !waiting}<Button variant="ghost" size="icon-xs" aria-label={tr('Przywróć tekst i ustawienia nagrania {index}', { index })} onclick={onrestore}><ArrowUpRight size={15}/></Button>{/if}
    {#if recording.url && !waiting && downloadable}<Button variant="ghost" size="icon-xs" href={recording.url} download={recording.filename || 'narracja.wav'} aria-label={tr('Pobierz nagranie {index}', { index })}><Download size={15}/></Button>{/if}
  </div>
  <div class="generation-meta"><span class="generation-status" role="status" aria-live="polite">{status}{#if generating && generationProgress !== undefined} · {Math.round(generationProgress)}%{/if}</span>{#if !generating}<span class="generation-voice-name">{recording.voice}</span>{/if}</div>
  {#if !generating && recording.wavBits}<p class="generation-format">{tr('WAV')} {recording.wavBits === '32' ? '32-bit float' : tr('{bits}-bit PCM', { bits: recording.wavBits })}{recording.designRecipe ? ` · ${tr('szkic projektowania zapisany')}` : ''}</p>{/if}
  {#if state?.error}<p class="generation-error" role="alert">{tr(state.error)}</p>{/if}
</article>

<style>
  .generation-controls :global(.generation-side-spinner){flex:none;margin:0 6px;color:var(--muted)}
  .generation-wave .mini-wave.wave-placeholder{justify-content:flex-start;gap:2px;overflow:hidden}.generation-wave .mini-wave.wave-placeholder i{flex:none;width:3.5px;max-width:none}
  .generation-wave.waiting .wave-base i{animation:wave-breathe 1.1s ease-in-out infinite;animation-delay:calc(var(--i) * -55ms);opacity:.7}
  .generation-wave.waiting .wave-played{display:none}
  @keyframes wave-breathe{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}
  @media(prefers-reduced-motion:reduce){.generation-wave.waiting .wave-base i{animation:none}}
  :global([data-reduced-motion=true]) .generation-wave.waiting .wave-base i{animation:none}
  .generation-format{font-size:var(--ui-text-10);line-height:1.5;color:var(--muted);margin:6px 1px 0}
  .generation-wave{position:relative;flex:1;min-width:25px;height:32px;display:flex;align-items:center;border-radius:4px}.generation-wave .mini-wave{position:absolute;inset:1px 0;display:flex;align-items:center;justify-content:space-between;gap:2px;height:30px;min-width:0;width:100%;margin:0}.generation-wave .mini-wave i{flex:1;max-width:4px;min-width:1px;border-radius:2px;background:var(--muted);opacity:.5}.generation-wave .wave-played i{background:var(--primary,var(--foreground));opacity:1}.wave-track{height:3px;width:100%;border-radius:3px;background:var(--input-border,var(--border));overflow:hidden}.wave-track span{display:block;height:100%;background:var(--primary,var(--foreground))}.generation-seek{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}.generation-wave:has(:focus-visible:not([data-focus-passive])){outline:2px solid var(--focus,var(--accent));outline-offset:3px}.generation-time{font-variant-numeric:tabular-nums;white-space:nowrap}.generation-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:7px 1px 0;font-size:var(--ui-text-10);line-height:1.5;color:var(--muted)}.generation-status{overflow-wrap:anywhere}.generation-voice-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;max-width:45%}.generation-error{color:var(--danger);font-size:var(--ui-text-11);line-height:1.6;margin:8px 0 0;overflow-wrap:anywhere}.generation-controls :global(.generation-loading){animation:generation-spin 1s linear infinite}@keyframes generation-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.generation-controls :global(.generation-loading){animation:none}}:global([data-reduced-motion=true]) .generation-controls :global(.generation-loading){animation:none}@media(pointer:coarse){.generation-wave{height:44px}.generation-wave .mini-wave{inset:7px 0}}
</style>
