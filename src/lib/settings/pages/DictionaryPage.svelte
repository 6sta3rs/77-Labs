<script lang="ts">
  import { userMessage } from '../../platform/user-message';
  // "Słownik wymowy": entries live in the engine's private database (/pronunciation).
  import { onDestroy, untrack } from 'svelte';
  import { Pencil, Trash2, Download, Plus, Check, Search } from '@lucide/svelte';
  import { uiLanguage, createUiTranslator } from '../../i18n';
  import type { SettingsSection } from '../settings-catalog';
  import { productionJson, postJson } from '../../tools/production/production';
  import { saveTextFile } from '../../tools/studio-tools';
  import { toast } from '../../ui/toast';
  import Button from '../../ui/Button.svelte';
  import FilePicker from '../../ui/FilePicker.svelte';
  import Input from '../../ui/Input.svelte';
  import Select from '../../ui/Select.svelte';
  import Switch from '../../ui/Switch.svelte';
  import Textarea from '../../ui/Textarea.svelte';
  const tr = $derived(createUiTranslator($uiLanguage));

  let { ready, onnavigate }: { ready: boolean; onnavigate?: (id: SettingsSection) => void } = $props();

  type Entry = { id: string; term: string; replacement: string; type: string; language: string; enabled: boolean };
  type ImportedEntry = Omit<Entry, 'id'>;
  type Preview = { substituted: string; changed: boolean; inert_entries?: { term: string; type: string }[] };
  let entries = $state.raw<Entry[]>([]), loaded = $state(false), busy = $state(false);
  let controller: AbortController | undefined, disposed = false;

  const BASE_LANGS = [{ value: '*', label: 'Wszystkie języki' }, { value: 'pl', label: 'Polski (pl)' }, { value: 'en', label: 'Angielski (en)' }];
  // Entries saved earlier with other language codes stay selectable.
  const langs = $derived([...BASE_LANGS.map(l => ({ ...l, label: tr(l.label) })), ...[...new Set(entries.map(e => e.language))].filter(l => !BASE_LANGS.some(b => b.value === l)).map(l => ({ value: l, label: l }))]);
  const langLabel = (l: string) => langs.find(x => x.value === l)?.label ?? l;

  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  onDestroy(() => { disposed = true; controller?.abort(); timers.forEach(clearTimeout); });
  // Two-step inline confirmation: first click arms the button (label changes), second runs the action; disarms after 4 s.
  let armed = $state<Record<string, boolean>>({});
  function arm(key: string, fn: () => void) {
    if (armed[key]) { armed[key] = false; fn(); return; }
    armed[key] = true; later(() => armed[key] = false, 4000);
  }
  const pl = (n: number, one: string, few: string, many: string) => n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;
  const count = (n: number) => tr(pl(n, '{count} wpis', '{count} wpisy', '{count} wpisów'), { count: n });

  async function work(action: (signal: AbortSignal) => Promise<void>) {
    if (!ready || busy || disposed) return;
    const abort = new AbortController(); controller = abort; busy = true;
    try { await action(abort.signal); }
    catch (cause) { if (!disposed && !abort.signal.aborted) toast.bad(userMessage(cause, 'Operacja na słowniku nie powiodła się.')); }
    finally { if (!disposed) busy = false; }
  }
  const reload = async (signal: AbortSignal) => { entries = await productionJson<Entry[]>('/pronunciation', { signal }); loaded = true; };
  $effect(() => { if (ready && !loaded) untrack(() => { void work(reload); }); });

  /* ---------- add / edit ---------- */
  let term = $state(''), replacement = $state(''), language = $state('*'), editId = $state(''), editType = $state('respelling');
  let formEl = $state<HTMLElement>();
  const clearForm = () => { editId = ''; term = ''; replacement = ''; language = '*'; editType = 'respelling'; };
  function save() {
    const t = term.trim(); if (!t) return;
    const id = editId;
    // ponytail: the notation selector was dropped; new entries are respellings, edits keep the stored type.
    void work(async signal => {
      const body = { term: t, replacement, type: id ? editType : 'respelling', language, ...(id ? {} : { enabled: true }) };
      await productionJson(id ? `/pronunciation/${encodeURIComponent(id)}` : '/pronunciation', { ...postJson(body, signal), method: id ? 'PUT' : 'POST' });
      clearForm(); preview = undefined; await reload(signal);
      toast.ok(id ? tr('Zapisano zmianę') : tr('Dodano wymowę'));
    });
  }
  function edit(e: Entry) { editId = e.id; term = e.term; replacement = e.replacement; language = e.language; editType = e.type; formEl?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  function toggle(e: Entry, enabled: boolean) {
    void work(async signal => {
      const previous = entries; entries = entries.map(row => row.id === e.id ? { ...row, enabled } : row); preview = undefined;
      try { await productionJson(`/pronunciation/${encodeURIComponent(e.id)}`, { ...postJson({ enabled }, signal), method: 'PUT' }); }
      catch (cause) { entries = previous; throw cause; }
      await reload(signal);
    });
  }
  function remove(e: Entry) {
    void work(async signal => {
      await productionJson(`/pronunciation/${encodeURIComponent(e.id)}`, { method: 'DELETE', signal });
      if (editId === e.id) clearForm(); preview = undefined; await reload(signal);
      toast.ok(tr('Usunięto wpis „{term}”', { term: e.term }));
    });
  }

  /* ---------- list ---------- */
  let q = $state('');
  const shown = $derived(q.trim() ? entries.filter(e => (e.term + ' ' + e.replacement).toLowerCase().includes(q.trim().toLowerCase())) : entries);

  /* ---------- substitution test ---------- */
  let testLang = $state('pl'), text = $state(''), preview = $state<Preview>();
  function check() {
    void work(async signal => {
      preview = await productionJson<Preview>('/pronunciation/test', postJson({ text, ...(testLang !== '*' ? { language: testLang } : {}) }, signal));
    });
  }

  /* ---------- export / import ---------- */
  function exportJson() {
    void work(async signal => {
      const data = await productionJson<{ entries: ImportedEntry[] }>('/pronunciation/export', { signal });
      saveTextFile(JSON.stringify(data, null, 2), 'slownik-wymowy.json', 'application/json');
      toast.ok(tr('Przygotowano plik JSON słownika'));
    });
  }
  let pending = $state.raw<ImportedEntry[]>(), replaceAll = $state(false), importError = $state('');
  async function chooseFile(files: File[]) {
    const file = files[0]; if (!file) return;
    pending = undefined; replaceAll = false; importError = '';
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Słownik JSON może mieć najwyżej 2 MB.');
      const parsed: unknown = JSON.parse(await file.text());
      const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? (parsed as { entries?: unknown }).entries : undefined;
      if (!Array.isArray(rows) || rows.length > 10000) throw new Error('Plik musi zawierać listę „entries” z najwyżej 10 000 wpisów.');
      const imported: ImportedEntry[] = [];
      for (const row of rows) {
        if (!row || typeof row !== 'object' || typeof row.term !== 'string' || !row.term.trim() || typeof row.replacement !== 'string' || row.term.length > 1000 || row.replacement.length > 10000 || row.type != null && !['respelling', 'ipa', 'cmu'].includes(row.type) || row.language != null && typeof row.language !== 'string' || row.enabled != null && typeof row.enabled !== 'boolean') throw new Error('Plik musi zawierać listę „entries” z wpisami zawierającymi „term” i „replacement”. Słownik nie został zmieniony.');
        imported.push({ term: row.term.trim(), replacement: row.replacement, type: row.type || 'respelling', language: row.language || '*', enabled: row.enabled ?? true });
      }
      if (!disposed) pending = imported;
    } catch (cause) { if (!disposed) importError = cause instanceof SyntaxError ? 'Plik musi zawierać listę „entries” z wpisami zawierającymi „term” i „replacement”. Słownik nie został zmieniony.' : (cause as Error).message; }
  }
  function doImport() {
    if (!pending) return;
    const payload = { entries: pending, replace: replaceAll };
    void work(async signal => {
      const result = await productionJson<{ imported: number; replaced: boolean }>('/pronunciation/import', postJson(payload, signal));
      pending = undefined; replaceAll = false; clearForm(); preview = undefined; await reload(signal);
      toast.ok(tr('Zaimportowano {entries}', { entries: count(result.imported) }));
    });
  }
