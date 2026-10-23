<script lang="ts">
  import { userMessage } from '../../platform/user-message';
  import { uiLanguage, createUiTranslator } from "../../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import '../../ui/document-editor.css'
  import Button from '../../ui/Button.svelte';
  import { onDestroy, untrack } from 'svelte'
  import { Mic, Square, RefreshCw, Download, Copy, Save } from '@lucide/svelte'
  import ToolWorkspace from '../ToolWorkspace.svelte'
  import Select from '../../ui/Select.svelte'
  import { productionJson, postJson } from '../production/production'
  import { saveTextFile } from '../studio-tools'
  import { acquireRuntime, isDesktop } from '../../platform/runtime'
  import { remoteBackend } from '../../platform/remote-backend'
  import { LiveDictation, emptyDictation, type DictationCatalog, type DictationPhase, type DictationTranscript } from './dictation'
  import workletUrl from './dictation-worklet.js?url&no-inline'

  let { ready, ontext }: { ready: boolean; ontext?: (text: string) => void } = $props()
  const uid = $props.id()
  let catalog = $state<DictationCatalog>(), selected = $state(''), defaultModel = $state('')
  let phase = $state<DictationPhase>('idle'), transcript = $state<DictationTranscript>(emptyDictation()), text = $state('')
  let loading = $state(false), preparing = $state(false), saving = $state(false), error = $state(''), message = $state(''), level = $state(0), seconds = $state(0)
  let tab = $state<'settings' | 'history'>('settings'), sessions = $state<Array<{ id: string; text: string; complete: boolean; created: string; engine: string }>>([])
  let session: LiveDictation | undefined, controller: AbortController | undefined, startController: AbortController | undefined, releaseLease: (() => Promise<void>) | undefined
  let clock: ReturnType<typeof setInterval> | undefined, disposed = false
  const active = $derived(preparing || ['connecting', 'loading', 'microphone', 'listening', 'finishing'].includes(phase))
  const model = $derived(catalog?.models.find(row => row.id === selected))
  const available = $derived(ready && catalog?.engine_available === true && model?.installed === true)
  const labels: Record<DictationPhase, string> = { idle: 'Gotowe do rozpoczęcia', connecting: 'Łączenie z lokalnym silnikiem…', loading: 'Przygotowywanie modelu…', microphone: 'Oczekiwanie na dostęp do mikrofonu…', listening: 'Mikrofon włączony · dyktuj', finishing: 'Mikrofon wyłączony · oczekiwanie na podsumowanie…', complete: 'Sesja zakończona', error: 'Sesja przerwana' }

  function fail(cause: unknown) { if (!disposed && !(cause instanceof Error && cause.name === 'AbortError')) error = userMessage(cause, 'Operacja dyktowania nie powiodła się. Spróbuj ponownie.') }
  function release() { const lease = releaseLease; releaseLease = undefined; if (lease) void lease().catch(fail) }
  function archive() { if (text.trim()) sessions = [{ id: crypto.randomUUID(), text, complete: transcript.complete, created: new Date().toISOString(), engine: transcript.engine }, ...sessions].slice(0, 20) }
  async function refresh() {
    if (!ready || active || loading || disposed) return
    controller?.abort(); const abort = new AbortController(); controller = abort; loading = true; error = ''
    try {
      const [models, prefs] = await Promise.all([productionJson<DictationCatalog>('/dictation/models', { signal: abort.signal }), productionJson<{ model_id: string }>('/dictation/prefs', { signal: abort.signal })])
      abort.signal.throwIfAborted(); if (disposed) return
      catalog = models; defaultModel = prefs.model_id
      if (!selected || !models.models.some(row => row.id === selected)) selected = models.models.some(row => row.id === prefs.model_id) ? prefs.model_id : models.default_model_id
    } catch (cause) { if (!abort.signal.aborted) fail(cause) }
    finally { if (controller === abort && !disposed) loading = false }
  }
  async function saveDefault() {
    if (!available || active || saving) return
    saving = true; error = ''
    try {
      const result = await productionJson<{ model_id: string }>('/dictation/prefs', postJson({ model_id: selected, enabled: true }))
      if (disposed) return
      defaultModel = result.model_id; message = 'Zapisano domyślny model dyktowania.'
    } catch (cause) { fail(cause) }
    finally { if (!disposed) saving = false }
  }
  async function start() {
    if (!available || active || loading || saving || disposed) return
    archive(); session?.cancel(); release(); transcript = emptyDictation(); text = ''; seconds = 0; level = 0; error = ''; message = 'Nowa sesja nie odtwarza audio pominiętego podczas poprzedniego rozłączenia.'; preparing = true
    const abort = new AbortController(); startController = abort
    try {
      releaseLease = await acquireRuntime(abort.signal)
      const state = await productionJson<{ ready: boolean; missing?: { message?: string } }>(`/dictation/readiness?purpose=dictation&model_id=${encodeURIComponent(selected)}`, { signal: abort.signal })
      abort.signal.throwIfAborted()
      if (!state.ready) throw new Error(state.missing?.message || 'Wybrany model dyktowania nie jest gotowy. Zainstaluj go w „Modele” i odśwież katalog.')
      const next = new LiveDictation({
        transcript: value => { if (!disposed) { transcript = value; text = value.text; if (value.error) error = value.error } },
        phase: value => {
          if (disposed) return
          phase = value
          if (value === 'listening') { const started = Date.now(); clearInterval(clock); clock = setInterval(() => seconds = Math.floor((Date.now() - started) / 1000), 500) }
          if (['complete', 'error', 'idle', 'finishing'].includes(value)) { clearInterval(clock); clock = undefined; level = 0 }
          if (value === 'complete' || value === 'error') release()
        },
        activity: rms => { if (!disposed) level = Math.min(1, rms * 4) },
      }); session = next
      const connection = await remoteBackend.state(abort.signal)
      await next.start({ model: selected, desktop: isDesktop(), origin: location.origin, workletUrl, remote: connection.active })
      if (abort.signal.aborted || disposed) next.cancel()
    } catch (cause) { if (!abort.signal.aborted) { phase = 'error'; fail(cause) }; release() }
    finally { if (!disposed) preparing = false; if (startController === abort) startController = undefined }
  }
  function cancel() {
    startController?.abort(); session?.cancel(); preparing = false; phase = 'idle'; clearInterval(clock); clock = undefined; level = 0; release()
    message = 'Przerwano sesję bez podsumowania. Zachowano potwierdzone zdania i podgląd; wynik może być niepełny.'
  }
  async function copy() { try { await navigator.clipboard.writeText(text); message = 'Skopiowano tekst.' } catch { error = 'Nie udało się skopiować tekstu. Zaznacz go ręcznie lub pobierz TXT.' } }
  $effect(() => { if (ready) untrack(() => { void refresh() }); else untrack(() => { controller?.abort(); if (active) cancel() }) })
  onDestroy(() => { disposed = true; controller?.abort(); startController?.abort(); session?.cancel(); clearInterval(clock); release() })
