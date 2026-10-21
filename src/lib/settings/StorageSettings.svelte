<script lang="ts">
  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import { onDestroy, tick, untrack } from 'svelte'
  import { Database, FolderOpen, HardDrive, History, RefreshCw, RotateCcw, ShieldCheck } from '@lucide/svelte'
  import Button from '../ui/Button.svelte'
  import Input from '../ui/Input.svelte'
  import { isDesktop } from '../platform/runtime'
  import { byteLabel, modelManagement, type ModelStorage } from '../models/model-management'
  import { dataFolderPath, pickStorageFolder, storageSettings, validRetentionCap, type StorageBackup, type StorageReport, type StorageState } from './storage-settings'

  let { ready = false, onrestart, onretentionchange }: { ready?: boolean; onrestart?: () => Promise<void>; onretentionchange?: (cap: number) => void } = $props()
  let storageState = $state.raw<StorageState>()
  let models = $state.raw<ModelStorage>()
  let report = $state.raw<StorageReport>()
  let backups = $state.raw<StorageBackup[]>([])
  let dataPath = $state(''), modelPath = $state(''), cap = $state<number | undefined>(200), savedCap = $state(200)
  let loading = $state(false), busy = $state(false), error = $state(''), message = $state('')
  let controller: AbortController | undefined
  let disposed = false
  const desktop = isDesktop()
  const transferring = $derived((models?.active_downloads || 0) > 0)
  const needsRestart = $derived(Boolean(storageState?.pending || models?.restart_required))

  function fail(cause: unknown) {
    if (disposed || (cause instanceof Error && cause.name === 'AbortError')) return
    error = cause instanceof Error && cause.name === 'TimeoutError' ? 'Silnik nie odpowiedział na czas. Spróbuj odświeżyć ustawienia.' : cause instanceof Error ? cause.message : String(cause)
  }
  async function load(signal: AbortSignal, refresh = false) {
    const [nextState, nextModels, nextReport, nextBackups, retention] = await Promise.all([
      storageSettings.state(signal), modelManagement.status(signal), storageSettings.report(refresh, signal), storageSettings.backups(signal), storageSettings.retention(signal),
    ])
    signal.throwIfAborted()
    if (disposed) return
    storageState = nextState; models = nextModels.storage; report = nextReport; backups = nextBackups.backups
    dataPath = nextState.pending?.destination || ''; modelPath = nextModels.storage.configured
    cap = retention.cap; savedCap = retention.cap; onretentionchange?.(retention.cap)
  }
  async function refresh(rescan = false) {
    if (!ready || busy || disposed) return
    controller?.abort(); const request = new AbortController(); controller = request
    loading = true; error = ''
    try { await load(request.signal, rescan) } catch (cause) { if (!request.signal.aborted) fail(cause) }
    finally { if (controller === request) loading = false }
  }
  $effect(() => {
    if (!ready) return
    untrack(() => { void refresh() })
    return () => { controller?.abort(); loading = false }
  })
  onDestroy(() => { disposed = true; controller?.abort() })

  async function action(operation: (signal: AbortSignal) => Promise<void>, success: string) {
    if (!ready || busy || loading || disposed) return
    controller?.abort(); const request = new AbortController(); controller = request
    busy = true; error = ''; message = ''
    try {
      await operation(request.signal); request.signal.throwIfAborted()
      if (!disposed) message = success
    } catch (cause) { if (!request.signal.aborted) fail(cause) }
    finally { if (controller === request) busy = false }
  }
  async function choose(kind: 'data' | 'models') {
    try {
      const path = await pickStorageFolder()
      if (!path || disposed) return
      if (kind === 'data') dataPath = dataFolderPath(path)
      else modelPath = path
    } catch (cause) { fail(cause) }
  }
  function saveRetention() {
    if (!validRetentionCap(cap)) { error = 'Podaj całkowitą liczbę nagrań od 0 do 100000.'; return }
    const nextCap = cap
    void action(async signal => {
      const retention = await storageSettings.saveRetention(nextCap, signal)
      cap = retention.cap; savedCap = retention.cap; onretentionchange?.(retention.cap)
    }, 'Zapisano limit. Zostanie zastosowany po kolejnych generacjach; ulubione nagrania są zachowywane.')
  }
  async function restart() {
    if (!onrestart || !ready || busy || loading || transferring) return
    controller?.abort(); busy = true; error = ''; message = ''
    try {
      await onrestart(); await tick()
      if (disposed) return
      busy = false
      await refresh(true)
      if (!disposed && !error) message = 'Uruchomiono silnik ponownie i odczytano aktywne katalogi.'
    } catch (cause) { fail(cause) }
    finally { busy = false }
  }
