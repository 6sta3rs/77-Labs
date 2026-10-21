<script lang="ts">
  import Button from './ui/Button.svelte';
  import { onDestroy } from 'svelte';
  import { RefreshCw, Save, Download } from '@lucide/svelte';
  import Select from './ui/Select.svelte';
  import ReferenceAudioInput from './ReferenceAudioInput.svelte';
  import { request, transcribe } from './api';
  import { assertModelLicenseResponse } from './model-licenses';
  import { profileLanguages } from './voice-reference';
  import { productionJson, postJson } from './production';
  import { backendHistory, type BackendRecording } from './studio-tools';
  import './studio-tools.css';
  type Profile = { id: string; name: string; kind: string; language: string; ref_text: string; instruct: string; is_locked: boolean; verified_own_voice: boolean; audio_url?: string | null; consent_text?: string; consent_recorded_at?: number; vd_states?: string };
  type Usage = { synth_total: number; project_total_segments: number; projects: Array<{project_id: string; project_name: string; segment_count: number}> };
  type Description = { attrs: Record<string, string>; instruct: string; unmatched: string[] };
  let { ready, onchange }: { ready: boolean; onchange: () => Promise<void> } = $props();
  const uid = $props.id();
  let profiles = $state<Profile[]>([]), selected = $state(''), name = $state(''), language = $state('Polish'), reference = $state(''), instruction = $state('');
  let description = $state(''), unmatched = $state<string[]>([]), audioUrl = $state(''), portrait = $state<File>(), consent = $state<File>(), consentText = $state(''), deleting = $state(false);
  let replacement = $state<File>(), replacementText = $state(''), recording = $state(false), revoking = $state(false), usage = $state<Usage>();
  let sampleError = $state(''), sampleDuration = $state(0);
  let selectionVersion = $state(0), sampleExtension = $state('wav');
  const selectedProfile = $derived(profiles.find(p => p.id === selected));
  const languages = $derived(profileLanguages.some(row => row.value === language) ? profileLanguages : [...profileLanguages, { value: language, label: language }]);
  let busy = $state(false), error = $state(''), message = $state('');
  let controller: AbortController | undefined, refreshController: AbortController | undefined;
  let refreshPending: Promise<void> | undefined;
  let loading = $state(false), disposed = false;
  let takes = $state<BackendRecording[]>([]), takeId = $state('');
  const categories = [
    { key: 'Gender', label: 'Barwa głosu', values: ['Auto', 'male', 'female'], labels: ['Automatyczna', 'Męska', 'Żeńska'] },
    { key: 'Age', label: 'Wiek brzmienia', values: ['Auto', 'child', 'teenager', 'young adult', 'middle-aged', 'elderly'], labels: ['Automatyczny', 'Dziecięcy', 'Nastoletni', 'Młody dorosły', 'Dojrzały', 'Starszy'] },
    { key: 'Pitch', label: 'Wysokość głosu', values: ['Auto', 'very low pitch', 'low pitch', 'moderate pitch', 'high pitch', 'very high pitch'], labels: ['Automatyczna', 'Bardzo niska', 'Niska', 'Średnia', 'Wysoka', 'Bardzo wysoka'] },
    { key: 'Style', label: 'Sposób mówienia', values: ['Auto', 'whisper'], labels: ['Zwykły', 'Szept'] },
    { key: 'EnglishAccent', label: 'Akcent angielski', values: ['Auto', 'american accent', 'british accent', 'australian accent', 'canadian accent', 'indian accent', 'chinese accent', 'korean accent', 'japanese accent', 'portuguese accent', 'russian accent'], labels: ['Automatyczny', 'Amerykański', 'Brytyjski', 'Australijski', 'Kanadyjski', 'Indyjski', 'Chiński', 'Koreański', 'Japoński', 'Portugalski', 'Rosyjski'] },
    { key: 'ChineseDialect', label: 'Dialekt chiński', values: ['Auto', '河南话', '陕西话', '四川话', '贵州话', '云南话', '桂林话', '济南话', '石家庄话', '甘肃话', '宁夏话', '青岛话', '东北话'], labels: ['Automatyczny', 'Henan', 'Shaanxi', 'Sichuan', 'Guizhou', 'Yunnan', 'Guilin', 'Jinan', 'Shijiazhuang', 'Gansu', 'Ningxia', 'Qingdao', 'Dongbei'] },
  ];
  let attrs = $state<Record<string, string>>(Object.fromEntries(categories.map(row => [row.key, 'Auto'])));
  function refresh(parentSignal?: AbortSignal): Promise<void> {
    if (refreshPending && !refreshController?.signal.aborted) return refreshPending;
    const abort = new AbortController(); refreshController = abort;
    const signal = parentSignal ? AbortSignal.any([abort.signal, parentSignal]) : abort.signal;
    loading = true;
    refreshPending = (async () => {
      try {
        const result = await productionJson<Profile[]>('/profiles', { signal });
        signal.throwIfAborted();
        if (!disposed && refreshController === abort) profiles = result;
      } finally {
        if (refreshController === abort) { refreshPending = undefined; if (!disposed) loading = false; }
      }
    })();
    return refreshPending;
  }
  function fail(cause: unknown) { if (!disposed && !(cause instanceof Error && cause.name === 'AbortError')) error = cause instanceof Error && cause.name === 'TimeoutError' ? 'Silnik nie odpowiedział na czas. Spróbuj ponownie.' : cause instanceof Error ? cause.message : String(cause); }
  async function work(fn: (signal: AbortSignal) => Promise<void>) {
    if (!ready || busy || recording || disposed) return;
    refreshController?.abort();
    const current = new AbortController(); controller = current;
    busy = true; error = ''; message = '';
    try { await fn(current.signal); } catch (cause) { if (!current.signal.aborted) fail(cause); }
    finally { if (controller === current) { controller = undefined; if (!disposed) busy = false; } }
  }
  $effect(() => {
    if (!ready) return;
    const abort = new AbortController();
    void refresh(abort.signal).catch(cause => { if (!abort.signal.aborted) fail(cause); });
    return () => { abort.abort(); refreshController?.abort(); controller?.abort(); busy = false; loading = false; };
  });
  onDestroy(() => { disposed = true; controller?.abort(); refreshController?.abort(); if (audioUrl) URL.revokeObjectURL(audioUrl); });
  function clearSample() { if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = ''; sampleError = ''; sampleDuration = 0; }
  function choose(id: string) {
    selected = id; selectionVersion++; deleting = false; revoking = false; usage = undefined; takes = []; takeId = ''; portrait = undefined; consent = undefined; replacement = undefined; replacementText = '';
    const row = profiles.find(p => p.id === id); name = row?.name || ''; language = row?.language || 'Polish'; reference = row?.ref_text || ''; instruction = row?.instruct || ''; consentText = row?.consent_text || '';
    clearSample(); error = ''; message = '';
  }
  async function save() {
    await work(async signal => {
      if (selected) await productionJson(`/profiles/${encodeURIComponent(selected)}`, { ...postJson({ name: name.trim(), language, ref_text: reference, instruct: instruction }, signal), method: 'PUT' });
      else {
        const form = new FormData(); form.append('name', name.trim()); form.append('kind', 'design'); form.append('language', language); form.append('vd_states', JSON.stringify(attrs)); form.append('instruct', Object.values(attrs).filter(v => v !== 'Auto').join(', '));
        const row = await productionJson<Profile>('/profiles', { method: 'POST', body: form, signal }); selected = row.id;
      }
      await refresh(signal); signal.throwIfAborted(); await onchange(); signal.throwIfAborted(); choose(selected); message = 'Zapisano profil głosu.';
    });
  }
  async function preview() { if (!selected) return; await work(async signal => { const path = selectedProfile?.audio_url || `/profiles/${encodeURIComponent(selected)}/audio`; const response = await request(path, { signal }); await assertModelLicenseResponse(response, signal); if (!response.ok) throw new Error(response.status === 404 ? 'Próbka nie jest jeszcze dostępna. Dla projektowanego głosu sprawdź model TTS i spróbuj ponownie.' : `Nie można wczytać próbki (${response.status}). ${(await response.text()).slice(0, 200)}`); const blob = await response.blob(); signal.throwIfAborted(); if (!blob.size || !blob.type.startsWith('audio/')) throw new Error('Nie otrzymano nagrania głosu.'); clearSample(); sampleExtension = ({'audio/mpeg':'mp3','audio/mp4':'m4a','audio/flac':'flac','audio/ogg':'ogg','audio/aac':'aac','audio/webm':'webm'} as Record<string,string>)[blob.type.split(';')[0]] || 'wav'; audioUrl = URL.createObjectURL(blob); }); }
  async function uploadPortrait() { if (!portrait || !selected) return; await work(async signal => { const body = new FormData(); body.append('image', portrait!); await productionJson(`/profiles/${encodeURIComponent(selected)}/image`, { method: 'PUT', body, signal }); await refresh(signal); await onchange(); portrait = undefined; message = 'Zapisano portret głosu.'; }); }
  async function loadTakes() { await work(async signal => { takes = await backendHistory(signal); takeId = takes[0]?.id || ''; message = takes.length ? 'Wybierz nagranie, które ustali brzmienie profilu.' : 'Brak nagrań w historii silnika.'; }); }
  async function lockTake() { if (!selected || !takeId) return; await work(async signal => { const body = new FormData(); body.append('history_id', takeId); await productionJson(`/profiles/${encodeURIComponent(selected)}/lock`, { method: 'POST', body, signal }); await refresh(signal); await onchange(); clearSample(); message = 'Utrwalono wybrane ujęcie jako brzmienie profilu.'; }); }
  async function replaceReference() { if (!selected || !replacement) return; await work(async signal => {
    const body = new FormData(); body.append('ref_audio', replacement!); body.append('ref_text', replacementText.trim()); body.append('name', name.trim()); body.append('language', language); body.append('instruct', instruction);
    await productionJson(`/profiles/${encodeURIComponent(selected)}/audio`, { method: 'PUT', body, signal }); await refresh(signal); await onchange(); choose(selected); message = 'Zastąpiono referencję głosu. Poprzednie utrwalenie i zgoda zostały wyczyszczone.';
  }); }
  async function recognizeReplacement() { if (!replacement) return; await work(async signal => { const result = await transcribe(replacement!, 'reference', 'auto', signal); if (!result.text.trim()) throw new Error('Nie rozpoznano słów. Wpisz tekst próbki lub wybierz inne nagranie.'); replacementText = result.text; message = 'Sprawdź rozpoznany tekst przed zastąpieniem referencji.'; }); }
  async function confirmDelete() { if (!selected) return; await work(async signal => { usage = await productionJson<Usage>(`/profiles/${encodeURIComponent(selected)}/usage`, { signal }); deleting = true; }); }
  async function deleteProfile() { if (!selected || !deleting || !usage) return; await work(async signal => { await productionJson(`/profiles/${encodeURIComponent(selected)}`, { method: 'DELETE', signal }); await refresh(signal); await onchange(); choose(''); message = 'Usunięto profil. Nagrania z historii zostały zachowane.'; }); }
  async function saveConsent() { if (!selected || !consent || !consentText.trim()) return; await work(async signal => { const body = new FormData(); body.append('consent_audio', consent!); body.append('consent_text', consentText.trim()); await productionJson(`/profiles/${encodeURIComponent(selected)}/consent`, { method: 'POST', body, signal }); await refresh(signal); await onchange(); message = 'Zapisano nagranie zgody. Zapis potwierdza obecność nagrania, nie weryfikuje tożsamości mówcy.'; }); }
  async function revokeConsent() { if (!selected || !revoking) return; await work(async signal => { await productionJson(`/profiles/${encodeURIComponent(selected)}/consent`, { method: 'DELETE', signal }); await refresh(signal); await onchange(); revoking = false; consent = undefined; consentText = ''; message = 'Usunięto nagranie i oznaczenie zgody.'; }); }
