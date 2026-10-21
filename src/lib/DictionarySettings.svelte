<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import { BookA, Download, RefreshCw, Trash2 } from '@lucide/svelte'
  import Button from './ui/Button.svelte'
  import Input from './ui/Input.svelte'
  import Select from './ui/Select.svelte'
  import Switch from './ui/Switch.svelte'
  import Textarea from './ui/Textarea.svelte'
  import { productionJson, postJson } from './production'
  import { saveTextFile } from './studio-tools'
  type Entry = { id: string; term: string; replacement: string; type: string; language: string; enabled: boolean }
  type ImportedEntry = Omit<Entry, 'id'>
  type Preview = { substituted: string; changed: boolean; inert_entries?: { term: string; type: string }[] }
  let { ready }: { ready: boolean } = $props()
  const uid = $props.id()
  let entries = $state.raw<Entry[]>([]), term = $state(''), replacement = $state(''), type = $state('respelling'), language = $state('*'), editId = $state('')
  let text = $state(''), testLanguage = $state('pl'), preview = $state<Preview>(), pending = $state.raw<ImportedEntry[]>(), replaceAll = $state(false)
  let busy = $state(''), error = $state(''), notice = $state(''), loaded = $state(false)
  let controller: AbortController | undefined, disposed = false
  const locked = $derived(!!busy)
  const options = [{ value: 'respelling', label: 'Zapis wymowy · działa w syntezie' }, { value: 'ipa', label: 'IPA · tylko zapis, silnik jeszcze nie stosuje' }, { value: 'cmu', label: 'CMU / ARPABET · tylko zapis' }]
  async function work(label: string, action: (signal: AbortSignal) => Promise<void>) {
    if (!ready || busy || disposed) return
    const abort = new AbortController(); controller = abort; busy = label; error = ''; notice = ''
    try { await action(abort.signal) } catch (cause) { if (!disposed && !abort.signal.aborted) error = cause instanceof Error ? cause.message : String(cause) }
    finally { if (!disposed) busy = '' }
  }
  async function refresh() { await work('Odczyt słownika', async signal => { entries = await productionJson<Entry[]>('/pronunciation', { signal }); loaded = true }) }
  function clearForm() { editId = ''; term = ''; replacement = ''; type = 'respelling'; language = '*' }
  function edit(entry: Entry) { editId = entry.id; term = entry.term; replacement = entry.replacement; type = entry.type; language = entry.language }
  async function updatePreview(signal: AbortSignal) {
    preview = undefined
    if (text.trim()) preview = await productionJson<Preview>('/pronunciation/test', postJson({ text, ...(testLanguage.trim() && testLanguage.trim() !== '*' ? { language: testLanguage.trim() } : {}) }, signal))
  }
  async function reloadAfterMutation(signal: AbortSignal) { entries = await productionJson<Entry[]>('/pronunciation', { signal }); await updatePreview(signal) }
  async function save() {
    await work('Zapis wymowy', async signal => {
      const body = { term: term.trim(), replacement, type, language: language.trim() || '*', ...(editId ? {} : { enabled: true }) }
      await productionJson(editId ? `/pronunciation/${encodeURIComponent(editId)}` : '/pronunciation', { ...postJson(body, signal), method: editId ? 'PUT' : 'POST' })
      clearForm(); await reloadAfterMutation(signal); notice = 'Zapisano wymowę w prywatnej bazie.'
    })
  }
  async function toggle(entry: Entry, enabled: boolean) { await work('Zmiana aktywności wpisu', async signal => {
    const previous = entries; entries = entries.map(row => row.id === entry.id ? { ...row, enabled } : row)
    try { await productionJson(`/pronunciation/${encodeURIComponent(entry.id)}`, { ...postJson({ enabled }, signal), method: 'PUT' }) }
    catch (cause) { entries = previous; throw cause }
    await reloadAfterMutation(signal)
  }) }
  async function remove(entry: Entry) { await work('Usuwanie wpisu', async signal => { await productionJson(`/pronunciation/${encodeURIComponent(entry.id)}`, { method: 'DELETE', signal }); if (editId === entry.id) clearForm(); await reloadAfterMutation(signal); notice = `Usunięto wpis „${entry.term}”.` }) }
  async function exportDictionary() { await work('Eksport słownika', async signal => { const data = await productionJson<{ entries: ImportedEntry[] }>('/pronunciation/export', { signal }); saveTextFile(JSON.stringify(data, null, 2), 'slownik-wymowy.json', 'application/json'); notice = 'Przygotowano plik JSON słownika.' }) }
  async function chooseFile(file?: File) {
    if (!file || locked) return
    error = ''; notice = ''; pending = undefined; replaceAll = false
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Słownik JSON może mieć najwyżej 2 MB.')
      const parsed: unknown = JSON.parse(await file.text())
      const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? (parsed as { entries?: unknown }).entries : undefined
      if (!Array.isArray(rows) || rows.length > 10000) throw new Error('Plik musi zawierać listę „entries” z najwyżej 10 000 wpisów.')
      const imported: ImportedEntry[] = []
      for (const row of rows) {
        if (!row || typeof row !== 'object' || typeof row.term !== 'string' || !row.term.trim() || typeof row.replacement !== 'string' || row.term.length > 1000 || row.replacement.length > 10000 || row.type != null && !['respelling', 'ipa', 'cmu'].includes(row.type) || row.language != null && typeof row.language !== 'string' || row.enabled != null && typeof row.enabled !== 'boolean') throw new Error('Plik zawiera nieprawidłowy wpis. Słownik nie został zmieniony.')
        imported.push({ term: row.term.trim(), replacement: row.replacement, type: row.type || 'respelling', language: row.language || '*', enabled: row.enabled ?? true })
      }
      if (!disposed) pending = imported
    } catch (cause) { if (!disposed) error = cause instanceof Error ? cause.message : String(cause) }
  }
  async function importDictionary() {
    if (!pending) return
    const payload = { entries: pending, replace: replaceAll }
    await work('Import słownika', async signal => { const result = await productionJson<{ imported: number; replaced: boolean }>('/pronunciation/import', postJson(payload, signal)); pending = undefined; replaceAll = false; clearForm(); await reloadAfterMutation(signal); notice = `Zaimportowano ${result.imported} wpisów${result.replaced ? ' · zastąpiono poprzedni słownik' : ' · dodano do istniejącego słownika'}.` })
  }
  $effect(() => { if (ready && !loaded) untrack(() => { void refresh() }) })
  onDestroy(() => { disposed = true; controller?.abort() })
