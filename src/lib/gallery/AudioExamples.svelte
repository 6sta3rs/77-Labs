<script lang="ts">
  function uiOptions<T extends { label: string }>(items: readonly T[]): T[] { return items.map(item => ({ ...item, label: tr(item.label) })); }

  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import { onMount, tick } from 'svelte'
  import { Play, Pause, Upload, AudioLines, LoaderCircle } from '@lucide/svelte'
  import Player from '../playback/Player.svelte'
  import GenerationCard from '../tts/GenerationCard.svelte'
  import AudioPreview from '../playback/AudioPreview.svelte'
  import VoiceOrb from '../playback/VoiceOrb.svelte'
  import Button from '../ui/Button.svelte'
  import Input from '../ui/Input.svelte'
  import ButtonGroup from '../ui/ButtonGroup.svelte'
  import { idlePlaybackState, playbackStatusLabel, type PlaybackState } from '../playback/playback-state'
  import { orbVariants, orbPalettes, setOrbPalette, type OrbVariant } from '../playback/voice-orb'
  import { quietActivity, type PlaybackActivity } from '../playback/playback-meter'
  import type { Render } from '../data'

  const uid = $props.id()
  let recordings = $state<Render[]>([])
  let selectedId = $state('example-speech')
  let selected = $derived(recordings.find(row => row.id === selectedId))
  let player: Player
  let playerHost: HTMLDivElement
  let fileInputContainer: HTMLDivElement
  let activity = $state.raw<PlaybackActivity>(quietActivity())
  let loading = $state(true), importing = $state(false), error = $state(''), notice = $state('')
  let playback = $state<PlaybackState>(idlePlaybackState())
  let variant = $state<OrbVariant>('storm')
  let generationDemo = $state(false)
  let palette = $state('voice')
  const variantNames: Record<OrbVariant, string> = { original: 'Oryginał', calm: 'Spokojny', storm: 'Burza', intonation: 'Intonacja', landing: 'Płyn' }
  const generationExample: Render = {id:'generation-state',title:'Podgląd generowania',voice:'Przykład stanu',text:'',created:'',kind:'audio'}
  let disposed = false
  let preparation: Promise<void> | undefined
  let importSequence = 0
  const urls = new Set<string>()

  async function demoBlob() {
    const response = await fetch('/demo/interface-tone.wav')
    if (!response.ok) throw new Error('Nie udało się odczytać sygnału demonstracyjnego.')
    return response.blob()
  }
  function testTone() {
    const rate = 24000, seconds = 5, count = rate * seconds
    const bytes = new ArrayBuffer(44 + count * 2), view = new DataView(bytes)
    const ascii = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
    ascii(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); ascii(8, 'WAVEfmt ')
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
    ascii(36, 'data'); view.setUint32(40, count * 2, true)
    for (let index = 0; index < count; index++) {
      const time = index / rate, phase = time % 2
      const envelope = phase < 1.2 ? Math.min(1, phase / .03, (1.2 - phase) / .03) : 0
      const sample = Math.sin(2 * Math.PI * 440 * time) * .18 * envelope
      view.setInt16(44 + index * 2, Math.round(sample * 32767), true)
    }
    return new Blob([bytes], { type: 'audio/wav' })
  }
  async function makeRecording(blob: Blob, id: string, title: string, filename: string, voice: string): Promise<Render> {
    const context = new OfflineAudioContext(1, 1, 24000)
    const buffer = await context.decodeAudioData(await blob.arrayBuffer())
    if (disposed) throw new Error('Podgląd został zamknięty.')
    if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error('Plik nie zawiera odtwarzalnego nagrania.')
    const channel = buffer.getChannelData(0), count = 48
    const peaks = Array.from({ length: count }, (_, index) => {
      const start = Math.floor(index * channel.length / count), end = Math.floor((index + 1) * channel.length / count)
      let peak = 0
      for (let sample = start; sample < end; sample += Math.max(1, Math.floor((end - start) / 500))) peak = Math.max(peak, Math.abs(channel[sample]))
      return peak
    })
    const maximum = Math.max(.001, ...peaks)
    const url = URL.createObjectURL(blob)
    urls.add(url)
    return { id, title, filename, voice, url, blob, duration: buffer.duration, peaks: peaks.map(value => value / maximum),
      created: new Date().toISOString(), kind: 'audio', text: '', blocks: [{ id: `${id}-block`, voiceId: id, text: '' }] }
  }
  onMount(() => {
    preparation = (async () => {
      try {
        const speech = await makeRecording(await demoBlob(), 'example-speech', 'Sygnał demonstracyjny', 'sygnal-demo.wav', 'Sygnał testowy')
        const tone = await makeRecording(testTone(), 'example-tone', 'Ton testowy 440 Hz i cisza', 'ton-testowy.wav', 'Sygnał testowy')
        if (!disposed) recordings = [speech, tone]
      } catch (cause) { if (!disposed) error = cause instanceof Error ? cause.message : 'Nie można przygotować przykładów audio.' }
      finally { if (!disposed) loading = false }
    })()
    return () => {
      disposed = true
      importSequence++
      const audio = playerHost?.querySelector('audio')
      audio?.pause()
      audio?.removeAttribute('src')
      audio?.load()
      for (const url of urls) URL.revokeObjectURL(url)
      urls.clear()
    }
  })
  async function choose(row: Render, autoplay = false) {
    if (selectedId !== row.id) {
      activity = quietActivity()
      selectedId = row.id
      await tick()
    }
    if (autoplay && !disposed) await player?.play()
  }
  async function toggleRecording(row: Render) {
    if (selectedId === row.id) await player?.toggle()
    else await choose(row, true)
  }
  export async function playExample() {
    await preparation
    if (disposed) return
    const row = selected ?? recordings.find(item => item.id === 'example-speech')
    if (row) await choose(row, true)
    else if (!loading) error = 'Próbka audio nie jest dostępna. Wczytaj własne nagranie.'
  }
  function chooseFile() { fileInputContainer?.querySelector<HTMLInputElement>('input')?.click() }
  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    error = ''; notice = ''
    if (!file.type.startsWith('audio/') && !/\.(wav|mp3|m4a|ogg|flac|aac|webm)$/i.test(file.name)) { error = 'Wybierz plik audio WAV, MP3, M4A, OGG lub FLAC.'; return }
    if (file.size > 50 * 1024 * 1024) { error = 'Podgląd obsługuje pliki audio do 50 MB.'; return }
    const sequence = ++importSequence
    importing = true
    try {
      const row = await makeRecording(file, 'example-import', file.name, file.name, 'Własny plik')
      if (disposed || sequence !== importSequence) { if (row.url) { URL.revokeObjectURL(row.url); urls.delete(row.url) }; return }
      const previous = recordings.find(item => item.id === row.id)
      recordings = [...recordings.filter(item => item.id !== row.id), row]
      activity = quietActivity(); selectedId = row.id
      await tick()
      if (previous?.url) { URL.revokeObjectURL(previous.url); urls.delete(previous.url) }
      notice = `Wczytano: ${file.name}. Naciśnij Odtwórz, aby rozpocząć.`
    } catch { if (!disposed && sequence === importSequence) error = 'Nie można odczytać pliku audio. Wybierz obsługiwany, nieuszkodzony plik.' }
    finally { if (!disposed && sequence === importSequence) importing = false }
  }
