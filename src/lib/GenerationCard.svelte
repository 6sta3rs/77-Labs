<script lang="ts">
  import Button from './ui/Button.svelte';
  import { Play, Pause, Download, ArrowUpRight, LoaderCircle, Star } from '@lucide/svelte'
  import type { Render } from './data'
  import { durationLabel } from './data'
  import { playbackStatusLabel, type PlaybackState } from './playback-state'
  let { recording, index, onplay, onrestore, onstar, state, generating = false, progress, onseek, generationLabel }: {
    recording: Render; index: number; onplay: () => void; onrestore?: () => void
    state?: PlaybackState; generating?: boolean; progress?: number; onseek?: (seconds: number) => void; generationLabel?: string; onstar?: () => void
  } = $props()
  const duration = $derived(state?.duration || recording.duration || 0)
  const currentTime = $derived(Math.max(0, Math.min(duration, state?.currentTime || 0)))
  const played = $derived(duration > 0 ? currentTime / duration * 100 : 0)
  const generationProgress = $derived(typeof progress === 'number' && Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : undefined)
  const loading = $derived(state?.status === 'loading')
  const active = $derived(state?.status === 'playing' || loading)
  const status = $derived(generating ? generationLabel || 'Generowanie nagrania…' : state ? playbackStatusLabel(state.status) : 'Gotowe do odtwarzania')
  const buttonLabel = $derived(generating ? 'Trwa generowanie nagrania' : loading ? `Anuluj wczytywanie nagrania ${index}` : state?.status === 'playing' ? `Wstrzymaj nagranie ${index}` : state?.status === 'paused' ? `Wznów nagranie ${index}` : `Odtwórz nagranie ${index}`)
</script>

