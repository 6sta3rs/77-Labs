<script lang="ts">
  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import { onDestroy } from 'svelte'
  import { ChevronDown } from '@lucide/svelte'
  import VoicePicker from './VoicePicker.svelte'
  import VoiceAvatar from '../ui/VoiceAvatar.svelte'
  import { request, type Profile } from '../platform/api'
  import type { Voice } from '../data'
  import { VoicePortraits } from './voice-portraits'
  import { engineCatalog } from '../tools/studio-tools'
  import { engineCatalogSnapshot } from '../models/engine-catalog-state'
  import Button from '../ui/Button.svelte'
  import { profileVoiceMetadata } from './voice-metadata'

  let { profiles, value, onchange, disabled = false, ready = false, label = 'Głos', allowDefault = false,
    defaultLabel = 'Domyślny głos silnika', oncreate }: {
    profiles: Profile[]; value: string; onchange: (value: string) => void; disabled?: boolean; ready?: boolean;
    label?: string; allowDefault?: boolean; defaultLabel?: string; oncreate?: () => void;
  } = $props()
  let open = $state(false), creationHint = $state(false), playingId = $state(''), busyId = $state('')
  let languageLoading = $state(false), languageNotice = $state('')
  let languageController: AbortController | undefined
  const model = $derived($engineCatalogSnapshot?.catalog.tts)
  const activeModel = $derived(model?.backends.find(engine=>engine.id===model?.active))
  let images = $state(new Map<string, string>())
  const portraits = new VoicePortraits()
  let controller: AbortController | undefined, audio: HTMLAudioElement | undefined, url = '', disposed = false
  const voices = $derived<Voice[]>(profiles.map(profile => ({ id: profile.id, name: profile.name,
    description: profile.description || 'Zapisany lokalnie', language: profile.language || 'Auto',
    kind: profile.kind === 'design' ? 'Projektowany' : 'Klonowany', demo: false, inLibrary: true,
    initials: profile.name.slice(0, 1).toUpperCase(), color: 'peach', portraitSrc: images.get(profile.id), ...profileVoiceMetadata(profile),
  })))
  const selected = $derived(voices.find(voice => voice.id === value))
  const uid = $props.id()
  $effect(() => {
    if (!ready) return
    let active = true
    void portraits.load(profiles).then(next => { if (active && !disposed) images = next })
    return () => { active = false }
  })
  $effect(() => { if (!ready || disabled) { open = false; stop(); languageController?.abort() } })
  function openPicker() { creationHint = false; languageNotice = ''; open = true }
  async function refreshLanguages() {
    languageNotice = ''; languageLoading = true
    languageController?.abort(); const current = new AbortController(); languageController = current
    try {
      await engineCatalog(current.signal)
    } catch (cause) {
      if (!current.signal.aborted && !disposed && !(cause instanceof Error && cause.name === 'AbortError')) languageNotice = 'Nie udało się odczytać języków modelu. Zachowano ostatnie dostępne dane.'
    } finally { if (languageController === current && !disposed) languageLoading = false }
  }
  function stop() {
    controller?.abort(); controller = undefined
    audio?.pause(); if (audio) audio.src = ''; audio = undefined
    if (url) URL.revokeObjectURL(url); url = ''
    playingId = ''; busyId = ''
  }
  function close() { open = false; stop(); languageController?.abort() }
  function choose(voice: Voice) { close(); onchange(voice.id) }
  async function preview(voice: Voice) {
    if (busyId === voice.id) { stop(); return }
    if (playingId === voice.id) { audio?.pause(); playingId = ''; return }
    if (!ready || disabled || disposed) throw new Error('Uruchom silnik, aby odsłuchać próbkę głosu.')
    stop()
    const current = new AbortController(); controller = current; busyId = voice.id
    try {
      const response = await request(`/profiles/${encodeURIComponent(voice.id)}/audio`, { signal: AbortSignal.any([current.signal, AbortSignal.timeout(15000)]) })
      if (!response.ok) throw new Error(`Nie można wczytać próbki głosu (${response.status}).`)
      const blob = await response.blob()
      current.signal.throwIfAborted()
      if (disposed || controller !== current) return
      if (!blob.type.startsWith('audio/')) throw new Error('Silnik nie zwrócił próbki audio.')
      url = URL.createObjectURL(blob)
      const player = new Audio(url); audio = player
      player.onplay = () => { if (!disposed && audio === player) playingId = voice.id }
      player.onpause = player.onended = () => { if (!disposed && audio === player) playingId = '' }
      await player.play()
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === 'AbortError')) throw cause
    } finally { if (controller === current) { controller = undefined; if (!disposed) busyId = '' } }
  }
  onDestroy(() => { disposed = true; stop(); languageController?.abort(); portraits.dispose() })
</script>

<div class="tool-workspace-section tool-voice-settings">
  <h2 id={`${uid}-label`}>{tr(String(label))}</h2>
  <Button variant="outline" class="tool-voice-trigger" disabled={disabled || !ready} aria-labelledby={`${uid}-label ${uid}-name`} aria-haspopup="dialog" aria-expanded={open} onclick={openPicker}>
    {#if selected}<VoiceAvatar voiceId={selected.id} name={selected.name} portraitSrc={selected.portraitSrc} size={28}/>{/if}
    <span id={`${uid}-name`} class="tool-voice-name">{selected?.name || (allowDefault ? defaultLabel : tr("Wybierz profil głosu"))}</span><ChevronDown size={15}/>
  </Button>
  {#if allowDefault && value}<Button variant="ghost" size="xs" class="tool-voice-default" disabled={disabled || !ready} onclick={() => onchange('')}>{tr("Użyj domyślnego głosu")}</Button>{/if}
  {#if creationHint}<p class="tool-workspace-note" role="status">{tr("Nowy profil dodasz w sekcji „Głosy” w nawigacji studia.")}</p>{/if}
</div>
{#if open}<VoicePicker {voices} modelLanguages={activeModel?.supported_language_names||[]} modelName={activeModel?.display_name||model?.active||''} onrefresh={refreshLanguages} {languageLoading} {languageNotice} selectedId={value} {ready} {playingId} {busyId} onselect={choose} onpreview={preview} onclose={close} oncreate={() => { close(); if (oncreate) oncreate(); else window.dispatchEvent(new Event('studio:create-voice')) }}/>{/if}

<style>
  :global(.tool-voice-trigger){justify-content:flex-start;gap:10px;min-height:42px;height:auto;width:100%;min-width:0;white-space:normal;text-align:left;font-size:var(--ui-font-size)}:global(.tool-voice-name){flex:1;min-width:0;overflow-wrap:anywhere}:global(.tool-voice-trigger>.voice-avatar-image){flex:0 0 auto}:global(.tool-voice-trigger>svg){margin-left:auto}:global(.tool-voice-default){align-self:flex-start;font-size:calc(var(--ui-font-size) * .92)}
</style>
