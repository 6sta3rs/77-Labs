<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import { AudioLines, RefreshCw, Trash2 } from '@lucide/svelte'
  import Button from '../ui/Button.svelte'
  import Switch from '../ui/Switch.svelte'
  import { byteLabel } from '../models/model-management'
  import { generatePreviewSeries, previewCache, type CacheAudit, type PreviewCacheState } from './preview-cache'
  let { ready = false }: { ready?: boolean } = $props()
  let cacheState = $state.raw<PreviewCacheState>()
  let busy = $state(false), loading = $state(false), generating = $state(false), stopRequested = $state(false)
  let error = $state(''), message = $state(''), progress = $state('')
  let galleryEnabled = $state(false)
  let selected = $state<string[]>([]), confirm = $state<{ audit: CacheAudit; temporary: boolean }>()
  let controller: AbortController | undefined
  let disposed = false
  const locked = $derived(!ready || busy || loading || generating || cacheState?.generating === true)
  function fail(cause: unknown) { if (cause instanceof Error && cause.name === 'AbortError') return; error = cause instanceof Error ? cause.message : 'Nie udało się zarządzać próbkami głosów.' }
  function applyState(value: PreviewCacheState) { cacheState = value; galleryEnabled = value.gallery.enabled }
  async function refresh() {
    if (!ready || busy || loading || generating || disposed) return
    controller?.abort(); const request = new AbortController(); controller = request; loading = true; error = ''
    try { const value = await previewCache.state(request.signal); if (!disposed) applyState(value) }
    catch (cause) { if (!request.signal.aborted && !disposed) fail(cause) }
    finally { if (controller === request) loading = false }
  }
  $effect(() => { if (!ready) return; untrack(() => { void refresh() }); return () => { if (!busy) controller?.abort(); stopRequested = true; loading = false } })
  onDestroy(() => { disposed = true; stopRequested = true; if (!busy) controller?.abort() })
  async function action(operation: (signal: AbortSignal) => Promise<PreviewCacheState>, success: string) {
    if (locked || disposed) return
    busy = true; error = ''; message = ''; controller?.abort()
    const request = new AbortController(); controller = request
    try { const value = await operation(request.signal); if (!disposed) { applyState(value); message = success || message } }
    catch (cause) { if (!request.signal.aborted && !disposed) fail(cause) }
    finally { busy = false; galleryEnabled = cacheState?.gallery.enabled || false }
  }
  function choose(id: string, checked: boolean) { selected = checked ? [...new Set([...selected, id])] : selected.filter(value => value !== id) }
  async function generate() {
    if (locked || !selected.length || disposed) return
    generating = true; stopRequested = false; error = ''; message = ''; progress = `Przygotowywanie 0 / ${selected.length} próbek…`
    try {
      const result = await generatePreviewSeries(selected, { stop: () => stopRequested || disposed, progress: (completed, total, id, value) => {
        if (disposed) return
        cacheState = value; progress = `Sprawdzono lub wygenerowano ${completed} / ${total} · ${value.voices.find(voice => voice.id === id)?.name || id}`
      } })
      if (!disposed) message = result.stopped ? `Zatrzymano serię po ukończeniu bieżącej próbki: ${result.completed} / ${result.total}.` : `Sprawdzono i przygotowano ${result.completed} próbek w lokalnym cache.`
    } catch (cause) { if (!disposed) fail(cause) }
    finally { generating = false; if (!disposed) progress = '' }
  }
  function clear() {
    if (!confirm) return
    const target = confirm
    void action(async signal => {
      const result = await previewCache.clear(target.audit, target.temporary, signal)
      confirm = undefined
      if (result.errors.length) { cacheState = result.state; throw new Error(`Usunięto ${result.removed} plików. Nie udało się usunąć ${result.errors.length}: ${result.errors.map(item => item.file).join(', ')}. Odśwież i sprawdź wynik.`) }
      message = `Usunięto ${result.removed} plików (${byteLabel(result.freed_bytes)}).`
      return result.state
    }, '')
  }
</script>