</script>

<ToolWorkspace title={tr("Dyktowanie na żywo")} description={tr("Mów do mikrofonu i odczytuj wynik z lokalnego silnika w trakcie sesji.")} bind:tab historyCount={sessions.length}>
  {#snippet content()}
    <div class="dictation-content">
      <div class="dictation-session" class:listening={phase === 'listening'}><Mic size={27}/><strong role="status">{preparing && phase === 'idle' ? tr("Sprawdzanie gotowości…") : labels[phase]}</strong><span>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} {tr("· limit 10 minut")}</span><meter min="0" max="1" value={level} aria-label={tr("Poziom sygnału mikrofonu")}></meter>
        {#if phase === 'listening'}<Button variant="default" onclick={() => void session?.stop()}><Square size={14}/>{tr("Zatrzymaj i zakończ")}</Button>{:else if active}<Button variant="outline" onclick={cancel}>{tr("Anuluj sesję")}</Button>{:else}<Button variant="default" disabled={!available || loading || saving} onclick={start}><Mic size={15}/>{phase === 'error' || phase === 'complete' ? tr("Rozpocznij nową sesję") : 'Rozpocznij dyktowanie'}</Button>{/if}
      </div>
      {#if transcript.stage && active}<p class="tool-workspace-note" role="status">{transcript.stage === 'loading' ? tr("Silnik ładuje model. Pierwszy wynik może pojawić się później.") : transcript.stage === 'downloading' ? tr("Silnik zgłasza pobieranie modelu.") : transcript.stage === 'ready' ? tr("Silnik potwierdził gotowość modelu.") : transcript.stage}</p>{/if}
      {#if !ready}<p class="tool-workspace-note" role="status">{tr("Uruchom silnik w ustawieniach „Silnik”, aby rozpocząć lokalne dyktowanie.")}</p>{/if}
      <label class="dictation-label" for={`${uid}-text`}>{tr("Potwierdzony tekst")}{transcript.complete ? ' · podsumowanie sesji' : ''}</label>
      <textarea id={`${uid}-text`} class="dictation-editor vs-document-editor" bind:value={text} readonly={active} placeholder={tr("Potwierdzone wypowiedzi pojawią się tutaj. Po zakończeniu możesz poprawić tekst.")}></textarea>
      {#if transcript.partial}<div class="dictation-partial" aria-label={tr("Niepotwierdzony podgląd")}><strong>{tr("Rozpoznawanie · podgląd")}</strong><p aria-live="polite">{transcript.partial}</p><small>{tr("Ten fragment może się zmienić. Poczekaj na potwierdzenie lub podsumowanie.")}</small></div>{/if}
      {#if transcript.refinedText && transcript.refinedText !== text}<details><summary>{tr("Propozycja korekty z konfiguracji silnika")}</summary><p class="dictation-refined">{transcript.refinedText}</p><Button variant="outline" disabled={active} onclick={() => { text = transcript.refinedText; message = tr("Zastosowano propozycję korekty.") }}>{tr("Użyj poprawionej wersji")}</Button></details>{/if}
      {#if transcript.engine}<p class="tool-workspace-note">{tr("Silnik wyniku:")} {transcript.engine}{transcript.language && transcript.language !== 'auto' ? ` · ${transcript.language.toUpperCase()}` : ''}</p>{/if}
      {#if transcript.warning}<p class="dictation-warning" role="status">{transcript.warning}</p>{/if}
      {#if error}<p class="dictation-error" role="alert">{tr(String(error))}</p>{/if}
      {#if message}<p class="tool-workspace-note" role="status">{tr(String(message))}</p>{/if}
      <p class="tool-workspace-note">{tr("Połączenie jest lokalne. Po utracie połączenia rozpocznij nową sesję i powtórz pominięte zdania. Tekst i historia tego narzędzia pozostają w pamięci widoku — pobierz TXT, aby je zachować. W aplikacji Windows skrót globalny i pływające okno włączysz w Ustawieniach → Skróty klawiaturowe. Wklejenie tekstu wymaga osobnego włączenia i kliknięcia.")}</p>
    </div>
  {/snippet}
  {#snippet settings()}
    <section class="tool-workspace-section"><h2>{tr("Model dyktowania")}</h2><Button variant="outline" disabled={!ready || active || loading} onclick={refresh}><RefreshCw size={14}/>{loading ? 'Wczytywanie…' : tr("Odśwież modele")}</Button>
      {#if catalog}<Select label={tr("Lokalny model")} value={selected} onchange={value => { selected = value; error = '' }} options={catalog.models.map(row => ({ value: row.id, label: `${row.label}${row.installed ? '' : ' · niepobrany'}`, disabled: !row.installed || !catalog?.engine_available }))} disabled={active || loading}/>{/if}
      {#if model}<p class="tool-workspace-note">{model.tag === 'streaming' ? 'Model strumieniowy' : tr("Model okienkowy · wynik cząstkowy zależy od czasu rozpoznania")} · {Array.isArray(model.languages) ? model.languages.join(', ') : model.languages}{model.size_gb ? " " + tr("· około {arg0} GB", { arg0: String(model.size_gb) }) : ''}</p><p class="tool-workspace-note repository">{model.repo_id}</p>{/if}
      {#if catalog && !catalog.engine_available}<p class="dictation-error" role="alert">{catalog.engine_reason || tr("Silnik dyktowania nie jest zainstalowany. Sprawdź ustawienia modeli.")}</p>{/if}
      {#if model && !model.installed}<p class="tool-workspace-note">{tr("Pobierz ten model w „Modele”, a potem odśwież katalog. Rozpoczęcie sesji nie uruchamia ukrytego pobierania.")}</p>{/if}
      <Button variant="outline" disabled={!available || active || saving || selected === defaultModel} onclick={saveDefault}><Save size={14}/>{saving ? 'Zapisywanie…' : selected === defaultModel ? tr("Domyślny model") : tr("Ustaw jako domyślny")}</Button>
    </section>
    <section class="tool-workspace-section"><h2>{tr("Odbiór tekstu")}</h2><p class="tool-workspace-note">{tr("Podgląd cząstkowy może się zmieniać. Potwierdzone zdania są uzupełniane w trakcie mówienia. Końcowe podsumowanie zastępuje tekst sesji, aby nie powielać wypowiedzi.")}</p><p class="tool-workspace-note">{tr("Przycisk „Zatrzymaj i zakończ” wyłącza mikrofon i czeka na końcowy wynik. „Anuluj sesję” zamyka połączenie bez takiej gwarancji.")}</p></section>
  {/snippet}
  {#snippet history()}
    <p class="tool-workspace-note">{tr("Do 20 poprzednich sesji w pamięci tego widoku. Pobieraj TXT przed zamknięciem narzędzia.")}</p>
    {#each sessions as row (row.id)}<article class="tool-workspace-history-item"><strong>{new Date(row.created).toLocaleString(tr.locale)}</strong><small>{row.complete ? tr("Z końcowym podsumowaniem") : 'Sesja bez podsumowania'}{row.engine ? ` · ${row.engine}` : ''}</small><p class="dictation-history-text">{row.text}</p><Button variant="outline" onclick={() => saveTextFile(row.text, 'dyktowanie.txt', 'text/plain;charset=utf-8')}><Download size={14}/>{tr("Pobierz TXT")}</Button></article>{/each}
    {#if !sessions.length}<p class="tool-workspace-empty">{tr("Poprzedni wynik trafi tutaj przy rozpoczęciu nowej sesji.")}</p>{/if}
  {/snippet}
  {#snippet actions()}
    <span class="tool-workspace-note">{text.length.toLocaleString(tr.locale)} {tr("znaków")}{transcript.complete ? " " + tr("· wynik końcowy") : ''}</span><div class="dictation-actions"><Button variant="outline" disabled={!text.trim() || active} onclick={copy}><Copy size={14}/>{tr("Kopiuj")}</Button><Button variant="outline" disabled={!text.trim() || active} onclick={() => saveTextFile(text, 'dyktowanie.txt', 'text/plain;charset=utf-8')}><Download size={14}/>{tr("TXT")}</Button>{#if ontext}<Button variant="default" disabled={!text.trim() || active} onclick={() => ontext?.(text)}>{tr("Otwórz w edytorze")}</Button>{/if}</div>
  {/snippet}
</ToolWorkspace>

<style>
  .dictation-content{display:flex;flex-direction:column;gap:18px;min-width:0}.dictation-session{display:flex;flex-direction:column;align-items:center;gap:14px;padding:28px;border:1px solid var(--border);border-radius:12px;background:var(--surface);text-align:center}.dictation-session.listening{border-color:var(--foreground)}.dictation-session>strong{font-size:var(--ui-text-14);font-weight:500}.dictation-session>span{font-size:var(--ui-text-11);color:var(--muted);font-variant-numeric:tabular-nums}.dictation-session>meter{width:180px;max-width:100%;height:8px;accent-color:var(--foreground)}.dictation-label{font-size:var(--ui-text-12);color:var(--muted)}.dictation-editor{display:block;width:100%;min-height:260px;resize:vertical;border:0;padding:8px 0;background:transparent;color:var(--foreground);font-family:var(--font-editor);font-size:16px;line-height:1.9}.dictation-partial{padding:16px;border:1px dashed var(--border);border-radius:8px;color:var(--muted);font-size:var(--ui-text-13);line-height:1.8}.dictation-partial>strong{font-size:var(--ui-text-11);font-weight:500}.dictation-partial>p{margin:8px 0;white-space:pre-wrap}.dictation-partial>small{font-size:var(--ui-text-10)}.dictation-error,.dictation-warning{font-size:var(--ui-text-12);line-height:1.8;overflow-wrap:anywhere}.dictation-error{color:var(--danger)}.dictation-warning{color:var(--muted)}.dictation-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.dictation-history-text,.dictation-refined{white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--ui-text-12);line-height:1.8}.repository{overflow-wrap:anywhere}summary{cursor:pointer;font-size:var(--ui-text-12)}
</style>
