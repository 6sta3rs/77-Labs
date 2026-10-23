<script lang="ts">
  function uiOptions<T extends { label: string }>(items: readonly T[]): T[] { return items.map(item => ({ ...item, label: tr(item.label) })); }

  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import { onDestroy } from 'svelte';
  import { Save, WandSparkles } from '@lucide/svelte';
  import type { Profile } from '../platform/api';
  import { productionJson, postJson } from '../tools/production/production';
  import { profileLanguages } from './voice-reference';
  import Input from '../ui/Input.svelte';
  import Textarea from '../ui/Textarea.svelte';
  import Select from '../ui/Select.svelte';
  import Button from '../ui/Button.svelte';
  import '../tools/studio-tools.css';

  let { ready = true, oncreated, oncancel, onbusychange }: {
    ready?: boolean; oncreated: (profile: Profile) => void | Promise<void>; oncancel: () => void;
    onbusychange?: (busy: boolean) => void;
  } = $props();
  const uid = $props.id();
  const categories = [
    { key: 'Gender', label: 'Barwa głosu', values: ['Auto', 'male', 'female'], labels: ['Automatyczna', 'Męska', 'Żeńska'] },
    { key: 'Age', label: 'Wiek brzmienia', values: ['Auto', 'child', 'teenager', 'young adult', 'middle-aged', 'elderly'], labels: ['Automatyczny', 'Dziecięcy', 'Nastoletni', 'Młody dorosły', 'Dojrzały', 'Starszy'] },
    { key: 'Pitch', label: 'Wysokość głosu', values: ['Auto', 'very low pitch', 'low pitch', 'moderate pitch', 'high pitch', 'very high pitch'], labels: ['Automatyczna', 'Bardzo niska', 'Niska', 'Średnia', 'Wysoka', 'Bardzo wysoka'] },
    { key: 'Style', label: 'Sposób mówienia', values: ['Auto', 'whisper'], labels: ['Zwykły', 'Szept'] },
    { key: 'EnglishAccent', label: 'Akcent angielski', values: ['Auto', 'american accent', 'british accent', 'australian accent', 'canadian accent', 'indian accent', 'chinese accent', 'korean accent', 'japanese accent', 'portuguese accent', 'russian accent'], labels: ['Automatyczny', 'Amerykański', 'Brytyjski', 'Australijski', 'Kanadyjski', 'Indyjski', 'Chiński', 'Koreański', 'Japoński', 'Portugalski', 'Rosyjski'] },
    { key: 'ChineseDialect', label: 'Dialekt chiński', values: ['Auto', '河南话', '陕西话', '四川话', '贵州话', '云南话', '桂林话', '济南话', '石家庄话', '甘肃话', '宁夏话', '青岛话', '东北话'], labels: ['Automatyczny', 'Henan', 'Shaanxi', 'Sichuan', 'Guizhou', 'Yunnan', 'Guilin', 'Jinan', 'Shijiazhuang', 'Gansu', 'Ningxia', 'Qingdao', 'Dongbei'] },
  ];
  let name = $state(''), language = $state('Polish'), description = $state('');
  let attrs = $state<Record<string, string>>(Object.fromEntries(categories.map(row => [row.key, 'Auto'])));
  let busy = $state<'describe' | 'save' | undefined>(), error = $state(''), message = $state('');
  let createdProfile = $state<Profile>();
  let controller: AbortController | undefined, disposed = false;
  $effect(() => { onbusychange?.(!!busy); });
  onDestroy(() => { disposed = true; controller?.abort(); onbusychange?.(false); });

  async function work(kind: 'describe' | 'save', run: (signal: AbortSignal) => Promise<void>) {
    if (!ready || busy || disposed) return;
    const current = new AbortController(); controller = current; busy = kind; error = ''; message = '';
    try { await run(current.signal); }
    catch (cause) {
      if (!disposed && !current.signal.aborted) error = `${createdProfile ? 'Głos został zapisany. Nie udało się odświeżyć biblioteki; otwórz zapisany głos ponownie. ' : ''}${cause instanceof Error ? cause.message : String(cause)}`;
    } finally { if (controller === current) { controller = undefined; if (!disposed) busy = undefined; } }
  }
  function describe() {
    if (!description.trim() || createdProfile) return;
    void work('describe', async signal => {
      const result = await productionJson<{ attrs: Record<string, string>; unmatched: string[] }>('/design/describe', postJson({ description: description.trim() }, signal));
      signal.throwIfAborted();
      attrs = Object.fromEntries(categories.map(row => [row.key, row.values.includes(result.attrs[row.key]) ? result.attrs[row.key] : 'Auto']));
      message = result.unmatched?.length ? `Dobrano dostępne cechy. Nierozpoznane określenia: ${result.unmatched.join(', ')}.` : 'Dobrano cechy. Możesz je zmienić przed zapisaniem głosu.';
    });
  }
  function save() {
    if (!name.trim()) return;
    void work('save', async signal => {
      if (!createdProfile) {
        const body = new FormData();
        body.append('name', name.trim()); body.append('kind', 'design'); body.append('language', language);
        body.append('vd_states', JSON.stringify(attrs));
        body.append('instruct', Object.values(attrs).filter(value => value !== 'Auto').join(', '));
        const profile = await productionJson<Profile>('/profiles', { method: 'POST', body, signal });
        signal.throwIfAborted(); createdProfile = profile;
      }
      await oncreated(createdProfile);
    });
  }
  function cancel() { controller?.abort(); oncancel(); }