</script>

<div class="dictionary-settings"><header><BookA size={23}/><div><h1>Słownik wymowy</h1><p>Własny zapis wymowy zmienia tekst przekazywany silnikowi przed syntezą. Wpisy są przechowywane w prywatnej bazie tej aplikacji.</p></div><Button variant="ghost" size="icon" aria-label="Odśwież słownik wymowy" disabled={!ready || locked} onclick={refresh}><RefreshCw size={15}/></Button></header>
  {#if !ready}<p role="status">Uruchom prywatny silnik, aby odczytać słownik wymowy.</p>{/if}
  <section aria-label="Dodawanie i edycja wymowy"><h2>{editId ? 'Edytuj wpis' : 'Dodaj wymowę'}</h2><label for={`${uid}-term`}>Słowo lub wyrażenie</label><Input id={`${uid}-term`} bind:value={term} placeholder="VoiceStudio" disabled={!ready || locked}/><label for={`${uid}-replacement`}>Jak ma zostać wypowiedziane</label><Input id={`${uid}-replacement`} bind:value={replacement} placeholder="wojs studio" disabled={!ready || locked}/><Select label="Rodzaj zapisu wymowy" value={type} onchange={value => type = value} {options} disabled={!ready || locked}/><label for={`${uid}-scope`}>Język wpisu</label><Input id={`${uid}-scope`} bind:value={language} placeholder="* lub pl, en, de…" disabled={!ready || locked}/><p>Gwiazdka * obejmuje wszystkie języki. Kod „pl” ogranicza wpis do polskiego. IPA i CMU są zapisywane i sprawdzane, ale obecny silnik ich jeszcze nie stosuje. Wybierz „Zapis wymowy”, aby zmienić wypowiadany tekst.</p><div class="actions"><Button variant="default" disabled={!ready || locked || !term.trim()} onclick={save}>{editId ? 'Zapisz zmianę wymowy' : 'Dodaj wpis'}</Button>{#if editId}<Button variant="ghost" disabled={locked} onclick={clearForm}>Anuluj edycję</Button>{/if}</div></section>
  <section aria-label="Wpisy słownika"><h2>Wpisy słownika · {entries.length}</h2>{#if loaded && !entries.length}<p>Słownik jest pusty.</p>{/if}{#each entries as entry (entry.id)}<article><div><strong>{entry.term} → {entry.replacement || '(pusty tekst)'}</strong><p>{entry.language === '*' ? 'Wszystkie języki' : entry.language} · {entry.type === 'respelling' ? 'zapis wymowy' : `${entry.type.toUpperCase()} · jeszcze nie stosowane`}</p></div><Switch label={`Stosuj wymowę ${entry.term}`} checked={entry.enabled} onchange={enabled => toggle(entry, enabled)} disabled={!ready || locked}/><Button variant="ghost" disabled={!ready || locked} onclick={() => edit(entry)}>Edytuj</Button><Button variant="ghost" size="icon" aria-label={`Usuń wymowę ${entry.term}`} disabled={!ready || locked} onclick={() => remove(entry)}><Trash2 size={14}/></Button></article>{/each}</section>
  <section aria-label="Sprawdzanie wymowy"><h2>Sprawdź podstawienie tekstu</h2><p>Ten test korzysta z tego samego słownika co synteza i nie generuje audio.</p><label for={`${uid}-test-lang`}>Język testu</label><Input id={`${uid}-test-lang`} bind:value={testLanguage} placeholder="pl lub *" oninput={() => preview = undefined} disabled={!ready || locked}/><Textarea aria-label="Tekst do sprawdzenia wymowy" bind:value={text} oninput={() => preview = undefined} disabled={!ready || locked} rows={3}/><Button variant="outline" disabled={!ready || locked || !text.trim()} onclick={() => work('Sprawdzanie podstawienia', updatePreview)}>Sprawdź tekst</Button>{#if preview}<div class="preview" role="status"><strong>{preview.changed ? 'Tekst po podstawieniu' : 'Tekst bez zmian'}</strong><p>{preview.substituted}</p>{#if preview.inert_entries?.length}<p>Wpisy zapisane, lecz jeszcze niestosowane przez silnik: {preview.inert_entries.map(row => `${row.term} (${row.type.toUpperCase()})`).join(', ')}.</p>{/if}</div>{/if}</section>
  <section aria-label="Import i eksport słownika"><h2>Kopia i przywracanie</h2><div class="actions"><Button variant="outline" disabled={!ready || locked} onclick={exportDictionary}><Download size={14}/>Eksportuj słownik JSON</Button><label for={`${uid}-import`}>Wybierz plik JSON do importu</label><Input id={`${uid}-import`} type="file" accept=".json,application/json" disabled={!ready || locked} onchange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void chooseFile(file) }}/></div>{#if pending}<div class="preview"><strong>Gotowe do importu: {pending.length} wpisów</strong><p>Obecny słownik: {entries.length} wpisów. Dodawanie zachowuje wszystkie dotychczasowe wpisy; powtórzenia nie są usuwane automatycznie.</p><div class="option"><span>Zastąp cały obecny słownik</span><Switch label="Zastąp cały obecny słownik podczas importu" checked={replaceAll} onchange={value => replaceAll = value} disabled={locked}/></div>{#if replaceAll}<p>Import usunie {entries.length} obecnych wpisów. Najpierw możesz wyeksportować ich kopię.</p>{/if}<div class="actions"><Button variant={replaceAll ? 'destructive' : 'default'} disabled={!ready || locked} onclick={importDictionary}>{replaceAll ? `Zastąp ${entries.length} wpisów i importuj ${pending.length}` : `Dodaj ${pending.length} wpisów do słownika`}</Button><Button variant="ghost" disabled={locked} onclick={() => pending = undefined}>Anuluj import</Button></div></div>{/if}</section>
  {#if busy}<p role="status">{busy}…</p>{/if}{#if error}<p class="failure" role="alert">{error}</p>{/if}{#if notice}<p role="status">{notice}</p>{/if}
</div>

<style>
  .dictionary-settings{display:flex;flex-direction:column;gap:20px;min-width:0}.dictionary-settings header{display:flex;align-items:flex-start;gap:14px}.dictionary-settings header>div{flex:1}.dictionary-settings h1{font-size:var(--ui-text-22);font-weight:600;letter-spacing:-.4px}.dictionary-settings h2{font-size:var(--ui-text-14);font-weight:600}.dictionary-settings p{font-size:var(--ui-text-12);color:var(--muted);line-height:1.75;margin:6px 0}.dictionary-settings section{display:flex;flex-direction:column;gap:12px;padding:20px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}.dictionary-settings label,.dictionary-settings strong,.dictionary-settings span{font-size:var(--ui-text-12)}.actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.dictionary-settings article{display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border);padding:10px 0}.dictionary-settings article>div{flex:1;min-width:0;overflow-wrap:anywhere}.preview{padding:14px;border:1px solid var(--border);border-radius:7px;white-space:pre-wrap;overflow-wrap:anywhere}.option{display:flex;align-items:center;justify-content:space-between;gap:16px}.failure{color:var(--danger)!important}.dictionary-settings section>:global([data-slot=button]){align-self:flex-start}@media(max-width:600px){.dictionary-settings section{padding:16px}.dictionary-settings article{flex-wrap:wrap}}
</style>
