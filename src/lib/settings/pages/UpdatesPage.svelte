<script lang="ts">
  // "Aktualizacje": app version, pinned engine provenance, public upstream releases and the bundled changelog.
  import { onDestroy, onMount, untrack } from 'svelte';
  import { Copy, Check, RefreshCw, ExternalLink } from '@lucide/svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { version as appVersion } from '../../../../package.json';
  import { uiLanguage, createUiTranslator } from '../../i18n';
  import type { SettingsSection } from '../settings-catalog';
  import { isDesktop } from '../../platform/runtime';
  import { productionJson, postJson } from '../../tools/production/production';
  import { settingsError } from '../system-settings';
  import { toast } from '../../ui/toast';
  import Button from '../../ui/Button.svelte';
  import Select from '../../ui/Select.svelte';
  import StatusBadge from '../../ui/StatusBadge.svelte';
  const tr = $derived(createUiTranslator($uiLanguage));

  let { ready, onnavigate }: { ready: boolean; onnavigate?: (id: SettingsSection) => void } = $props();

  type Source = { source: { sourceVersion?: string; commit?: string; archive_sha256?: string; installedDistributionVersion?: string } };
  type Release = { tag: string; name: string; published_at: string; prerelease: boolean; url: string; notes: string };
  type Changelog = { version: string; date: string; intro: string; sections: { title: string; bullets: string[] }[] };
  const RELEASES_URL = 'https://github.com/debpalash/VoiceStudio/releases';

  let version = $state(appVersion), source = $state<Source['source']>(), changelog = $state.raw<Changelog[]>([]), loaded = $state(false);
  let controller: AbortController | undefined, disposed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  onDestroy(() => { disposed = true; controller?.abort(); timers.forEach(clearTimeout); });
  onMount(() => { if (isDesktop()) getVersion().then(v => { if (!disposed) version = v; }).catch(() => {}); else version = `${appVersion} · ${tr('podgląd')}`; });

  async function load() {
    const abort = new AbortController(); controller = abort;
    const [src, log] = await Promise.allSettled([
      productionJson<Source>('/next/settings/update-source', { signal: abort.signal }),
      productionJson<{ available: boolean; releases: Changelog[] }>('/api/settings/changelog?limit_versions=3', { signal: abort.signal }),
    ]);
    if (disposed || abort.signal.aborted) return;
    if (src.status === 'fulfilled') source = src.value.source;
    if (log.status === 'fulfilled') changelog = log.value.releases;
    if (src.status === 'rejected' || log.status === 'rejected') toast.bad(tr('Nie odczytano wszystkich metadanych aktualizacji. Odśwież po uruchomieniu prywatnego silnika.'));
    loaded = true;
  }
  $effect(() => { if (ready && !loaded) untrack(() => { void load(); }); });

  const KV = $derived<[string, string][]>([
    ['Wersja źródeł', source?.sourceVersion || tr('nieustalona')],
    ['Commit źródłowy', source?.commit ? source.commit.slice(0, 7) : tr('nieodczytany')],
    ['Metadane dystrybucji Python', source?.installedDistributionVersion || tr('brak')],
  ]);
  const sha = $derived(source?.archive_sha256 || '');
  const short = (s: string) => s.length > 20 ? `${s.slice(0, 8)}…${s.slice(-8)}` : s;
  let copied = $state(false);
  async function copySha() {
    try { await navigator.clipboard.writeText(sha); copied = true; const id = setTimeout(() => { timers.delete(id); copied = false; }, 1800); timers.add(id); }
    catch { toast.bad(tr('Nie udało się skopiować. Zaznacz tekst i skopiuj ręcznie.')); }
  }

  /* ---------- public release check ---------- */
  let channel = $state('stable'), checking = $state(false), latest = $state<Release>(), result = $state<null | 'latest' | 'newer'>(null);
  const plain = (v = '') => v.trim().replace(/^v/i, '');
  async function check() {
    if (checking || !ready) return;
    checking = true; result = null; latest = undefined;
    try {
      const { releases } = await productionJson<{ releases: Release[] }>('/next/settings/update-source/check', postJson({ channel }));
      if (disposed) return;
      latest = releases[0];
      if (!latest) { toast.info(tr('GitHub nie zwrócił wydań w wybranym kanale.')); return; }
      result = plain(latest.tag) === plain(source?.sourceVersion) ? 'latest' : 'newer';
      if (result === 'latest') toast.ok(tr('Masz najnowszą wersję źródeł ({version})', { version: plain(latest.tag) }));
      else toast.warn(tr('Dostępne nowsze wydanie źródeł: {version}', { version: plain(latest.tag) }));
    } catch (cause) { if (!disposed) toast.bad(tr(settingsError(cause))); }
    finally { if (!disposed) checking = false; }
  }
</script>

