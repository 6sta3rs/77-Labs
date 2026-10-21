<script lang="ts">
  function uiOptions<T extends { label: string }>(items: readonly T[]): T[] { return items.map(item => ({ ...item, label: tr(item.label) })); }

  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import { onDestroy } from 'svelte';
  import { createVoice, transcribe, type Profile } from '../platform/api';
  import Select from '../ui/Select.svelte';
  import Input from '../ui/Input.svelte';
  import Textarea from '../ui/Textarea.svelte';
  import Button from '../ui/Button.svelte';
  import ReferenceAudioInput from './ReferenceAudioInput.svelte';
  import { profileLanguages } from './voice-reference';
  import '../tools/studio-tools.css';

  let { ready = true, oncreated, oncancel, onbusychange }: {
    ready?: boolean; oncreated: (profile: Profile) => void | Promise<void>; oncancel: () => void;
    onbusychange?: (busy: boolean) => void;
  } = $props();
  const uid = $props.id();
  let name = $state(''), language = $state('Polish'), reference = $state(''), file = $state<File>();
  let busy = $state(false), recording = $state(false), transcribing = $state(false), error = $state(''), message = $state('');
  let createdProfile = $state<Profile>();
  let controller: AbortController | undefined, disposed = false;
  $effect(() => { onbusychange?.(busy || transcribing || recording); });
  async function recognize() {
    if (!file || busy || recording || transcribing) return;
    const current = new AbortController(); controller = current; transcribing = true; error = ''; message = '';
    try {
      const result = await transcribe(file, 'reference', 'auto', current.signal);
      current.signal.throwIfAborted();
      if (!result.text.trim()) throw new Error('Nie rozpoznano słów. Wpisz tekst próbki lub wybierz wyraźniejsze nagranie.');
      reference = result.text; message = 'Rozpoznano tekst. Sprawdź, czy odpowiada nagraniu.';
    } catch (cause) { if (!disposed && !current.signal.aborted) error = (cause as Error).message; }
    finally { if (controller === current) { controller = undefined; if (!disposed) transcribing = false; } }
  }
  async function save() {
    if (!ready || !name.trim() || !file || busy || transcribing || recording) return;
    const current = new AbortController(); controller = current; busy = true; error = ''; message = '';
    try {
      const profile = createdProfile ?? await createVoice(name, file, reference, { language, signal: current.signal });
      current.signal.throwIfAborted();
      createdProfile = profile;
      await oncreated(profile);
    } catch (cause) { if (!disposed && !current.signal.aborted) error = `${createdProfile ? 'Głos został zapisany, ale nie można odświeżyć biblioteki. Spróbuj otworzyć go ponownie. ' : ''}${(cause as Error).message}`; }
    finally { if (controller === current) { controller = undefined; if (!disposed) busy = false; } }
  }
  function cancel() { controller?.abort(); oncancel(); }
  onDestroy(() => { disposed = true; controller?.abort(); onbusychange?.(false); });
</script>

<form class="voice-clone-form studio-tools" onsubmit={event => { event.preventDefault(); void save(); }}>
  <p class="page-footnote">{tr("Zapisz własny głos lub głos, do którego użycia masz zgodę. Możesz wczytać plik albo nagrać próbkę mikrofonem.")}</p>
  {#if !ready}<p class="tool-notice">{tr("Uruchom lokalny silnik, aby zapisać klon głosu.")}</p>{/if}
  <label for={`${uid}-name`}>{tr("Nazwa głosu")}</label><Input id={`${uid}-name`} bind:value={name} required disabled={busy || transcribing || !!createdProfile} autocomplete="off"/>
  <Select label={tr("Język nagrania")} value={language} onchange={value => language = value} options={uiOptions(profileLanguages)} disabled={busy || transcribing || !!createdProfile}/>
  <ReferenceAudioInput disabled={busy || transcribing || !!createdProfile} onchange={next => { file = next; if (!next) reference = ''; error = ''; message = ''; }} onrecordingchange={value => recording = value}/>
  <label for={`${uid}-text`}>{tr("Tekst wypowiedziany w próbce")}</label><Textarea id={`${uid}-text`} rows={3} bind:value={reference} disabled={busy || transcribing || recording || !!createdProfile} placeholder={tr("Dokładne słowa z nagrania, bez instrukcji dla modelu.")}/>
  <div class="tool-actions"><Button variant="outline" disabled={!ready || !file || busy || transcribing || recording || !!createdProfile} onclick={recognize}>{transcribing ? 'Rozpoznawanie mowy…' : 'Rozpoznaj tekst z nagrania'}</Button></div>
  <p class="page-footnote">{tr("Dokładny tekst referencji pomaga zachować poprawne brzmienie. Przy pustym polu silnik spróbuje lokalnej transkrypcji podczas zapisu. Nie pobiera w tym celu brakującego modelu ASR.")}</p>
  {#if error}<p class="tool-error" role="alert">{tr(error)}</p>{/if}{#if message}<p class="tool-notice" role="status">{tr(message)}</p>{/if}
  <div class="tool-actions"><Button type="submit" disabled={!ready || !name.trim() || !file || busy || transcribing || recording}>{busy ? createdProfile ? tr("Odświeżanie biblioteki…") : tr("Zapisywanie głosu…") : createdProfile ? tr("Otwórz zapisany głos") : tr("Zapisz klon głosu")}</Button><Button variant="outline" onclick={cancel}>{busy || transcribing ? tr("Anuluj i wróć") : tr("Anuluj")}</Button></div>
  {#if busy}<p class="page-footnote" role="status">{tr("Przesyłanie próbki i przygotowanie profilu. Przy automatycznej transkrypcji pierwsze wykonanie może potrwać dłużej.")}</p>{/if}
</form>

<style>.voice-clone-form{display:grid;gap:12px;min-width:0}.voice-clone-form>p{margin:0}.voice-clone-form .page-footnote{font-size:.95em;color:var(--foreground)}.voice-clone-form .tool-actions{flex-wrap:wrap}</style>
