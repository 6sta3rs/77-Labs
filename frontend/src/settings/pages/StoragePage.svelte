<script lang="ts">
  import Checkbox from '../../ui/Checkbox.svelte'
  // "Przechowywanie": data folder, model folder (single owner of all paths), disk usage, DB backups, history cap, preview cache.
  import { onDestroy, tick, untrack } from 'svelte'
  import { FolderOpen, RotateCcw, RefreshCw, Database, Trash2, LoaderCircle } from '@lucide/svelte'
  import { uiLanguage, createUiTranslator } from '../../i18n'
  import { polishPlural } from '../../i18n/plural'
  import type { SettingsSection } from '../settings-catalog'
  import { toast } from '../../ui/toast'
  import Button from '../../ui/Button.svelte'
  import Input from '../../ui/Input.svelte'
  import Switch from '../../ui/Switch.svelte'
  import StatusBadge from '../../ui/StatusBadge.svelte'
  import { isDesktop } from '../../platform/runtime'
  import { byteLabel, modelManagement, type ModelStorage } from '../../models/model-management'
  import { dataFolderPath, pickStorageFolder, storageSettings, validRetentionCap, type StorageBackup, type StorageReport, type StorageState } from '../storage-settings'
  import { generatePreviewSeries, previewCache, type CacheAudit, type PreviewCacheState } from '../../playback/preview-cache'
  import { settingsError } from '../system-settings'

  let { ready = false, onrestart, onnavigate }: { ready?: boolean; onrestart?: () => Promise<void>; onnavigate?: (id: SettingsSection) => void } = $props()
  const tr = $derived(createUiTranslator($uiLanguage))
  const desktop = isDesktop()

  let storageState = $state.raw<StorageState>()
  let models = $state.raw<ModelStorage>()
  let report = $state.raw<StorageReport>()
  let backups = $state.raw<StorageBackup[]>()
  let cache = $state.raw<PreviewCacheState>()
  let loadError = $state(''), loading = $state(false), busy = $state(''), disposed = false
  let controller: AbortController | undefined
  const transferring = $derived((models?.active_downloads || 0) > 0)
  const locked = $derived(!ready || loading || !!busy)

  const timers = new Set<ReturnType<typeof setTimeout>>()
  const later = (fn: () => void, ms: number) => { const id = setTimeout(() => { timers.delete(id); fn() }, ms); timers.add(id) }
  onDestroy(() => { disposed = true; stopRequested = true; controller?.abort(); timers.forEach(clearTimeout) })

  async function load(rescan = false) {
    controller?.abort(); const request = new AbortController(); controller = request
    loading = true; loadError = ''
    const results = await Promise.allSettled([
      storageSettings.state(request.signal), modelManagement.status(request.signal), storageSettings.report(rescan, request.signal),
      storageSettings.backups(request.signal), storageSettings.retention(request.signal), previewCache.state(request.signal),
    ])
    if (request.signal.aborted || disposed) return
    const [s, m, r, b, h, p] = results
    if (s.status === 'fulfilled') storageState = s.value
    if (m.status === 'fulfilled') models = m.value.storage
    if (r.status === 'fulfilled') report = r.value
    if (b.status === 'fulfilled') backups = b.value.backups
    if (h.status === 'fulfilled') { cap = h.value.cap; savedCap = h.value.cap }
    if (p.status === 'fulfilled') cache = p.value
    loadError = [...new Set(results.filter(x => x.status === 'rejected').map(x => settingsError((x as PromiseRejectedResult).reason)))].join('\n')
    loading = false
  }
  $effect(() => {
    if (!ready) return
    untrack(() => { void load() })
    return () => { controller?.abort(); loading = false }
  })
  // One click result = one toast. `label` locks the page while the request runs.
  async function work(label: string, run: (signal: AbortSignal) => Promise<string | void>) {
    if (locked || disposed) return
    const request = new AbortController(); controller = request; busy = label
    try { const done = await run(request.signal); if (done && !disposed) toast.ok(done) }
    catch (cause) { if (!request.signal.aborted && !disposed) toast.bad(settingsError(cause)) }
    finally { if (!disposed) busy = '' }
  }

  /* ---------- folders ---------- */
  let dataDraft = $state(''), manual = $state({ data: '', models: '' })
  const modelPending = $derived(!!models?.restart_required)
  const needsRestart = $derived(!!storageState?.pending || modelPending)
  let restarting = $state(false), restartOk = $state(false)
  async function choose(kind: 'data' | 'models', typed?: string) {
    let path = typed?.trim()
    if (!path) { try { path = await pickStorageFolder() } catch (cause) { toast.bad(settingsError(cause)); return } }
    if (!path || disposed) return
    if (kind === 'data') { dataDraft = dataFolderPath(path); manual.data = ''; return }
    manual.models = ''
    void work('models', async signal => { models = await modelManagement.storage(path!, signal) })
  }
  const planData = () => work('data', async signal => { storageState = await storageSettings.relocate(dataDraft, signal); dataDraft = '' })
  const cancelPlan = () => work('data', async signal => { storageState = await storageSettings.cancelRelocation(signal); return tr('Anulowano plan. Zarezerwowany katalog pozostał na dysku; dane nie zostały przeniesione.') })
  const resetModels = () => work('models', async signal => { models = await storageSettings.resetModels(signal) })
  async function applyRestart() {
    if (!onrestart || locked || transferring) return
    restarting = true; busy = 'restart'
    try {
      await onrestart(); await tick()
      if (disposed) return
      busy = ''; await load(true)
      if (!disposed && !loadError) { restartOk = true; later(() => restartOk = false, 3500) }
    } catch (cause) { if (!disposed) toast.bad(settingsError(cause)) }
    finally { restarting = false; if (busy === 'restart') busy = '' }
  }

  /* ---------- disk ---------- */
  const catMax = $derived(Math.max(1, ...(report?.categories || []).map(c => c.bytes)))
  const when = (seconds: number) => new Date(seconds * 1000).toLocaleString(tr.locale)
  const volumes = $derived((report?.volumes || []).map(v => tr('Dysk {name}: wolne {free} z {total}', { name: v.path, free: byteLabel(v.free_bytes), total: byteLabel(v.total_bytes) })).join(' · '))
  const rescan = () => work('scan', async signal => { report = await storageSettings.report(true, signal) })

  /* ---------- backups ---------- */
  const lastBackup = $derived((backups || []).reduce<StorageBackup | undefined>((a, b) => !a || b.created_at > a.created_at ? b : a, undefined))
  const backup = () => work('backup', async signal => { backups = (await storageSettings.backup(signal)).backups; return tr('Kopia bazy utworzona i sprawdzona') })

  /* ---------- history ---------- */
  let cap = $state<number | undefined>(), savedCap = $state<number>(), capOk = $state(false)
  const capValid = $derived(validRetentionCap(cap))
  const saveCap = () => work('cap', async signal => {
    const next = await storageSettings.saveRetention(cap as number, signal); cap = next.cap; savedCap = next.cap
    capOk = true; later(() => capOk = false, 1800)
  })

  /* ---------- samples + temp ---------- */
  let selected = $state<string[]>([]), progress = $state<{ pct: number; text: string } | null>(null), stopRequested = $state(false)
  let confirm = $state<{ audit: CacheAudit; temporary: boolean } | null>(null), cleaned = $state('')
  const sampleLocked = $derived(locked || !!progress || !!cache?.generating)
  const files = (n: number) => `${n} ${tr(polishPlural(n, 'plik', 'pliki', 'plików'))}`
  const setGallery = (enabled: boolean) => work('gallery', async signal => { cache = await previewCache.gallery(enabled, signal) }).then(() => { if (cache) gallery = cache.gallery.enabled })
  let gallery = $state(false)
  $effect(() => { gallery = cache?.gallery.enabled ?? false })
  const checkGallery = () => work('check', async signal => { cache = await previewCache.check(signal); return cache.gallery.last_error ? undefined : tr('Galeria jest aktualna') })
  const toggle = (id: string, on: boolean) => selected = on ? [...new Set([...selected, id])] : selected.filter(v => v !== id)
  async function prepare() {
    if (sampleLocked || !selected.length) return
    stopRequested = false; progress = { pct: 0, text: tr('0 / {total} · Przygotowywanie', { total: selected.length }) }
    try {
      const result = await generatePreviewSeries(selected, { stop: () => stopRequested || disposed, progress: (done, total, id, value) => {
        if (disposed) return
        cache = value
        progress = { pct: done / total * 100, text: `${done} / ${total} · ${value.voices.find(v => v.id === id)?.name || id}` }
      } })
      if (disposed) return
      selected = []
      if (result.stopped) toast.info(tr('Zatrzymano serię po ukończeniu bieżącej próbki: {done} / {total}.', { done: result.completed, total: result.total }))
      else toast.ok(tr('Próbki gotowe ({count})', { count: result.completed }))
    } catch (cause) { if (!disposed) toast.bad(settingsError(cause)) }
    finally { progress = null }
  }
  const doClean = () => { const target = confirm!; return work('clean', async signal => {
    const result = await previewCache.clear(target.audit, target.temporary, signal)
    cache = result.state; confirm = null
    if (result.errors.length) throw new Error(tr('Usunięto {removed} plików. Nie udało się usunąć {failed}: {list}. Odśwież i sprawdź wynik.', { removed: result.removed, failed: result.errors.length, list: result.errors.map(e => e.file).join(', ') }))
    cleaned = tr('Usunięto {files} ({size}).', { files: files(result.removed), size: byteLabel(result.freed_bytes) }); later(() => cleaned = '', 4000)
  }) }