<article class="generation-card" data-playback-state={generating ? 'generating' : state?.status ?? 'idle'}>
  <span class="generation-label">{generating ? 'Nowe nagranie' : `Nagranie ${index}`}</span>
  <div class="generation-controls">
    <button class="mini-play" aria-label={buttonLabel} disabled={generating || !recording.url} onclick={onplay}>
      {#if generating || loading}<LoaderCircle size={15} class="generation-loading"/>{:else if active}<Pause size={14} fill="currentColor"/>{:else}<Play size={14} fill="currentColor"/>{/if}
    </button>
    <div class="generation-wave" class:seekable={!!onseek && !generating && duration > 0}>
      {#if recording.peaks?.length}
        <div class="mini-wave wave-base" aria-hidden="true">{#each recording.peaks as peak}<i style:height={`${Math.max(3, peak * 27)}px`}></i>{/each}</div>
        <div class="mini-wave wave-played" aria-hidden="true" style={`clip-path:inset(0 ${100 - played}% 0 0)`}>{#each recording.peaks as peak}<i style:height={`${Math.max(3, peak * 27)}px`}></i>{/each}</div>
      {:else}
        <div class="wave-track" aria-hidden="true"><span style:width={`${played}%`}></span></div>
      {/if}
      {#if onseek && !generating && duration > 0}
        <input class="generation-seek" type="range" min="0" max={duration} step="0.01" value={currentTime}
          aria-label={`Pozycja nagrania ${index}`} aria-valuetext={`${durationLabel(currentTime)} z ${durationLabel(duration)}`}
          oninput={event => onseek?.(Number(event.currentTarget.value))}/>
      {/if}
    </div>
    {#if !generating}<span class="generation-time">{#if state}{durationLabel(currentTime)} / {/if}{durationLabel(duration)}</span>{/if}
    {#if onstar && !generating}<Button variant="ghost" size="icon-xs" aria-label={`${recording.starred?'Usuń gwiazdkę':'Zachowaj'} nagrania ${index}`} aria-pressed={!!recording.starred} title="Nagrania z gwiazdką pozostają poza limitem historii" onclick={onstar}><Star size={15} fill={recording.starred?'currentColor':'none'}/></Button>{/if}
    {#if onrestore && !generating}<Button variant="ghost" size="icon-xs" aria-label={`Przywróć tekst i ustawienia nagrania ${index}`} onclick={onrestore}><ArrowUpRight size={15}/></Button>{/if}
    {#if recording.url && !generating}<Button variant="ghost" size="icon-xs" href={recording.url} download={recording.filename || 'narracja.wav'} aria-label={`Pobierz nagranie ${index}`}><Download size={15}/></Button>{/if}
  </div>
  <div class="generation-meta"><span class="generation-status" role="status" aria-live="polite">{status}{#if generating && generationProgress !== undefined} · {Math.round(generationProgress)}%{/if}</span>{#if !generating}<span class="generation-voice-name">{recording.voice}</span>{/if}</div>
  {#if !generating && recording.wavBits}<p class="generation-format">WAV {recording.wavBits === '32' ? '32-bit float' : `${recording.wavBits}-bit PCM`}{recording.designRecipe ? ' · szkic projektowania zapisany' : ''}</p>{/if}
  {#if generating}
    <div class="generation-progress" role="progressbar" aria-label="Postęp generowania nagrania" aria-valuemin={0} aria-valuemax={100} aria-valuenow={generationProgress} aria-valuetext={generationProgress === undefined ? 'Silnik nie podał postępu procentowego' : `${Math.round(generationProgress)}%`}><span style:width={generationProgress === undefined ? '100%' : `${generationProgress}%`} class:indeterminate={generationProgress === undefined}></span></div>
  {/if}
  {#if state?.error}<p class="generation-error" role="alert">{state.error}</p>{/if}
</article>

<style>
  .generation-format{font-size:var(--ui-text-10);line-height:1.5;color:var(--muted);margin:6px 1px 0}
  .generation-wave{position:relative;flex:1;min-width:25px;height:32px;display:flex;align-items:center;border-radius:4px}.generation-wave .mini-wave{position:absolute;inset:1px 0;display:flex;align-items:center;justify-content:space-between;gap:2px;height:30px;min-width:0;width:100%;margin:0}.generation-wave .mini-wave i{flex:1;max-width:4px;min-width:1px;border-radius:2px;background:var(--muted);opacity:.5}.generation-wave .wave-played i{background:var(--primary,var(--foreground));opacity:1}.wave-track{height:3px;width:100%;border-radius:3px;background:var(--input-border,var(--border));overflow:hidden}.wave-track span{display:block;height:100%;background:var(--primary,var(--foreground))}.generation-seek{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}.generation-wave:focus-within{outline:2px solid var(--focus,var(--accent));outline-offset:3px}.generation-time{font-variant-numeric:tabular-nums;white-space:nowrap}.generation-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:7px 1px 0;font-size:var(--ui-text-10);line-height:1.5;color:var(--muted)}.generation-status{overflow-wrap:anywhere}.generation-voice-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;max-width:45%}.generation-progress{height:3px;margin-top:7px;border-radius:4px;overflow:hidden;background:var(--input-border,var(--border))}.generation-progress span{display:block;height:100%;background:var(--primary,var(--foreground))}.generation-progress .indeterminate{opacity:.35;background:repeating-linear-gradient(135deg,var(--primary,var(--foreground)) 0,var(--primary,var(--foreground)) 4px,transparent 4px,transparent 8px)}.generation-error{color:var(--danger);font-size:var(--ui-text-11);line-height:1.6;margin:8px 0 0;overflow-wrap:anywhere}.generation-controls :global(.generation-loading){animation:generation-spin 1s linear infinite}@keyframes generation-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.generation-controls :global(.generation-loading){animation:none}}:global([data-reduced-motion=true]) .generation-controls :global(.generation-loading){animation:none}@media(pointer:coarse){.generation-wave{height:44px}.generation-wave .mini-wave{inset:7px 0}}
</style>
