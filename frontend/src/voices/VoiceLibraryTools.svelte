<script lang="ts">
  import Checkbox from '../ui/Checkbox.svelte'
  function uiOptions<T extends { label: string }>(items: readonly T[]): T[] { return items.map(item => ({ ...item, label: tr(item.label) })); }

  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import Button from '../ui/Button.svelte';
  import AudioPreview from '../playback/AudioPreview.svelte';
  import FilePicker from '../ui/FilePicker.svelte';
  import { onDestroy, untrack } from 'svelte';
  import { RefreshCw, Download, Upload, Play, Sparkles } from '@lucide/svelte';
  import type { Profile } from '../platform/api';
  import Select from '../ui/Select.svelte';
  import { profileLanguages } from './voice-reference';
  import { voiceLanguage } from './voice-picker';
  import {
    archetypeCategories, createPersonalityProfile, emptyArchetypeFilters, exportPersona, importPersona, inspectPersona,
    loadArchetypes, loadLibraryProfiles, loadPersonalities, personalityLabels, personaLicenses, previewArchetype, useArchetype,
    importedPersonaMetadata, rememberPersonaMetadata, type ImportedPersonaMetadata, type Archetype, type ArchetypePage, type PersonaInspection, type Personality,
  } from './voice-library-tools';
  import '../tools/studio-tools.css';

  let { ready, onchange, oncreated }: { ready: boolean; onchange: () => Promise<void>; oncreated?: (profile: Profile) => void | Promise<void> } = $props();
  const uid = $props.id();
  let tab = $state<'archetypes' | 'personalities' | 'personas'>('archetypes');
  let filters = $state(emptyArchetypeFilters()), page = $state<ArchetypePage>({ items: [], total: 0, limit: 24, offset: 0 });
  let selected = $state<Archetype>(), profileName = $state(''), personalities = $state<Personality[]>([]), personalityId = $state(''), language = $state('Polish');
  let presetText = $state('Cześć. To jest próbka zaprojektowanego głosu.');
  let profiles = $state<Profile[]>([]), exportId = $state(''), license = $state(personaLicenses[0].value), tags = $state(''), includeReference = $state(true);
  let sourceMetadata = $state<ImportedPersonaMetadata>();
  let importFile = $state<File>(), inspection = $state<PersonaInspection>(), inspectedFile = $state<File>();
  let busy = $state(false), loading = $state(false), error = $state(''), message = $state(''), audioUrl = $state('');
  let pendingProfile = $state<Profile>(), importSummary = $state('');
  let controller: AbortController | undefined, readController: AbortController | undefined, disposed = false;
  const currentPersonality = $derived(personalities.find(item => item.id === personalityId));
  const locked = $derived(busy || loading || !!pendingProfile);
  const licenseOptions = $derived(personaLicenses.some(item => item.value === license) ? personaLicenses : [...personaLicenses, { value: license, label: license }]);
  function chooseExport(id: string) { exportId = id; sourceMetadata = importedPersonaMetadata(id); license = sourceMetadata?.license || personaLicenses[0].value; tags = sourceMetadata?.tags.join(', ') || ''; }

  function fail(cause: unknown) { if (!disposed && (cause as Error).name !== 'AbortError') error = (cause as Error).name === 'TimeoutError' ? 'Silnik nie odpowiedział na czas. Spróbuj odświeżyć bibliotekę.' : (cause as Error).message || String(cause); }
  function clearAudio() { if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = ''; }
  async function refresh(signal?: AbortSignal) {
    readController?.abort(); const current = new AbortController(); readController = current;
    const combined = signal ? AbortSignal.any([signal, current.signal]) : current.signal;
    loading = true;
    try {
      const [result, presets, library] = await Promise.all([loadArchetypes(filters, 0, combined), loadPersonalities(combined), loadLibraryProfiles(combined)]);
      combined.throwIfAborted(); if (disposed || readController !== current) return;
      page = result; personalities = presets; profiles = library;
      if (!presets.some(item => item.id === personalityId)) personalityId = presets[0]?.id || '';
      if (!library.some(item => item.id === exportId)) chooseExport(library[0]?.id || '');
    } finally { if (readController === current && !disposed) loading = false; }
  }
  async function search(offset = 0) {
    if (!ready || locked) return;
    readController?.abort(); const current = new AbortController(); readController = current;
    loading = true; error = '';
    try { const result = await loadArchetypes(filters, offset, current.signal); current.signal.throwIfAborted(); if (!disposed) page = result; }
    catch (cause) { if (!current.signal.aborted) fail(cause); }
    finally { if (readController === current && !disposed) loading = false; }
  }
  async function work(fn: (signal: AbortSignal) => Promise<void>) {
    if (!ready || busy || loading || disposed) return;
    const current = new AbortController(); controller = current; busy = true; error = ''; message = '';
    try { await fn(current.signal); }
    catch (cause) { if (!current.signal.aborted) fail(cause); }
    finally { if (controller === current) { controller = undefined; if (!disposed) busy = false; } }
  }
  async function finishCreated(signal: AbortSignal) {
    if (!pendingProfile) return;
    if (oncreated) await oncreated(pendingProfile); else await onchange();
    signal.throwIfAborted();
    profiles = await loadLibraryProfiles(signal); signal.throwIfAborted();
    chooseExport(pendingProfile.id); pendingProfile = undefined; message = 'Głos zapisano w lokalnej bibliotece.';
  }
  async function created(profile: Profile, signal: AbortSignal) { pendingProfile = profile; await finishCreated(signal); }
  function chooseArchetype(item: Archetype) { selected = item; profileName = item.name; clearAudio(); message = ''; error = ''; }
  async function materialize() { if (!selected || pendingProfile) return; await work(async signal => { const profile = await useArchetype(selected!.id, profileName, signal); await created(profile, signal); }); }
  async function preview() { if (!selected || pendingProfile) return; await work(async signal => { const blob = await previewArchetype(selected!.id, signal); signal.throwIfAborted(); clearAudio(); audioUrl = URL.createObjectURL(blob); }); }
  async function createPreset() { if (!currentPersonality || pendingProfile || !presetText.trim()) return; await work(async signal => { const profile = await createPersonalityProfile(currentPersonality!, profileName, language, signal, presetText); await created(profile, signal); }); }
  async function inspect() {
    if (!importFile) return;
    const file = importFile; inspection = undefined; inspectedFile = undefined; importSummary = '';
    await work(async signal => { const result = await inspectPersona(file, signal); signal.throwIfAborted(); inspection = result; inspectedFile = file; });
  }
  async function importBundle() {
    if (!inspection || !importFile || importFile !== inspectedFile || pendingProfile) return;
    await work(async signal => {
      const result = await importPersona(importFile!, signal); signal.throwIfAborted();
      if (!result.success || !result.profile_id) throw new Error('Silnik nie potwierdził utworzenia profilu.');
      importSummary = `Zaimportowano „${result.name}” jako nowy profil ${result.profile_id}. Licencja: ${result.license_spdx}. ${result.preview_only ? 'Źródłem głosu jest skrócony podgląd.' : 'Pakiet zawiera pełną referencję.'}`;
      if (!rememberPersonaMetadata(result.profile_id, inspection!, importFile!.name)) importSummary += ' Nie udało się zachować metadanych pakietu w pamięci tej aplikacji.';
      inspection = undefined; inspectedFile = undefined;
      await created({ id: result.profile_id, name: result.name, kind: result.kind }, signal);
    });
  }
  async function exportBundle() {
    if (!exportId) return;
    await work(async signal => {
      const result = await exportPersona(exportId, { license, tags, includeReference }, signal); signal.throwIfAborted();
      const url = URL.createObjectURL(result.blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = result.filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
      message = tr("Przygotowano lokalny plik {filename}.", { filename: result.filename });
    });
  }
  $effect(() => {
    if (!ready) return;
    const lifecycle = new AbortController();
    void untrack(() => refresh(lifecycle.signal)).catch(cause => { if (!lifecycle.signal.aborted) fail(cause); });
    return () => { lifecycle.abort(); readController?.abort(); controller?.abort(); busy = false; loading = false; };
  });
  onDestroy(() => { disposed = true; readController?.abort(); controller?.abort(); clearAudio(); });
</script>

<section class="studio-tools voice-library-tools" aria-label={tr("Archetypy, presety i przenoszenie głosów")}>
  <div class="page-heading"><div><h2>{tr("Rozszerz bibliotekę głosów")}</h2><p>{tr("Gotowe projekty brzmienia i lokalne pakiety person.")}</p></div><Button variant="outline" disabled={!ready || busy || loading} onclick={() => work(refresh)}><RefreshCw size={15}/>{tr("Odśwież bibliotekę")}</Button></div>
  {#if !ready}<p class="tool-notice">{tr("Uruchom lokalny silnik, aby wczytać katalog i przenosić głosy.")}</p>{/if}
  {#if error}<p class="tool-error" role="alert">{tr(error)}</p>{/if}{#if message}<p class="tool-notice" role="status">{tr(message)}</p>{/if}
  {#if pendingProfile}<div class="tool-notice" role="status">{tr("Profil „")}{pendingProfile.name}{tr("” został zapisany. Dokończ odświeżenie biblioteki.")}<Button variant="outline" disabled={busy || loading} onclick={() => work(finishCreated)}>{tr("Otwórz zapisany głos")}</Button></div>{/if}
  <div class="filter-tabs" aria-label={tr("Narzędzia biblioteki głosów")}>{#each [['archetypes','Archetypy'],['personalities','Presety brzmienia'],['personas','Import i eksport']] as [value,label]}<button class:chosen={tab === value} disabled={busy} onclick={() => { tab = value as typeof tab; clearAudio(); }}>{tr(label)}</button>{/each}</div>

  {#if tab === 'archetypes'}
    <div class="tool-card">
      <h3>{tr("Archetypy głosu")}</h3><p class="page-footnote">{tr("Katalog opisuje syntetyczne projekty brzmienia. Odsłuch i użycie przygotowują próbkę na tym komputerze. Ponowne użycie tego samego archetypu przywraca jego istniejący profil.")}</p>
      <form onsubmit={event => { event.preventDefault(); void search(); }}>
        <label for={`${uid}-query`}>{tr("Szukaj nazwy lub cechy")}</label><input id={`${uid}-query`} class="text-input" bind:value={filters.query} disabled={!ready || locked} placeholder={tr("np. Librarian, whisper, british")}/>
        <div class="tool-columns"><Select label={tr("Zastosowanie")} value={filters.category} onchange={value => filters = { ...filters, category: value }} disabled={!ready || locked} options={uiOptions([{ value: '', label: 'Wszystkie zastosowania' }, ...Object.entries(archetypeCategories).map(([value,label]) => ({value,label}))])}/><Select label={tr("Język próbki")} value={filters.language} onchange={value => filters = { ...filters, language: value }} disabled={!ready || locked} options={uiOptions([{ value: '', label: 'Wszystkie języki' }, ...profileLanguages.filter(row => row.value !== 'Auto')])}/></div>
        <details><summary>{tr("Więcej filtrów")}</summary><div class="tool-columns">
          <Select label={tr("Barwa")} value={filters.gender} onchange={value => filters = { ...filters, gender: value }} disabled={locked} options={uiOptions([{value:'',label:'Wszystkie'}, {value:'female',label:'Żeńska'}, {value:'male',label:'Męska'}])}/>
          <Select label={tr("Wiek brzmienia")} value={filters.age} onchange={value => filters = { ...filters, age: value }} disabled={locked} options={uiOptions([{value:'',label:'Wszystkie'}, {value:'child',label:'Dziecięcy'}, {value:'teenager',label:'Nastoletni'}, {value:'young adult',label:'Młody dorosły'}, {value:'middle-aged',label:'Dojrzały'}, {value:'elderly',label:'Starszy'}])}/>
          <Select label={tr("Wysokość")} value={filters.pitch} onchange={value => filters = { ...filters, pitch: value }} disabled={locked} options={uiOptions([{value:'',label:'Wszystkie'}, {value:'very low pitch',label:'Bardzo niska'}, {value:'low pitch',label:'Niska'}, {value:'moderate pitch',label:'Średnia'}, {value:'high pitch',label:'Wysoka'}, {value:'very high pitch',label:'Bardzo wysoka'}])}/>
          <Select label={tr("Zestaw")} value={filters.featured} onchange={value => filters = { ...filters, featured: value }} disabled={locked} options={uiOptions([{value:'',label:'Wszystkie archetypy'}, {value:'true',label:'Wybrane archetypy'}, {value:'false',label:'Archetypy generowane z cech'}])}/>
          <Select label={tr("Sposób mówienia")} value={filters.whisper} onchange={value => filters = { ...filters, whisper: value }} disabled={locked} options={uiOptions([{value:'',label:'Wszystkie'}, {value:'true',label:'Szept'}, {value:'false',label:'Bez szeptu'}])}/>
        </div><label for={`${uid}-accent`}>{tr("Akcent silnika")}</label><input id={`${uid}-accent`} class="text-input" bind:value={filters.accent} placeholder={tr("np. british accent")} disabled={locked}/></details>
        <div class="tool-actions"><Button variant="outline" type="submit" disabled={!ready || locked}>{tr("Szukaj archetypów")}</Button><Button variant="ghost" type="button" disabled={!ready || locked} onclick={() => { filters = emptyArchetypeFilters(); void search(); }}>{tr("Wyczyść filtry")}</Button></div>
      </form>
      <p class="page-footnote" role="status">{loading ? tr('Wczytywanie katalogu…') : `${tr('Wyniki:')} ${page.total}. ${page.total ? `${page.offset + 1}–${Math.min(page.offset + page.items.length, page.total)}` : ''}`}</p>
      <div class="archetype-grid">{#each page.items as item (item.id)}<button class="archetype-card" class:selected={selected?.id === item.id} disabled={locked} aria-pressed={selected?.id === item.id} onclick={() => chooseArchetype(item)}><strong>{item.name}</strong><span>{voiceLanguage(item.language)} · {archetypeCategories[item.use_case] || item.use_case}</span><small>{item.instruct}</small></button>{/each}</div>
      <div class="tool-actions"><Button variant="outline" disabled={!ready || locked || !page.offset} onclick={() => search(Math.max(0, page.offset - page.limit))}>{tr("Poprzednia strona")}</Button><Button variant="outline" disabled={!ready || locked || page.offset + page.items.length >= page.total} onclick={() => search(page.offset + page.limit)}>{tr("Następna strona")}</Button></div>
      {#if selected}<div class="library-selection"><h3>{selected.name}</h3><p class="page-footnote">{tr("Tekst lokalnej próbki:")}</p><p class="tool-output">{selected.sample_script}</p><label for={`${uid}-archetype-name`}>{tr("Nazwa profilu")}</label><input id={`${uid}-archetype-name`} class="text-input" bind:value={profileName} disabled={locked}/><div class="tool-actions"><Button variant="outline" disabled={!ready || locked} onclick={preview}><Play size={15}/>{tr("Przygotuj lokalny odsłuch")}</Button><Button variant="default" disabled={!ready || locked || !profileName.trim()} onclick={materialize}><Sparkles size={15}/>{tr("Użyj archetypu w bibliotece")}</Button></div>{#if audioUrl}<AudioPreview src={audioUrl} title={tr("Próbka archetypu {name}", { name: selected.name })}/>{/if}</div>{/if}
    </div>
  {:else if tab === 'personalities'}
    <div class="tool-card">
      <h3>{tr("Presety brzmienia")}</h3><p class="page-footnote">{tr("Preset wybiera obsługiwane cechy modelu. Zapis tworzy projektowany głos i próbuje przygotować próbkę; gdy model nie jest gotowy, próbka pozostaje do wygenerowania przy pierwszym użyciu.")}</p>
      <Select label={tr("Preset")} value={personalityId} onchange={value => { const preset = personalities.find(item => item.id === value); personalityId = value; profileName = personalityLabels[value]?.name || preset?.name || ''; language = preset?.language || 'Polish'; presetText = preset?.script || 'Cześć. To jest próbka zaprojektowanego głosu.'; }} disabled={!ready || locked} options={uiOptions(personalities.map(item => ({value:item.id,label:personalityLabels[item.id]?.name || item.name})))}/>
      {#if currentPersonality}
        <p>{personalityLabels[currentPersonality.id]?.description ? tr(personalityLabels[currentPersonality.id].description) : currentPersonality.name}</p><p class="page-footnote">{tr("Cechy silnika:")} {currentPersonality.instruct}</p>
        <label for={`${uid}-preset-name`}>{tr("Nazwa nowego głosu")}</label><input id={`${uid}-preset-name`} class="text-input" bind:value={profileName} disabled={locked}/>
        <Select label={tr("Język próbki")} value={language} onchange={value => language = value} options={uiOptions(profileLanguages)} disabled={locked}/>
        <label for={`${uid}-preset-text`}>{tr("Tekst próbki w wybranym języku")}</label><textarea id={`${uid}-preset-text`} class="text-input" rows="3" bind:value={presetText} disabled={locked} maxlength="1000"></textarea>
        <p class="page-footnote">{tr("Po zmianie języka dopasuj również słowa próbki.")}</p>
        <Button variant="default" disabled={!ready || locked || !profileName.trim() || !presetText.trim()} onclick={createPreset}>{tr("Zapisz preset jako nowy głos")}</Button>
      {/if}
    </div>
  {:else}
    <div class="tool-columns persona-columns">
      <div class="tool-card"><h3>{tr("Import persony")}</h3><p class="page-footnote">{tr("Pakiet .ovsvoice lub starszy .omnivoice przenosi brzmienie i metadane. Najpierw sprawdź plik; import tworzy nowy identyfikator i zachowuje istniejące profile, także o tej samej nazwie.")}</p><FilePicker label={tr("Wybierz pakiet głosu")} ariaLabel={tr("Lokalny pakiet głosu")} accept=".ovsvoice,.omnivoice" disabled={!ready || locked} onchange={files => { importFile = files[0]; inspection = undefined; inspectedFile = undefined; importSummary = ''; error = ''; }}/><Button variant="outline" disabled={!ready || locked || !importFile} onclick={inspect}><Upload size={15}/>{tr("Sprawdź pakiet przed importem")}</Button>
        {#if inspection}<dl class="persona-metadata"><dt>{tr("Nazwa")}</dt><dd>{inspection.name}</dd><dt>{tr("Rodzaj")}</dt><dd>{inspection.kind === 'design' ? tr("Projektowany") : tr("Klonowany")}</dd><dt>{tr("Język")}</dt><dd>{voiceLanguage(inspection.language)}</dd><dt>{tr("Licencja")}</dt><dd>{inspection.license_spdx}</dd><dt>{tr("Format")}</dt><dd>{inspection.format} {tr("· schemat")} {inspection.schema_version}</dd><dt>{tr("Tagi")}</dt><dd>{inspection.tags.length ? inspection.tags.join(', ') : tr("Brak")}</dd><dt>{tr("Nagranie")}</dt><dd>{inspection.preview_only ? tr("Tylko skrócona próbka podglądu") : tr("Pełna referencja lub utrwalone ujęcie")}</dd><dt>{tr("Znak wodny podglądu")}</dt><dd>{inspection.watermarked_preview ? tr("Oznaczony według metadanych pakietu") : tr("Brak potwierdzonego oznaczenia")}</dd><dt>{tr("Zgoda w pakiecie")}</dt><dd>{inspection.consent?.has_recording ? tr("Zawiera nagranie zgody; silnik sprawdzi kompletność przy imporcie") : tr("Brak nagrania zgody")}</dd></dl>{#if inspection.schema_version_ahead}<p class="tool-notice">{tr("Pakiet używa nowszej wersji schematu. Silnik odczyta znane pola; pozostałe mogą nie zostać przeniesione.")}</p>{/if}<Button variant="default" disabled={!ready || locked || importFile !== inspectedFile} onclick={importBundle}>{tr("Importuj jako nowy profil")}</Button>{/if}
        {#if importSummary}<p class="tool-notice" role="status">{importSummary}</p>{/if}
      </div>
      <div class="tool-card">
        <h3>{tr("Eksport persony")}</h3>
        <p class="page-footnote">{tr("Eksport zapisuje plik .ovsvoice na komputerze. Przygotowuje krótki podgląd istniejącej referencji i oznacza go, jeśli lokalny moduł znaku wodnego jest dostępny.")}</p>
        <Select label={tr("Głos do eksportu")} value={exportId} onchange={chooseExport} disabled={!ready || locked} options={profiles.map(item => ({value:item.id,label:item.name}))}/>
        {#if sourceMetadata}<p class="page-footnote">{tr("Zaimportowano z:")} {sourceMetadata.source}{tr(". Licencja źródłowa:")} {sourceMetadata.license}{tr(". Metadane są zapisane lokalnie w tej aplikacji.")}</p>{/if}
        <Select label={tr("Licencja zapisana w pakiecie")} value={license} onchange={value => license = value} options={licenseOptions} disabled={locked}/>
        <label for={`${uid}-tags`}>{tr("Tagi oddzielone przecinkami")}</label><input id={`${uid}-tags`} class="text-input" bind:value={tags} disabled={locked}/>
        <label class="tool-checkbox"><Checkbox bind:checked={includeReference} disabled={locked}/>{tr("Dołącz pełne nagranie referencyjne i utrwalone ujęcie")}</label>
        <p class="page-footnote">{tr("Bez pełnej referencji pakiet zawiera tylko podgląd do 8 sekund, który będzie referencją po imporcie. Zapisane nagranie zgody jest dołączane niezależnie od tej opcji. Licencja jest metadanymi wybranymi przez eksportującego.")}</p>
        <Button variant="default" disabled={!ready || locked || !exportId} onclick={exportBundle}><Download size={15}/>{tr("Zapisz plik persony")}</Button>
      </div>
    </div>
  {/if}
  {#if busy}<p class="tool-notice" role="status">{tr("Silnik przetwarza żądanie. Przygotowanie lokalnego brzmienia może potrwać dłużej.")}</p>{/if}
</section>

<style>
  .voice-library-tools{margin-top:28px}.voice-library-tools h3{margin:0;font-size:var(--ui-text-14)}.voice-library-tools p{line-height:1.7}.voice-library-tools .filter-tabs{flex-wrap:wrap}.archetype-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.archetype-card{display:flex;flex-direction:column;align-items:flex-start;text-align:left;gap:9px;padding:14px;border:1px solid var(--border);border-radius:8px;background:var(--background);color:var(--foreground);min-width:0}.archetype-card.selected{border-color:var(--foreground)}.archetype-card span,.archetype-card small{font-size:var(--ui-text-11);line-height:1.6;color:var(--muted);overflow-wrap:anywhere}.archetype-card strong{font-size:var(--ui-text-12);font-weight:550}.library-selection{display:grid;gap:12px;padding-top:18px;border-top:1px solid var(--border)}.persona-columns{align-items:start}.persona-columns>.tool-card{min-width:0}.persona-metadata{display:grid;grid-template-columns:minmax(80px,.7fr) minmax(0,1.3fr);gap:12px;font-size:var(--ui-text-12);line-height:1.6}.persona-metadata dt{color:var(--muted)}.persona-metadata dd{margin:0;overflow-wrap:anywhere}@media(max-width:1000px){.archetype-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.archetype-grid{grid-template-columns:1fr}.persona-metadata{grid-template-columns:1fr;gap:7px}.persona-metadata dd{margin-bottom:8px}}
</style>