</script>

<form class="voice-design-form studio-tools" onsubmit={event => { event.preventDefault(); save(); }}>
  <p class="page-footnote">{tr("Nadaj głosowi nazwę i wybierz cechy brzmienia. Nagranie referencyjne nie jest potrzebne.")}</p>
  {#if !ready}<p class="tool-notice">{tr("Uruchom lokalny silnik, aby utworzyć projektowany głos.")}</p>{/if}
  <div class="design-field"><label for={`${uid}-name`}>{tr("Nazwa głosu")}</label><Input id={`${uid}-name`} bind:value={name} required maxlength={120} disabled={!!busy || !!createdProfile} autocomplete="off" placeholder={tr("Np. Ciepły głos narratora")}/></div>
  <Select label={tr("Język głosu")} value={language} onchange={value => language = value} options={uiOptions(profileLanguages)} disabled={!!busy || !!createdProfile}/>
  <div class="design-features">{#each categories as category}<Select label={tr(category.label)} value={attrs[category.key] || 'Auto'} onchange={value => attrs = { ...attrs, [category.key]: value }} options={uiOptions(category.values.map((value, i) => ({ value, label: category.labels[i] })))} disabled={!!busy || !!createdProfile}/>{/each}</div>
  <details class="design-description"><summary>{tr("Dobierz cechy z opisu")}</summary><div class="design-description-body"><label for={`${uid}-description`}>{tr("Opis brzmienia po angielsku")}</label><Textarea id={`${uid}-description`} bind:value={description} rows={3} placeholder={tr("A warm female voice with low pitch")} disabled={!!busy || !!createdProfile}/><p class="page-footnote">{tr("Lokalny słownik zamienia obsługiwane określenia na cechy powyżej. Pozostałe słowa pokaże w komunikacie.")}</p><Button variant="outline" disabled={!ready || !!busy || !!createdProfile || !description.trim()} onclick={describe}><WandSparkles size={16}/>{busy === 'describe' ? tr("Dobieranie cech…") : tr("Dobierz cechy")}</Button></div></details>
  <p class="page-footnote">{tr("Silnik przygotuje próbkę, jeśli lokalny model jest gotowy. W przeciwnym razie zapisze profil, a próbkę będzie można przygotować przy pierwszym odsłuchu lub użyciu.")}</p>
  {#if error}<p class="tool-error" role="alert">{tr(error)}</p>{/if}
  {#if message}<p class="tool-notice" role="status">{tr(message)}</p>{/if}
  <div class="tool-actions"><Button type="submit" disabled={!ready || !!busy || !name.trim()}><Save size={16}/>{busy === 'save' ? createdProfile ? tr("Odświeżanie biblioteki…") : tr("Zapisywanie głosu…") : createdProfile ? tr("Otwórz zapisany głos") : tr("Utwórz głos")}</Button><Button variant="outline" onclick={cancel}>{busy ? tr("Anuluj i wróć") : tr("Anuluj")}</Button></div>
  {#if busy === 'save' && !createdProfile}<p class="page-footnote" role="status">{tr("Przygotowanie profilu i próbki. Pierwsze wczytanie lokalnego modelu może potrwać dłużej.")}</p>{/if}
</form>

<style>
  .voice-design-form{display:grid;gap:18px;min-width:0}.voice-design-form>p{margin:0}.page-footnote{font-size:.95em;color:var(--foreground)}.design-field{display:grid;gap:8px;min-width:0}.design-features{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.design-description{border-top:1px solid var(--border);padding-top:16px}.design-description summary{cursor:pointer;font-weight:600}.design-description-body{display:grid;gap:12px;padding-top:16px}.design-description-body>p{margin:0}.design-description-body :global(.vs-button){justify-self:start}.tool-actions{flex-wrap:wrap;gap:10px}@media(max-width:560px){.design-features{grid-template-columns:minmax(0,1fr)}}
</style>
