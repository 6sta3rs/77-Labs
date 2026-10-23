<script lang="ts">
  import { userMessage } from '../platform/user-message';
  import Input from '../ui/Input.svelte'
  import Checkbox from '../ui/Checkbox.svelte'
  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import '../ui/document-editor.css'
  import Button from '../ui/Button.svelte'
  import FilePicker from '../ui/FilePicker.svelte';
  import AudioPreview from '../playback/AudioPreview.svelte';
  import VideoCard from '../ui/VideoCard.svelte';
  import { onDestroy } from 'svelte';
  import { Download, RefreshCw, LoaderCircle, Plus, Star, Trash2, Play, Upload, AudioLines, FileText } from '@lucide/svelte';
  import ToolWorkspace from './ToolWorkspace.svelte';
  import ToolModelSettings from '../models/ToolModelSettings.svelte';
  import ToolVoiceSettings from '../voices/ToolVoiceSettings.svelte';
  import Select from '../ui/Select.svelte';
  import Switch from '../ui/Switch.svelte';
  import { profiles, type Profile } from '../platform/api';
  import { productionJson, postJson, downloadProduction, productionLanguages } from './production/production';
  import { dictionary, batch, convertVoice, backendHistory, starRecording, deleteBackendRecording, loadBackendAudio, saveTextFile, type PronunciationEntry, type PronunciationDraft, type PronunciationTest, type BatchJob, type BackendRecording } from './studio-tools';
  import './studio-tools.css';

  let { kind, ready, ontext }: { kind: 'pronunciation' | 'batch' | 'conversion' | 'tools' | 'engine-history'; ready: boolean; ontext: (text: string) => void } = $props();
  const titles = { pronunciation: 'Słownik wymowy', batch: 'Kolejka dubbingu', conversion: 'Zmień głos nagrania', tools: 'Narzędzia audio', 'engine-history': 'Historia silnika' };
  const uid = $props.id();
  let busy = $state(false), error = $state(''), message = $state('');
  let entries = $state<PronunciationEntry[]>([]), editing = $state(''), term = $state(''), replacement = $state(''), entryType = $state('respelling'), language = $state('*'), enabled = $state(true);
  let testText = $state(''), testResult = $state<PronunciationTest>();
  let voices = $state<Profile[]>([]), voice = $state(''), file = $state<File>(), preserveBg = $state(true), matchDuration = $state(true), langs = $state<string[]>(['pl']);
  let jobs = $state<BatchJob[]>([]), recordings = $state<BackendRecording[]>([]), query = $state(''), starredOnly = $state(false), deleting = $state('');
  let audioUrl = $state(''), resultText = $state(''), duration = $state(0);
  let direction = $state(''), tool = $state('direction'), slot = $state(5), targetLang = $state('pl'), toolResult = $state<Record<string, unknown>>();
  let panelTab = $state<'settings' | 'history'>('settings');
  let modelBusy = $state(false);
  let sourceUrl = $state('');
  let conversionHistory = $state<Array<{ id: string; url: string; filename: string; voice: string; duration: number; text: string }>>([]);
  let analysisHistory = $state<Array<{ id: string; label: string; text: string; output: string }>>([]);
  const workspaceKind = $derived(kind === 'conversion' || kind === 'batch' || kind === 'tools');
  const activeJobs = $derived(jobs.filter(job => job.status === 'queued' || job.status === 'running'));
  const outputText = (result: Record<string, unknown>) => String(result.instruct_prompt || result.text || result.adjusted_text || result.error || 'Analiza zakończona. Rozwiń szczegóły wyniku.');
  let action: AbortController | undefined;
  let loading: AbortController | undefined;
  const filteredHistory = $derived(recordings.filter(row => (!starredOnly || row.starred) && `${row.text} ${row.profile_name || ''}`.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl'))));
  const statuses: Record<string, string> = { queued: 'Oczekuje', running: 'W toku', done: 'Gotowe', failed: 'Błąd', cancelled: 'Anulowane' };

  function fail(cause: unknown) { if (!(cause instanceof Error && cause.name === 'AbortError')) error = userMessage(cause, 'Operacja nie powiodła się. Spróbuj ponownie.'); }
  async function work(fn: (signal: AbortSignal) => Promise<void>) {
    if (busy || !ready || modelBusy) return;
    const current = new AbortController(); action = current;
    busy = true; error = ''; message = '';
    try { await fn(current.signal); } catch (cause) { if (action === current) fail(cause); } finally { if (action === current) { action = undefined; busy = false; } }
  }
  async function refresh(signal?: AbortSignal) {
    if (kind === 'pronunciation') entries = await dictionary.list(signal);
    else if (kind === 'batch') jobs = await batch.list(signal);
    else if (kind === 'engine-history') recordings = await backendHistory(signal);
  }
  $effect(() => {
    if (!ready) return;
    loading = new AbortController(); const controller = loading;
    void refresh(controller.signal).catch(fail);
    if (kind === 'batch' || kind === 'conversion') void profiles(controller.signal).then(rows => { if (!controller.signal.aborted) { voices = rows; if (kind === 'conversion' && !rows.some(row => row.id === voice)) voice = rows[0]?.id || ''; } }).catch(fail);
    let polling = false;
    const interval = kind === 'batch' ? setInterval(() => { if (!busy && !polling) { polling = true; void refresh(controller.signal).catch(fail).finally(() => polling = false); } }, 3000) : undefined;
    return () => { controller.abort(); clearInterval(interval); action?.abort(); action = undefined; busy = false; };
  });
  $effect(() => {
    if (!file) { sourceUrl = ''; return; }
    const url = URL.createObjectURL(file); sourceUrl = url;
    return () => URL.revokeObjectURL(url);
  });
  onDestroy(() => { action?.abort(); loading?.abort(); if (audioUrl && kind !== 'conversion') URL.revokeObjectURL(audioUrl); conversionHistory.forEach(row => URL.revokeObjectURL(row.url)); });
  function clearDraft() { editing = ''; term = ''; replacement = ''; entryType = 'respelling'; language = '*'; enabled = true; }
  function edit(entry: PronunciationEntry) { editing = entry.id; term = entry.term; replacement = entry.replacement; entryType = entry.type; language = entry.language; enabled = entry.enabled; }
  async function saveEntry() { await work(async signal => { await dictionary.save({ term: term.trim(), replacement, type: entryType, language, enabled }, editing || undefined, signal); clearDraft(); await refresh(signal); testResult = undefined; message = 'Zapisano wymowę.'; }); }
  let sourcePicker = $state<{ open: () => void }>()
  async function importDictionary(imported?: File) {
    if (!imported) return;
    await work(async signal => {
      if (imported.size > 2 * 1024 * 1024) throw new Error('Słownik może mieć maksymalnie 2 MB.');
      const data = JSON.parse(await imported.text()); const rows = Array.isArray(data) ? data : data.entries;
      if (!Array.isArray(rows) || rows.some(row => typeof row.term !== 'string' || typeof row.replacement !== 'string')) throw new Error('Wybierz JSON słownika z polami term i replacement.');
      const result = await dictionary.import(rows as PronunciationDraft[], signal); await refresh(signal); testResult = undefined; message = `Dodano ${result.imported} wpisów. Istniejący słownik został zachowany.`;
    });
  }
  async function playAudio(path: string, signal: AbortSignal) {
    const blob = await loadBackendAudio(path, signal);
    if (signal.aborted) return;
    if (audioUrl && kind !== 'conversion') URL.revokeObjectURL(audioUrl); audioUrl = URL.createObjectURL(blob);
  }
  async function convert() { if (!file || !voice) return; const filename = file.name; const voiceName = voices.find(row => row.id === voice)?.name || 'Wybrany głos'; await work(async signal => { const result = await convertVoice(file!, voice, matchDuration, signal); resultText = result.text; duration = result.duration_s; await playAudio(result.audio_url, signal); if (signal.aborted) return; conversionHistory = [{ id: crypto.randomUUID(), url: audioUrl, filename, voice: voiceName, duration, text: resultText }, ...conversionHistory]; message = 'Nowe nagranie jest gotowe.'; }); }
  async function enqueue() { if (!file || !langs.length) return; await work(async signal => { const result = await batch.enqueue(file!, langs, voice, preserveBg, signal); file = undefined; await refresh(signal); message = `Dodano zadanie ${result.job_id}.`; }); }
  async function runTool() { await work(async signal => { toolResult = await productionJson<Record<string, unknown>>(tool === 'direction' ? '/tools/direction' : '/tools/rate-fit', postJson(tool === 'direction' ? { text: direction } : { text: direction, slot_seconds: slot, target_lang: targetLang }, signal)); analysisHistory = [{ id: crypto.randomUUID(), label: tool === 'direction' ? 'Wskazówki sposobu mówienia' : 'Dopasowanie tekstu do czasu', text: direction, output: outputText(toolResult) }, ...analysisHistory]; message = 'Analiza zakończona.'; }); }
  function date(value: string | number) { const d = new Date(typeof value === 'number' ? value * 1000 : value); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(tr.locale); }
</script>

{#if workspaceKind}
<ToolWorkspace title={tr(String(titles[kind]))} description={kind === 'conversion' ? tr("Te same słowa wypowiedziane wybranym głosem.") : kind === 'batch' ? tr("Jeden materiał, dubbing w wielu językach.") : tr("Przygotuj sposób mówienia lub dopasuj tekst do czasu.")} bind:tab={panelTab} historyLabel={tr(String(kind === 'batch' ? 'Zadania' : 'Ta sesja'))} historyCount={kind === 'conversion' ? conversionHistory.length : kind === 'batch' ? jobs.length : analysisHistory.length}>
  {#snippet content()}
    <div class="studio-tools studio-tools-workspace">
      {#if !ready}<p class="tool-notice" role="status">{tr("Uruchom lokalny silnik w „Silnik”, aby rozpocząć przetwarzanie.")}</p>{/if}
      {#if error}<p class="tool-error" role="alert">{tr(String(error))}</p>{/if}
      {#if message}<p class="tool-inline-message" role="status">{tr(String(message))}</p>{/if}
      {#if kind === 'tools'}
        <section class="tool-document"><label for={`${uid}-workspace-text`}>{tool === 'direction' ? tr("Opisz sposób mówienia") : tr("Tekst wypowiedzi")}</label><textarea id={`${uid}-workspace-text`} class="text-input vs-document-editor" placeholder={tool === 'direction' ? tr("Na przykład: spokojnie, z ciepłem i naturalnymi pauzami…") : tr("Wklej tekst, który ma zmieścić się w wybranym czasie.")} bind:value={direction} disabled={busy}></textarea><span class="tool-workspace-note">{direction.length.toLocaleString(tr.locale)} {tr("znaków")}</span></section>
        {#if toolResult}<section class="tool-result"><h2>{tr("Wynik analizy")}</h2><p class="tool-output">{outputText(toolResult)}</p><Button variant="outline" onclick={() => ontext(outputText(toolResult!))}>{tr("Otwórz wynik w edytorze")}</Button><details><summary>{tr("Szczegóły analizy")}</summary><pre>{JSON.stringify(toolResult, null, 2)}</pre></details></section>{/if}
      {:else}
        <section class="tool-source">
          <button type="button" class="upload-zone tool-source-drop" class:has-file={Boolean(file)} disabled={busy} onclick={() => sourcePicker?.open()}><Upload size={26}/><strong>{file?.name || (kind === 'conversion' ? tr("Dodaj nagranie źródłowe") : tr("Dodaj materiał do dubbingu"))}</strong><span>{kind === 'conversion' ? tr("WAV, MP3, M4A lub FLAC · do 64 MB") : tr("Plik wideo lub audio")}<br/>{tr("Kliknij, aby wybrać plik z komputera.")}</span></button><FilePicker bind:this={sourcePicker} bare accept={kind === 'conversion' ? 'audio/*,.wav,.mp3,.m4a,.flac' : 'audio/*,video/*,.mp4,.mkv,.wav,.mp3'} disabled={busy} onchange={files => { file = files[0] }}/>
          {#if sourceUrl && file}<div class="tool-source-preview"><span class="tool-workspace-note">{tr("Materiał źródłowy ·")} {(file.size / 1024 / 1024).toLocaleString(tr.locale, { maximumFractionDigits: 1 })} {tr("MB")}</span>{#if file.type.startsWith('video/') || /\.(mp4|mkv|mov|webm)$/i.test(file.name)}<VideoCard src={sourceUrl} title="Materiał źródłowy"/>{:else}<AudioPreview src={sourceUrl} title={tr("Materiał źródłowy")}/>{/if}<Button variant="ghost" disabled={busy} onclick={() => file = undefined}>{tr("Usuń wybrany plik")}</Button></div>{/if}
        </section>
        {#if kind === 'conversion' && audioUrl}<section class="tool-result"><div class="tool-result-heading"><AudioLines size={17}/><h2>{tr("Ostatni wynik")}</h2><span>{duration.toFixed(1)} {tr("s")}</span></div><AudioPreview src={audioUrl} title={tr("Ostatni wynik")}/><div class="tool-actions"><Button variant="outline" href={audioUrl} download="nowy-glos.wav"><Download size={14}/>{tr("Pobierz WAV")}</Button>{#if resultText}<Button variant="ghost" onclick={() => ontext(resultText)}>{tr("Otwórz tekst w edytorze")}</Button>{/if}</div>{#if resultText}<p class="tool-output">{resultText}</p>{/if}</section>{/if}
        {#if kind === 'batch'}<section class="tool-active-jobs"><div class="tool-result-heading"><h2>{tr("Aktywna kolejka")}</h2><Button variant="ghost" size="icon" aria-label={tr("Odśwież kolejkę")} disabled={!ready || busy} onclick={() => work(refresh)}><RefreshCw size={15}/></Button></div>{#each activeJobs as job}<article><strong>{job.filename}</strong><span>{tr(String(statuses[job.status]))} · {job.langs.join(', ')}</span>{#if job.progress}<small>{typeof job.progress === 'number' ? `${job.progress}%` : `${job.progress.stage || ''} ${job.progress.percent ?? ''}${job.progress.percent !== undefined ? '%' : ''}`}</small>{/if}<Button variant="outline" disabled={busy || !ready} onclick={() => work(async signal => { await batch.action(job.id, 'cancel', signal); await refresh(signal); })}>{tr("Anuluj zadanie")}</Button></article>{/each}{#if !activeJobs.length}<p class="tool-workspace-empty">{tr("Brak aktywnych zadań. Wybierz materiał i dodaj go do kolejki.")}</p>{/if}</section>{/if}
      {/if}
    </div>
  {/snippet}
  {#snippet settings()}
    {#if kind === 'tools'}
      <Select label={tr("Narzędzie")} value={tool} onchange={v => { tool = v; toolResult = undefined; error = ''; }} disabled={busy} options={[{ value: 'direction', label: tr("Wskazówki sposobu mówienia") }, { value: 'rate-fit', label: 'Dopasowanie tekstu do czasu' }]}/>
      {#if tool === 'rate-fit'}<label class="tool-setting-label" for={`${uid}-slot`}>{tr("Czas wypowiedzi (sekundy)")}<Input id={`${uid}-slot`} type="number" min="0.1" step="0.1" bind:value={slot} disabled={busy}/></label><Select label={tr("Język docelowy")} value={targetLang} onchange={v => targetLang = v} options={productionLanguages.map(option=>({...option,label:tr(option.label)}))} disabled={busy}/>{/if}
      <ToolModelSettings {ready} disabled={busy} family="llm" bind:busy={modelBusy}/>
      <p class="tool-workspace-note">{tool === 'direction' ? tr("Przygotuj wskazówki dla silnika bez generowania nagrania.") : tr("Podaj docelowy czas. Silnik przygotuje tekst dopasowany do długości segmentu.")}</p>
    {:else}
      <ToolVoiceSettings profiles={voices} value={voice} onchange={v => voice = v} label={tr("Głos docelowy")} {ready} disabled={busy} allowDefault={kind === 'batch'}/>
      <ToolModelSettings {ready} disabled={busy} bind:busy={modelBusy}/>
      {#if kind === 'conversion'}<div class="tool-setting-switch"><span>{tr("Dopasuj długość nagrania")}</span><Switch checked={matchDuration} onchange={v => matchDuration = v} label={tr("Dopasuj długość nagrania")} disabled={busy}/></div><p class="tool-workspace-note">{tr("Silnik rozpoznaje słowa i tworzy nową wypowiedź. Intonacja i pauzy mogą się zmienić.")}</p><div class="tool-workspace-section"><h2>{tr("Format wyjściowy")}</h2><span class="tool-format">{tr("WAV")}</span></div>
      {:else}<fieldset class="tool-languages" disabled={!ready || busy}><legend>{tr("Języki docelowe")}</legend>{#each productionLanguages as lang}<label><Checkbox checked={langs.includes(lang.value)} onchange={on => langs = on ? [...langs, lang.value] : langs.filter(code => code !== lang.value)}/>{tr(String(lang.label))}</label>{/each}</fieldset><div class="tool-setting-switch"><span>{tr("Zachowaj dźwięki tła")}</span><Switch checked={preserveBg} onchange={v => preserveBg = v} label={tr("Zachowaj dźwięki tła")} disabled={busy}/></div><p class="tool-workspace-note">{tr("Każdy wybrany język otrzyma osobny plik wynikowy. Postęp i pobieranie są dostępne w zakładce Zadania.")}</p>{/if}
    {/if}
  {/snippet}
  {#snippet history()}
    {#if kind === 'conversion'}<p class="tool-workspace-note">{tr("Wyniki z bieżącej sesji. Pobierz nagrania przed opuszczeniem tego narzędzia.")}</p>{#each conversionHistory as row}<article class="tool-workspace-history-item"><strong>{row.filename}</strong><small>{row.voice} · {row.duration.toFixed(1)} {tr("s")}</small><AudioPreview src={row.url} title={row.filename} meta={row.voice}/><Button variant="outline" href={row.url} download={`nowy-glos-${row.id}.wav`}><Download size={14}/>{tr("Pobierz WAV")}</Button></article>{/each}{#if !conversionHistory.length}<p class="tool-workspace-empty">{tr("Wygenerowane nagrania pojawią się tutaj.")}</p>{/if}
    {:else if kind === 'batch'}<Button variant="outline" disabled={!ready || busy} onclick={() => work(refresh)}><RefreshCw size={14}/>{tr("Odśwież zadania")}</Button>{#each jobs as job}<article class="tool-workspace-history-item"><strong>{job.filename}</strong><small>{statuses[job.status] || job.status} · {job.langs.join(', ')}</small>{#if job.error}<p class="tool-workspace-note">{tr(String(job.error))}</p>{/if}{#if job.status === 'queued' || job.status === 'running'}<Button variant="outline" disabled={busy || !ready} onclick={() => work(async signal => { await batch.action(job.id, 'cancel', signal); await refresh(signal); })}>{tr("Anuluj")}</Button>{:else if (job.status === 'failed' || job.status === 'cancelled') && job.retry_ready !== false}<Button variant="outline" disabled={busy || !ready} onclick={() => work(async signal => { await batch.action(job.id, 'retry', signal); await refresh(signal); })}>{tr("Ponów")}</Button>{:else if job.status === 'done'}{#each Object.keys(job.outputs || {}) as lang}<Button variant="outline" disabled={busy || !ready} onclick={() => work(async signal => downloadProduction(`/batch/download/${encodeURIComponent(job.id)}/${encodeURIComponent(lang)}`, `${job.filename}-${lang}.mp4`, signal))}><Download size={14}/>{lang.toUpperCase()}</Button>{/each}{/if}</article>{/each}{#if !jobs.length}<p class="tool-workspace-empty">{tr("Zadania dubbingu pojawią się tutaj.")}</p>{/if}
    {:else}<p class="tool-workspace-note">{tr("Analizy z bieżącej sesji.")}</p>{#each analysisHistory as row}<article class="tool-workspace-history-item"><strong>{tr(String(row.label))}</strong><p class="tool-analysis-excerpt">{row.output}</p><Button variant="outline" disabled={busy} onclick={() => { direction = row.text; toolResult = { text: row.output }; panelTab = 'settings'; }}><FileText size={14}/>{tr("Otwórz wynik")}</Button></article>{/each}{#if !analysisHistory.length}<p class="tool-workspace-empty">{tr("Gotowe analizy pojawią się tutaj.")}</p>{/if}{/if}
  {/snippet}
  {#snippet actions()}
    <div class="tool-workspace-note tool-action-status" role="status">{#if busy}<LoaderCircle class="spin" size={15}/>{tr("Trwa przetwarzanie…")}{:else if kind === 'tools'}{direction.trim() ? tr("Tekst gotowy do analizy") : tr("Wpisz tekst, aby rozpocząć")}{:else if file}{file.name}{:else}{tr("Wybierz materiał źródłowy")}{/if}</div>
    {#if kind === 'tools'}<Button variant="default" disabled={!ready || busy || modelBusy || !direction.trim() || (tool === 'rate-fit' && (!Number.isFinite(slot) || slot <= 0))} onclick={runTool}>{tr("Przygotuj tekst")}</Button>{:else if kind === 'conversion'}<Button variant="default" disabled={!ready || busy || modelBusy || !file || !voice} onclick={convert}>{tr("Wygeneruj nowym głosem")}</Button>{:else}<Button variant="default" disabled={!ready || busy || modelBusy || !file || !langs.length} onclick={enqueue}><Plus size={15}/>{tr("Dodaj do kolejki")}</Button>{/if}
  {/snippet}
</ToolWorkspace>
{:else}
<div class="page-body studio-tools">
  <div class="page-heading"><div><h1>{tr(String(titles[kind]))}</h1><p>{kind === 'pronunciation' ? tr("Ustal, jak wymawiać nazwy, skróty i własne słowa.") : kind === 'batch' ? tr("Przygotuj dubbing do wielu języków i śledź zadania.") : kind === 'conversion' ? tr("Te same słowa wypowiedziane wybranym głosem.") : kind === 'engine-history' ? tr("Nagrania zachowane przez lokalny silnik, także poza bieżącą sesją.") : tr("Przygotuj sposób mówienia i dopasuj tekst do czasu.")}</p></div>{#if kind !== 'conversion' && kind !== 'tools'}<Button variant="outline" disabled={!ready || busy} onclick={() => work(refresh)}><RefreshCw size={15}/>{tr("Odśwież")}</Button>{/if}</div>
  {#if !ready}<p class="tool-notice" role="status">{tr("Uruchom lokalny silnik w „Silnik”, aby korzystać z tej funkcji.")}</p>{/if}
  {#if error}<p class="tool-error" role="alert">{tr(String(error))}</p>{/if}
  {#if message}<p class="tool-notice" role="status">{tr(String(message))}</p>{/if}
  {#if busy}<p class="tool-progress" role="status"><LoaderCircle class="spin" size={16}/>{tr("Trwa przetwarzanie…")}</p>{/if}

  {#if kind === 'pronunciation'}
    <form class="tool-card" onsubmit={event => { event.preventDefault(); void saveEntry(); }}>
      <h2>{editing ? 'Edytuj wpis' : 'Nowa wymowa'}</h2>
      <div class="tool-columns"><label>{tr("Słowo lub skrót")}<input class="text-input" aria-label={tr("Słowo lub skrót")} bind:value={term} required disabled={busy}/></label><label>{tr("Jak przeczytać")}<input class="text-input" aria-label={tr("Jak przeczytać")} bind:value={replacement} disabled={busy}/></label></div>
      <div class="tool-columns"><Select label={tr("Rodzaj wymowy")} value={entryType} onchange={v => entryType = v} options={[{ value: 'respelling', label: 'Zapis brzmienia' }, { value: 'ipa', label: 'IPA (zapis bez stosowania)' }, { value: 'cmu', label: 'CMU (zapis bez stosowania)' }]}/><label>{tr("Język (np. Polish lub *)")}<input class="text-input" aria-label={tr("Język wpisu")} bind:value={language} disabled={busy}/></label></div>
      {#if entryType === 'ipa' || entryType === 'cmu'}<p class="page-footnote">{tr("Silnik zapisuje ten typ, ale obecna ścieżka syntezy nie stosuje fonemów. Do zmiany wymowy użyj zapisu brzmienia.")}</p>{/if}
      <div class="tool-actions"><Switch checked={enabled} onchange={v => enabled = v} label={tr("Wpis aktywny")} disabled={busy}/><span>{tr("Aktywny")}</span><Button type="submit" variant="default" disabled={!ready || busy || !term.trim()}><Plus size={15}/>{tr("Zapisz wpis")}</Button>{#if editing}<Button type="button" variant="outline" onclick={clearDraft}>{tr("Anuluj edycję")}</Button>{/if}</div>
    </form>
    <div class="tool-actions"><Button variant="outline" disabled={!ready || busy} onclick={() => work(async signal => { const data = await dictionary.export(signal); saveTextFile(JSON.stringify(data, null, 2), 'slownik-wymowy.json'); })}><Download size={15}/>{tr("Eksport JSON")}</Button><FilePicker label={tr("Import JSON")} ariaLabel={tr("Import słownika")} accept=".json,application/json" showName={false} disabled={!ready || busy} onchange={files => void importDictionary(files[0])}/></div>
    <div class="tool-list">{#each entries as entry}<article><div class="tool-row-main"><strong>{entry.term}</strong><span>→ {entry.replacement || '(bez zamiany)'}</span><small>{entry.language} · {entry.type} · {entry.enabled ? 'aktywny' : tr("wyłączony")}</small></div><Button variant="ghost" disabled={busy} onclick={() => edit(entry)}>{tr("Edytuj")}</Button><Switch checked={entry.enabled} label={tr(String(`Aktywuj ${entry.term}`))} disabled={!ready || busy} onchange={v => work(async signal => { await dictionary.save({ ...entry, enabled: v }, entry.id, signal); await refresh(signal); testResult = undefined; })}/><Button variant="ghost" size="icon" aria-label={tr("Usuń {arg0}", { arg0: String(entry.term) })} disabled={!ready || busy} onclick={() => deleting = entry.id}><Trash2 size={15}/></Button>{#if deleting === entry.id}<div class="tool-confirm">{tr("Usunąć wpis „")}{entry.term}”?<Button variant="outline" disabled={busy} onclick={() => work(async signal => { await dictionary.remove(entry.id, signal); deleting = ''; await refresh(signal); testResult = undefined; })}>{tr("Usuń wpis")}</Button><Button variant="ghost" onclick={() => deleting = ''}>{tr("Zachowaj")}</Button></div>{/if}</article>{/each}{#if ready && !entries.length && !busy}<p>{tr("Słownik jest pusty. Dodaj pierwszy wpis.")}</p>{/if}</div>
    <section class="tool-card"><h2>{tr("Sprawdź wymowę bez generowania audio")}</h2><label for={`${uid}-test`}>{tr("Tekst do sprawdzenia")}</label><textarea id={`${uid}-test`} class="text-input" rows="3" bind:value={testText}></textarea><Button variant="outline" disabled={!ready || busy || !testText.trim()} onclick={() => work(async signal => { testResult = await dictionary.test(testText, language, signal); })}>{tr("Sprawdź podstawienia")}</Button>{#if testResult}<p class="tool-output">{testResult.substituted}</p><p class="page-footnote">{testResult.changed ? tr("Wymowa została zmieniona.") : tr("Tekst pozostał bez zmian.")}{#if testResult.inert_entries?.length} {tr("Wpisy fonetyczne nie są stosowane:")} {testResult.inert_entries.map(row => row.term).join(', ')}.{/if}</p>{/if}</section>
  {:else if kind === 'engine-history'}
    <div class="tool-actions"><input class="text-input tool-search" aria-label={tr("Szukaj nagrania silnika")} placeholder={tr("Szukaj po tekście lub głosie")} bind:value={query}/><label class="tool-checkbox"><Checkbox bind:checked={starredOnly}/>{tr("Tylko ulubione")}</label></div><div class="tool-list">{#each filteredHistory as row}<article><Button variant="ghost" size="icon" aria-label={tr("Odtwórz nagranie silnika")} disabled={!ready || busy || !row.audio_path} onclick={() => work(async signal => { await playAudio(row.audio_path, signal); resultText = row.text; })}><Play size={16}/></Button><div class="tool-row-main"><strong>{row.profile_name || 'Nagranie'}</strong><span class="tool-excerpt">{row.text}</span><small>{date(row.created_at)}</small></div><Button variant="ghost" size="icon" aria-label={row.starred ? tr("Usuń z ulubionych") : tr("Dodaj do ulubionych")} aria-pressed={Boolean(row.starred)} disabled={!ready || busy} onclick={() => work(async signal => { await starRecording(row.id, !row.starred, signal); await refresh(signal); })}><Star size={17} fill={row.starred ? 'currentColor' : 'none'}/></Button><Button variant="ghost" onclick={() => ontext(row.text)}>{tr("Użyj tekstu")}</Button><Button variant="ghost" size="icon" aria-label={tr("Pobierz nagranie silnika")} disabled={!ready || busy} onclick={() => work(async signal => { const blob = await loadBackendAudio(row.audio_path, signal); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `nagranie-${row.id}.wav`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); })}><Download size={16}/></Button><Button variant="ghost" size="icon" aria-label={tr("Usuń nagranie silnika")} disabled={busy || !ready} onclick={() => deleting = row.id}><Trash2 size={16}/></Button>{#if deleting === row.id}<div class="tool-confirm">{tr("Usunąć to nagranie i jego plik z historii silnika?")}<Button variant="outline" disabled={busy} onclick={() => work(async signal => { await deleteBackendRecording(row.id, signal); deleting = ''; await refresh(signal); })}>{tr("Usuń nagranie")}</Button><Button variant="ghost" onclick={() => deleting = ''}>{tr("Zachowaj")}</Button></div>{/if}</article>{/each}{#if ready && !filteredHistory.length && !busy}<p>{tr("Brak pasujących nagrań.")}</p>{/if}</div>
  {/if}
  {#if audioUrl}<section class="tool-card"><h2>{tr("Nagranie")}</h2><AudioPreview src={audioUrl} title={tr("Nagranie")}/><Button variant="outline" href={audioUrl} download="nagranie.wav"><Download size={15}/>{tr("Pobierz WAV")}</Button>{#if duration}<small>{duration.toFixed(1)} {tr("s")}</small>{/if}{#if resultText}<p class="tool-output">{resultText}</p><Button variant="ghost" onclick={() => ontext(resultText)}>{tr("Otwórz tekst w edytorze")}</Button>{/if}</section>{/if}
</div>
{/if}
