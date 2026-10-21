<script lang="ts">
  import './ui/document-editor.css'
  import Button from './ui/Button.svelte';
  import { onDestroy, onMount } from 'svelte'
  import { FileAudio, Upload, Download, LoaderCircle, X, Mic, Square, Trash2, ChevronLeft, ChevronRight } from '@lucide/svelte'
  import ToolWorkspace from './ToolWorkspace.svelte'
  import ToolModelSettings from './ToolModelSettings.svelte'
  import Select from './ui/Select.svelte'
  import Switch from './ui/Switch.svelte'
  import { transcribe } from './api'
  import { productionJson } from './production'
  import { saveTextFile } from './studio-tools'
  import { audioFileError, exportTranscription, microphoneError, normalizeTranscription, readTranscriptionHistory, refinementNotice, saveTranscriptionHistory, segmentError, transcriptionOutputText, transcriptText, MICROPHONE_LIMIT_MS, TRANSCRIPTION_FILE_BYTES, type TranscriptionRefinement, type TranscriptionResult, type TranscriptionSegment } from './transcription'

  let { ready, ontext }: { ready: boolean; ontext: (text: string) => void } = $props()
  const uid = $props.id()
  const pageSize = 20
  let file = $state<File>(), sourceUrl = $state(''), text = $state(''), segments = $state<TranscriptionSegment[]>([])
  let language = $state('auto'), mode = $state('accurate'), resultLanguage = $state('auto')
  let refine = $state(false), refinement = $state<TranscriptionRefinement>()
  let busy = $state(false), modelBusy = $state(false), error = $state(''), message = $state(''), saved = $state(''), saveFailed = $state(false)
  let results = $state<TranscriptionResult[]>([]), currentId = $state(''), tab = $state<'settings' | 'history'>('settings'), dragging = $state(false), page = $state(0)
  let microphone = $state<'idle' | 'requesting' | 'recording' | 'stopping'>('idle'), recordedSeconds = $state(0)
  let fastReady = $state<boolean>(), readinessNotice = $state('')
  let input: HTMLInputElement | undefined, controller: AbortController | undefined, readinessController: AbortController | undefined, disposed = false
  let recorder: MediaRecorder | undefined, microphoneStream: MediaStream | undefined, recordingTimer: ReturnType<typeof setInterval> | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined, storage: Storage | undefined, historyWritable = false, micRevision = 0
  const capturing = $derived(microphone !== 'idle')
  const locked = $derived(busy || modelBusy || !ready || capturing)
  const canonicalText = $derived(transcriptText(segments, text))
  const outputText = $derived(transcriptionOutputText(text, segments, refinement))
  const refinementMessage = $derived(refinementNotice(refinement))
  const timingError = $derived(segmentError(segments))
  const pages = $derived(Math.max(1, Math.ceil(segments.length / pageSize)))
  const modeOptions = $derived([
    { value: 'accurate', label: 'Dokładny · czasy, jeśli model je zwraca' },
    { value: 'reference', label: 'Tekst referencyjny' },
    { value: 'fast', label: fastReady === false ? 'Szybki · model niedostępny' : 'Szybki · model dyktowania', disabled: fastReady === false },
  ])

  function releaseSource() { if (sourceUrl) URL.revokeObjectURL(sourceUrl); sourceUrl = '' }
  function choose(next?: File) {
    if (!next || busy || capturing) return
    const invalid = audioFileError(next)
    if (invalid) { error = invalid; return }
    flushSave(); releaseSource()
    file = next; sourceUrl = URL.createObjectURL(next); error = ''; message = ''; text = ''; segments = []; refinement = undefined; currentId = ''; page = 0; saved = ''; saveFailed = false
  }
  function clear() {
    if (busy || capturing) return
    flushSave(); releaseSource()
    file = undefined; text = ''; segments = []; refinement = undefined; currentId = ''; message = ''; error = ''; saved = ''; page = 0
    if (input) input.value = ''
  }
  function persist() {
    if (!storage || !historyWritable) { results = results.slice(0, 20); saved = 'Brak zapisu historii. Pobierz tekst lub napisy, aby zachować wynik.'; saveFailed = true; return }
    try {
      const result = saveTranscriptionHistory(storage, results)
      results = result.results
      saved = result.removed ? `Zapisano na tym urządzeniu. Limit 20 wyników / 1 MB: usunięto ${result.removed} najstarszych zapisów.` : 'Zapisano na tym urządzeniu.'
      saveFailed = false
    } catch (cause) {
      results = results.slice(0, 20)
      saved = cause instanceof Error && cause.name === 'QuotaExceededError' ? 'Brak miejsca na historię. Wynik jest w pamięci; pobierz tekst lub napisy.' : cause instanceof Error ? cause.message : 'Nie udało się zapisać historii. Pobierz wynik, aby go zachować.'
      saveFailed = true
    }
  }
  function flushSave() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined; persist() } }
  function changed() {
    if (!currentId) return
    if (timingError) { clearTimeout(saveTimer); saveTimer = undefined; saved = 'Popraw czasy i tekst segmentów, aby zapisać zmiany.'; saveFailed = true; return }
    const now = new Date().toISOString()
    const previous = results.find(row => row.id === currentId)
    if (previous) results = [{ ...previous, text: canonicalText, segments: segments.map(segment => ({ ...segment })), refinement: refinement ? { ...refinement } : undefined, updated: now }, ...results.filter(row => row.id !== currentId)]
    saved = 'Zapisywanie zmian…'; saveFailed = false
    clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveTimer = undefined; persist() }, 300)
  }
  function changeSegment(index: number, patch: Partial<TranscriptionSegment>) { segments = segments.map((row, i) => i === index ? { ...row, ...patch } : row); changed() }
  function applyRefinement(applied: boolean) {
    if (busy || capturing || refinement?.status !== 'suggested') return
    refinement = { ...refinement, applied }; changed()
  }
  function removeSegment(index: number) {
    segments = segments.filter((_, i) => i !== index)
    if (!segments.length) text = ''
    page = Math.min(page, Math.max(0, Math.ceil(segments.length / pageSize) - 1)); changed()
  }
  async function run() {
    if (!file || locked) return
    if (mode === 'fast' && fastReady === false) { error = 'Model trybu szybkiego nie jest gotowy. Wybierz inny tryb lub zainstaluj model dyktowania.'; return }
    flushSave()
    const current = new AbortController(); controller = current
    const source = file, selectedMode = mode, selectedRefine = refine
    busy = true; error = ''; message = ''
    try {
      const result = normalizeTranscription(await transcribe(source, selectedMode, language, current.signal, { refine: selectedRefine }), selectedRefine)
      current.signal.throwIfAborted()
      if (disposed) return
      text = result.text; segments = result.segments; refinement = result.refinement; resultLanguage = result.language; page = 0
      const now = new Date().toISOString()
      const row: TranscriptionResult = { id: crypto.randomUUID(), name: source.name, text, segments: segments.map(segment => ({ ...segment })), ...(refinement ? { refinement: { ...refinement } } : {}), language: resultLanguage, mode: selectedMode, created: now, updated: now }
      currentId = row.id; results = [row, ...results]; persist()
      message = result.warning || (canonicalText.trim() ? `Rozpoznano tekst${resultLanguage !== 'auto' ? ` · ${resultLanguage.toUpperCase()}` : ''}. Możesz poprawić treść i czasy przed eksportem.` : 'Nie rozpoznano mowy. Sprawdź nagranie lub wybierz inny tryb.')
    } catch (cause) {
      if (!disposed) {
        if (current.signal.aborted) message = 'Przerwano oczekiwanie. Silnik może nadal kończyć rozpoznawanie.'
        else error = cause instanceof Error ? cause.message : String(cause)
      }
    } finally { if (controller === current) { controller = undefined; if (!disposed) busy = false } }
  }
  function restore(result: TranscriptionResult) {
    if (busy || capturing) return
    flushSave(); releaseSource(); file = undefined; if (input) input.value = ''
    currentId = result.id; text = result.text; segments = result.segments.map(segment => ({ ...segment })); refinement = result.refinement ? { ...result.refinement } : undefined; resultLanguage = result.language; page = 0
    message = `Otworzono wynik: ${result.name}. Historia zawiera tekst i czasy; nagranie źródłowe nie jest zapisywane.`; error = ''; saved = 'Otworzono zapis z tego urządzenia.'; saveFailed = false; tab = 'settings'
  }
  function deleteResult(id: string) {
    const row = results.find(result => result.id === id)
    if (!row || busy || capturing || !confirm(`Usunąć zapis transkrypcji „${row.name}”? Plik źródłowy nie zostanie usunięty.`)) return
    flushSave(); results = results.filter(result => result.id !== id)
    if (currentId === id) currentId = ''
    persist()
  }
  function exportText(format: 'txt' | 'srt' | 'vtt') {
    try {
      const output = exportTranscription(text, segments, format, refinement)
      saveTextFile(output, `transkrypcja.${format}`, format === 'vtt' ? 'text/vtt;charset=utf-8' : 'text/plain;charset=utf-8')
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
  }
  function stopTracks() { microphoneStream?.getTracks().forEach(track => track.stop()); microphoneStream = undefined; clearInterval(recordingTimer); recordingTimer = undefined }
  function stopRecording() { if (recorder?.state === 'recording') { microphone = 'stopping'; recorder.stop(); stopTracks() } }
  async function startRecording() {
    if (busy || capturing || modelBusy) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { error = 'Ten widok nie obsługuje nagrywania mikrofonu. Otwórz aplikację desktopową lub bezpieczny adres localhost; możesz też wczytać plik audio.'; return }
    const revision = ++micRevision
    microphone = 'requesting'; error = ''; message = ''
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (disposed || revision !== micRevision) { stream.getTracks().forEach(track => track.stop()); return }
      microphoneStream = stream
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type))
      const next = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); recorder = next
      const chunks: Blob[] = []; let bytes = 0, failed = false
      next.ondataavailable = event => {
        if (!event.data.size || failed) return
        bytes += event.data.size
        if (bytes > TRANSCRIPTION_FILE_BYTES) { failed = true; error = 'Nagranie przekroczyło 64 MB. Nagraj krótszy fragment.'; stopRecording(); return }
        chunks.push(event.data)
      }
      next.onerror = () => { failed = true; error = 'Nagrywanie zostało przerwane przez urządzenie. Spróbuj ponownie lub wczytaj gotowy plik.'; microphone = 'stopping'; stopRecording(); stopTracks() }
      next.onstop = () => {
        stopTracks(); recorder = undefined
        if (disposed) return
        microphone = 'idle'
        if (failed) return
        const blob = new Blob(chunks, { type: next.mimeType || mime || 'audio/webm' })
        const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'
        const source = new File([blob], `mikrofon-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`, { type: blob.type })
        choose(source)
        if (!source.size) { error = 'Mikrofon nie zapisał dźwięku. Sprawdź urządzenie i spróbuj ponownie.'; return }
        message = 'Nagranie zapisano w pamięci tego widoku. Możesz je odtworzyć lub pobrać.'
        if (ready && !modelBusy) void run()
      }
      next.start(1000); microphone = 'recording'; recordedSeconds = 0
      const started = Date.now()
      recordingTimer = setInterval(() => { recordedSeconds = Math.floor((Date.now() - started) / 1000); if (Date.now() - started >= MICROPHONE_LIMIT_MS) stopRecording() }, 250)
    } catch (cause) { stopTracks(); recorder = undefined; if (!disposed && revision === micRevision) { microphone = 'idle'; error = microphoneError(cause) } }
  }
  onMount(() => {
    try { storage = localStorage; const history = readTranscriptionHistory(storage); results = history.results; historyWritable = true; saved = history.warning }
    catch (cause) { saveFailed = true; saved = cause instanceof Error ? cause.message : 'Historia jest niedostępna w tym widoku. Pobieraj wyniki, aby je zachować.' }
    const flush = () => flushSave()
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  })
  $effect(() => { if (!ready) controller?.abort() })
  $effect(() => {
    if (!ready) { fastReady = undefined; readinessNotice = ''; return }
    const abort = new AbortController(); readinessController = abort
    void productionJson<{ ready: boolean; missing?: { message?: string } }>('/dictation/readiness?purpose=dictation', { signal: abort.signal }).then(result => {
      if (!disposed && !abort.signal.aborted) { fastReady = result.ready; readinessNotice = result.ready ? '' : 'Tryb szybki wymaga instalacji modelu dyktowania. Tryby dokładny i referencyjny korzystają z wybranego ASR.' }
    }).catch(cause => { if (!disposed && !abort.signal.aborted) readinessNotice = `Nie sprawdzono modelu trybu szybkiego. ${cause instanceof Error ? cause.message : ''}` })
    return () => abort.abort()
  })
  onDestroy(() => { flushSave(); disposed = true; micRevision++; controller?.abort(); readinessController?.abort(); if (recorder) { recorder.onstop = null; recorder.ondataavailable = null; recorder.onerror = null; if (recorder.state !== 'inactive') recorder.stop() }; stopTracks(); releaseSource() })
