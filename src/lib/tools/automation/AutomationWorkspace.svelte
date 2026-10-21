<script lang="ts">
  import { uiLanguage, createUiTranslator } from "../../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import Button from '../../ui/Button.svelte';
  import AudioPreview from '../../playback/AudioPreview.svelte';
  import { onMount } from 'svelte';
  import { Plus, Play, Save, Trash2, ArrowUp, ArrowDown, Square, RotateCcw, Download, Workflow, Upload } from '@lucide/svelte';
  import ToolWorkspace from '../ToolWorkspace.svelte';
  import ToolModelSettings from '../../models/ToolModelSettings.svelte';
  import WatchFolderPanel from './WatchFolderPanel.svelte';
  import { watchFolder } from './watch-folder';
  import Input from '../../ui/Input.svelte';
  import Textarea from '../../ui/Textarea.svelte';
  import Select from '../../ui/Select.svelte';
  import Switch from '../../ui/Switch.svelte';
  import { profiles, type Profile } from '../../platform/api';
  import { productionLanguages } from '../production/production';
  import { saveTextFile } from '../studio-tools';
  import { automation, automationLabels, runLabels, activeAutomationRun, automationCanRun, validateRecipe, validateAutomationInput, defaultAutomationAudioEdit, type AutomationAudioEdit, type AutomationRecipe, type AutomationRun, type AutomationKind, type AutomationValue } from './automation';
  import '../studio-tools.css';

  let { ready, ontext }: { ready: boolean; ontext?: (text: string) => void } = $props();
  const uid = $props.id();
  const fresh = (): AutomationRecipe => ({ schema: 1, id: crypto.randomUUID(), name: 'Nowa receptura', inputKind: 'audio', steps: [{ id: crypto.randomUUID(), kind: 'transcribe' }], updatedAt: Date.now() });
  let recipe = $state<AutomationRecipe>(fresh()), recipes = $state<AutomationRecipe[]>([]), runs = $state<AutomationRun[]>([]);
  let voices = $state<Profile[]>([]), inputText = $state(''), files = $state<File[]>([]), error = $state(''), message = $state(''), saving = $state(false), loaded = $state(false);
  let tab = $state<'settings' | 'history'>('settings'), selectedRun = $state(''), addKind = $state<AutomationKind>('speak'), deleteKind = $state<'recipe' | 'run'>('recipe'), deleting = $state('');
  let outputUrl = $state(''), modelBusy = $state(false), asrModelBusy = $state(false);
  let watchEnabled = $state(false);
  const activeRuns = $derived(runs.filter(activeAutomationRun));
  const resultRun = $derived(runs.find(run => run.id === selectedRun) || runs[0]);
  const recipeError = $derived.by(() => { try { validateRecipe(recipe); return ''; } catch (cause) { return cause instanceof Error ? cause.message : String(cause); } });
  const resultText = $derived(resultRun?.result?.kind === 'text' ? resultRun.result.text : '');
  const outputName = $derived(`${(resultRun?.recipe.name || 'automatyzacja').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 70)}-${resultRun?.id.slice(0, 8) || 'wynik'}`);
  const languageOptions = productionLanguages.map(language => ({ value: language.value, label: language.label }));
  function fail(cause: unknown) { error = cause instanceof Error ? cause.message : String(cause); }
  function updateStep(index: number, key: string, value: string | number) { recipe = { ...recipe, steps: recipe.steps.map((step, offset) => offset === index ? { ...step, [key]: value } : step) }; }
  function updateAudioStep(index: number, key: keyof AutomationAudioEdit, value: string | boolean) {
    recipe = { ...recipe, steps: recipe.steps.map((step, offset) => {
      if (offset !== index) return step;
      const settings = { ...(step.audioEdit || defaultAutomationAudioEdit()), [key]: typeof value === 'boolean' ? value : value === '' && key === 'end' ? undefined : value === '' ? Number.NaN : Number(value) };
      return { ...step, audioEdit: settings };
    }) };
  }
  function addStep() { recipe = { ...recipe, steps: [...recipe.steps, { id: crypto.randomUUID(), kind: addKind, ...(addKind === 'speak' || addKind === 'convert' ? { voiceId: voices[0]?.id || '' } : {}), ...(addKind === 'speak' ? { language: 'Polish', speed: 1 } : {}), ...(addKind === 'edit-audio' ? { audioEdit: defaultAutomationAudioEdit() } : {}), ...(addKind === 'translate' ? { language: 'en', sourceLanguage: 'auto', provider: 'argos' as const } : {}) }] }; }
  function moveStep(index: number, offset: number) { const steps = [...recipe.steps]; [steps[index], steps[index + offset]] = [steps[index + offset], steps[index]]; recipe = { ...recipe, steps }; }
  function template(kind: 'asr' | 'tts' | 'convert' | 'translate' | 'audio') {
    const value = fresh();
    if (kind === 'audio') { value.name = 'Audio → WAV · bez modelu'; value.steps = [{ id: crypto.randomUUID(), kind: 'edit-audio', audioEdit: defaultAutomationAudioEdit() }]; }
    else if (kind === 'tts') { value.name = 'Tekst → narracja'; value.inputKind = 'text'; value.steps = [{ id: crypto.randomUUID(), kind: 'speak', voiceId: voices[0]?.id || '', language: 'Polish', speed: 1 }]; }
    else if (kind === 'convert') { value.name = 'Nagranie → inny głos'; value.steps = [{ id: crypto.randomUUID(), kind: 'convert', voiceId: voices[0]?.id || '' }]; }
    else if (kind === 'translate') { value.name = 'Nagranie → tłumaczenie → narracja'; value.steps.push({ id: crypto.randomUUID(), kind: 'translate', language: 'en', sourceLanguage: 'auto', provider: 'argos' }, { id: crypto.randomUUID(), kind: 'speak', voiceId: voices[0]?.id || '', language: 'English', speed: 1 }); }
    else value.name = 'Nagranie → tekst';
    recipe = value; files = []; inputText = ''; error = ''; message = '';
  }
  async function save() {
    if (saving) return; saving = true; error = ''; message = '';
    try { await automation.saveRecipe(recipe); message = 'Zapisano recepturę lokalnie. Wejście wybierasz podczas uruchamiania.'; }
    catch (cause) { fail(cause); } finally { saving = false; }
  }
  async function run() {
    if (!automationCanRun(recipe, ready) || saving || !loaded || modelBusy || asrModelBusy) return;
    error = ''; message = ''; saving = true;
    let added = 0;
    try {
      const value = validateRecipe(recipe);
      const inputs: AutomationValue[] = value.inputKind === 'text' ? [{ kind: 'text', text: inputText }] : files.map(file => ({ kind: 'audio', blob: file, name: file.name }));
      if (!inputs.length) throw new Error('Wybierz co najmniej jeden plik audio.');
      for (const input of inputs) validateAutomationInput(input, value);
      for (const input of inputs) { selectedRun = await automation.enqueue(value, input); added++; }
      message = `Dodano ${inputs.length} ${inputs.length === 1 ? 'zadanie' : 'zadań'} do lokalnej kolejki.`;
    } catch (cause) { fail(cause); if (added) error = `Dodano ${added} zadań. Kolejnych nie dodano: ${error}`; } finally { saving = false; }
  }
  async function jobAction(id: string, operation: 'cancel' | 'retry') {
    error = ''; try { if (operation === 'cancel') await automation.cancel(id); else selectedRun = await automation.retry(id); } catch (cause) { fail(cause); }
  }
  async function remove() {
    error = ''; try { if (deleteKind === 'recipe') await automation.removeRecipe(deleting); else await automation.removeRun(deleting); deleting = ''; } catch (cause) { fail(cause); }
  }
  async function importRecipe(event: Event) {
    const input = event.currentTarget as HTMLInputElement; const file = input.files?.[0]; input.value = ''; if (!file) return;
    error = ''; try { if (file.size > 1024 * 1024) throw new Error('Plik receptury może mieć maksymalnie 1 MB.'); const parsed = validateRecipe(JSON.parse(await file.text())); recipe = { ...parsed, id: crypto.randomUUID(), name: `${parsed.name.slice(0, 105)} — import` }; message = 'Wczytano recepturę do edycji. Sprawdź głosy i zapisz własną kopię.'; } catch (cause) { fail(cause); }
  }
  function chooseFiles(event: Event) {
    const selected = [...((event.currentTarget as HTMLInputElement).files || [])];
    if (selected.length > 10) { files = []; error = 'Jednorazowo możesz uruchomić do 10 plików.'; }
    else { files = selected; error = ''; }
  }
  onMount(() => {
    let live = true;
    const unsubscribe = automation.subscribe(snapshot => { if (live) { recipes = snapshot.recipes; runs = snapshot.runs; } });
    const unsubscribeWatch = watchFolder.subscribe(snapshot => { if (live) watchEnabled = snapshot.enabled; });
    void automation.initialize().then(() => { if (live) loaded = true; }).catch(cause => { if (live) fail(cause); });
    return () => { live = false; unsubscribe(); unsubscribeWatch(); };
  });
  $effect(() => {
    if (!ready || !recipe.steps.some(step => step.kind === 'speak' || step.kind === 'convert')) return;
    const controller = new AbortController();
    void profiles(controller.signal).then(value => { if (!controller.signal.aborted) voices = value; }).catch(cause => { if (!controller.signal.aborted) fail(cause); });
    return () => controller.abort();
  });
  $effect(() => {
    if (resultRun?.result?.kind !== 'audio') { outputUrl = ''; return; }
    const url = URL.createObjectURL(resultRun.result.blob); outputUrl = url;
    return () => URL.revokeObjectURL(url);
  });