</script>

<section class="studio-tools voice-manager" aria-label="Projektowanie i zarządzanie głosami">
  <div class="page-heading"><div><h2>Projektowanie i zarządzanie głosami</h2><p>Edytuj bibliotekę lub zaprojektuj nowe brzmienie.</p></div><Button variant="outline" disabled={!ready || busy || loading} onclick={() => work(refresh)}><RefreshCw size={15}/>{loading ? 'Wczytywanie głosów…' : 'Odśwież'}</Button></div>
  {#if !ready}<p class="tool-notice">Uruchom lokalny silnik, aby zarządzać profilami.</p>{/if}{#if error}<p class="tool-error" role="alert">{error}</p>{/if}{#if message}<p class="tool-notice" role="status">{message}</p>{/if}
  <div class="tool-card"><Select label="Profil do edycji" value={selected} onchange={choose} disabled={!ready || busy || recording || loading} options={[{ value: '', label: 'Zaprojektuj nowy głos' }, ...profiles.map(p => ({ value: p.id, label: p.name }))]}/><label for={`${uid}-name`}>Nazwa głosu</label><input id={`${uid}-name`} class="text-input" aria-label="Nazwa projektowanego głosu" bind:value={name} disabled={busy || recording}/><Select label="Język próbki głosu" value={language} onchange={value => language = value} disabled={busy || recording} options={languages}/>
    {#if !selected}<label for={`${uid}-description`}>Opis brzmienia (po angielsku)</label><textarea id={`${uid}-description`} class="text-input" bind:value={description} rows="2" placeholder="A female, elderly voice with low pitch" disabled={busy}></textarea><Button variant="outline" disabled={!ready || busy || !description.trim()} onclick={() => work(async signal => { const result = await productionJson<Description>('/design/describe', postJson({ description }, signal)); attrs = result.attrs; unmatched = result.unmatched; })}>Dobierz cechy z opisu</Button><p class="page-footnote">Opis jest mapowany na obsługiwane cechy przez lokalny słownik. Nie wszystkie określenia da się odwzorować.</p>{#if unmatched.length}<p class="page-footnote">Nierozpoznane określenia: {unmatched.join(', ')}</p>{/if}<div class="tool-columns">{#each categories as cat}<Select label={cat.label} value={attrs[cat.key] || 'Auto'} onchange={value => attrs = { ...attrs, [cat.key]: value }} disabled={busy} options={cat.values.map((value, i) => ({ value, label: cat.labels[i] }))}/>{/each}</div><p class="page-footnote">Silnik próbuje przygotować próbkę lokalnym modelem. Jeśli model nie jest gotowy, zapisze profil, a próbkę przygotuje przy pierwszym odsłuchu lub użyciu.</p>
    {:else}<label for={`${uid}-reference`}>Tekst referencyjny</label><textarea id={`${uid}-reference`} class="text-input" bind:value={reference} rows="3" disabled={busy}></textarea><label for={`${uid}-instruction`}>Instrukcje brzmienia</label><input id={`${uid}-instruction`} class="text-input" bind:value={instruction} disabled={busy}/><p class="page-footnote">Silnik przyjmuje własną taksonomię cech, np. „female, low pitch”.</p>{/if}
    <div class="tool-actions"><Button variant="default" disabled={!ready || busy || recording || !name.trim()} onclick={save}><Save size={15}/>{busy ? 'Przetwarzanie…' : selected ? 'Zapisz zmiany głosu' : 'Utwórz projektowany głos'}</Button>{#if selected}<Button variant="outline" disabled={!ready || busy || recording} onclick={preview}>Wczytaj próbkę głosu</Button>{/if}</div>
    {#if selected}<p>{selectedProfile?.is_locked ? 'Utrwalone ujęcie głosu' : 'Głos bez utrwalonego ujęcia'} · {selectedProfile?.verified_own_voice ? 'Zapisano nagranie zgody' : 'Brak nagrania zgody'}</p>{#if selectedProfile?.is_locked}<Button variant="outline" disabled={!ready || busy || recording} onclick={() => work(async signal => { await productionJson(`/profiles/${encodeURIComponent(selected)}/unlock`, { method: 'POST', signal }); await refresh(signal); await onchange(); clearSample(); message = 'Zwolniono utrwalone ujęcie.'; })}>Zwolnij utrwalone ujęcie</Button>{/if}
      {#if selectedProfile?.kind === 'clone'}
        {#key selectionVersion}<details><summary>Zastąp nagranie referencyjne</summary><p class="page-footnote">Profil zachowa identyfikator, portret i historię. Zmiana referencji usuwa poprzednie utrwalone ujęcie i nagranie zgody.</p><ReferenceAudioInput disabled={busy || recording} onchange={file => { replacement = file; if (!file) replacementText = ''; }} onrecordingchange={value => recording = value}/><label for={`${uid}-replacement`}>Tekst nowej próbki</label><textarea id={`${uid}-replacement`} class="text-input" rows="3" bind:value={replacementText} disabled={busy || recording}></textarea><div class="tool-actions"><Button variant="outline" disabled={!ready || busy || recording || !replacement} onclick={recognizeReplacement}>Rozpoznaj tekst nowej próbki</Button><Button variant="default" disabled={!ready || busy || recording || !replacement || !name.trim()} onclick={replaceReference}>Zastąp referencję i zapisz zmiany</Button></div></details>{/key}
      {/if}
      <details><summary>Utrwal brzmienie z nagrania</summary><p class="page-footnote">Wybrane nagranie z historii silnika stanie się referencją dla tego profilu.</p><Button variant="outline" disabled={!ready || busy || recording} onclick={loadTakes}>Wczytaj ujęcia</Button>{#if takes.length}<Select label="Ujęcie do utrwalenia" value={takeId} onchange={v => takeId = v} disabled={busy || recording} options={takes.map(row => ({ value: row.id, label: row.text.slice(0,80) || row.id }))}/><Button variant="outline" disabled={!ready || busy || recording || !takeId} onclick={lockTake}>Utrwal wybrane ujęcie</Button>{/if}</details>
      {#key selectionVersion}<details><summary>Portret i zgoda właściciela</summary><label class="form-label" for={`${uid}-portrait`}>Portret głosu</label><input id={`${uid}-portrait`} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || recording} onchange={event => portrait = event.currentTarget.files?.[0]}/><Button variant="outline" disabled={!ready || busy || recording || !portrait} onclick={uploadPortrait}>Zapisz portret</Button><label class="form-label" for={`${uid}-consent-text`}>Słowa wypowiedziane w nagraniu zgody</label><textarea id={`${uid}-consent-text`} class="text-input" rows="2" bind:value={consentText} disabled={busy || recording}></textarea><ReferenceAudioInput label="Nagranie zgody" disabled={busy || recording} onchange={file => consent = file} onrecordingchange={value => recording = value}/><Button variant="outline" disabled={!ready || busy || recording || !consent || !consentText.trim()} onclick={saveConsent}>Zapisz zgodę</Button>{#if selectedProfile?.verified_own_voice}<p class="page-footnote">{selectedProfile.consent_recorded_at ? `Zapisano: ${new Date(selectedProfile.consent_recorded_at * 1000).toLocaleString('pl-PL')}. ` : ''}Oznaczenie potwierdza zapis nagrania. Silnik nie sprawdza tożsamości mówcy.</p><Button variant="ghost" disabled={!ready || busy || recording} onclick={() => revoking = true}>Usuń nagranie zgody</Button>{#if revoking}<div class="tool-confirm">Usunąć zapisane nagranie zgody dla „{name}”?<Button variant="outline" disabled={busy || recording} onclick={revokeConsent}>Potwierdź usunięcie zgody</Button><Button variant="ghost" disabled={busy} onclick={() => revoking = false}>Zachowaj zgodę</Button></div>{/if}{/if}</details>{/key}
      <Button variant="ghost" disabled={!ready || busy || recording} onclick={confirmDelete}>Usuń profil głosu</Button>{#if deleting && usage}<div class="tool-confirm"><span>Usunąć profil „{name}” i jego pliki referencyjne? Nagrania w historii: {usage.synth_total}. Segmenty dubbingu: {usage.project_total_segments} w {usage.projects.length} projektach. Istniejące nagrania pozostaną; projektom używającym tego głosu trzeba wybrać inny profil.</span><Button variant="outline" disabled={busy || recording} onclick={deleteProfile}>Potwierdź usunięcie profilu</Button><Button variant="ghost" disabled={busy} onclick={() => deleting = false}>Zachowaj profil</Button></div>{/if}
    {/if}
    {#if audioUrl}<audio controls src={audioUrl} aria-label={`Próbka głosu ${name}`} onloadedmetadata={event => sampleDuration = event.currentTarget.duration} onerror={() => sampleError = 'Nie można odtworzyć próbki w tym środowisku. Pobierz ją lub wybierz nowe nagranie.'}></audio>{#if sampleDuration > 0}<p class="page-footnote">Czas próbki: {sampleDuration.toFixed(2)} s</p>{/if}{#if sampleError}<p class="tool-error" role="alert">{sampleError}</p>{/if}<Button variant="outline" href={audioUrl} download={`probka-${name.replace(/[^\p{L}\p{N}-]/gu, '-').slice(0, 60) || 'glosu'}.${sampleExtension}`}><Download size={15}/>Pobierz próbkę</Button>{/if}
  </div>
</section>