</script>

<section class="storage-settings studio-tools" aria-label={tr("Przechowywanie")}>
  <div class="page-heading"><div><h2>{tr("Przechowywanie")}</h2><p class="page-footnote">{tr("Prywatne dane aplikacji, modele, miejsce na dysku i kopie bezpieczeństwa.")}</p></div><Button variant="outline" disabled={!ready || busy || loading} onclick={() => refresh(true)}><RefreshCw size={15}/>{loading ? 'Odczytywanie…' : tr("Odśwież")}</Button></div>
  {#if error}<p class="tool-error" role="alert">{tr(String(error))}</p>{/if}
  {#if message}<p class="tool-notice" role="status">{tr(String(message))}</p>{/if}
  {#if !ready}<p class="tool-notice">{tr("Uruchom prywatny silnik, aby odczytać i zmienić ustawienia przechowywania.")}</p>{/if}
  {#if storageState?.last_error}<p class="tool-error" role="alert">{storageState.last_error} {tr("Dotychczasowy katalog pozostaje aktywny. Wybierz nowy pusty katalog, aby ponowić kopię.")}</p>{/if}

  <section class="tool-card storage-card" aria-labelledby="storage-data-title">
    <h3 id="storage-data-title"><Database size={18}/> {tr("Głosy, projekty i nagrania silnika")}</h3>
    {#if storageState}
      <p>{tr("Aktywny katalog:")} <code>{storageState.data_dir}</code></p>
      <label for="storage-data-path">{tr("Nowy pusty katalog danych — ostatni folder musi nazywać się")} <code>{tr("data")}</code></label>
      <div class="storage-path"><Input id="storage-data-path" bind:value={dataPath} spellcheck={false} disabled={busy || loading || Boolean(storageState.pending)} placeholder={tr("D:\\SeventySevenLabs\\data")}/><Button variant="outline" disabled={!desktop || busy || loading || Boolean(storageState.pending)} onclick={() => choose('data')}><FolderOpen size={15}/>{tr("Wybierz folder…")}</Button></div>
      <p class="page-footnote">{tr("Po restarcie silnika aplikacja skopiuje bazę, głosy, pliki i projekty, sprawdzi kopię i aktywuje nową lokalizację. Dotychczasowy katalog pozostanie zachowany. Modele mają osobny katalog. Projekty edytora i nagrania zapisane w pamięci przeglądarki (IndexedDB) pozostają w profilu aplikacji.")}</p>
      {#if storageState.pending}
        <p class="tool-notice" role="status">{tr("Zaplanowano kopię do")} <code>{storageState.pending.destination}</code>{tr(". Zostanie wykonana przy kolejnym uruchomieniu silnika.")}</p>
        <Button variant="outline" disabled={busy || loading} onclick={() => action(async signal => { storageState = await storageSettings.cancelRelocation(signal) }, tr("Anulowano plan. Zarezerwowany katalog pozostał na dysku; dane nie zostały przeniesione."))}>{tr("Anuluj plan przeniesienia")}</Button>
      {:else}
        <Button variant="outline" disabled={!ready || busy || loading || transferring || !dataPath.trim()} onclick={() => action(async signal => { storageState = await storageSettings.relocate(dataPath, signal); dataPath = storageState.pending?.destination || dataPath }, tr("Zapisano plan przeniesienia. Uruchom ponownie silnik, aby wykonać i sprawdzić kopię."))}>{tr("Zaplanuj kopię i zmianę katalogu")}</Button>
      {/if}
      {#if storageState.last_relocation}<p class="page-footnote">{tr("Ostatnia kopia:")} {new Date(storageState.last_relocation.completed_at * 1000).toLocaleString(tr.locale)}{tr(". Poprzedni katalog:")} <code>{storageState.last_relocation.source}</code>.</p>{/if}
    {:else}<p>{loading ? 'Odczytywanie katalogu danych…' : tr("Katalog zostanie odczytany po połączeniu z silnikiem.")}</p>{/if}
  </section>

  <section class="tool-card storage-card" aria-labelledby="storage-model-title">
    <h3 id="storage-model-title"><HardDrive size={18}/> {tr("Cache modeli")}</h3>
    {#if models}
      <label for="storage-model-path">{tr("Katalog wag modeli")}</label>
      <div class="storage-path"><Input id="storage-model-path" bind:value={modelPath} spellcheck={false} disabled={busy || loading || transferring}/><Button variant="outline" disabled={!desktop || busy || loading || transferring} onclick={() => choose('models')}><FolderOpen size={15}/>{tr("Wybierz folder…")}</Button></div>
      <p class="page-footnote">{tr("Bieżący katalog:")} <code>{models.effective}</code>{tr(". Nowa lokalizacja obowiązuje po restarcie silnika; istniejące modele pozostają w poprzednim miejscu. Wybierz pusty katalog lub prywatny cache utworzony przez tę aplikację.")}</p>
      <div class="tool-actions"><Button variant="outline" disabled={busy || loading || transferring || !modelPath.trim() || modelPath === models.configured} onclick={() => action(async signal => { models = await modelManagement.storage(modelPath, signal); modelPath = models.configured }, 'Zapisano katalog modeli. Zastosuj go restartem silnika.')}>{tr("Zapisz katalog modeli")}</Button><Button variant="ghost" disabled={busy || loading || transferring || models.configured === storageState?.model_default} onclick={() => action(async signal => { models = await storageSettings.resetModels(signal); modelPath = models.configured }, tr("Wybrano prywatny domyślny katalog modeli. Zastosuj go restartem silnika."))}><RotateCcw size={14}/>{tr("Przywróć domyślny")}</Button></div>
      {#if models.restart_required}<p class="tool-notice" role="status">{tr("Zmiana katalogu modeli wymaga restartu silnika.")}</p>{/if}
    {:else}<p>{tr("Brak odczytu katalogu modeli.")}</p>{/if}
  </section>

  {#if needsRestart && onrestart}<div class="tool-actions"><Button disabled={!ready || busy || loading || transferring} onclick={restart}><RefreshCw size={15}/>{tr("Zastosuj zmiany i uruchom silnik ponownie")}</Button></div>{/if}

  <section class="tool-card storage-card" aria-labelledby="storage-disk-title">
    <h3 id="storage-disk-title"><HardDrive size={18}/> {tr("Wykorzystanie dysku")}</h3>
    {#if report}
      {#each report.volumes as volume (volume.path)}<div class="storage-volume"><strong>{tr("Dysk")} {volume.path}</strong><span>{byteLabel(volume.free_bytes)} {tr("wolne z")} {byteLabel(volume.total_bytes)}</span>{#if volume.low_space}<span class="tool-error">{tr("Mało miejsca na dysku — mniej niż 5 GB.")}</span>{/if}</div>{/each}
      <dl class="storage-usage">{#each report.categories as category (category.id)}<div><dt>{tr(String(category.label))}<code>{category.path}</code></dt><dd>{category.complete ? '' : 'co najmniej '}{byteLabel(category.bytes)}</dd></div>{#each category.errors as detail}<p class="page-footnote">{tr(String(detail))}</p>{/each}{/each}</dl>
      <p class="page-footnote">{tr("Pomiar:")} {new Date(report.generated_at * 1000).toLocaleString(tr.locale)}{report.cached ? " " + tr("· wynik z pamięci podręcznej") : ''}{tr(". Rozmiary logiczne plików; biblioteki i modele mogą współdzielić fizyczne dane przez hardlinki. Nie sumuj tych wartości jako zajętego miejsca.")}</p>
    {:else}<p>{loading ? tr("Mierzenie prywatnych katalogów…") : tr("Odśwież, aby sprawdzić zajęte miejsce.")}</p>{/if}
  </section>

  <section class="tool-card storage-card" aria-labelledby="storage-backup-title">
    <h3 id="storage-backup-title"><ShieldCheck size={18}/> {tr("Kopie bezpieczeństwa bazy")}</h3>
    <p>{tr("Przed aktualizacją silnik tworzy automatyczną kopię. Możesz też zapisać spójny obraz bieżącej bazy SQLite. Ręczna kopia bazy nie zawiera plików nagrań.")}</p>
    <Button variant="outline" disabled={!ready || busy || loading || transferring} onclick={() => action(async signal => { backups = (await storageSettings.backup(signal)).backups }, tr("Utworzono i sprawdzono kopię bazy SQLite."))}>{tr("Utwórz kopię bazy teraz")}</Button>
    {#if backups.length}<ul class="storage-backups">{#each backups as backup (backup.path)}<li><strong>{backup.kind} · {new Date(backup.created_at * 1000).toLocaleString(tr.locale)} · {byteLabel(backup.bytes)}</strong><code>{backup.path}</code></li>{/each}</ul>{:else}<p class="page-footnote">{tr("Nie odczytano zapisanych kopii. Pierwsza automatyczna kopia powstanie przed kolejną aktualizacją bazy.")}</p>{/if}
  </section>

  <section class="tool-card storage-card" aria-labelledby="storage-history-title">
    <h3 id="storage-history-title"><History size={18}/> {tr("Historia generowania")}</h3>
    <p>{tr("Po kolejnych generacjach najstarsze nagrania ponad limit będą usuwane razem z plikami audio. Ulubione są zawsze zachowywane. Wpisz 0, aby zachować wszystko.")}</p>
    <label for="storage-history-cap">{tr("Liczba zachowywanych nagrań")}</label>
    <div class="storage-retention"><Input id="storage-history-cap" type="number" min="0" max="100000" step="1" bind:value={cap} disabled={!ready || busy || loading}/><Button variant="outline" disabled={!ready || busy || loading || !validRetentionCap(cap) || cap === savedCap} onclick={saveRetention}>{tr("Zapisz limit historii")}</Button></div>
  </section>
</section>

<style>
  .storage-settings { display: flex; flex-direction: column; gap: 20px; }
  .storage-card { display: flex; flex-direction: column; gap: 12px; }
  .storage-card h3 { display: flex; align-items: center; gap: 9px; margin: 0; font-size: 15px; }
  .storage-card p { margin: 0; line-height: 1.6; }
  .storage-card label { font-size: 13px; font-weight: 500; }
  .storage-path { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; }
  .storage-card code { overflow-wrap: anywhere; font-size: 12px; }
  .storage-card :global(.vs-button) { align-self: flex-start; }
  .storage-retention { display: flex; align-items: center; gap: 12px; }
  .storage-retention :global(input) { max-width: 160px; }
  .storage-volume { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; font-size: 13px; }
  .storage-usage { margin: 0; display: flex; flex-direction: column; gap: 12px; }
  .storage-usage > div { display: flex; justify-content: space-between; gap: 15px; }
  .storage-usage dt { display: flex; flex-direction: column; gap: 5px; font-size: 13px; min-width: 0; }
  .storage-usage dd { white-space: nowrap; margin: 0; font-size: 13px; }
  .storage-backups { padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; list-style: none; }
  .storage-backups li { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
  @media (max-width: 700px) { .storage-path { grid-template-columns: minmax(0, 1fr); } .storage-retention { flex-wrap: wrap; } }
</style>