</script>

{#snippet manualPath(kind: 'data' | 'models')}
  {#if !desktop}
    <div class="p-actions"><Input class="sp-manual" bind:value={manual[kind]} spellcheck={false} aria-label={tr('Pełna ścieżka folderu')} placeholder={kind === 'data' ? 'D:\\SeventySevenLabs\\data' : 'D:\\SeventySevenLabs\\models'} disabled={locked}/>
      <Button variant="outline" disabled={locked || !manual[kind].trim()} onclick={() => choose(kind, manual[kind])}>{tr('Użyj ścieżki')}</Button></div>
  {/if}
{/snippet}

<div class="p-page storage-page">
  <div class="page-heading"><div><h1>{tr('Przechowywanie')}</h1><p>{tr('Gdzie aplikacja trzyma głosy, nagrania i modele oraz ile to zajmuje.')}</p></div></div>

  {#if !ready}
    <p class="p-notice">{tr('Silnik jest zatrzymany, więc foldery, miejsce na dysku i kopie są niedostępne. Uruchom go na stronie Silnik.')}{#if onnavigate}{' '}<Button size="sm" onclick={() => onnavigate?.('engine')}>{tr('Przejdź do strony Silnik')}</Button>{/if}</p>
  {:else}
  {#if loadError}<p class="p-notice bad" role="alert">{loadError}</p>{/if}
  {#if !storageState && !models && !report && !cache && loading}<p class="p-sub" role="status">{tr('Odczytywanie ustawień przechowywania…')}</p>{/if}

  {#if storageState || models || report || backups || savedCap !== undefined || cache}
  <section class="p-card sp-card">
    <!-- Foldery -->
    {#if storageState || models}
    <div class="p-section">
      <header><h3>{tr('Foldery')}</h3><p>{tr('Zmiana folderu działa po restarcie silnika. Dotychczasowe dane zostają na dysku.')}</p></header>
      {#if storageState?.last_error}<p class="p-notice bad" role="alert">{storageState.last_error} {tr('Dotychczasowy katalog pozostaje aktywny. Wybierz nowy pusty katalog, aby ponowić kopię.')}</p>{/if}

      {#if storageState}
      <div class="sp-folder">
        <div class="p-row flat">
          <div class="t"><b>{tr('Głosy, projekty i nagrania')}</b><span>{tr('Baza, głosy i pliki audio.')}</span></div>
          <div class="p-actions">
            {#if storageState.pending}<StatusBadge kind="wait" text={tr('Czeka na restart')}/>
            {:else}{#if desktop}<Button variant="outline" disabled={locked || transferring} onclick={() => choose('data')}><FolderOpen size={15}/>{tr('Wybierz folder…')}</Button>{/if}
              <Button variant="ghost" disabled={!dataDraft} onclick={() => dataDraft = ''}><RotateCcw size={14}/>{tr('Przywróć domyślny')}</Button>{/if}
          </div>
        </div>
        <code class="sp-path" title={tr('Aktywny katalog')}>{storageState.data_dir}</code>
        {#if storageState.pending}
          <dl class="p-kv"><div><dt>{tr('Zaplanowana kopia do')}</dt><dd class="mono">{storageState.pending.destination}</dd></div></dl>
          <div class="p-actions"><Button variant="outline" disabled={locked} onclick={cancelPlan}>{tr('Anuluj plan przeniesienia')}</Button></div>
        {:else if dataDraft}
          <dl class="p-kv"><div><dt>{tr('Nowy katalog')}</dt><dd class="mono">{dataDraft}</dd></div></dl>
          <div class="p-actions"><Button disabled={locked || transferring} onclick={planData}>{tr('Zaplanuj kopię i zmianę katalogu')}</Button>
            <span class="p-sub">{tr('Kopia obejmie bazę, głosy i projekty. Folder musi być pusty i nazywać się „data”.')}</span></div>
        {:else}{@render manualPath('data')}{/if}
        {#if storageState.last_relocation}<span class="p-sub">{tr('Ostatnia kopia: {date}. Poprzedni katalog: {path}.', { date: when(storageState.last_relocation.completed_at), path: storageState.last_relocation.source })}</span>{/if}
      </div>
      {/if}

      {#if models}
      <div class="sp-folder">
        <div class="p-row flat">
          <div class="t"><b>{tr('Wagi modeli')}</b><span>{tr('Pobrane modele syntezy i rozpoznawania mowy.')}</span></div>
          <div class="p-actions">
            {#if modelPending}<StatusBadge kind="wait" text={tr('Czeka na restart')}/>{/if}
            {#if desktop}<Button variant="outline" disabled={locked || transferring} onclick={() => choose('models')}><FolderOpen size={15}/>{tr('Wybierz folder…')}</Button>{/if}
            <Button variant="ghost" disabled={locked || transferring || models.configured === storageState?.model_default} onclick={resetModels}><RotateCcw size={14}/>{tr('Przywróć domyślny')}</Button>
          </div>
        </div>
        <code class="sp-path" title={tr('Aktywny katalog')}>{models.effective}</code>
        {#if modelPending}<dl class="p-kv"><div><dt>{tr('Po restarcie')}</dt><dd class="mono">{models.configured}</dd></div></dl>
          <span class="p-sub">{tr('Istniejące modele zostają w poprzednim miejscu. Wybierz pusty folder.')}</span>{/if}
        {#if transferring}<span class="p-sub">{tr('Trwa pobieranie modelu. Zmiana folderu będzie możliwa po jego zakończeniu.')}</span>{/if}
        {@render manualPath('models')}
      </div>
      {/if}

      {#if needsRestart || restarting || restartOk}
        <div class="sp-apply">
          {#if restarting}<div class="p-progress" role="status"><progress class="p-bar" aria-label={tr('Uruchamianie ponowne silnika')}></progress><span>{tr('Uruchamianie ponowne silnika…')}</span></div>
          {:else if restartOk}<span class="saved on">{tr('Silnik uruchomiony ponownie, odczytano aktywne katalogi.')}</span>
          {:else}<StatusBadge kind="wait" text={tr('Czeka na restart')}/>{#if onrestart}<Button disabled={locked || transferring} onclick={applyRestart}><RefreshCw size={15}/>{tr('Zastosuj zmiany i uruchom silnik ponownie')}</Button>{/if}{/if}
        </div>
      {/if}
    </div>
    {/if}

    <!-- Miejsce na dysku -->
    {#if report}
    <div class="p-section">
      <header class="split"><div><h3>{tr('Miejsce na dysku')}</h3><p>{volumes}{volumes ? '. ' : ''}{tr('Pomiar: {date}.', { date: when(report.generated_at) })}</p></div>
        <Button variant="outline" disabled={locked} onclick={rescan}>{#if busy === 'scan'}<LoaderCircle size={15} class="spin"/>{tr('Odczytywanie…')}{:else}<RefreshCw size={15}/>{tr('Odśwież')}{/if}</Button></header>
      {#if report.volumes.some(v => v.low_space)}<p class="p-notice warn">{tr('Mało miejsca na dysku — mniej niż 5 GB.')}</p>{/if}
      <div class="sp-cats">
        {#each report.categories as c (c.id)}
          <div class="sp-cat" title={c.path}><div class="sp-cat-h"><b>{tr(c.label)}</b><span>{c.complete ? '' : tr('co najmniej') + ' '}{byteLabel(c.bytes)}</span></div>
            <div class="p-bar" role="meter" aria-label={tr(c.label)} aria-valuenow={c.bytes} aria-valuemin={0} aria-valuemax={catMax}><i style:width="{Math.max(1.5, c.bytes / catMax * 100)}%"></i></div>
            {#each c.errors as detail}<span class="p-sub">{tr(detail)}</span>{/each}</div>
        {/each}
      </div>
      <p class="p-sub">{tr('Rozmiary logiczne plików. Modele i biblioteki mogą współdzielić dane, więc nie sumuj ich jako zajętego miejsca.')}</p>
    </div>
    {/if}

    <!-- Kopie bezpieczeństwa -->
    {#if backups}
    <div class="p-section">
      <header><h3>{tr('Kopie bezpieczeństwa bazy')}</h3></header>
      <div class="p-row flat">
        <div class="t"><b>{tr('Ostatnia kopia')}</b><span title={lastBackup?.path}>{lastBackup ? `${tr(lastBackup.kind)} · ${when(lastBackup.created_at)} · ${byteLabel(lastBackup.bytes)}. ${tr('Kopia robi się sama przed aktualizacją. Ręczna nie zawiera plików nagrań.')}` : tr('Brak kopii. Pierwsza automatyczna powstanie przed kolejną aktualizacją bazy. Ręczna nie zawiera plików nagrań.')}</span></div>
        <div class="p-actions"><Button disabled={locked || transferring} onclick={backup}><Database size={15}/>{tr('Utwórz kopię bazy teraz')}</Button></div>
      </div>
      {#if busy === 'backup'}<div class="p-progress" role="status"><progress class="p-bar" aria-label={tr('Zapisywanie i sprawdzanie kopii')}></progress><span>{tr('Zapisywanie i sprawdzanie kopii…')}</span></div>{/if}
    </div>
    {/if}

    <!-- Historia -->
    {#if savedCap !== undefined}
    <div class="p-section">
      <header><h3>{tr('Historia generowania')}</h3></header>
      <div class="p-row flat">
        <div class="t"><b>{tr('Liczba zachowywanych nagrań')}</b><span>{tr('Starsze nagrania ponad limit są usuwane, ulubione zostają. 0 = bez limitu.')}</span></div>
        <div class="p-actions">
          {#if capOk}<span class="saved on" role="status">{tr('Zapisano')}</span>{/if}
          <Input class="num" type="number" min="0" max="100000" step="1" aria-label={tr('Liczba zachowywanych nagrań')} bind:value={cap} disabled={locked}/>
          <Button disabled={locked || !capValid || cap === savedCap} onclick={saveCap}>{tr('Zapisz limit historii')}</Button></div>
      </div>
      {#if !capValid}<p class="p-field-err" role="alert">{tr('Podaj całkowitą liczbę nagrań od 0 do 100000.')}</p>{/if}
    </div>
    {/if}

    <!-- Próbki i pliki tymczasowe -->
    {#if cache}
    <div class="p-section">
      <header><h3>{tr('Próbki głosów i pliki tymczasowe')}</h3></header>
      <div class="p-rows">
        <div class="p-row"><div class="t"><b>{tr('Pobieraj gotowe próbki z galerii online')}</b><span>{tr('Opcjonalne. Pobierze zestaw wyróżnionych próbek głosów.')}</span></div>
          <Switch label={tr('Pobieraj gotowe próbki z galerii online')} bind:checked={gallery} disabled={sampleLocked} onchange={setGallery}/></div>
        <div class="p-row"><div class="t"><b>{tr('Galeria')}</b><span>{tr('Wyróżnione próbki: {cached} / {total} · ostatnie sprawdzenie {when}.', { cached: cache.gallery.featured_cached, total: cache.gallery.featured_total, when: cache.gallery.checked_seconds_ago == null ? tr('jeszcze nie wykonano') : tr('{min} min temu', { min: Math.floor(cache.gallery.checked_seconds_ago / 60) }) })}</span></div>
          <div class="p-actions"><Button variant="outline" disabled={!cache.gallery.enabled || sampleLocked} onclick={checkGallery}>{#if busy === 'check'}<LoaderCircle size={15} class="spin"/>{tr('Sprawdzam…')}{:else}{tr('Sprawdź galerię teraz')}{/if}</Button></div></div>
      </div>
      {#if cache.gallery.last_error}<p class="p-notice bad" role="alert">{cache.gallery.last_error}</p>{/if}

      {#if cache.voices.length}
        <div class="sp-voices" role="group" aria-label={tr('Głosy do przygotowania')}>
          {#each cache.voices as v (v.id)}<label><Checkbox checked={selected.includes(v.id)} disabled={sampleLocked} onchange={checked => toggle(v.id, checked)}/><span>{v.name}</span>{#if v.cached}<small>{tr('w cache')}</small>{/if}</label>{/each}
        </div>
        <div class="p-actions"><Button disabled={!selected.length || sampleLocked} onclick={prepare}>{tr('Przygotuj zaznaczone próbki ({count})', { count: selected.length })}</Button>
          {#if progress}<Button variant="outline" disabled={stopRequested} onclick={() => stopRequested = true}>{stopRequested ? tr('Zatrzymanie po bieżącej próbce…') : tr('Zatrzymaj po bieżącej próbce')}</Button>{/if}
          <span class="p-sub">{tr('Silnik użyje istniejącej próbki albo wygeneruje ją lokalnym modelem.')}</span></div>
        {#if progress}<div class="p-progress" role="status"><progress class="p-bar" max="100" value={progress.pct} aria-label={progress.text}></progress><span>{progress.text}</span></div>{/if}
      {/if}

      <div class="p-rows">
        <div class="p-row"><div class="t"><b>{tr('Pamięć podręczna próbek')}</b><span>{tr('{files} · {size}. Głosy i nagrania zostają.', { files: files(cache.cache.count), size: byteLabel(cache.cache.bytes) })}</span></div>
          <Button variant="outline" disabled={!cache.cache.count || sampleLocked} onclick={() => confirm = { audit: cache!.cache, temporary: false }}><Trash2 size={14}/>{tr('Wyczyść próbki…')}</Button></div>
        <div class="p-row"><div class="t"><b>{tr('Prywatne pliki tymczasowe')}</b><span>{tr('{files} · {size}. To pliki robocze silnika.', { files: files(cache.temporary.count), size: byteLabel(cache.temporary.bytes) })}</span></div>
          <Button variant="outline" disabled={!cache.temporary.count || sampleLocked} onclick={() => confirm = { audit: cache!.temporary, temporary: true }}>{tr('Wyczyść pliki tymczasowe…')}</Button></div>
      </div>
      {#if confirm}
        <div class="p-confirm" role="alert"><span>{tr(confirm.temporary ? 'Usunąć {count} plików tymczasowych ({size})? Tej operacji nie można cofnąć.' : 'Usunąć {count} plików próbek ({size})? Tej operacji nie można cofnąć.', { count: confirm.audit.count, size: byteLabel(confirm.audit.bytes) })}</span>
          <div class="p-actions"><Button variant="destructive" disabled={locked} onclick={doClean}>{tr('Potwierdź usunięcie {count} plików', { count: confirm.audit.count })}</Button><Button variant="outline" disabled={busy === 'clean'} onclick={() => confirm = null}>{tr('Anuluj czyszczenie')}</Button></div></div>
      {/if}
      {#if cleaned}<span class="saved on" role="status">{cleaned}</span>{/if}
    </div>
    {/if}
  </section>
  {/if}
  {/if}
</div>

<style>
  .sp-card{display:flex;flex-direction:column;gap:22px;padding:22px}
  .sp-folder{display:flex;flex-direction:column;gap:10px;padding-top:4px}
  .sp-folder+.sp-folder{padding-top:14px;border-top:1px solid var(--border)}
  .sp-path{display:block;font:var(--ui-text-11)/1.6 var(--font-mono,monospace);overflow-wrap:anywhere;padding:9px 12px;border:1px solid var(--border);border-radius:8px;background:var(--background)}
  .mono{font-family:var(--font-mono,monospace);font-size:var(--ui-text-11)}
  .sp-apply{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding-top:4px}
  .sp-apply .p-progress{flex:1;min-width:260px}
  .sp-cats{display:flex;flex-direction:column;gap:14px}
  .sp-cat{display:flex;flex-direction:column;gap:6px}
  .sp-cat-h{display:flex;justify-content:space-between;gap:12px;font-size:var(--ui-text-12)}
  .sp-cat-h b{font-weight:550}.sp-cat-h span{color:var(--muted);font-variant-numeric:tabular-nums}
  .saved{color:var(--success);font-size:var(--ui-text-12)}
  .storage-page :global(.num){width:110px;text-align:right}
  .storage-page :global(.sp-manual){flex:1;min-width:240px}
  .storage-page :global(.spin){animation:sp-rot .8s linear infinite}@keyframes sp-rot{to{transform:rotate(360deg)}}
  @media(prefers-reduced-motion:reduce){.storage-page :global(.spin){animation:none}}
  .storage-page :global(.vs-button svg.spin){color:var(--accent)}
  .sp-voices{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:9px 16px;max-height:260px;overflow:auto}
  .sp-voices label{display:flex;align-items:center;gap:8px;font-size:var(--ui-text-12)}

  .sp-voices small{font-size:var(--ui-text-10);color:var(--muted)}
  @media(max-width:600px){.sp-card{padding:16px}}
</style>
