<script lang="ts">
  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import Button from '../ui/Button.svelte';
  import { onDestroy, tick, untrack } from 'svelte';
  import { RefreshCw, Check, Cpu, Download, Trash2, X, Folder, KeyRound } from '@lucide/svelte';
  import { engineCatalog, modelsCatalog, selectEngine, type EngineCatalog } from '../tools/studio-tools';
  import { canSelectEngine, engineReadinessLabel, engineSelectionLabel, needsEngineVerification } from './engine-readiness';
  import { activeDownload, byteLabel, downloadLabels, downloadPercent, engineLicenses, modelFamily, modelManagement, type ManagedModel, type ModelDownload, type ModelStorage } from './model-management';
  import Input from '../ui/Input.svelte';
  import ExtraTtsEnvironments from './ExtraTtsEnvironments.svelte';
  import ModelLicenseReview from './ModelLicenseReview.svelte';
  import AISettings from '../tts/AISettings.svelte';
  import { requiredLicenseRepos, validModelRepo } from './model-licenses';
  import { openLicenseSource } from './license-sources';
  import '../tools/studio-tools.css';
  let { ready, onchange, onrestart, requestedLicenseRepo, requestedLicenseRepos = [] }: { ready: boolean; onchange: () => Promise<void>; onrestart?: () => Promise<void>; requestedLicenseRepo?: string; requestedLicenseRepos?: string[] } = $props();
  let catalog = $state<EngineCatalog>(), models = $state<ManagedModel[]>([]), error = $state(''), message = $state(''), busy = $state(false), family = $state<'tts' | 'asr' | 'llm' | 'other'>('tts');
  let freeSpace = $state<number>(), storage = $state<ModelStorage>(), path = $state(''), pathEdited = $state(false);
  let jobs = $state<ModelDownload[]>([]), loading = $state(false), deleteId = $state(''), confirmation = $state('');
  let licenseId = $state(''), licenseAgreed = $state(false), token = $state(''), tokenPresent = $state(false);
  let modelLicenseRepo = $state('');
  let licenseReviewHost = $state<HTMLDivElement>();
  let refreshController: AbortController | undefined, actionController: AbortController | undefined;
  let refreshPending: Promise<void> | undefined;
  let disposed = false;
  const names = { tts: 'Synteza mowy', asr: 'Rozpoznawanie mowy', llm: 'Modele językowe', other: 'Pozostałe wagi' };
  const transferring = $derived(jobs.some(activeDownload));
  const visibleModels = $derived(models.filter(model => modelFamily(model.role) === family));
  const selectedLicense = $derived(engineLicenses[licenseId]);
  const requiredRepos = $derived(requiredLicenseRepos(requestedLicenseRepos.map(repo_id => ({repo_id}))));
  const jobFor = (repo: string) => jobs.find(job => job.repo_id === repo && (!job.cache_dir || job.cache_dir === storage?.effective));
  async function openModelLicense(repo: string) {
    if (!validModelRepo(repo)) { error = 'Nieprawidłowy identyfikator repozytorium modelu.'; return; }
    modelLicenseRepo = repo; licenseId = ''; licenseAgreed = false;
    await tick(); if (!disposed) { licenseReviewHost?.scrollIntoView({ block: 'start', behavior: 'smooth' }); licenseReviewHost?.focus({ preventScroll: true }); }
  }
  async function openSource(url: string) { try { await openLicenseSource(url); } catch (cause) { fail(cause); } }
  $effect(() => { if (requestedLicenseRepo) { const repo = requestedLicenseRepo; untrack(() => { void openModelLicense(repo); }); } else if (!requestedLicenseRepos.length) modelLicenseRepo = ''; });
  function applyStorage(value: ModelStorage) { storage = value; if (!pathEdited) path = value.configured; }
  function refresh(parentSignal?: AbortSignal): Promise<void> {
    if (refreshPending && !refreshController?.signal.aborted) return refreshPending;
    const controller = new AbortController();
    refreshController = controller;
    const signal = parentSignal ? AbortSignal.any([controller.signal, parentSignal]) : controller.signal;
    loading = true;
    refreshPending = (async () => {
      try {
        const [engines, weights, status, auth] = await Promise.all([engineCatalog(signal), modelsCatalog(signal), modelManagement.status(signal), modelManagement.tokenState(signal)]);
        signal.throwIfAborted();
        if (disposed || refreshController !== controller) return;
        catalog = engines; models = weights.models; freeSpace = weights.disk_free_gb; jobs = status.jobs;
        applyStorage(status.storage); tokenPresent = !!auth.sources.find(source => source.source === 'app')?.set;
      } finally {
        if (refreshController === controller) { refreshPending = undefined; loading = false; }
      }
    })();
    return refreshPending;
  }
  function fail(cause: unknown) { if (!disposed && !(cause instanceof Error && cause.name === 'AbortError')) error = cause instanceof Error && cause.name === 'TimeoutError' ? 'Silnik nie odpowiedział na czas. Odśwież katalog, aby spróbować ponownie.' : cause instanceof Error ? cause.message : String(cause); }
  $effect(() => {
    if (!ready) return;
    const controller = new AbortController();
    let polling = false;
    void refresh(controller.signal).catch(cause => { if (!controller.signal.aborted) fail(cause); });
    const poll = setInterval(() => {
      if (polling || disposed || controller.signal.aborted || document.hidden || busy || loading) return;
      polling = true;
      void modelManagement.status(controller.signal).then(async status => {
        if (controller.signal.aborted) return;
        const changed = jobs.some(job => activeDownload(job) && !activeDownload(status.jobs.find(next => next.repo_id === job.repo_id)));
        jobs = status.jobs; applyStorage(status.storage);
        if (changed) await refresh(controller.signal);
      }).catch(cause => { if (!controller.signal.aborted) fail(cause); }).finally(() => polling = false);
    }, 1500);
    return () => { clearInterval(poll); controller.abort(); refreshController?.abort(); actionController?.abort(); busy = false; loading = false; };
  });
  onDestroy(() => { disposed = true; refreshController?.abort(); actionController?.abort(); });
  async function action(operation: (signal: AbortSignal) => Promise<unknown>, success: string) {
    if (busy || !ready || disposed) return;
    busy = true; error = ''; message = ''; refreshController?.abort();
    const controller = new AbortController(); actionController = controller;
    try {
      await operation(controller.signal); controller.signal.throwIfAborted();
      await refresh(controller.signal); controller.signal.throwIfAborted();
      message = success;
    } catch (cause) { if (!controller.signal.aborted) fail(cause); }
    finally { if (actionController === controller) { actionController = undefined; busy = false; } }
  }
  async function select(id: string) {
    if (family === 'other') return;
    const selectedFamily = family;
    await action(async signal => {
      const result = await selectEngine(selectedFamily, id, signal);
      signal.throwIfAborted();
      await refresh(signal); signal.throwIfAborted();
      if (!result.env_override && catalog?.[selectedFamily].active !== id) throw new Error('Silnik nie potwierdził wybranego modelu. Odśwież katalog i spróbuj ponownie.');
      await onchange(); signal.throwIfAborted();
    }, 'Sprawdzono konfigurację i wybrano silnik. Nie wykonano próbnej generacji.');
  }
  async function savePath() {
    await action(async signal => { const result = await modelManagement.storage(path, signal); pathEdited = false; applyStorage(result); }, 'Zapisano katalog. Uruchom ponownie silnik, aby zastosować zmianę. Istniejące modele pozostają w dotychczasowym miejscu.');
  }
  async function removeModel(repo: string) {
    await action(async signal => { await modelManagement.remove(repo, confirmation, signal); deleteId = ''; confirmation = ''; await onchange(); }, 'Usunięto wskazany model z prywatnego katalogu tej aplikacji.');
  }