<section class="preview-cache-settings tool-card" aria-labelledby="preview-cache-title">
  <div class="preview-heading"><h2 id="preview-cache-title"><AudioLines size={18}/> Próbki głosów i pliki tymczasowe</h2><Button variant="ghost" disabled={!ready || busy || loading || generating} onclick={refresh}><RefreshCw size={14}/>{loading ? 'Odczytywanie…' : 'Odśwież próbki'}</Button></div>
  {#if !ready}<p class="tool-notice">Uruchom prywatny silnik, aby odczytać cache próbek.</p>{/if}
  {#if error}<p class="tool-error" role="alert">{error}</p>{/if}{#if message}<p class="tool-notice" role="status">{message}</p>{/if}
  {#if cacheState}
    <div class="preview-consent"><div><h3>Gotowe próbki z galerii online</h3><p>Pobieranie podpisanych próbek z internetu jest opcjonalne. Włączenie pobierze wyróżniony zestaw; odsłuch może później pobierać kolejne próbki.</p></div><Switch label="Pobieraj gotowe próbki z galerii online" bind:checked={galleryEnabled} disabled={locked} onchange={enabled => action(signal => previewCache.gallery(enabled, signal), enabled ? 'Włączono pobieranie gotowych próbek z galerii.' : 'Wyłączono pobieranie gotowych próbek z galerii.')}/></div>
    <p class="page-footnote">Wyróżnione próbki galerii: {cacheState.gallery.featured_cached} / {cacheState.gallery.featured_total}. Ostatnie sprawdzenie: {cacheState.gallery.checked_seconds_ago == null ? 'jeszcze nie wykonano' : `${Math.floor(cacheState.gallery.checked_seconds_ago / 60)} min temu`}.</p>
    {#if cacheState.gallery.last_error}<p class="tool-error" role="alert">{cacheState.gallery.last_error}</p>{/if}
    <Button variant="outline" disabled={locked || !cacheState.gallery.enabled} onclick={() => action(signal => previewCache.check(signal), 'Sprawdzono aktualizacje podpisanych próbek galerii. Szczegóły ewentualnej odmowy są pokazane poniżej.')}>Sprawdź galerię teraz</Button>

    <div class="preview-counts"><p><strong>Lokalne próbki:</strong> {cacheState.local.count} · {byteLabel(cacheState.local.bytes)}</p><p><strong>Pobrane próbki:</strong> {cacheState.downloaded.count} · {byteLabel(cacheState.downloaded.bytes)}</p></div>
    <h3>Przygotuj lokalne próbki wyróżnionych głosów</h3>
    <p class="page-footnote">Zaznacz głosy i uruchom serię. Silnik wykorzystuje istniejącą prawidłową próbkę albo generuje ją z użyciem lokalnego modelu i jego licencji. Postęp oznacza rzeczywiście ukończone głosy; bieżąca próbka może wymagać czasu na wczytanie modelu.</p>
    <div class="preview-selection">{#each cacheState.voices as voice (voice.id)}<label><input type="checkbox" checked={selected.includes(voice.id)} disabled={locked} onchange={event => choose(voice.id, event.currentTarget.checked)}/><span>{voice.name}</span>{#if voice.cached}<small>Plik w cache</small>{/if}</label>{/each}</div>
    <div class="tool-actions"><Button variant="outline" disabled={locked || !selected.length} onclick={generate}>Przygotuj zaznaczone próbki ({selected.length})</Button>{#if generating}<Button variant="outline" disabled={stopRequested} onclick={() => stopRequested = true}>{stopRequested ? 'Zatrzymanie po bieżącej próbce…' : 'Zatrzymaj po bieżącej próbce'}</Button>{/if}</div>
    {#if progress}<p role="status">{progress}</p>{/if}

    <div class="preview-cleanup"><h3>Wyczyść cache próbek</h3><p>{cacheState.cache.count} plików · {byteLabel(cacheState.cache.bytes)}. Usunięte zostaną tylko kopie WAV/MP3 w cache. Głosy, referencje, projekty i wygenerowane nagrania pozostaną zachowane. Włączona galeria może ponownie pobrać próbki podczas odsłuchu.</p><Button variant="outline" disabled={locked || !cacheState.cache.count} onclick={() => confirm = { audit: cacheState!.cache, temporary: false }}><Trash2 size={14}/>Wyczyść próbki…</Button></div>
    <div class="preview-cleanup"><h3>Prywatne pliki tymczasowe</h3><p>{cacheState.temporary.count} plików · {byteLabel(cacheState.temporary.bytes)} w prywatnych katalogach <code>DATA/tmp</code> i <code>runtime/temp</code>.</p><Button variant="outline" disabled={locked || !cacheState.temporary.count} onclick={() => confirm = { audit: cacheState!.temporary, temporary: true }}>Wyczyść pliki tymczasowe…</Button></div>
    {#if confirm}<div class="preview-confirmation" role="group" aria-label="Potwierdzenie czyszczenia"><p>Potwierdź usunięcie {confirm.audit.count} {confirm.temporary ? 'prywatnych plików tymczasowych' : 'plików cache próbek'} ({byteLabel(confirm.audit.bytes)}). Operacji nie można cofnąć. Zmieniony od odczytu zestaw zostanie odrzucony.</p><div class="tool-actions"><Button variant="destructive" disabled={locked} onclick={clear}>Potwierdź usunięcie {confirm.audit.count} plików</Button><Button variant="ghost" disabled={busy} onclick={() => confirm = undefined}>Anuluj czyszczenie</Button></div></div>{/if}
  {/if}
</section>

<style>
  .preview-cache-settings { display: flex; flex-direction: column; gap: 13px; }
  .preview-heading, .preview-consent { display: flex; justify-content: space-between; align-items: center; gap: 20px; }
  .preview-heading { flex-wrap: wrap; }
  .preview-heading h2 { display: flex; align-items: center; gap: 9px; margin: 0; font-size: 16px; }
  .preview-cache-settings h3 { font-size: 14px; margin: 0; }
  .preview-cache-settings p { margin: 0; line-height: 1.6; }
  .preview-consent p { margin-top: 6px; font-size: 13px; }
  .preview-counts { display: flex; flex-wrap: wrap; gap: 15px; font-size: 13px; }
  .preview-selection { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 9px; max-height: 260px; overflow: auto; padding: 3px; }
  .preview-selection label { display: flex; align-items: center; gap: 7px; font-size: 13px; }
  .preview-selection small { font-size: 10px; opacity: .7; }
  .preview-cleanup, .preview-confirmation { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
  .preview-cleanup p, .preview-confirmation p { font-size: 13px; }
  .preview-cache-settings :global(.vs-button) { align-self: flex-start; }
</style>