</script>

<section class="audio-examples" id="control-14" aria-labelledby={`${uid}-heading`}>
  <header class="audio-heading"><span class="audio-number">14</span><h2 id={`${uid}-heading`}>{tr("Audio i kula głosu")}</h2><span class="audio-type">{tr("Player · GenerationCard · VoiceOrb")}</span></header>
  <p class="audio-intro">{tr("Odtwarzanie sygnałów demonstracyjnych i własnego pliku. Fala pochodzi z nagrania, a kula reaguje na jego rzeczywisty poziom i pasma dźwięku.")}</p>
  {#if loading}<p class="audio-message" role="status">{tr("Przygotowywanie lokalnych próbek audio…")}</p>{/if}
  <div class="audio-layout">
    <div class="audio-samples">
      {#each recordings as row, index (row.url)}
        <div class="audio-sample" class:chosen={selectedId === row.id}>
          <div class="audio-sample-heading"><Button variant={selectedId === row.id ? 'secondary' : 'ghost'} size="sm" aria-pressed={selectedId === row.id} onclick={() => choose(row)}>{row.title}</Button>{#if selectedId === row.id}<span class="audio-active">{playbackStatusLabel(playback.status)}</span>{/if}</div>
          <GenerationCard recording={row} index={index + 1} state={selectedId === row.id ? playback : undefined} onplay={() => toggleRecording(row)} onseek={seconds => { void choose(row).then(() => player?.seek(seconds)) }} />
          <p class="audio-source">{row.id === 'example-speech' ? tr("Syntetyczny sygnał demonstracyjny z repozytorium.") : row.id === 'example-tone' ? tr("Lokalny ton 440 Hz z przerwami ciszy · 5 s. To sygnał testowy.") : tr("Plik wybrany na tym urządzeniu. Nie jest wysyłany do serwera.")}</p>
        </div>
      {/each}
      {#if recordings.find(row => row.id === 'example-tone')?.url}{@const tone = recordings.find(row => row.id === 'example-tone')!}
        <div class="audio-sample"><span class="audio-active">{tr("AudioPreview · samodzielny odtwarzacz")}</span><AudioPreview src={tone.url!} title={tr("Wynik obróbki audio")} meta={tr("Sygnał testowy")} filename="ton-testowy.wav"/><p class="audio-source">{tr("Zastępuje natywne <audio controls> w całej aplikacji: sam wczytuje plik, liczy falę i płynnie przesuwa postęp.")}</p></div>
        <div class="audio-sample"><span class="audio-active">{tr("Wczytywanie i generowanie")}</span><GenerationCard recording={{ ...tone, peaks: undefined }} index={3} generating generationLabel="Generowanie nagrania…" onplay={() => {}}/><p class="audio-source">{tr("Słupki falują, dopóki nagranie się wczytuje lub generuje.")}</p></div>
      {/if}
      <div class="audio-import" bind:this={fileInputContainer}>
        <label for={`${uid}-file`}><Upload size={14} />{tr("Własne nagranie")}</label>
        <Button variant="outline" size="sm" disabled={loading || importing} onclick={chooseFile} aria-describedby={`${uid}-file-hint`}><Upload size={15}/>{importing ? tr("Wczytywanie…") : 'Wybierz plik audio'}</Button>
        <Input hidden id={`${uid}-file`} type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac" disabled={loading || importing} onchange={importFile} aria-describedby={`${uid}-file-hint`} />
        <p id={`${uid}-file-hint`} class="audio-source">{tr("Do 50 MB. Wczytanie nie rozpoczyna odtwarzania.")}</p>
      </div>
    </div>
    <div class="audio-orb-panel">
      <div class="audio-orb-stage" class:landing={variant === 'landing'}>
        <VoiceOrb voiceId={selected?.id ?? 'example-speech'} size={variant === 'landing' ? 256 : 190} ring={variant !== 'landing'} {variant} features={activity.features} orbAudio={activity.orbAudio} level={activity.level} bands={activity.bands} playing={activity.playing} />
        <Button class="audio-orb-play" variant="secondary" size="icon" disabled={!selected} aria-label={`${playback.status === 'loading' ? 'Anuluj wczytywanie' : playback.status === 'playing' ? tr("Wstrzymaj") : tr("Odtwórz")}: ${selected?.title ?? tr("próbkę")}`} onclick={() => player?.toggle()}>{#if playback.status === 'loading'}<LoaderCircle size={18} />{:else if playback.status === 'playing'}<Pause size={18} fill="currentColor" />{:else}<Play size={18} fill="currentColor" />{/if}</Button>
      </div>
      <strong>{selected?.voice ?? 'Próbka audio'}</strong>
      <span class="audio-orb-state" aria-live="polite">{playbackStatusLabel(playback.status)}</span>
      <div class="audio-signal"><AudioLines size={14} /><span>{activity.available ? tr("Poziom sygnału: {value0}%", {value0: (Math.round(activity.level * 100))}) : tr("Pomiar sygnału po uruchomieniu audio")}</span></div>
      <p class="audio-source">{variant === 'landing' ? tr("Płynąca powierzchnia z ziarnem w kolorach wybranej palety. Reaguje na wybraną próbkę powyżej.") : tr("Po pauzie pomiar wraca do zera, a ruch łagodnie wraca do spokojnego dryfu. Ograniczenie animacji zachowuje działanie audio.")}</p>
    </div>
  </div>
  <div class="audio-variants">
    <h3>{tr("Warianty kuli głosu")}</h3>
    <ButtonGroup label={tr("Wariant kuli głosu")} mode="single" value={variant} items={uiOptions(orbVariants.map(value => ({value,label:variantNames[value]})))} onchange={value => variant = value as OrbVariant}/>
    <div class="orb-comparison">{#each orbVariants as item}<button class:selected={variant === item} aria-pressed={variant === item} onclick={() => variant = item}>
      <VoiceOrb voiceId={selected?.id ?? 'example-speech'} size={110} variant={item} features={activity.features} orbAudio={activity.orbAudio} level={activity.level} bands={activity.bands} playing={activity.playing}/><strong>{variantNames[item]}</strong>
    </button>{/each}</div>
    <h3>{tr("Kolor kuli")}</h3>
    <ButtonGroup label={tr("Kolor kuli głosu")} mode="single" value={palette} items={uiOptions([{ value: 'voice', label: 'Z głosu' }, ...orbPalettes.map(item => ({ value: item.id, label: item.label }))])} onchange={value => { palette = String(value); setOrbPalette(palette) }}/>
    <p class="audio-source">{tr("Wszystkie kule korzystają z tego samego nagrania i tej samej palety. „Z głosu” daje każdemu głosowi jego stały kolor. Burza pozostaje dynamiczna również przy stałym tonie: głośność podtrzymuje jej siłę, a wysokość tonu zmienia tempo i wiry. To nie jest rozpoznawanie emocji.")}</p>
    <p class="audio-features">{activity.features?.pitchHz ? `Ton: ${Math.round(activity.features.pitchHz)} Hz` : tr("Brak stabilnego tonu")} {tr("· Zmienność:")} {Math.round((activity.features?.turbulence ?? 0) * 100)}%</p>
  </div>
  <div class="generation-demo"><Button variant="outline" size="sm" onclick={() => generationDemo = !generationDemo}>{generationDemo ? tr("Zakończ podgląd stanu") : tr("Pokaż stan generowania")}</Button><p class="audio-source">{tr("Podgląd stanu — nie uruchamia modelu. W Studio karta jest widoczna przez cały czas rzeczywistego generowania.")}</p>{#if generationDemo}<GenerationCard recording={generationExample} index={1} generating generationLabel="Model generuje audio…" onplay={() => {}}/>{/if}</div>
  <div class="audio-player" bind:this={playerHost}><Player bind:this={player} recording={selected} orbVariant={variant} onstate={value => playback = value} onimport={chooseFile} onactivity={value => activity = value} /></div>
  {#if importing}<p class="audio-message" role="status">{tr("Odczytywanie nagrania…")}</p>{/if}
  {#if error}<p class="audio-error" role="alert">{tr(error)}</p>{/if}
  {#if notice}<p class="audio-message" role="status">{notice}</p>{/if}
  <p class="audio-source audio-footer">{tr("Przykłady działają lokalnie i bez automatycznego odtwarzania. Nie uruchamiają syntezy, mikrofonu ani usług zewnętrznych.")}</p>
</section>

<style>
  .audio-orb-stage.landing :global(.audio-orb-play){width:56px;height:56px;background:var(--neutral-selected-background);color:var(--neutral-selected-foreground);border:1px solid var(--neutral-selected-border);box-shadow:0 1px 2px #0000000d}.audio-orb-stage.landing :global(.audio-orb-play:hover){background:var(--neutral-selected-hover)}.audio-orb-stage.landing{margin-bottom:12px}
  .audio-examples{min-width:0;grid-column:1/-1;border:1px solid var(--border);border-radius:12px;padding:23px;background:var(--background);scroll-margin-top:18px}.audio-heading{display:flex;align-items:center;gap:10px;margin-bottom:15px}.audio-heading h2{font-size:var(--ui-text-14);font-weight:550;letter-spacing:-.2px}.audio-number{font-size:var(--ui-text-10);color:var(--muted);font-variant-numeric:tabular-nums}.audio-type{margin-left:auto;font-size:var(--ui-text-10);color:var(--muted);font-family:ui-monospace,monospace}.audio-intro{font-size:var(--ui-text-12);line-height:1.7;color:var(--muted);max-width:710px;margin-bottom:20px}.audio-layout{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:24px;align-items:start}.audio-samples{min-width:0;display:grid;gap:14px}.audio-sample{border:1px solid var(--border);border-radius:9px;padding:12px;min-width:0}.audio-sample.chosen{border-color:var(--focus)}.audio-sample-heading{display:flex;align-items:center;gap:8px;margin-bottom:10px}.audio-sample-heading :global(.vs-button){min-width:0;white-space:normal;overflow-wrap:anywhere;text-align:left;height:auto}.audio-active{margin-left:auto;color:var(--muted);font-size:var(--ui-text-10);white-space:nowrap}.audio-source{font-size:var(--ui-text-11);line-height:1.7;color:var(--muted);margin:7px 0 0;overflow-wrap:anywhere}.audio-import{display:grid;gap:8px;margin-top:5px}.audio-import label{display:flex;gap:7px;align-items:center;font-size:var(--ui-text-12)}.audio-import :global(input[type=file]){height:auto;min-height:34px;line-height:1.5;padding:5px 8px;max-width:100%}.audio-orb-panel{display:flex;align-items:center;flex-direction:column;text-align:center;min-width:0;padding:3px 10px}.audio-orb-stage{position:relative;display:grid;place-items:center}.audio-orb-stage :global(.audio-orb-play){position:absolute;border-radius:50%;width:42px;height:42px;background:color-mix(in srgb,var(--surface) 88%,transparent);border:1px solid var(--border);box-shadow:0 2px 10px #0002}.audio-orb-panel strong{font-size:var(--ui-text-13);margin-top:3px}.audio-orb-state{font-size:var(--ui-text-11);color:var(--muted);margin-top:5px}.audio-signal{display:flex;align-items:center;gap:6px;margin-top:16px;font-size:var(--ui-text-10);color:var(--muted);min-height:28px;font-variant-numeric:tabular-nums}.audio-player{margin-top:22px;border:1px solid var(--border);border-radius:9px;overflow:hidden}.audio-player :global(.player){height:auto;min-height:104px;padding:14px;gap:14px;grid-template-columns:minmax(135px,1fr) minmax(170px,1.8fr) 34px}.audio-player :global(.player-end .format-label){display:none}.audio-sample :global(.generation-card){border:0;padding:0;background:transparent;min-width:0}.audio-message,.audio-error{font-size:var(--ui-text-12);line-height:1.6;margin-top:12px;overflow-wrap:anywhere}.audio-error{color:var(--danger)}.audio-message{color:var(--muted)}.audio-footer{margin-top:15px}
  .audio-variants{margin-top:24px;border-top:1px solid var(--border);padding-top:20px}.audio-variants h3{font-size:var(--ui-text-13);margin:0 0 12px}.orb-comparison{display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:10px;margin-top:16px}.orb-comparison button{display:flex;flex-direction:column;align-items:center;gap:8px;padding:10px 4px;border:1px solid var(--border);border-radius:10px;background:var(--background);color:var(--foreground);cursor:pointer}.orb-comparison button.selected{border-color:var(--focus)}.orb-comparison strong{font-size:var(--ui-text-11);font-weight:500}.audio-features{font-size:var(--ui-text-11);color:var(--muted);font-variant-numeric:tabular-nums;margin-top:10px}.generation-demo{margin-top:20px;padding-top:18px;border-top:1px solid var(--border)}.generation-demo :global(.generation-card){margin-top:14px}.audio-variants :global(.vs-button-group){flex-wrap:wrap}@media(max-width:500px){.orb-comparison{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:760px){.audio-layout{grid-template-columns:minmax(0,1fr)}.audio-orb-panel{order:-1}.audio-type{display:none}.audio-player :global(.player){grid-template-columns:minmax(0,1fr) 34px;gap:10px}.audio-player :global(.player-center){grid-row:2;grid-column:1/-1;width:100%}.audio-player :global(.player-identity){grid-row:1;grid-column:1}.audio-player :global(.player-end){grid-row:1;grid-column:2}.audio-examples{padding:18px}.audio-sample-heading{flex-wrap:wrap}.audio-sample-heading :global(.vs-button){white-space:normal;text-align:left;height:auto}}
</style>