</script>

<div class="p-page dict-page">
  <div class="page-heading"><div><h1>{tr('Słownik wymowy')}</h1><p>{tr('Własny zapis wymowy zmienia tekst przekazywany silnikowi przed syntezą.')}</p></div></div>

  {#if !ready}
    <p class="p-notice">{tr('Silnik jest zatrzymany, więc słownik wymowy jest niedostępny. Uruchom go na stronie Silnik.')}{#if onnavigate} <Button size="sm" onclick={() => onnavigate?.('engine')}>{tr('Przejdź do strony Silnik')}</Button>{/if}</p>
  {:else}
  <section class="p-card">
    <div class="p-section" bind:this={formEl}>
      <header><h3>{editId ? tr('Edytuj wpis') : tr('Dodaj wymowę')}</h3><p>{tr('Wpisy są przechowywane w prywatnej bazie tej aplikacji.')}</p></header>
      <form class="form" onsubmit={e => { e.preventDefault(); save(); }}>
        <label><span>{tr('Słowo lub wyrażenie')}</span><Input bind:value={term} placeholder="Seventy Seven Labs" aria-label={tr('Słowo lub wyrażenie')} disabled={busy}/></label>
        <label><span>{tr('Jak ma zostać wypowiedziane')}</span><Input bind:value={replacement} placeholder="sewenti sewen labs" aria-label={tr('Jak ma zostać wypowiedziane')} disabled={busy}/></label>
        <label><span>{tr('Język wpisu')}</span><Select ariaLabel={tr('Język wpisu')} bind:value={language} options={langs} disabled={busy}/></label>
        <div class="p-actions go">
          <Button type="submit" disabled={!term.trim() || busy}>{#if editId}<Check size={15}/>{tr('Zapisz')}{:else}<Plus size={15}/>{tr('Dodaj')}{/if}</Button>
          {#if editId}<Button variant="outline" type="button" onclick={clearForm}>{tr('Anuluj')}</Button>{/if}
        </div>
      </form>
    </div>

    <div class="p-section">
      <header class="split"><div><h3>{tr('Wpisy słownika')}</h3><p>{tr('{entries}. Wyłączony wpis zostaje na liście, ale nie zmienia mowy.', { entries: count(entries.length) })}</p></div>
        {#if entries.length > 5}<div class="search"><Search size={14}/><Input bind:value={q} placeholder={tr('Szukaj we wpisach…')} aria-label={tr('Szukaj we wpisach słownika')}/></div>{/if}</header>
      {#if !loaded}<p class="p-sub" role="status">{tr('Odczytuję słownik…')}</p>
      {:else if !entries.length}<p class="p-sub">{tr('Słownik jest pusty. Dodaj pierwszą wymowę powyżej.')}</p>
      {:else if !shown.length}<p class="p-sub">{tr('Brak wpisów pasujących do „{query}”.', { query: q })}</p>
      {:else}
        <div class="p-rows">
          {#each shown as e (e.id)}
            <div class="p-row" class:off={!e.enabled}>
              <div class="t"><b>{e.term} <i class="arrow">→</i> {e.replacement || tr('(pusty tekst)')}</b><span>{langLabel(e.language)}{#if e.type !== 'respelling'} · {e.type.toUpperCase()} · {tr('jeszcze nie stosowane')}{/if}</span></div>
              <div class="ctl">
                <Switch label={tr('Stosuj wymowę {term}', { term: e.term })} checked={e.enabled} disabled={busy} onchange={v => toggle(e, v)}/>
                <Button variant="ghost" size="icon" aria-label={tr('Edytuj wymowę {term}', { term: e.term })} disabled={busy} onclick={() => edit(e)}><Pencil size={15}/></Button>
                {#if armed['d' + e.id]}<Button variant="destructive" disabled={busy} onclick={() => arm('d' + e.id, () => remove(e))}>{tr('Potwierdź')}</Button>
                {:else}<Button variant="ghost" size="icon" aria-label={tr('Usuń wymowę {term}', { term: e.term })} disabled={busy} onclick={() => arm('d' + e.id, () => remove(e))}><Trash2 size={15}/></Button>{/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="p-section">
      <header><h3>{tr('Sprawdź podstawienie tekstu')}</h3><p>{tr('Używa tego samego słownika co synteza i nie generuje dźwięku.')}</p></header>
      <div class="test">
        <label class="lang"><span>{tr('Język testu')}</span><Select ariaLabel={tr('Język testu')} bind:value={testLang} onchange={() => preview = undefined} options={langs}/></label>
        <Textarea aria-label={tr('Tekst do sprawdzenia wymowy')} rows={3} bind:value={text} oninput={() => preview = undefined}/>
        <div class="p-actions"><Button disabled={!text.trim() || busy} onclick={check}>{tr('Sprawdź tekst')}</Button></div>
        {#if preview}
          <div class="result" role="status">
            <small>{preview.changed ? tr('Tekst po podstawieniu') : tr('Tekst bez zmian')}</small>
            <p>{preview.substituted}</p>
            {#if preview.inert_entries?.length}<small class="inert">{tr('Wpisy zapisane, lecz jeszcze niestosowane przez silnik:')} {preview.inert_entries.map(row => `${row.term} (${row.type.toUpperCase()})`).join(', ')}.</small>{/if}
          </div>
        {/if}
      </div>
    </div>

    <div class="p-section">
      <header><h3>{tr('Kopia i przywracanie')}</h3><p>{tr('Eksport zapisuje wszystkie wpisy do pliku JSON. Import pozwala dodać je do słownika albo go zastąpić.')}</p></header>
      <div class="p-actions">
        <Button variant="outline" disabled={busy} onclick={exportJson}><Download size={15}/>{tr('Eksportuj słownik JSON')}</Button>
        <FilePicker label={tr('Importuj słownik JSON')} accept=".json,application/json" showName={false} disabled={busy} onchange={chooseFile}/>
      </div>
      {#if importError}<p class="p-field-err" role="alert">{tr(importError)}</p>{/if}
      {#if pending}
        <div class="p-notice info import">
          <div class="p-row flat"><div class="t"><b>{tr('Gotowe do importu: {entries}', { entries: count(pending.length) })}</b><span>{replaceAll ? tr('Import usunie {count} obecnych wpisów. Najpierw możesz wyeksportować ich kopię.', { count: entries.length }) : tr('Dotychczasowe wpisy zostaną zachowane ({count}).', { count: entries.length })}</span></div></div>
          <div class="p-row flat"><span>{tr('Zastąp cały obecny słownik')}</span><Switch label={tr('Zastąp cały obecny słownik podczas importu')} checked={replaceAll} disabled={busy} onchange={v => replaceAll = v}/></div>
          <div class="p-actions">
            {#if replaceAll}<Button variant={armed.imp ? 'destructive' : 'outline'} disabled={busy} onclick={() => arm('imp', doImport)}>{armed.imp ? tr('Potwierdź zastąpienie') : tr('Zastąp {replaced} i importuj {count}', { replaced: entries.length, count: pending.length })}</Button>
            {:else}<Button disabled={busy} onclick={doImport}>{tr('Dodaj {entries}', { entries: count(pending.length) })}</Button>{/if}
            <Button variant="outline" disabled={busy} onclick={() => { pending = undefined; replaceAll = false; }}>{tr('Anuluj import')}</Button>
          </div>
        </div>
      {/if}
    </div>
  </section>
  {/if}
</div>

<style>
  .form{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 190px auto;gap:12px;align-items:end}
  .form label,.lang{display:flex;flex-direction:column;gap:6px;min-width:0}
  .form label>span,.lang>span{font-size:var(--ui-text-12);color:var(--muted)}
  .go{flex-wrap:nowrap}
  .search{display:flex;align-items:center;gap:8px;width:240px;color:var(--muted)}
  .arrow{font-style:normal;color:var(--muted);margin:0 .25em}
  .ctl{display:flex;align-items:center;gap:6px;flex-shrink:0}
  .p-row.off .t{opacity:.5}
  .test{display:flex;flex-direction:column;gap:12px}.lang{max-width:260px}
  .result{padding:14px;border:1px solid var(--border);border-radius:8px;background:var(--surface-raised)}
  .result small{display:block;font-size:var(--ui-text-11);color:var(--muted);margin-bottom:6px}
  .result small.inert{margin:8px 0 0}
  .result p{margin:0;font-size:var(--ui-text-13);line-height:1.75;overflow-wrap:anywhere;white-space:pre-wrap}
  .import{display:flex;flex-direction:column;gap:12px}
  .p-notice :global([data-slot=button]){margin-left:8px}
  @media(max-width:900px){.form{grid-template-columns:1fr 1fr}.go{grid-column:1/-1}.search{width:100%}}
  @media(max-width:600px){.form{grid-template-columns:1fr}}
</style>
