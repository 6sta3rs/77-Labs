<script lang="ts">
  import { uiLanguage, createUiTranslator } from '../../i18n';
  const tr = $derived(createUiTranslator($uiLanguage));

  import { onDestroy, tick, untrack } from 'svelte';
  import { Download, FileCheck, LoaderCircle, Plus, RefreshCw, Trash2, X } from '@lucide/svelte';
  import Button from '../../ui/Button.svelte';
  import ButtonGroup from '../../ui/ButtonGroup.svelte';
  import Input from '../../ui/Input.svelte';
  import ModelIcon from '../../ui/ModelIcon.svelte';
  import ProviderIcon from '../../ui/ProviderIcon.svelte';
  import StatusBadge, { type BadgeKind } from '../../ui/StatusBadge.svelte';
  import Switch from '../../ui/Switch.svelte';
  import Tooltip from '../../ui/Tooltip.svelte';
  import { toast } from '../../ui/toast';
  import { engineCatalog, modelsCatalog, selectEngine, type Engine, type EngineCatalog } from '../../tools/studio-tools';
  import { productionJson } from '../../tools/production/production';
  import { request } from '../../platform/api';
  import { canSelectEngine, engineReadinessLabel, needsEngineVerification } from '../../models/engine-readiness';
  import { activeDownload, byteLabel, downloadPercent, engineLicenses, modelFamily, modelManagement, type ManagedModel, type ModelDownload, type ModelStorage } from '../../models/model-management';
  import { requiredLicenseRepos, validModelRepo } from '../../models/model-licenses';
  import { readOnboardingPlan, type LicenseOnboardingPlan } from '../../models/license-onboarding';
  import { openLicenseSource } from '../../models/license-sources';
  import ModelLicenseReview from '../../models/ModelLicenseReview.svelte';
  import { hfMirrorAddress, putSettings, settingsError, type CredentialState, type HfMirrorState } from '../system-settings';
  import type { LlmProviders } from '../general-settings';
  import type { SettingsSection } from '../settings-catalog';
  import '../../tools/studio-tools.css';

  let { ready, intent = '', requestedLicenseRepo, requestedLicenseRepos = [], onchange, onrestart, onnavigate }: {
    ready: boolean; desktop?: boolean; intent?: string; requestedLicenseRepo?: string; requestedLicenseRepos?: string[]
    onchange: () => Promise<void>; onrestart?: () => Promise<void>; onnavigate: (section: SettingsSection, intent?: string) => void
  } = $props();

  type Family = 'tts' | 'asr' | 'llm' | 'other';
  type Tab = Family | 'access';
  type Row = { key: string; name: string; engine?: Engine; weight?: ManagedModel };
  const tabs: Array<[Family, string]> = [['tts', 'Synteza mowy'], ['asr', 'Rozpoznawanie mowy'], ['llm', 'Modele językowe'], ['other', 'Pozostałe']];
  const famName = Object.fromEntries(tabs) as Record<Family, string>;
  const users: Record<string, string> = { tts: 'Studio, Audiobooki, Dubbing', asr: 'Transkrypcja, Dubbing', llm: 'Tłumaczenia, Tagowanie, Dyktowanie' };
  const sourceText: Record<string, string> = { off: 'Pobieranie bezpośrednio z huggingface.co.', auto: 'Aplikacja wybiera działające źródło i ponawia test.', man: 'Pobieranie z własnego mirroru Hugging Face.' };

  let family = $state<Tab>('tts');
  let catalog = $state<EngineCatalog>(), models = $state<ManagedModel[]>([]), jobs = $state<ModelDownload[]>([]), storage = $state<ModelStorage>(), freeGb = $state<number>();
  let plan = $state.raw<LicenseOnboardingPlan>(), providers = $state<LlmProviders>(), providersFailed = $state(false);
  let loading = $state(false), busy = $state(false), review = $state(false);
  let licenseKey = $state(''), agreed = $state(false), deleteRepo = $state(''), confirmation = $state('');
  let registryRepo = $state(''), registryHost = $state('');
  let tokenState = $state<CredentialState['hf']>(), token = $state(''), tokenArmed = $state(false), armTimer: ReturnType<typeof setTimeout> | undefined;
  let mirror = $state<HfMirrorState>(), source = $state('off'), mirrorUrl = $state(''), mirrorError = $state(''), accessBusy = $state(false), retesting = $state(false);
  let refreshController: AbortController | undefined, actionController: AbortController | undefined, refreshPending: Promise<void> | undefined;
  let disposed = false;

  const transferring = $derived(jobs.some(activeDownload));
  const jobFor = (repo: string) => jobs.find(job => job.repo_id === repo && (!job.cache_dir || job.cache_dir === storage?.effective));
  const numberText = (n: number, digits = 1) => n.toLocaleString(tr.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const engineName = (engine: Engine) => engine.display_name || engine.name || engine.id;

  // One row per engine (its weights attached through `engines`), then weights no engine claims.
  function rowsFor(tab: Family): Row[] {
    const weights = models.filter(model => modelFamily(model.role) === tab);
    const engines = tab !== 'other' && catalog?.[tab] ? catalog[tab].backends : [];
    const claimed = new Set<string>();
    const rows: Row[] = engines.map(engine => {
      const weight = weights.find(model => model.engines?.includes(engine.id));
      if (weight) claimed.add(weight.repo_id);
      return { key: `e:${engine.id}`, name: engineName(engine), engine, weight };
    });
    return [...rows, ...weights.filter(model => !claimed.has(model.repo_id)).map(weight => ({ key: `w:${weight.repo_id}`, name: weight.label || weight.repo_id, weight }))];
  }
  const visible = $derived(family === 'access' ? [] : rowsFor(family));
  const licensedEngines = $derived((['tts', 'asr', 'llm'] as const).flatMap(fam => (catalog?.[fam]?.backends || []).filter(engine => engine.license_required).map(engine => ({ fam, engine }))));
  const registryRepos = $derived([...new Set([...requiredLicenseRepos(requestedLicenseRepos.map(repo_id => ({ repo_id }))), ...(plan?.models.filter(model => model.required).map(model => model.repo_id) || [])])]);
  const cloud = $derived((providers?.providers || []).filter(provider => provider.configured || provider.has_key || provider.id === providers?.active));
  const defaultProvider = $derived(providers?.providers.find(provider => provider.id === providers?.active));

  function sourceOf(state: HfMirrorState) { return state.mode === 'auto' ? 'auto' : state.configured ? 'man' : 'off'; }
  function applyMirror(state: HfMirrorState) { mirror = state; source = sourceOf(state); mirrorUrl = state.configured; }

  function refresh(parentSignal?: AbortSignal): Promise<void> {
    if (refreshPending && !refreshController?.signal.aborted) return refreshPending;
    const controller = new AbortController();
    refreshController = controller;
    const signal = parentSignal ? AbortSignal.any([controller.signal, parentSignal]) : controller.signal;
    loading = true;
    refreshPending = (async () => {
      try {
        const [engines, weights, status] = await Promise.all([engineCatalog(signal), modelsCatalog(signal), modelManagement.status(signal)]);
        signal.throwIfAborted();
        if (disposed || refreshController !== controller) return;
        catalog = engines; models = weights.models; freeGb = weights.disk_free_gb; jobs = status.jobs; storage = status.storage;
        // Secondary reads: their failure must not hide the model catalogue.
        const [nextPlan, credentials, nextMirror, nextProviders] = await Promise.allSettled([
          readOnboardingPlan(request, signal), productionJson<CredentialState>('/next/settings/credentials', { signal }),
          productionJson<HfMirrorState>('/api/settings/hf-mirror', { signal }), productionJson<LlmProviders>('/api/settings/llm-providers', { signal })]);
        if (disposed || refreshController !== controller || signal.aborted) return;
        plan = nextPlan.status === 'fulfilled' ? nextPlan.value : undefined;
        if (credentials.status === 'fulfilled') tokenState = credentials.value.hf;
        if (nextMirror.status === 'fulfilled') applyMirror(nextMirror.value);
        providersFailed = nextProviders.status === 'rejected';
        if (nextProviders.status === 'fulfilled') providers = nextProviders.value;
      } finally {
        if (refreshController === controller) { refreshPending = undefined; loading = false; }
      }
    })();
    return refreshPending;
  }
  function fail(cause: unknown) {
    if (disposed || (cause instanceof Error && cause.name === 'AbortError')) return;
    toast.bad(cause instanceof Error && cause.name === 'TimeoutError' ? tr('Silnik nie odpowiedział na czas. Odśwież katalog, aby spróbować ponownie.') : tr(settingsError(cause)));
  }
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
        const finished = jobs.filter(job => activeDownload(job)).map(job => ({ job, next: status.jobs.find(next => next.repo_id === job.repo_id) })).filter(({ next }) => !activeDownload(next));
        jobs = status.jobs; storage = status.storage;
        for (const { job, next } of finished) {
          const name = models.find(model => model.repo_id === job.repo_id)?.label || job.repo_id;
          if (next?.state === 'complete') toast.ok(tr('Pobrano {name}. Można go wybrać jako aktywny.', { name }));
          else if (next?.state === 'failed') toast.bad(next.error ? tr(next.error) : tr('Pobieranie {name} nie powiodło się.', { name }));
        }
        if (finished.length) await refresh(controller.signal);
      }).catch(cause => { if (!controller.signal.aborted) fail(cause); }).finally(() => polling = false);
    }, 1500);
    return () => { clearInterval(poll); controller.abort(); refreshController?.abort(); actionController?.abort(); busy = false; loading = false; };
  });
  onDestroy(() => { disposed = true; refreshController?.abort(); actionController?.abort(); clearTimeout(armTimer); });

  async function action(operation: (signal: AbortSignal) => Promise<unknown>, success?: () => string) {
    if (busy || !ready || disposed) return;
    busy = true; refreshController?.abort();
    const controller = new AbortController(); actionController = controller;
    try {
      await operation(controller.signal); controller.signal.throwIfAborted();
      await refresh(controller.signal); controller.signal.throwIfAborted();
      if (success) toast.ok(success());
    } catch (cause) { if (!controller.signal.aborted) fail(cause); }
    finally { if (actionController === controller) { actionController = undefined; busy = false; } }
  }
  async function select(tab: 'tts' | 'asr' | 'llm', engine: Engine) {
    const previous = catalog?.[tab].backends.find(item => item.id === catalog?.[tab].active);
    await action(async signal => {
      const result = await selectEngine(tab, engine.id, signal);
      signal.throwIfAborted();
      await refresh(signal); signal.throwIfAborted();
      if (!result.env_override && catalog?.[tab].active !== engine.id) throw new Error(tr('Silnik nie potwierdził wybranego modelu. Odśwież katalog i spróbuj ponownie.'));
      await onchange(); signal.throwIfAborted();
    }, () => tr('Aktywny model ({family}): {from} → {to}. Dotyczy: {users}.', { family: tr(famName[tab]).toLowerCase(), from: previous ? engineName(previous) : '—', to: engineName(engine), users: tr(users[tab]) }));
  }
  function toggleLicense(row: Row) { deleteRepo = ''; agreed = false; registryRepo = ''; licenseKey = licenseKey === row.key ? '' : row.key; }
  function openDelete(repo: string) { deleteRepo = repo; licenseKey = ''; confirmation = ''; }
  async function openSource(url: string) { try { await openLicenseSource(url); } catch (cause) { fail(cause); } }
  async function reviewOpen(tab: Family, key: string) {
    family = tab; licenseKey = key; agreed = false; deleteRepo = ''; registryRepo = '';
    await tick();
    document.querySelector(`[data-model-row="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  async function openRegistry(repo: string, host: string) {
    if (!validModelRepo(repo)) { toast.bad(tr('Nieprawidłowy identyfikator repozytorium modelu.')); return; }
    registryRepo = registryRepo === repo && registryHost === host ? '' : repo; registryHost = host;
    await tick();
    if (registryRepo) document.querySelector(`[data-registry-host="${CSS.escape(host)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  // A licence request from a blocked generation (App) opens the review card on that model.
  $effect(() => { const repo = requestedLicenseRepo; if (repo) untrack(() => { review = true; void openRegistry(repo, 'review'); }); });
  $effect(() => { const value = intent; untrack(() => { if (tabs.some(([key]) => key === value) || value === 'access') family = value as Tab; else if (value === 'review') review = true; }); });

  // Download access: one HF token endpoint (/next/settings/hf-token, private app store only).
  async function access(operation: (signal: AbortSignal) => Promise<unknown>) {
    if (accessBusy || !ready || disposed) return;
    accessBusy = true;
    const controller = new AbortController();
    try { await operation(controller.signal); } catch (cause) { fail(cause); } finally { accessBusy = false; }
  }
  function saveToken() {
    const value = token.trim();
    void access(async signal => { tokenState = await putSettings<CredentialState['hf']>('/next/settings/hf-token', { token: value }, signal); token = ''; toast.ok(tr('Token zapisany w prywatnym magazynie')); });
  }
  function testToken() {
    void access(async signal => { const next = await productionJson<CredentialState['hf']>('/next/settings/hf-token/test', { method: 'POST', signal }); tokenState = next; toast.ok(next.user ? tr('Hugging Face potwierdziło token konta {user}.', { user: next.user }) : tr('Hugging Face potwierdziło token.')); });
  }
  // Two-step inline confirmation: the first click arms the button for 4 s.
  function dropToken() {
    if (!tokenArmed) { tokenArmed = true; armTimer = setTimeout(() => tokenArmed = false, 4000); return; }
    clearTimeout(armTimer); tokenArmed = false;
    void access(async signal => { tokenState = await productionJson<CredentialState['hf']>('/next/settings/hf-token', { method: 'DELETE', signal }); toast.ok(tr('Token usunięty')); });
  }
  function saveSource(next: string) {
    mirrorError = '';
    if (next === 'man') return; // the manual address is saved with its own button
    void access(async signal => {
      applyMirror(await putSettings<HfMirrorState>('/api/settings/hf-mirror', { url: '', mode: next === 'auto' ? 'auto' : 'manual' }, signal));
      toast.ok(next === 'auto' && mirror?.auto_opt_out ? tr('Zapisano preferencję, ale konfiguracja uruchomienia blokuje automatyczny wybór.') : tr('Zapisano źródło pobierania.'));
    });
  }
  function saveMirror() {
    let url: string;
    try { url = hfMirrorAddress(mirrorUrl); mirrorError = ''; } catch (cause) { mirrorError = cause instanceof Error ? cause.message : String(cause); return; }
    void access(async signal => { applyMirror(await putSettings<HfMirrorState>('/api/settings/hf-mirror', { url, mode: 'manual' }, signal)); toast.ok(tr('Zapisano adres mirroru. Zapis nie sprawdza dostępności serwera.')); });
  }
  async function retest() {
    retesting = true;
    await access(async signal => {
      applyMirror(await productionJson<HfMirrorState>('/api/settings/hf-mirror/test', { method: 'POST', signal }));
      const auto = mirror?.auto;
      if (auto?.reachable) toast.ok(auto.latency_ms != null ? tr('Serwer odpowiada · {ms} ms', { ms: String(auto.latency_ms) }) : tr('Serwer odpowiada'));
      else toast.bad(tr('Żadne z badanych źródeł nie odpowiedziało.'));
    });
    retesting = false;
  }
  function badges(row: Row, job: ModelDownload | undefined, isActive: boolean, incomplete: boolean): Array<[BadgeKind, string]> {
    const weight = row.weight, list: Array<[BadgeKind, string]> = [];
    if (activeDownload(job)) list.push(['wait', tr('Pobieranie')]);
    else if (incomplete) { const pct = job ? downloadPercent(job) : undefined; list.push(['warn', pct !== undefined ? tr('Przerwane ({pct}%)', { pct: String(pct) }) : tr('Przerwane')]); }
    else if (weight && !weight.installed) list.push(['neutral', tr('Niepobrany')]);
    if (isActive) list.push(['ok', tr('Aktywny')]);
    else if (weight?.installed) list.push(['neutral', tr('Pobrany')]);
    return list;
  }
  function detail(row: Row) {
    const { engine, weight } = row;
    const size = weight?.installed && weight.size_on_disk_bytes ? byteLabel(weight.size_on_disk_bytes) : weight?.size_gb ? (weight.installed ? `${numberText(weight.size_gb)} GB` : tr('około {size} GB', { size: numberText(weight.size_gb) })) : '';
    return [size, engine?.supports_cloning ? tr('Klonowanie głosu') : '', engine && engine.available !== true ? tr(engineReadinessLabel(engine)) : '', engine?.reason || engine?.unavailable_reason || ''].filter(Boolean).join(' · ');
  }
  function progressText(job: ModelDownload) {
    const pct = downloadPercent(job);
    return [pct !== undefined ? `${pct}%` : '', `${byteLabel(job.downloaded_bytes)}${job.total_bytes ? ` / ${byteLabel(job.total_bytes)}` : ` · ${tr('ustalanie rozmiaru')}`}`].filter(Boolean).join(' · ');
  }
</script>

{#snippet restartButton()}
  {#if onrestart}<Button variant="outline" disabled={busy || accessBusy || transferring} onclick={() => action(async () => { await onrestart?.(); }, () => tr('Uruchomiono ponownie silnik.'))}>{tr('Uruchom ponownie')}</Button>{/if}
{/snippet}

<div class="p-page models-page">
  <div class="page-heading">
    <div><h1>{tr('Modele')}</h1><p>{tr('Wybierz aktywny model dla każdej funkcji i zarządzaj pobranymi wagami.')}</p></div>
    <div class="eng"><div class="engrow">{#if ready}<StatusBadge kind="ok" text={tr('Silnik gotowy')}/>{:else}<StatusBadge kind="neutral" text={tr('Silnik nie działa')}/>{/if}<Button variant="ghost" onclick={() => onnavigate('engine')}>{tr('Zarządzaj')}</Button></div></div>
  </div>

  {#if !ready}
    <p class="p-notice warn">{tr('Silnik nie działa, więc katalog modeli, pobieranie i warunki są niedostępne. Uruchom go na stronie „Silnik”.')}</p>
  {:else}
  <div class="p-actions">
    <Button variant="outline" aria-expanded={review} onclick={() => review = !review}><FileCheck size={15}/>{tr('Przejrzyj warunki modeli')}</Button>
    <Button variant="outline" disabled={busy || loading} onclick={() => void refresh().then(() => toast.ok(tr('Katalog modeli odświeżony'))).catch(fail)}>{#if loading}<LoaderCircle size={15} class="spin"/>{tr('Wczytywanie…')}{:else}<RefreshCw size={15}/>{tr('Odśwież katalog')}{/if}</Button>
    {#if freeGb !== undefined}<span class="free">{tr('Wolne miejsce:')} <b>{numberText(freeGb)} GB</b></span>{/if}
  </div>

  {#if review}
    <section class="p-card" aria-label={tr('Warunki modeli')}>
      <div class="p-section">
        <header class="split"><div><h3>{tr('Warunki modeli')}</h3><p>{licensedEngines.length || registryRepos.length ? tr('Każdy model ma osobną decyzję. Otwarcie przeglądu niczego nie akceptuje.') : tr('Żaden model w katalogu nie wymaga teraz akceptacji warunków.')}</p></div>
          <Button variant="light" aria-label={tr('Zamknij przegląd warunków')} onclick={() => { review = false; if (registryHost === 'review') registryRepo = ''; }}>{tr('Zamknij')}</Button></header>
        {#if licensedEngines.length || registryRepos.length}
        <div class="p-rows">
          {#each licensedEngines as { fam, engine } (engine.id)}
            <div class="p-row"><div class="t"><b>{engineName(engine)}</b><span>{engineLicenses[engine.id]?.name || tr('Licencja modelu')} · {tr(famName[fam])}</span></div>
              <div class="ctl">{#if engine.license_accepted}<StatusBadge kind="ok" text={tr('Zaakceptowano')}/>{:else}<StatusBadge kind="warn" text={tr('Nie zaakceptowano')}/>{/if}
                <Button variant="outline" onclick={() => reviewOpen(fam, `e:${engine.id}`)}>{tr('Przeczytaj')}</Button></div></div>
          {/each}
          {#each registryRepos as repo (repo)}
            {@const state = plan?.models.find(model => model.repo_id === repo)}
            <div class="p-row"><div class="t"><b>{repo}</b><span>{state?.license || tr('Licencja nieustalona')} · {tr('Rejestr warunków')}</span></div>
              <div class="ctl">{#if state?.accepted}<StatusBadge kind="ok" text={tr('Zaakceptowano')}/>{:else if state?.state === 'terms_updated'}<StatusBadge kind="warn" text={tr('Warunki zmienione')}/>{:else}<StatusBadge kind="warn" text={tr('Nie zaakceptowano')}/>{/if}
                <Button variant="outline" aria-expanded={registryRepo === repo && registryHost === 'review'} onclick={() => openRegistry(repo, 'review')}>{tr('Przeczytaj')}</Button></div></div>
          {/each}
        </div>
        {/if}
        {#if registryRepo && registryHost === 'review'}<div class="registry" data-registry-host="review"><ModelLicenseReview {ready} repoId={registryRepo} onclose={() => registryRepo = ''} onchanged={async () => { await refresh(); await onchange(); }}/></div>{/if}
      </div>
    </section>
  {/if}

  <div class="filter-tabs p-tabs" role="tablist" aria-label={tr('Modele')}>
    {#each tabs as [key, label]}<button role="tab" aria-selected={family === key} class:chosen={family === key} onclick={() => family = key}>{tr(label)}</button>{/each}
    <button role="tab" aria-selected={family === 'access'} class:chosen={family === 'access'} onclick={() => family = 'access'}>{tr('Pobieranie i dostęp')}</button>
  </div>

  {#if family !== 'access'}
    {@const tab = family}
    <section class="p-card" role="tabpanel">
      {#if tab === 'llm'}
        <div class="p-section">
          <header class="split"><div><h3>{tr('Dostawcy w chmurze')}</h3><p>{providersFailed ? tr('Nie udało się odczytać dostawców. Konfiguracja jest w „AI i klucze”.') : !cloud.length ? tr('Nie połączono żadnego dostawcy. Połącz dostawcę, aby używać funkcji AI.') : tr('Zewnętrzne modele przez klucz API albo konto. Konfiguracja jest w „AI i klucze”.')}</p></div>
            {#if cloud.length}<Button onclick={() => onnavigate('ai', 'add')}><Plus size={15}/>{tr('Dodaj dostawcę')}</Button>{/if}</header>
          {#if !cloud.length}
            <div class="p-actions"><Button onclick={() => onnavigate('ai', 'add')}><Plus size={15}/>{tr('Dodaj dostawcę')}</Button></div>
          {:else}
          <div class="p-rows">
            {#each cloud as provider (provider.id)}
              <div class="p-row prov">
                <div class="pname"><ProviderIcon id={provider.id} size={22}/><div class="t"><b>{provider.display_name}{#if provider.local}<em>{tr('lokalny')}</em>{/if}</b><span>{provider.model ? tr('Wybrany model: {model}', { model: provider.model }) : tr('Nie wybrano modelu')}</span></div></div>
                <div class="ctl">{#if provider.local}<StatusBadge kind={provider.configured ? 'ok' : 'neutral'} text={provider.configured ? tr('Skonfigurowany') : tr('Nieskonfigurowany')}/>{:else if provider.has_key}<StatusBadge kind="ok" text={tr('Klucz zapisany')}/>{:else}<StatusBadge kind="warn" text={tr('Brak klucza')}/>{/if}
                  {#if provider.id === providers?.active}<StatusBadge kind="neutral" text={tr('Domyślny')}/>{/if}
                  <Button variant="ghost" aria-label={tr('Konfiguruj: {name}', { name: provider.display_name })} onclick={() => onnavigate('ai', provider.id)}>{tr('Konfiguruj')}</Button></div>
              </div>
            {/each}
          </div>
          <div class="p-actions"><Button variant="ghost" onclick={() => onnavigate('ai', 'funkcje')}>{defaultProvider ? tr('Domyślny model: {model} — zmienisz w AI i klucze › Funkcje AI', { model: [defaultProvider.display_name, defaultProvider.model].filter(Boolean).join(' · ') }) : tr('Domyślny model: nie wybrano — wybierz w AI i klucze › Funkcje AI')}</Button></div>
          {/if}
        </div>
        <div class="p-section"><header><h3>{tr('Modele lokalne')}</h3><p>{visible.length ? tr('Pobrane na ten komputer; działają bez internetu.') : tr('Silnik nie udostępnia lokalnych modeli językowych.')}</p></header></div>
      {:else if !visible.length}
        <div class="p-section"><header><p>{loading && !catalog ? tr('Wczytywanie katalogu…') : tr('W katalogu nie ma modeli tej kategorii.')}</p></header></div>
      {/if}
      {#each visible as row (row.key)}
        {@const engine = row.engine}
        {@const weight = row.weight}
        {@const fam = tab !== 'other' ? catalog?.[tab] : undefined}
        {@const job = weight ? jobFor(weight.repo_id) : undefined}
        {@const downloading = activeDownload(job)}
        {@const incomplete = !downloading && !!weight && !weight.installed && (!!weight.incomplete || ['interrupted', 'cancelled', 'failed'].includes(job?.state || ''))}
        {@const isActive = !!engine && fam?.active === engine.id}
        {@const blocked = !!engine?.license_required && !engine.license_accepted}
        {@const supported = weight?.supported !== false && engine?.availability_check !== 'platform_unsupported'}
        {@const otherDownload = transferring && !downloading}
        <div class="p-section" data-model-row={row.key}>
          <div class="mrow">
            <ModelIcon id={engine?.id || weight?.repo_id} name={row.name} size={22}/>
            <div class="main">
              <div class="title"><b>{row.name}</b>
                {#each badges(row, job, isActive, incomplete) as [kind, text]}<StatusBadge {kind} {text}/>{/each}
                {#if weight?.curated}<StatusBadge kind="neutral" text={tr('Polecany')}/>{/if}
                {#if !supported}<StatusBadge kind="bad" text={tr('Niezgodny z tym komputerem')}/>{/if}
                {#if blocked}<StatusBadge kind="warn" text={tr('Wymaga akceptacji warunków')}/>{/if}
              </div>
              {#if engine?.description || weight?.note}<span class="desc">{engine?.description || weight?.note}</span>{/if}
              {#if detail(row)}<span class="det">{detail(row)}</span>{/if}
              {#if job && downloading}
                {@const pct = downloadPercent(job)}
                <div class="p-progress" role="status">{#if pct !== undefined}<progress class="p-bar" max="100" value={pct} aria-label={tr('Postęp pobierania {name}', { name: row.name })}></progress>{:else}<progress class="p-bar" aria-label={tr('Postęp pobierania {name}', { name: row.name })}></progress>{/if}<span>{progressText(job)}</span></div>
              {:else if job?.error && !weight?.installed}<span class="det err">{tr(job.error)}</span>{/if}
            </div>
            <div class="mact">
              {#if weight && job && downloading}
                <Button variant="outline" disabled={busy || job.state === 'cancelling'} onclick={() => action(signal => modelManagement.cancel(weight.repo_id, signal))}><X size={14}/>{tr('Anuluj')}</Button>
              {:else if blocked}
                <Button variant="outline" onclick={() => toggleLicense(row)}>{tr('Warunki')}</Button>
              {:else if weight && !weight.installed}
                <Tooltip content={otherDownload ? tr('Trwa inne pobieranie') : !supported ? tr('Niezgodny z tym komputerem') : storage?.restart_required ? tr('Nowy katalog modeli czeka na restart silnika') : ''} disabled={!otherDownload && supported && !storage?.restart_required}>
                  <Button disabled={busy || transferring || !supported || storage?.restart_required} onclick={() => action(signal => modelManagement.install(weight.repo_id, signal))}><Download size={14}/>{incomplete ? tr('Wznów') : tr('Pobierz')}</Button>
                </Tooltip>
              {:else if engine && fam && (fam.active !== engine.id || needsEngineVerification(engine))}
                <Tooltip content={fam.env_override ? tr('Model jest ustawiony przez konfigurację uruchomienia') : tr(engineReadinessLabel(engine))} disabled={canSelectEngine(engine) && !fam.env_override}>
                  <Button variant="outline" disabled={busy || !canSelectEngine(engine) || Boolean(fam.env_override) || Boolean(engine.license_required && !engine.license_accepted)} onclick={() => select(tab as 'tts' | 'asr' | 'llm', engine)}>{needsEngineVerification(engine) ? tr('Sprawdź i użyj') : tr('Użyj')}</Button>
                </Tooltip>
              {/if}
              {#if !blocked}
                <Tooltip content={tr('Warunki i licencja')}><Button variant="ghost" size="icon" aria-label={tr('Warunki i licencja: {name}', { name: row.name })} onclick={() => toggleLicense(row)}><FileCheck size={15}/></Button></Tooltip>
              {/if}
              {#if weight && (weight.installed || incomplete)}
                <Tooltip content={isActive ? tr('Aktywnego modelu nie można usunąć') : tr('Usuń model')}>
                  <Button variant="ghost" size="icon" disabled={isActive || busy || transferring} aria-label={tr('Usuń model {name}', { name: row.name })} onclick={() => openDelete(weight.repo_id)}><Trash2 size={15}/></Button>
                </Tooltip>
              {/if}
            </div>
          </div>

          {#if licenseKey === row.key}
            {@const info = engine ? engineLicenses[engine.id] : undefined}
            <div class="p-notice box" role="region" aria-label={tr('Warunki: {name}', { name: row.name })}>
              <b>{tr('Warunki używania: {name}', { name: info?.name || weight?.license || tr('licencja nieustalona w katalogu') })}</b>
              <span>{info ? tr(info.summary) : engine?.license_required ? tr('Ten model wymaga akceptacji warunków przed użyciem. Przeczytaj licencję u źródła.') : tr('Aplikacja nie wymaga akceptacji. Przed użyciem komercyjnym sprawdź licencję u źródła.')}</span>
              <div class="links">{#each info?.links || [] as link (link.url)}<Button variant="ghost" onclick={() => openSource(link.url)}>{link.title}</Button>{/each}
              {#if weight}
                <Button variant="ghost" onclick={() => openSource(`https://huggingface.co/${weight.repo_id}`)}>{tr('Opis i licencja na Hugging Face')}</Button>
                {#each [weight.repo_id, ...(weight.dependencies || []).map(dependency => dependency.repo_id)] as repo, index (repo)}
                  <Button variant="ghost" aria-expanded={registryRepo === repo && registryHost === row.key} onclick={() => openRegistry(repo, row.key)}>{index ? tr('Warunki składnika: {repo}', { repo }) : tr('Rejestr warunków modelu')}</Button>
                {/each}
              {/if}</div>
              {#if engine?.license_required && !engine.license_accepted}
                <div class="agree"><Switch size="sm" label={tr('Akceptuję warunki')} bind:checked={agreed}/><span>{tr('Zapoznałem się z warunkami i akceptuję je.')}</span></div>
              {/if}
              <div class="p-actions">
                {#if engine?.license_required && !engine.license_accepted}<Button disabled={!agreed || busy} onclick={() => action(async signal => { await modelManagement.license(engine.id, true, signal); licenseKey = ''; await onchange(); }, () => tr('Zapisano akceptację warunków: {name}.', { name: row.name }))}>{tr('Akceptuję warunki')}</Button>
                {:else if engine?.license_required}<StatusBadge kind="ok" text={tr('Warunki zaakceptowane')}/><Button variant="outline" disabled={busy} onclick={() => action(async signal => { await modelManagement.license(engine.id, false, signal); licenseKey = ''; await onchange(); }, () => tr('Cofnięto akceptację warunków: {name}.', { name: row.name }))}>{tr('Cofnij akceptację')}</Button>{/if}
                <Button variant="light" onclick={() => { licenseKey = ''; if (registryHost === row.key) registryRepo = ''; }}>{tr('Zamknij')}</Button>
              </div>
              {#if registryRepo && registryHost === row.key}<div class="registry" data-registry-host={row.key}><ModelLicenseReview {ready} repoId={registryRepo} onclose={() => registryRepo = ''} onchanged={async () => { await refresh(); await onchange(); }}/></div>{/if}
            </div>
          {/if}

          {#if weight && deleteRepo === weight.repo_id}
            <div class="p-confirm del" role="alert">
              <div class="body">
                <span>{tr('Usuniesz lokalne wagi')} <b>{weight.repo_id}</b>{#if weight.size_on_disk_bytes} {tr('(zwolnisz {size})', { size: byteLabel(weight.size_on_disk_bytes) })}{/if}. {tr('Głosy i nagrania zostaną.')}</span>
                <label for={`confirm-${row.key}`}>{tr('Wpisz identyfikator modelu, aby potwierdzić')}</label>
                <Input id={`confirm-${row.key}`} bind:value={confirmation} autocomplete="off" spellcheck={false} placeholder={weight.repo_id}/>
              </div>
              <div class="p-actions">
                <Button variant="destructive" disabled={busy || confirmation !== weight.repo_id} onclick={() => action(async signal => { await modelManagement.remove(weight.repo_id, confirmation, signal); deleteRepo = ''; confirmation = ''; await onchange(); }, () => tr('Usunięto model {name} z katalogu modeli.', { name: row.name }))}>{tr('Usuń model')}</Button>
                <Button variant="outline" disabled={busy} onclick={() => { deleteRepo = ''; confirmation = ''; }}>{tr('Zachowaj')}</Button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </section>

  {:else}
    <section class="p-card" role="tabpanel">
      <div class="p-section">
        <header><h3>{tr('Pobieranie i dostęp')}</h3><p>{tr('Token, źródło modeli i katalog na dysku.')}</p></header>
        <div class="p-rows">
          <div class="p-row">
            <div class="t"><b>{tr('Token Hugging Face')}</b><span>{tr('Potrzebny tylko dla modeli chronionych. Nigdy nie jest wyświetlany.')}</span></div>
            <div class="ctl">{#if tokenState?.set}<StatusBadge kind="ok" text={tr('Token zapisany')}/>{:else}<StatusBadge kind="neutral" text={tr('Brak tokenu')}/>{/if}
              <Input type="password" bind:value={token} placeholder="hf_…" autocomplete="off" aria-label={tr('Token Hugging Face')} disabled={accessBusy}/>
              <Button disabled={accessBusy || !token.trim()} onclick={saveToken}>{tr('Zapisz')}</Button>
              {#if tokenState?.set}<Button variant="outline" disabled={accessBusy} onclick={testToken}>{tr('Sprawdź')}</Button>
                <Button variant={tokenArmed ? 'destructive' : 'outline'} disabled={accessBusy} onclick={dropToken}>{tokenArmed ? tr('Potwierdź usunięcie') : tr('Usuń token')}</Button>{/if}</div>
          </div>
          {#if mirror}
            <div class="p-row">
              <div class="t"><b>{tr('Źródło pobierania')}</b><span>{source === 'auto' && mirror.auto_opt_out ? tr('Automatyczny wybór jest zablokowany przez konfigurację uruchomienia silnika.') : tr(sourceText[source])}</span></div>
              <div class="ctl">{#if mirror.restart_required}<StatusBadge kind="wait" text={tr('Czeka na restart')}/>{@render restartButton()}{/if}
                <ButtonGroup label={tr('Źródło pobierania')} mode="single" disabled={accessBusy} bind:value={source} onchange={value => saveSource(String(value))} items={[{ value: 'off', label: tr('Oficjalny') }, { value: 'auto', label: tr('Auto'), disabled: mirror.auto_opt_out }, { value: 'man', label: tr('Ręczny') }]}/></div>
            </div>
            {#if source === 'man'}
              <div class="p-row"><div class="t"><b>{tr('Adres mirroru')}</b><span>{tr('Adres zgodny z Hugging Face.')}</span></div>
                <div class="ctl col"><div class="ctl"><Input bind:value={mirrorUrl} placeholder="https://mirror.example/" aria-label={tr('Adres mirroru')} autocomplete="off" spellcheck={false} disabled={accessBusy}/><Button variant="outline" disabled={accessBusy || !mirrorUrl.trim()} onclick={saveMirror}>{tr('Zapisz')}</Button></div>
                  {#if mirrorError}<p class="p-field-err" role="alert">{tr(mirrorError)}</p>{/if}</div></div>
            {/if}
            {#if source === 'auto' && mirror.mode === 'auto'}
              <div class="p-row"><div class="t"><b>{tr('Ostatni test źródła')}</b><span>{mirror.auto ? (mirror.auto.reachable ? (mirror.auto.latency_ms != null ? tr('{endpoint} odpowiada ({ms} ms).', { endpoint: mirror.auto.endpoint, ms: String(mirror.auto.latency_ms) }) : tr('{endpoint} odpowiada.', { endpoint: mirror.auto.endpoint })) : tr('Żadne z badanych źródeł nie odpowiedziało.')) : tr('Nie wykonano jeszcze testu.')}</span></div>
                <div class="ctl">{#if mirror.auto}{#if mirror.auto.reachable}<StatusBadge kind="ok" text={tr('Odpowiada')}/>{:else}<StatusBadge kind="bad" text={tr('Nie odpowiada')}/>{/if}{/if}<Button variant="outline" disabled={accessBusy || mirror.auto_opt_out} onclick={retest}>{#if retesting}<LoaderCircle size={15} class="spin"/>{tr('Testowanie…')}{:else}{tr('Ponów test')}{/if}</Button></div></div>
            {/if}
          {/if}
          <div class="p-row">
            <div class="t"><b>{tr('Katalog modeli')}</b><span>{tr('Ścieżkę zmienisz w Przechowywaniu, razem z pozostałymi katalogami.')}</span></div>
            <div class="ctl">{#if storage?.restart_required}<StatusBadge kind="wait" text={tr('Czeka na restart')}/>{/if}{#if storage}<code>{storage.effective}</code>{/if}<Button variant="outline" onclick={() => onnavigate('storage')}>{tr('Zmień w Przechowywaniu')}</Button></div>
          </div>
        </div>
      </div>
    </section>
  {/if}
  {/if}
</div>

<style>
  .models-page .p-card>.p-section:not(:last-child){padding-bottom:18px}
  .eng{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:8px 24px;flex:1 1 100%}
  .models-page :global(.page-heading){flex-wrap:wrap}
  .engrow{display:flex;align-items:center;gap:8px}
  .free{margin-left:auto;font-size:var(--ui-text-12);color:var(--muted)}.free b{color:var(--foreground);font-weight:550}
  .models-page :global(.spin){color:var(--accent)}
  .ctl{display:flex;align-items:center;flex-wrap:wrap;justify-content:flex-end;gap:8px;min-width:0}
  .ctl.col{flex-direction:column;align-items:flex-end;gap:0}
  .ctl code{font-size:var(--ui-text-11);overflow-wrap:anywhere}
  .mrow{display:flex;align-items:flex-start;gap:12px}
  .mrow>:global(.model-icon){margin-top:1px;flex-shrink:0}
  .main{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
  .title{display:flex;align-items:center;flex-wrap:wrap;gap:6px 8px}.title b{font-size:var(--ui-text-14);font-weight:600}
  .desc{font-size:var(--ui-text-12);color:var(--muted);line-height:1.6;max-width:520px}
  .det{font-size:var(--ui-text-12);color:var(--muted);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
  .det.err{color:var(--danger)}
  .main .p-progress{margin-top:4px;max-width:460px}
  .mact{display:flex;align-items:center;gap:4px;min-height:32px;flex-shrink:0}
  .box{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin:0 0 0 34px}
  .box b{color:var(--foreground);font-weight:550}
  .agree{display:flex;align-items:center;gap:10px}
  .links{display:flex;flex-wrap:wrap;gap:4px}
  .registry{align-self:stretch;margin-top:8px}
  .prov .pname{display:flex;align-items:center;gap:12px;min-width:0}
  .prov em{font-style:normal;font-weight:400;font-size:var(--ui-text-11);color:var(--muted);margin-left:8px}
  .prov .ctl{display:flex;align-items:center;gap:8px}
  .del{margin-left:34px;align-items:flex-end}
  .del .body{display:flex;flex-direction:column;gap:8px;flex:1;min-width:0}
  .del .body label{color:var(--muted)}
  @media(max-width:700px){.free{margin-left:0}.mrow{flex-wrap:wrap}.box,.del{margin-left:0}}
</style>