<div class="p-page">
  <div class="page-heading"><div><h1>{tr('Aktualizacje')}</h1><p>{tr('Wersja aplikacji, pochodzenie silnika i opis zmian.')}</p></div></div>

  <section class="p-card card">
    <div class="p-section">
      <header class="split"><div><h3>Seventy Seven Labs · {version}</h3><p>{tr('Aplikacja nie aktualizuje się automatycznie. Nową wersję instalujesz z nowej kompilacji lub instalatora.')}</p></div><StatusBadge kind="neutral" text={tr('Aktualizacje ręczne')}/></header>
    </div>

    {#if !ready}
      <p class="p-notice">{tr('Silnik jest zatrzymany, więc pochodzenie silnika i opis zmian są niedostępne. Uruchom go na stronie Silnik.')}{#if onnavigate} <Button size="sm" onclick={() => onnavigate?.('engine')}>{tr('Przejdź do strony Silnik')}</Button>{/if}</p>
    {:else}
    <div class="p-section">
      <header><h3>{tr('Pochodzenie silnika')}</h3><p>{tr('Silnik korzysta z przypiętych źródeł VoiceStudio (AGPL-3.0-only). To dane pakietu źródłowego, nie wersji aplikacji.')}</p></header>
      {#if !loaded}<p class="p-sub" role="status">{tr('Odczytuję metadane…')}</p>
      {:else}
      <dl class="p-kv">
        {#each KV as [k, v]}<div><dt>{tr(k)}</dt><dd>{v}</dd></div>{/each}
        <div><dt>{tr('SHA-256 archiwum')}</dt><dd class="sha">{#if sha}<code title={sha}>{short(sha)}</code>
          <Button variant="ghost" size="icon" aria-label={copied ? tr('Skopiowano') : tr('Kopiuj SHA-256 archiwum')} onclick={copySha}>{#if copied}<Check size={15} class="ok"/>{:else}<Copy size={15}/>{/if}</Button>{:else}{tr('nieodczytany')}{/if}</dd></div>
      </dl>
      {/if}
    </div>

    <div class="p-section">
      <header class="split"><div><h3>{tr('Publiczne wydania źródeł bazowych')}</h3><p>{tr('Sprawdzenie łączy się z GitHub dopiero po kliknięciu i pobiera tylko opis wydań. To nie jest aktualizacja aplikacji.')}</p></div>
        {#if result}<StatusBadge kind={result === 'latest' ? 'ok' : 'warn'} text={result === 'latest' ? tr('Masz najnowszą wersję') : tr('Dostępna nowsza')}/>{/if}</header>
      <div class="p-row flat">
        <div class="t"><b>{tr('Kanał publicznych wydań źródeł')}</b><span>{tr('Stabilne lub także testowe.')}</span></div>
        <Select ariaLabel={tr('Kanał publicznych wydań źródeł')} value={channel} disabled={checking} options={[{ value: 'stable', label: tr('Stabilne') }, { value: 'preview', label: tr('Stabilne i testowe') }]} onchange={v => { channel = v; result = null; latest = undefined; }}/>
      </div>
      <div class="p-actions">
        <Button disabled={checking} onclick={check}><RefreshCw size={15} class={checking ? 'spin' : ''}/>{checking ? tr('Sprawdzam…') : tr('Sprawdź wydania na GitHub')}</Button>
        <Button variant="ghost" href={RELEASES_URL} target="_blank" rel="noreferrer"><ExternalLink size={15}/>{tr('Otwórz historię wydań źródeł bazowych')}</Button>
      </div>
      {#if checking}<div class="p-progress" role="status"><progress class="p-bar" aria-label={tr('Sprawdzanie wydań')}></progress><span>{tr('Łączenie z GitHub')}</span></div>{/if}
      {#if result === 'newer' && latest}<p class="p-notice warn" role="status">{tr('Najnowsze wydanie źródeł: {version} ({kind}{date}). Silnik w tej aplikacji używa {current}; zmiana wymaga przypięcia źródeł i testów.', { version: plain(latest.tag), kind: latest.prerelease ? tr('testowe, ') : '', date: latest.published_at.slice(0, 10), current: source?.sourceVersion || tr('nieustalona') })}</p>{/if}
    </div>

    <div class="p-section">
      <header><h3>{tr('Zmiany w pakiecie silnika')}</h3><p>{tr('Trzy ostatnie wydania osadzonego silnika.')}</p></header>
      {#if loaded && !changelog.length}<p class="p-sub">{tr('Pakiet nie udostępnił opisu zmian.')}</p>{/if}
      <div class="log">
        {#each changelog as r (r.version)}
          <article>
            <h4><b>{r.version}</b><span>{r.date}</span></h4>
            <p class="p-sub">{r.intro}</p>
            {#each r.sections as s, i (i)}<h5>{s.title}</h5><ul>{#each s.bullets as b}<li>{b}</li>{/each}</ul>{/each}
          </article>
        {/each}
      </div>
    </div>
    {/if}
  </section>
</div>

<style>
  .card{display:flex;flex-direction:column;gap:18px}
  .sha{display:flex;align-items:center;justify-content:flex-end;gap:6px}
  .sha code{font-size:var(--ui-text-11);font-family:var(--font-mono,monospace)}
  .p-kv>div{align-items:center}.sha :global(.ok){color:var(--success)}
  .log{display:flex;flex-direction:column}
  .log article{padding:14px 0;border-top:1px solid var(--border)}.log article:first-child{border-top:0;padding-top:2px}
  .log h4{display:flex;align-items:baseline;gap:10px;margin:0;font-size:var(--ui-text-13)}.log h4 b{font-weight:600}.log h4 span{color:var(--muted);font-size:var(--ui-text-12);font-variant-numeric:tabular-nums}
  .log h5{margin:10px 0 2px;font-size:var(--ui-text-12);font-weight:600}
  .log ul{margin:0;padding-left:18px;font-size:var(--ui-text-12);color:var(--muted);line-height:1.8}
  .p-notice :global([data-slot=button]){margin-left:8px}
  .p-actions :global(.spin){animation:rot .8s linear infinite;color:var(--accent)}@keyframes rot{to{transform:rotate(360deg)}}
  @media(prefers-reduced-motion:reduce){.p-actions :global(.spin){animation:none}}
</style>