</script>

<ToolWorkspace title="Mowa na tekst" description="Wczytaj plik lub nagraj mikrofon, popraw tekst i przygotuj napisy." bind:tab historyCount={results.length}>
  {#snippet content()}
    <div class="transcription-content">
      {#if !ready}<p class="transcription-notice" role="status">Uruchom lokalny silnik w „Modele i silnik”, aby rozpoznać mowę. Nagrywanie mikrofonu jest dostępne bez silnika.</p>{/if}
      <label class="transcription-source" class:dragging class:has-file={Boolean(file)} class:disabled={busy || capturing}
        ondragover={event => { event.preventDefault(); if (!busy && !capturing) dragging = true }} ondragleave={() => dragging = false}
        ondrop={event => { event.preventDefault(); dragging = false; choose(event.dataTransfer?.files[0]) }}>
        <span class="source-icon">{#if file}<FileAudio size={23}/>{:else}<Upload size={23}/>{/if}</span>
        <strong>{file?.name || 'Kliknij, aby wybrać nagranie, lub przeciągnij je tutaj'}</strong>
        <span>{file ? `${(file.size / 1024 / 1024).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} MB` : 'WAV, MP3, M4A, OGG lub FLAC · do 64 MB'}</span>
        <input bind:this={input} type="file" aria-label="Nagranie do transkrypcji" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac,.opus,.webm" disabled={busy || capturing} onchange={event => choose(event.currentTarget.files?.[0])}/>
      </label>
      <div class="microphone-row">
        {#if microphone === 'recording'}<Button variant="outline" class=" recording" onclick={stopRecording}><Square size={14}/>{ready ? 'Zatrzymaj i przepisz' : 'Zatrzymaj nagranie'}</Button><span role="status">Nagrywanie · {Math.floor(recordedSeconds / 60)}:{String(recordedSeconds % 60).padStart(2, '0')}</span>
        {:else if capturing}<span class="transcription-notice" role="status"><LoaderCircle size={14} class="spin"/>{microphone === 'requesting' ? 'Oczekiwanie na zgodę na mikrofon…' : 'Kończenie nagrania…'}</span>{#if microphone === 'requesting'}<Button variant="ghost" onclick={() => { micRevision++; microphone = 'idle'; message = 'Anulowano oczekiwanie na mikrofon.' }}>Anuluj</Button>{/if}
        {:else}<Button variant="outline" disabled={busy || modelBusy} onclick={startRecording}><Mic size={15}/>Nagraj mikrofon</Button>{/if}
      </div>
      <p class="tool-workspace-note">Transkrypcja mikrofonu zaczyna się po zatrzymaniu nagrania. Limit: 10 minut / 64 MB. Dyktowanie na żywo znajdziesz w osobnym narzędziu „Dyktowanie”; skrót globalny i pływające okno wymagają osobnego włączenia w aplikacji desktopowej.</p>
      {#if sourceUrl}<div class="source-preview"><audio controls src={sourceUrl} preload="metadata"></audio><Button variant="ghost" size="icon" href={sourceUrl} download={file?.name || 'nagranie.webm'} aria-label="Pobierz nagranie źródłowe"><Download size={16}/></Button><Button variant="ghost" size="icon" disabled={busy || capturing} aria-label="Usuń nagranie z tego widoku" onclick={clear}><X size={16}/></Button></div>{/if}
      {#if refinement?.status === 'suggested'}
        <section class="tool-workspace-section" aria-label="Porównanie redakcji LLM">
          <h2>Redakcja tekstu przez LLM</h2>
          <label for={`${uid}-original`}>Oryginał rozpoznania</label>
          <textarea id={`${uid}-original`} class="transcription-editor transcript-summary vs-document-editor" value={refinement.originalText} readonly></textarea>
          <label for={`${uid}-refined`}>Propozycja po redakcji</label>
          <textarea id={`${uid}-refined`} class="transcription-editor transcript-summary vs-document-editor" value={refinement.refinedText} readonly></textarea>
          <p class="tool-workspace-note">Sprawdź, czy redakcja zachowała znaczenie wypowiedzi. Możesz użyć jej w TXT i edytorze. Napisy SRT/VTT nadal korzystają z tekstu i czasów segmentów poniżej; redakcja nie ma przypisanych czasów.</p>
          <div class="transcription-actions">{#if refinement.applied}<Button variant="outline" disabled={busy || capturing} onclick={() => applyRefinement(false)}>Cofnij użycie redakcji</Button>{:else}<Button variant="outline" disabled={busy || capturing} onclick={() => applyRefinement(true)}>Użyj redakcji w TXT i edytorze</Button>{/if}</div>
          <p class="tool-workspace-note" role="status">{refinement.applied ? 'TXT i edytor używają propozycji po redakcji. Poprawki transkrypcji poniżej nadal są zapisywane; cofnięcie wróci do ich aktualnej wersji.' : 'TXT i edytor używają bieżącego tekstu transkrypcji. Propozycja nie została zastosowana.'}</p>
        </section>
      {/if}
      {#if refinementMessage}<p class="transcription-notice" role="status">{refinementMessage}</p>{/if}
      <div class="transcription-label"><label for={`${uid}-text`}>{segments.length ? 'Tekst z segmentów' : 'Transkrypcja'}</label><span>{canonicalText.length.toLocaleString('pl-PL')} znaków</span></div>
      {#if segments.length}
        <textarea id={`${uid}-text`} class="transcription-editor transcript-summary vs-document-editor" value={canonicalText} readonly aria-describedby={`${uid}-segment-help`}></textarea>
        <p id={`${uid}-segment-help`} class="tool-workspace-note">Popraw tekst i czasy w segmentach poniżej. {refinement?.applied ? 'SRT i VTT korzystają z tych zmian; TXT używa wybranej propozycji po redakcji.' : 'TXT, SRT i VTT korzystają z tych samych zmian.'} Czasy podano w sekundach.</p>
        <div class="transcription-segments">
          {#each segments.slice(page * pageSize, (page + 1) * pageSize) as segment, offset}
            {@const index = page * pageSize + offset}
            <article class="transcription-segment"><header><strong>Segment {index + 1}</strong><Button variant="ghost" size="icon" disabled={busy || capturing} aria-label={`Usuń segment ${index + 1}`} onclick={() => removeSegment(index)}><Trash2 size={14}/></Button></header><div class="segment-times"><label>Początek <input aria-label={`Początek segmentu ${index + 1} w sekundach`} type="number" min="0" step="0.001" value={Number.isFinite(segment.start) ? segment.start : ''} disabled={busy || capturing} oninput={event => changeSegment(index, { start: event.currentTarget.valueAsNumber })}/></label><label>Koniec <input aria-label={`Koniec segmentu ${index + 1} w sekundach`} type="number" min="0" step="0.001" value={Number.isFinite(segment.end) ? segment.end : ''} disabled={busy || capturing} oninput={event => changeSegment(index, { end: event.currentTarget.valueAsNumber })}/></label></div><textarea class="text-input" aria-label={`Tekst segmentu ${index + 1}`} value={segment.text} disabled={busy || capturing} rows="2" oninput={event => changeSegment(index, { text: event.currentTarget.value })}></textarea></article>
          {/each}
        </div>
        {#if pages > 1}<nav class="segment-pagination" aria-label="Strony segmentów"><Button variant="outline" disabled={page === 0} onclick={() => page--}><ChevronLeft size={14}/>Poprzednie</Button><span>{page + 1} / {pages}</span><Button variant="outline" disabled={page >= pages - 1} onclick={() => page++}>Następne<ChevronRight size={14}/></Button></nav>{/if}
      {:else}<textarea id={`${uid}-text`} class="transcription-editor vs-document-editor" value={text} disabled={busy || capturing} oninput={event => { text = event.currentTarget.value; changed() }} placeholder="Tutaj pojawi się rozpoznany tekst. Możesz go poprawić przed pobraniem lub otwarciem w edytorze."></textarea>{/if}
      {#if timingError}<p class="transcription-error" role="alert">{timingError}</p>{/if}
      {#if error}<p class="transcription-error" role="alert">{error}</p>{/if}
      {#if message}<p class="transcription-notice" role="status">{message}</p>{/if}
      {#if saved}<p class:transcription-error={saveFailed} class:transcription-notice={!saveFailed} role="status">{saved}</p>{/if}
      {#if busy}<p class="transcription-notice" role="status"><LoaderCircle size={14} class="spin"/>Rozpoznawanie mowy… Pierwsze wczytanie modelu może potrwać dłużej.</p>{/if}
    </div>
  {/snippet}
  {#snippet settings()}
    <section class="tool-workspace-section"><h2>Rozpoznawanie</h2><ToolModelSettings {ready} disabled={busy || capturing} family="asr" bind:busy={modelBusy}/></section>
    <Select label="Preferowany język · wskazówka" value={language} onchange={next => language = next} options={[{ value: 'auto', label: 'Wykryj automatycznie' }, { value: 'pl', label: 'Polski' }, { value: 'en', label: 'Angielski' }, { value: 'de', label: 'Niemiecki' }, { value: 'fr', label: 'Francuski' }, { value: 'es', label: 'Hiszpański' }, { value: 'it', label: 'Włoski' }, { value: 'uk', label: 'Ukraiński' }]} disabled={busy || capturing}/>
    <p class="tool-workspace-note">Obecny backend wykrywa język automatycznie i może pominąć wskazówkę. Przy wyniku zapisujemy język rozpoznany przez silnik.</p>
    <Select label="Tryb transkrypcji" value={mode} onchange={next => mode = next} options={modeOptions} disabled={busy || capturing}/>
    <section class="tool-workspace-section"><h2>Redakcja tekstu</h2><div class="transcription-label"><span>Poproś LLM o redakcję po rozpoznaniu</span><Switch label="Redakcja transkrypcji przez LLM" checked={refine} onchange={value => refine = value} disabled={busy || capturing}/></div><p class="tool-workspace-note">Domyślnie wyłączone. Używa LLM wcześniej wskazanego w ustawieniach i jego zasad redakcji; tekst może trafić do skonfigurowanego dostawcy. Nie zmienia konfiguracji LLM. Wynik zatwierdzisz po porównaniu z oryginałem.</p></section>
    {#if mode === 'fast'}<p class="tool-workspace-note">Tryb szybki automatycznie wybiera model dyktowania. Pozostałe tryby korzystają z wybranego ASR. Nie każdy silnik zwraca segmenty lub czasy słów.</p>{/if}
    {#if readinessNotice}<p class="tool-workspace-note" role="status">{readinessNotice}</p>{/if}
    <section class="tool-workspace-section"><h2>Eksport</h2><div class="transcription-exports"><Button variant="outline" disabled={!outputText.trim() || busy || !!timingError} onclick={() => exportText('txt')}><Download size={14}/>{refinement?.applied ? 'Tekst TXT po redakcji' : 'Tekst TXT'}</Button><Button variant="outline" disabled={!segments.length || busy || !!timingError} onclick={() => exportText('srt')}>Napisy SRT</Button><Button variant="outline" disabled={!segments.length || busy || !!timingError} onclick={() => exportText('vtt')}>Napisy VTT</Button></div><p class="tool-workspace-note">TXT zawiera wybraną wersję tekstu. SRT/VTT zachowują aktualny tekst segmentów i wymagają poprawnych czasów. Nagranie źródłowe pobierzesz przy odtwarzaczu.</p></section>
  {/snippet}
  {#snippet history()}
    <p class="tool-workspace-note">Na tym urządzeniu zapisujemy do 20 wyników, łącznie do 1 MB. Najstarsze zapisy ustępują miejsca nowym. Historia obejmuje tekst, poprawione segmenty, czasy i decyzję o redakcji z oryginałem; nie zapisuje plików audio.</p>
    {#if saved}<p class:transcription-error={saveFailed} class:transcription-notice={!saveFailed} role="status">{saved}</p>{/if}
    {#each results as result (result.id)}<article class="tool-workspace-history-item"><strong>{result.name}</strong><small>{new Date(result.updated).toLocaleString('pl-PL')} · {result.language.toUpperCase()} · {result.text.length.toLocaleString('pl-PL')} znaków</small><p class="transcription-excerpt">{result.text.slice(0, 180) || 'Nie rozpoznano mowy.'}</p><div class="transcription-actions"><Button variant="outline" disabled={busy || capturing} onclick={() => restore(result)}>Otwórz wynik</Button><Button variant="ghost" disabled={busy || capturing} onclick={() => deleteResult(result.id)}>Usuń zapis</Button></div></article>{/each}
    {#if !results.length}<p class="tool-workspace-empty">Rozpoznane wypowiedzi pojawią się tutaj.</p>{/if}
  {/snippet}
  {#snippet actions()}
    <span class="tool-workspace-note">{segments.length ? `Segmenty z czasami: ${segments.length}` : 'Transkrypcja po przesłaniu nagrania'}</span>
    <div class="transcription-actions"><Button variant="outline" disabled={!outputText.trim() || busy || capturing} onclick={() => ontext(outputText)}>Otwórz w edytorze</Button>{#if busy}<Button variant="outline" onclick={() => controller?.abort()}>Przerwij oczekiwanie</Button>{:else}<Button variant="default" disabled={!file || locked || mode === 'fast' && fastReady === false} onclick={run}>Przepisz nagranie</Button>{/if}</div>
  {/snippet}
</ToolWorkspace>

<style>
  .transcription-content{display:flex;flex-direction:column;gap:18px;min-width:0}.transcription-source{position:relative;display:flex;min-height:210px;flex-direction:column;align-items:center;justify-content:center;gap:12px;border:1px dashed var(--border);border-radius:12px;padding:28px;text-align:center;cursor:pointer;background:var(--surface)}.transcription-source.dragging{border-color:var(--foreground);background:var(--surface-hover)}.transcription-source.has-file{min-height:150px}.transcription-source.disabled{opacity:.5;cursor:wait}.source-icon{display:grid;place-items:center;width:43px;height:43px;border:1px solid var(--border);border-radius:10px;color:var(--muted)}.transcription-source strong{font-size:var(--ui-text-13);font-weight:500;overflow-wrap:anywhere;max-width:100%}.transcription-source>span:last-of-type{font-size:var(--ui-text-11);color:var(--muted)}.transcription-source input{position:absolute;width:1px;height:1px;opacity:0}.transcription-source:focus-within{outline:2px solid var(--focus);outline-offset:3px}.source-preview{display:flex;align-items:center;gap:10px}.source-preview audio{flex:1;width:0;height:38px}.transcription-label{display:flex;justify-content:space-between;align-items:center;font-size:var(--ui-text-12);gap:12px}.transcription-label span{font-size:var(--ui-text-10);color:var(--muted)}.transcription-editor{display:block;width:100%;min-height:280px;resize:vertical;border:0;border-radius:0;padding:8px 0;background:transparent;color:var(--foreground);font-family:var(--font-editor);font-size:15px;line-height:1.9}.transcription-editor::placeholder{color:var(--muted)}.transcript-summary{min-height:120px;max-height:240px}.transcription-notice,.transcription-error{display:flex;align-items:center;gap:8px;font-size:var(--ui-text-12);line-height:1.8;margin:0;overflow-wrap:anywhere}.transcription-notice{color:var(--muted)}.transcription-error{color:var(--danger)}.transcription-exports,.transcription-actions,.microphone-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.microphone-row>span{font-size:var(--ui-text-12);color:var(--muted)}.microphone-row :global(.recording){color:var(--danger)}.transcription-excerpt{font-size:var(--ui-text-11);line-height:1.8;color:var(--muted);margin:0;overflow-wrap:anywhere}.transcription-segments{display:flex;flex-direction:column;gap:12px}.transcription-segment{padding:16px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}.transcription-segment header{display:flex;align-items:center;justify-content:space-between;font-size:var(--ui-text-12);margin-bottom:8px}.segment-times{display:flex;gap:12px;margin-bottom:12px}.segment-times label{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:var(--ui-text-11);min-width:0}.segment-times input{min-width:0;width:100px;border:1px solid var(--border);border-radius:6px;padding:7px 8px;background:var(--input);color:var(--foreground);font:inherit;font-variant-numeric:tabular-nums}.segment-pagination{display:flex;justify-content:center;align-items:center;gap:12px;font-size:var(--ui-text-12);color:var(--muted)}@media(max-width:600px){.transcription-source{padding:24px 16px;min-height:180px}.transcription-editor{min-height:230px}.transcription-actions{width:100%}.segment-times{flex-wrap:wrap}.segment-times label{flex:1}.segment-times input{width:80px}.transcription-segment{padding:12px}}
</style>