</script>

<ToolWorkspace title={tr("Automatyzacja")} description={tr("Zapisuj lokalne receptury i wykonuj ich kroki kolejno na tekście lub nagraniach.")} bind:tab historyCount={runs.length} historyLabel="Zadania">
  {#snippet content()}
    {#if error}<p class="tool-error" role="alert">{tr(String(error))}</p>{/if}{#if message}<p class="tool-notice" role="status">{tr(String(message))}</p>{/if}
    {#if !ready && !automationCanRun(recipe, false)}<p class="tool-workspace-note" role="status">{tr("Ta receptura wymaga silnika. Uruchom go w ustawieniach „Modele i silnik”. Obróbka audio do WAV działa także przy wyłączonym silniku.")}</p>{/if}
    <div class="automation-templates"><Button variant="outline" onclick={() => template('audio')}>{tr("Audio → WAV · bez modelu")}</Button><Button variant="outline" onclick={() => template('asr')}>{tr("Nagranie → tekst")}</Button><Button variant="outline" onclick={() => template('tts')}>{tr("Tekst → narracja")}</Button><Button variant="outline" onclick={() => template('convert')}>{tr("Inny głos")}</Button><Button variant="outline" onclick={() => template('translate')}>{tr("Tłumaczenie i narracja")}</Button></div>
    <div class="automation-name"><label for={`${uid}-name`}>{tr("Nazwa receptury")}</label><Input id={`${uid}-name`} bind:value={recipe.name} maxlength={120}/></div>
    <div class="automation-input-type"><Select ariaLabel="Wejście receptury" value={recipe.inputKind} onchange={value => recipe = { ...recipe, inputKind: value as 'audio' | 'text' }} options={[{ value: 'audio', label: tr("Wejście: nagranie audio") }, { value: 'text', label: tr("Wejście: tekst") }]}/><span>{recipe.steps.length} {tr("/ 8 kroków")}</span></div>
    <ol class="automation-steps">{#each recipe.steps as step, index (step.id)}<li>
      <div class="automation-step-heading"><span>{index + 1}</span><strong>{tr(String(automationLabels[step.kind]))}</strong><Button variant="ghost" aria-label={tr("Przenieś krok {arg0} w górę", { arg0: String(index + 1) })} disabled={index === 0} onclick={() => moveStep(index, -1)}><ArrowUp size={14}/></Button><Button variant="ghost" aria-label={tr("Przenieś krok {arg0} w dół", { arg0: String(index + 1) })} disabled={index === recipe.steps.length - 1} onclick={() => moveStep(index, 1)}><ArrowDown size={14}/></Button><Button variant="ghost" aria-label={tr("Usuń krok {arg0}", { arg0: String(index + 1) })} onclick={() => recipe = { ...recipe, steps: recipe.steps.filter(row => row.id !== step.id) }}><Trash2 size={14}/></Button></div>
      {#if step.kind === 'speak' || step.kind === 'convert'}<Select ariaLabel={tr("Głos kroku {arg0}", { arg0: String(index + 1) })} value={step.voiceId || ''} onchange={value => updateStep(index, 'voiceId', value)} options={[{ value: '', label: tr("Wybierz zapisany głos"), disabled: true }, ...voices.map(voice => ({ value: voice.id, label: voice.name }))]}/>{/if}
      {#if step.kind === 'speak'}<div class="automation-step-fields"><Select ariaLabel={tr("Język narracji kroku {arg0}", { arg0: String(index + 1) })} value={step.language || 'Polish'} onchange={value => updateStep(index, 'language', value)} options={productionLanguages.map(language => ({ value: language.tts, label: language.label }))}/><label>{tr("Tempo")}<Input type="number" min={0.5} max={2} step={0.05} value={step.speed ?? 1} oninput={event => updateStep(index, 'speed', Number(event.currentTarget.value))}/></label></div>{/if}
      {#if step.kind === 'translate'}<div class="automation-step-fields"><Select ariaLabel={tr("Silnik tłumaczenia kroku {arg0}", { arg0: String(index + 1) })} value={step.provider || 'argos'} onchange={value => updateStep(index, 'provider', value)} options={[{ value: 'argos', label: 'Argos — lokalnie' }, { value: 'nllb', label: 'NLLB — lokalnie' }]}/><Select ariaLabel={tr("Język źródłowy kroku {arg0}", { arg0: String(index + 1) })} value={step.sourceLanguage || 'auto'} onchange={value => updateStep(index, 'sourceLanguage', value)} options={[{ value: 'auto', label: tr("Język z transkrypcji") }, ...languageOptions]}/><Select ariaLabel={tr("Język docelowy kroku {arg0}", { arg0: String(index + 1) })} value={step.language || 'en'} onchange={value => updateStep(index, 'language', value)} options={languageOptions.map(option=>({...option,label:tr(option.label)}))}/></div><small>{tr("Przy wejściu tekstowym wybierz język źródłowy. Pakiety tłumaczeń muszą być wcześniej przygotowane.")}</small>{/if}
      {#if step.kind === 'transcribe'}<small>{tr("Używa wybranego lokalnego modelu ASR. Język rozpoznaje silnik; wynik nie jest ulepszany przez LLM.")}</small>{/if}
      {#if step.kind === 'convert'}<small>{tr("Rozpoznanie treści → synteza wybranym głosem, z dopasowaniem długości.")}</small>{/if}
      {#if step.kind === 'edit-audio'}
        {@const audio = step.audioEdit || defaultAutomationAudioEdit()}
        <small>{tr("Przycinanie, normalizacja i wygaszanie lokalnie w aplikacji. Bez silnika, modelu i pobierania. Do 5 minut oraz 16 milionów próbek kanałów; wynik PCM WAV 16-bit.")}</small>
        <div class="automation-step-fields"><label>{tr("Początek audio w s")}<Input type="number" min={0} max={300} step="any" value={audio.start} oninput={event => updateAudioStep(index, 'start', event.currentTarget.value)}/></label><label>{tr("Koniec audio w s")}<Input type="number" min={0} max={300} step="any" placeholder={tr("Do końca")} value={audio.end ?? ''} oninput={event => updateAudioStep(index, 'end', event.currentTarget.value)}/></label></div>
        <div class="automation-step-fields"><span>{tr("Normalizacja szczytu")}</span><Switch label={tr("Normalizacja kroku audio")} checked={audio.normalize} onchange={value => updateAudioStep(index, 'normalize', value)}/></div>
        <div class="automation-step-fields"><label>{tr("Szczyt audio w dBFS")}<Input type="number" min={-24} max={0} step="any" value={audio.targetDb} disabled={!audio.normalize} oninput={event => updateAudioStep(index, 'targetDb', event.currentTarget.value)}/></label><label>{tr("Głośność audio w dB")}<Input type="number" min={-60} max={24} step="any" value={audio.gainDb} disabled={audio.normalize} oninput={event => updateAudioStep(index, 'gainDb', event.currentTarget.value)}/></label></div>
        <div class="automation-step-fields"><label>{tr("Wejście audio w ms")}<Input type="number" min={0} step="any" value={audio.fadeInMs} oninput={event => updateAudioStep(index, 'fadeInMs', event.currentTarget.value)}/></label><label>{tr("Wyjście audio w ms")}<Input type="number" min={0} step="any" value={audio.fadeOutMs} oninput={event => updateAudioStep(index, 'fadeOutMs', event.currentTarget.value)}/></label></div>
      {/if}
    </li>{/each}</ol>
    <div class="automation-add"><Select ariaLabel="Nowy krok" bind:value={addKind} options={Object.entries(automationLabels).map(([value, label]) => ({ value, label }))}/><Button variant="outline" disabled={recipe.steps.length >= 8} onclick={addStep}><Plus size={15}/>{tr("Dodaj krok")}</Button></div>
    {#if recipeError}<p class="tool-inline-message" role="status">{recipeError}</p>{/if}
    <section class="automation-source"><h2>{tr("Wejście do uruchomienia")}</h2>{#if recipe.inputKind === 'text'}<Textarea aria-label={tr("Tekst wejściowy receptury")} bind:value={inputText} maxlength={20000} rows={7} placeholder={tr("Wpisz tekst do przetworzenia…")}/>{:else}<label class="automation-file"><Upload size={18}/><span>{tr("Wybierz do 10 nagrań, każde do 64 MB")}</span><input class="vs-file-input" type="file" multiple accept=".wav,.mp3,.flac,.ogg,.m4a,.aac,.opus,.webm,audio/*" onchange={chooseFiles}/></label>{#if files.length}<ul>{#each files as file}<li>{file.name} · {(file.size / 1024 / 1024).toLocaleString(tr.locale, { maximumFractionDigits: 1 })} {tr("MB")}</li>{/each}</ul>{/if}{/if}<p class="tool-workspace-note">{tr("Wejście, wynik i parametry zadania są zachowywane lokalnie w aplikacji, aby umożliwić odsłuch i ręczne ponowienie po restarcie.")}</p></section>
    {#if activeRuns.length}<section class="automation-active"><h2>{tr("Aktywne zadania")}</h2>{#each activeRuns as run}<article><div><strong>{run.recipe.name}</strong><span>{tr(String(runLabels[run.status]))} {tr("· ukończono")} {run.completedSteps} {tr("z")} {run.recipe.steps.length} {tr("kroków")}</span>{#if run.status !== 'queued'}<small>{tr(String(automationLabels[run.recipe.steps[run.stepIndex]?.kind]))}</small>{/if}</div><Button variant="outline" disabled={run.status === 'stopping'} onclick={() => jobAction(run.id, 'cancel')}><Square size={13}/>{run.status === 'queued' ? tr("Usuń z kolejki") : tr('Zatrzymaj po kroku')}</Button></article>{/each}</section>{/if}
    {#if resultRun?.result}<section class="automation-result"><h2>{resultRun.status === 'done' ? tr('Wynik') : tr("Ostatni ukończony krok")} · {resultRun.recipe.name}</h2>{#if outputUrl}<AudioPreview src={outputUrl} title={tr("Wynik automatyzacji")} onerror={() => error = tr("Nie można odtworzyć pliku wynikowego. Możesz go pobrać i sprawdzić.")}/><Button variant="outline" href={outputUrl} download={`${outputName}.wav`}><Download size={14}/>{tr("Pobierz audio")}</Button>{:else if resultText}<pre class="tool-output">{resultText}</pre><div class="tool-actions"><Button variant="outline" onclick={() => saveTextFile(resultText, `${outputName}.txt`, 'text/plain;charset=utf-8')}><Download size={14}/>{tr("Pobierz tekst")}</Button>{#if ontext}<Button variant="outline" onclick={() => ontext?.(resultText)}>{tr("Przenieś do edytora")}</Button>{/if}</div>{/if}</section>{/if}
    {#if deleting}<div class="tool-confirm"><p>{deleteKind === 'recipe' ? tr("Usunąć wybraną recepturę? Zapisane zadania i ich wyniki pozostaną zachowane.") : tr("Usunąć wybrane zadanie wraz z jego zapisanym wejściem i wynikiem?")}</p><Button variant="outline" onclick={remove}>{tr("Usuń wskazany element")}</Button><Button variant="ghost" onclick={() => deleting = ''}>{tr("Zachowaj")}</Button></div>{/if}
  {/snippet}
  {#snippet settings()}
    <div class="tool-workspace-section"><h2>{tr("Receptury lokalne")}</h2><Button variant="outline" disabled={!loaded || saving || !!recipeError} onclick={save}><Save size={14}/>{tr("Zapisz recepturę")}</Button><Button variant="ghost" onclick={() => { recipe = fresh(); message = ''; error = ''; }}><Plus size={14}/>{tr("Nowa receptura")}</Button>{#each recipes as saved}<div class="automation-saved"><Button variant="ghost" onclick={() => { recipe = structuredClone(saved); tab = 'settings'; error = ''; }}>{saved.name}</Button><Button variant="ghost" aria-label={tr("Usuń recepturę {arg0}", { arg0: String(saved.name) })} onclick={() => { deleteKind = 'recipe'; deleting = saved.id; }}><Trash2 size={14}/></Button></div>{/each}</div>
    <WatchFolderPanel {recipes} {ready} disabled={saving || modelBusy || asrModelBusy}/>
    {#if ready && recipe.steps.some(step => step.kind === 'speak' || step.kind === 'convert')}<ToolModelSettings {ready} disabled={activeRuns.length > 0 || watchEnabled} bind:busy={modelBusy} family="tts"/>{/if}
    {#if ready && recipe.steps.some(step => step.kind === 'transcribe' || step.kind === 'convert')}<ToolModelSettings {ready} disabled={activeRuns.length > 0 || watchEnabled} bind:busy={asrModelBusy} family="asr"/>{/if}
    <div class="tool-workspace-section"><h2>{tr("Przenoszenie receptur")}</h2><Button variant="outline" disabled={!!recipeError} onclick={() => saveTextFile(JSON.stringify(validateRecipe(recipe), null, 2), 'receptura.json')}>{tr("Eksportuj parametry")}</Button><Button variant="outline" as="label"><Upload size={14}/>{tr("Importuj recepturę")}<input class="vs-file-input" type="file" accept="application/json,.json" onchange={importRecipe}/></Button><p class="tool-workspace-note">{tr("Eksport zawiera parametry i identyfikatory głosów. Nagrania wejściowe pozostają w historii zadań tej aplikacji.")}</p></div>
    <p class="tool-workspace-note">{tr("Kolejka wykonuje jedno zadanie na raz. Przełączanie ekranów zachowuje wykonywane zadanie. Zamknięcie aplikacji oznacza przerwanie; ponowienie zawsze wymaga twojej akcji.")}</p>
  {/snippet}
  {#snippet history()}
    {#if !runs.length}<p class="tool-workspace-note">{tr("Po uruchomieniu receptury pojawią się tu trwałe zadania i wyniki.")}</p>{/if}
    <div class="automation-history">{#each runs as run}<article><strong>{run.recipe.name}</strong><span>{tr(String(runLabels[run.status]))} · {run.completedSteps}/{run.recipe.steps.length} {tr("· próba")} {run.attempt}</span><small>{new Date(run.createdAt).toLocaleString(tr.locale)}</small>{#if run.error}<p role="status">{tr(String(run.error))}</p>{/if}<div class="tool-actions">{#if run.result}<Button variant="outline" onclick={() => selectedRun = run.id}>{tr("Pokaż wynik")}</Button>{/if}{#if activeAutomationRun(run)}<Button variant="ghost" disabled={run.status === 'stopping'} onclick={() => jobAction(run.id, 'cancel')}>{tr("Zatrzymaj")}</Button>{:else}<Button variant="outline" disabled={!automationCanRun(run.recipe, ready)} onclick={() => jobAction(run.id, 'retry')}><RotateCcw size={13}/>{tr("Uruchom od początku")}</Button><Button variant="ghost" aria-label={tr("Usuń zadanie {arg0}", { arg0: String(run.recipe.name) })} onclick={() => { deleteKind = 'run'; deleting = run.id; }}><Trash2 size={14}/></Button>{/if}</div></article>{/each}</div>
  {/snippet}
  {#snippet actions()}
    <span class="tool-action-status"><Workflow size={16}/>{saving ? 'Zapisywanie…' : activeRuns.length ? tr("{arg0} zadań w kolejce", { arg0: String(activeRuns.length) }) : loaded ? tr("Gotowe do uruchomienia") : 'Wczytywanie magazynu…'}</span><Button variant="default" disabled={!automationCanRun(recipe, ready) || !loaded || saving || modelBusy || asrModelBusy || !!recipeError || recipe.inputKind === 'audio' && !files.length || recipe.inputKind === 'text' && !inputText.trim()} onclick={run}><Play size={15}/>{tr("Uruchom recepturę")}</Button>
  {/snippet}
</ToolWorkspace>

<style>
  .automation-templates,.automation-add,.automation-input-type{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.automation-templates{margin-bottom:24px}.automation-name{display:flex;flex-direction:column;gap:9px;margin-bottom:18px}.automation-name label{font-size:var(--ui-text-12);color:var(--muted)}.automation-input-type>span{font-size:var(--ui-text-11);color:var(--muted)}.automation-steps{display:flex;flex-direction:column;gap:14px;padding:0;margin:24px 0;list-style:none}.automation-steps>li{border:1px solid var(--border);padding:18px;border-radius:9px;display:flex;flex-direction:column;gap:13px}.automation-step-heading{display:flex;align-items:center;gap:8px}.automation-step-heading>span{font-size:var(--ui-text-11);color:var(--muted);width:18px}.automation-step-heading>strong{flex:1;font-size:var(--ui-text-13);font-weight:500}.automation-step-fields{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.automation-step-fields label{display:flex;gap:8px;align-items:center;font-size:var(--ui-text-12)}.automation-step-fields :global(input[type=number]){max-width:90px}.automation-steps small{font-size:var(--ui-text-11);color:var(--muted);line-height:1.7}.automation-source,.automation-active,.automation-result{margin-top:30px;display:flex;flex-direction:column;gap:16px}.automation-source h2,.automation-active h2,.automation-result h2{font-size:var(--ui-text-13);font-weight:550;margin:0}.automation-source>ul{padding-left:18px;font-size:var(--ui-text-12);line-height:1.9}.automation-file{display:flex;align-items:center;gap:13px;flex-wrap:wrap;border:1px dashed var(--border);border-radius:8px;padding:24px;font-size:var(--ui-text-12)}.automation-file input{max-width:240px}.automation-active article{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:16px 0;border-bottom:1px solid var(--border)}.automation-active article>div{flex:1;display:flex;flex-direction:column;gap:8px}.automation-active strong{font-size:var(--ui-text-13)}.automation-active span,.automation-active small{font-size:var(--ui-text-11);color:var(--muted)}.automation-result>:global(a[data-slot="button"]){align-self:flex-start}.automation-saved{display:flex;gap:6px;align-items:center}.automation-saved>:first-child{flex:1;justify-content:flex-start;text-align:left;overflow-wrap:anywhere}.automation-history{display:flex;flex-direction:column;gap:20px}.automation-history article{display:flex;flex-direction:column;gap:9px;padding-bottom:20px;border-bottom:1px solid var(--border)}.automation-history strong{font-size:var(--ui-text-12)}.automation-history span,.automation-history small,.automation-history p{font-size:var(--ui-text-11);line-height:1.7;color:var(--muted);margin:0}.automation-history .tool-actions{margin:0;gap:8px}.tool-confirm p{font-size:var(--ui-text-12);line-height:1.7;margin:0}
</style>