</script>

<section class="studio-tools engine-catalog" aria-label={tr("Katalog silników i modeli")}>
  <div class="page-heading"><h2>{tr("Silniki i modele")}</h2><Button variant="outline" disabled={!ready || busy || loading} onclick={() => { error = ''; void refresh().catch(fail); }}><RefreshCw size={15}/>{loading ? tr('Wczytywanie katalogu…') : tr("Odśwież katalog")}</Button></div>
  {#if error}<p class="tool-error" role="alert">{tr(String(error))}</p>{/if}{#if message}<p class="tool-notice" role="status">{tr(String(message))}</p>{/if}
  {#if !ready}<p>{tr("Uruchom silnik, aby sprawdzić dostępne modele i ich możliwości.")}</p>{/if}
  {#if requiredRepos.length}<section class="tool-card model-required-licenses" aria-label={tr("Modele wskazane przez ostatnie żądanie")}><h2>{tr("Warunki modeli wskazanych przez ostatnie żądanie")}</h2><p>{tr("Każdy model i składnik ma osobny przegląd oraz decyzję. Wybór przycisku wyłącznie odczytuje informacje; nie zapisuje zgody.")}</p><div class="tool-actions">{#each requiredRepos as repo}<Button variant="outline" data-selection aria-pressed={modelLicenseRepo === repo} disabled={!ready || busy} onclick={() => openModelLicense(repo)}>{#if modelLicenseRepo === repo}<Check aria-hidden="true"/>{/if}<span>{repo}</span></Button>{/each}</div></section>{/if}
  {#if modelLicenseRepo}<div class="model-license-review-host" bind:this={licenseReviewHost} tabindex="-1"><ModelLicenseReview {ready} repoId={modelLicenseRepo} onclose={() => modelLicenseRepo = ''} onchanged={async () => { await refresh(); await onchange(); }}/></div>{/if}
  {#if storage}
    <div class="tool-card model-storage">
      <h2><Folder size={17}/> {tr("Katalog pobierania modeli")}</h2>
      <label for="model-cache-path">{tr("Pełna ścieżka do osobnego katalogu modeli")}</label>
      <Input id="model-cache-path" bind:value={path} oninput={() => pathEdited = true} disabled={busy || transferring} spellcheck={false}/>
      <p class="page-footnote">{tr("Bieżący katalog:")} <code>{storage.effective}</code>{tr(". Zmiana dotyczy kolejnych pobrań i odczytu po restarcie silnika. Istniejące pliki nie są przenoszone. Wybierz pusty katalog lub prywatny cache tej aplikacji.")}</p>
      <div class="tool-actions"><Button variant="outline" disabled={!ready || busy || transferring || !path.trim() || path === storage.configured} onclick={savePath}>{tr("Zapisz katalog")}</Button>{#if storage.restart_required}<span role="status">{tr("Zapisano nową ścieżkę. Wymagany restart silnika.")}</span>{#if onrestart}<Button variant="default" disabled={busy || transferring} onclick={() => action(async () => { await onrestart?.(); }, tr("Uruchomiono ponownie silnik z nowym katalogiem modeli."))}>{tr("Zastosuj i uruchom ponownie")}</Button>{/if}{/if}</div>
      <p class="page-footnote">{tr("Synteza korzysta z lokalnych wag w trybie offline. Połączenie z Hugging Face jest uruchamiane wyłącznie po wybraniu pobierania.")}</p>
    </div>
  {/if}
  <div class="filter-tabs">{#each Object.entries(names) as [key, label]}<button class:chosen={family === key} onclick={() => family = key as typeof family}>{tr(String(label))}</button>{/each}</div>
  {#if family === 'llm'}<AISettings embedded/><h3>{tr("Lokalne modele językowe silnika")}</h3><p class="page-footnote">{tr("Poniższe silniki obsługują lokalne funkcje językowe Seventy Seven Labs. Automatyczne tagowanie edytora korzysta z ustawień OpenAi zapisanych powyżej.")}</p>{/if}
  {#if catalog && family !== 'other'}<div class="tool-list">{#each catalog[family].backends as engine}<article><Cpu size={20}/><div class="tool-row-main"><strong>{engine.display_name || engine.name || engine.id}</strong><span>{engineReadinessLabel(engine)}{#if engine.supports_cloning} {tr("· Klonowanie głosu")}{/if}</span>{#if engine.reason || engine.unavailable_reason}<small>{engine.reason || engine.unavailable_reason}</small>{/if}{#if engine.license_required}<small>{engine.license_accepted ? tr('Licencja zaakceptowana') : tr("Przed użyciem wymaga akceptacji licencji")}</small>{#if engineLicenses[engine.id]}<Button variant="ghost" class=" model-license-trigger" onclick={() => { licenseId = engine.id; licenseAgreed = false; }}>{tr("Przeczytaj warunki")}{engine.license_accepted ? " " + tr("/ cofnij akceptację") : ''}</Button>{/if}{/if}</div>{#if catalog[family].active === engine.id}<span class="subtle-badge"><Check size={13}/> {tr("Aktywny")}</span>{/if}{#if catalog[family].active !== engine.id || needsEngineVerification(engine)}<Button variant="outline" disabled={!ready || busy || !canSelectEngine(engine) || Boolean(catalog[family].env_override) || Boolean(engine.license_required && !engine.license_accepted)} onclick={() => select(engine.id)}>{engineSelectionLabel(engine)}</Button>{/if}</article>{/each}</div>{/if}
  {#if selectedLicense}
    <section class="tool-card" aria-label={tr('Licencja {name}', { name: selectedLicense.name })}>
      <h2>{tr("Warunki używania")} {selectedLicense.name}</h2><p>{tr(String(selectedLicense.summary))}</p>
      {#each selectedLicense.links as link}<a href={link.url} target="_blank" rel="noreferrer" onclick={event => { event.preventDefault(); void openSource(link.url); }}>{link.title}</a>{/each}
      <label class="tool-checkbox"><input type="checkbox" bind:checked={licenseAgreed}/> {tr("Zapoznałem się z powyższymi licencjami i akceptuję ich warunki.")}</label>
      <div class="tool-actions"><Button variant="default" disabled={!licenseAgreed || busy} onclick={() => action(async signal => { await modelManagement.license(licenseId, true, signal); licenseId = ''; await onchange(); }, tr("Zapisano akceptację licencji."))}>{tr("Akceptuję warunki")}</Button><Button variant="outline" disabled={busy} onclick={() => action(async signal => { await modelManagement.license(licenseId, false, signal); licenseId = ''; await onchange(); }, tr("Cofnięto akceptację licencji."))}>{tr("Cofnij akceptację")}</Button><Button variant="ghost" onclick={() => licenseId = ''}>{tr("Zamknij")}</Button></div>
    </section>
  {/if}
  {#if ready&&family==='tts'}<ExtraTtsEnvironments onchange={async()=>{await refresh();await onchange();}}/>{/if}
  <h2 style="margin-top:28px">{tr("Wagi modeli")}</h2>{#if freeSpace !== undefined}<p class="page-footnote">{tr("Wolne miejsce w katalogu modeli:")} {freeSpace} {tr("GB")}</p>{/if}
  <div class="tool-list">{#each visibleModels as model}
    {@const job = jobFor(model.repo_id)}
    <article>
      <div class="tool-row-main"><strong>{model.label || model.repo_id}</strong><small>{model.repo_id}</small><span>{model.installed ? tr('Pobrany') : model.incomplete ? tr('Pobieranie niekompletne') : tr('Niepobrany')}{!model.supported ? ` · ${tr('Niezgodny z tym komputerem')}` : ''}{model.size_gb ? " " + tr("· około {arg0} GB", { arg0: String(model.size_gb) }) : ''}{model.curated ? ` · ${tr('Polecany dla tego komputera')}` : ''}</span>
        {#if model.size_on_disk_bytes}<small>{tr("Na dysku:")} {byteLabel(model.size_on_disk_bytes)}</small>{/if}
        <a class="model-source" href={`https://huggingface.co/${model.repo_id}`} target="_blank" rel="noreferrer" onclick={event => { event.preventDefault(); void openSource(`https://huggingface.co/${model.repo_id}`); }}>{tr("Opis, licencja i warunki dostępu")}</a>
        <Button variant="ghost" class=" model-license-trigger" disabled={!ready || busy} onclick={() => openModelLicense(model.repo_id)}>{tr("Warunki modelu · przegląd i lokalne potwierdzenie")}</Button>
        {#if model.dependencies?.length}<div class="model-dependencies"><small>{tr("Osobne warunki składników:")}</small>{#each model.dependencies as dependency}<Button variant="ghost" class=" model-license-trigger" disabled={!ready || busy} onclick={() => openModelLicense(dependency.repo_id)}>{dependency.repo_id}</Button>{/each}</div>{/if}
        {#if model.note}<details><summary>{tr("Informacje o modelu")}</summary><small>{model.note}</small></details>{/if}
        {#if job}
          <div class="model-download" aria-live="polite"><span>{tr(String(downloadLabels[job.state]))}</span>{#if activeDownload(job)}
            {#if downloadPercent(job) !== undefined}<progress max="100" value={downloadPercent(job)} aria-label={tr("Postęp pobierania {arg0}", { arg0: String(model.repo_id) })}></progress>{:else}<progress aria-label={tr("Postęp pobierania {arg0}", { arg0: String(model.repo_id) })}></progress>{/if}
            <small>{byteLabel(job.downloaded_bytes)}{job.total_bytes ? ` / ${byteLabel(job.total_bytes)}` : ` · ${tr('ustalanie rozmiaru')}`}{#if job.filename} · {job.filename}{/if}</small>
          {/if}{#if job.error}<small class="model-job-error">{tr(String(job.error))}</small>{/if}</div>
        {/if}
      </div>
      {#if activeDownload(job)}<Button variant="outline" disabled={busy || job?.state === 'cancelling'} onclick={() => action(signal => modelManagement.cancel(model.repo_id, signal), tr("Anulowanie pobierania zostało zlecone. Niekompletne pliki pozwolą wznowić instalację."))}><X size={14}/>{tr("Anuluj")}</Button>
      {:else}<Button variant="outline" disabled={!ready || busy || transferring || !model.supported || model.installed || storage?.restart_required} onclick={() => action(signal => modelManagement.install(model.repo_id, signal), tr("Rozpoczęto pobieranie. Postęp jest zachowywany także po zamknięciu tego widoku."))}><Download size={14}/>{model.incomplete || job?.state === 'interrupted' || job?.state === 'cancelled' || job?.state === 'failed' ? tr("Wznów pobieranie") : tr("Pobierz wagi")}</Button>{#if model.installed || model.incomplete}<Button variant="ghost" disabled={busy || transferring} onclick={() => { deleteId = model.repo_id; confirmation = ''; }} aria-label={tr("Usuń model {arg0}", { arg0: String(model.repo_id) })}><Trash2 size={15}/></Button>{/if}{/if}
      {#if deleteId === model.repo_id}<div class="tool-confirm model-delete"><p>{tr("Usuniesz wszystkie lokalne rewizje")} <strong>{model.repo_id}</strong> {tr("z")} <code>{storage?.effective}</code>{tr(". Głosy i nagrania pozostaną zachowane. Ponowne użycie wymaga pobrania wag.")}</p><label for="model-delete-confirm">{tr("Wpisz identyfikator modelu, aby potwierdzić")}</label><Input id="model-delete-confirm" bind:value={confirmation} autocomplete="off" spellcheck={false}/><Button variant="outline" disabled={busy || confirmation !== model.repo_id} onclick={() => removeModel(model.repo_id)}>{tr("Usuń wskazany model")}</Button><Button variant="ghost" disabled={busy} onclick={() => { deleteId = ''; confirmation = ''; }}>{tr("Zachowaj model")}</Button></div>{/if}
    </article>
  {/each}</div>
  {#if !loading && !visibleModels.length}<p class="page-footnote">{tr("W tym katalogu nie ma wag dla wybranej kategorii. Dostępność silników zewnętrznych jest pokazywana powyżej.")}</p>{/if}
  <details class="tool-card model-token"><summary><KeyRound size={15}/> {tr("Dostęp do modeli chronionych — Hugging Face")}</summary><p class="page-footnote">{tr("Niektóre repozytoria wymagają zgody na stronie modelu i tokenu z prawem odczytu. Token zapisuje się w prywatnym magazynie aplikacji. Nie jest wyświetlany ani importowany z innych instalacji.")}</p><span>{tokenPresent ? tr('Token aplikacji zapisany') : tr("Brak tokenu aplikacji — dostępne pobieranie publicznych modeli")}</span><label for="model-hf-token">{tr("Token Hugging Face")}</label><Input id="model-hf-token" type="password" bind:value={token} autocomplete="off" placeholder={tr("hf_…")} disabled={busy}/><div class="tool-actions"><Button variant="outline" disabled={!ready || busy || !token.trim()} onclick={() => action(async signal => { await modelManagement.token(token.trim(), signal); token = ''; }, tr('Zapisano token Hugging Face w prywatnym magazynie aplikacji.'))}>{tr("Zapisz token")}</Button><Button variant="ghost" disabled={!ready || busy || !tokenPresent} onclick={() => action(signal => modelManagement.clearToken(signal), tr("Usunięto token aplikacji."))}>{tr("Usuń token aplikacji")}</Button></div></details>
  <p class="page-footnote">{tr("Pobierane są rzeczywiste wagi z przypiętych rewizji katalogu modeli Seventy Seven Labs. Wagi nie instalują automatycznie dodatkowych bibliotek ani osobnych środowisk silników. Ich brak jest pokazywany przy danym silniku.")}</p>
</section>

<style>
  .model-license-review-host{scroll-margin-top:20px}.model-required-licenses .tool-actions :global([data-slot="button"]){white-space:normal;overflow-wrap:anywhere;max-width:100%}.model-dependencies{display:flex;flex-direction:column;align-items:flex-start;gap:4px;margin-top:5px}.model-dependencies :global([data-slot="button"]){white-space:normal;text-align:left;overflow-wrap:anywhere}
  .model-storage h2,.model-token summary{display:flex;align-items:center;gap:9px}.model-storage label,.model-token label{font-size:var(--ui-text-13)}.model-storage .tool-actions{margin:0}.model-storage code,.model-delete code{overflow-wrap:anywhere}:global(.model-license-trigger){align-self:flex-start;padding-left:0}.model-source{font-size:var(--ui-text-12);color:var(--muted)}.model-download{display:flex;flex-direction:column;gap:7px;margin-top:6px;max-width:550px}.model-download progress{width:100%;height:7px;accent-color:var(--foreground)}.model-download small{overflow-wrap:anywhere}.model-job-error{color:var(--foreground)}.model-delete p{margin:0;flex-basis:100%;font-size:var(--ui-text-13);line-height:1.7}.model-delete label{font-size:var(--ui-text-13)}.model-delete :global(input){flex:1;min-width:200px}.model-token summary{cursor:pointer}.model-token p{margin-top:16px}.model-token>span{font-size:var(--ui-text-13)}.model-token>label{display:block;margin:14px 0 9px}
</style>
