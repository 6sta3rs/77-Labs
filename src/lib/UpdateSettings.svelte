<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import { ArrowDownToLine, RefreshCw } from '@lucide/svelte'
  import { getVersion } from '@tauri-apps/api/app'
  import { version as appVersion } from '../../package.json'
  import { isDesktop } from './runtime'
  import Button from './ui/Button.svelte'
  import Select from './ui/Select.svelte'
  import { productionJson, postJson } from './production'
  type Source = { app: { name: string; updater_configured: boolean }; source: { sourceVersion?: string; commit?: string; archive_sha256?: string; installedDistributionVersion?: string }; install_supported: boolean }
  type Release = { tag: string; name: string; published_at: string; prerelease: boolean; url: string; notes: string }
  type Changelog = { version: string; date: string; intro: string; sections: { title: string; bullets: string[] }[] }
  let { ready }: { ready: boolean } = $props()
  let source = $state<Source>(), changelog = $state.raw<Changelog[]>([]), releases = $state.raw<Release[]>([])
  let version = $state(appVersion), channel = $state('stable'), loaded = $state(false), checked = $state(false), busy = $state(''), error = $state('')
  let controller: AbortController | undefined, disposed = false
  const locked = $derived(!!busy)
  async function work(label: string, action: (signal: AbortSignal) => Promise<void>) {
    if (!ready || busy || disposed) return
    const abort = new AbortController(); controller = abort; busy = label; error = ''
    try { await action(abort.signal) } catch (cause) { if (!disposed && !abort.signal.aborted) error = cause instanceof Error ? cause.message : String(cause) }
    finally { if (!disposed) busy = '' }
  }
  async function refresh() {
    await work('Odczyt wersji i zmian', async signal => {
      const results = await Promise.allSettled([
        productionJson<Source>('/next/settings/update-source', { signal }),
        productionJson<{ available: boolean; releases: Changelog[] }>('/api/settings/changelog?limit_versions=5', { signal }),
        isDesktop() ? getVersion() : Promise.resolve(`${appVersion} · podgląd`),
      ])
      signal.throwIfAborted(); if (disposed) return
      if (results[0].status === 'fulfilled') source = results[0].value
      if (results[1].status === 'fulfilled') changelog = results[1].value.releases
      if (results[2].status === 'fulfilled') version = results[2].value
      if (results[0].status === 'rejected' || results[1].status === 'rejected') error = 'Nie odczytano wszystkich metadanych aktualizacji. Odśwież po uruchomieniu prywatnego silnika.'
      loaded = true
    })
  }
  async function check() {
    checked = false; releases = []
    await work('Sprawdzanie publicznych wydań silnika', async signal => { const result = await productionJson<{ releases: Release[] }>('/next/settings/update-source/check', postJson({ channel }, signal)); signal.throwIfAborted(); releases = result.releases; checked = true })
  }
  $effect(() => { if (ready && !loaded) untrack(() => { void refresh() }) })
  onDestroy(() => { disposed = true; controller?.abort() })
</script>

<div class="update-settings"><header><ArrowDownToLine size={23}/><div><h1>Aktualizacje</h1><p>Wersja aplikacji, pochodzenie osadzonego silnika i opis zmian.</p></div><Button variant="ghost" size="icon" aria-label="Odśwież metadane aktualizacji" disabled={!ready || locked} onclick={refresh}><RefreshCw size={15}/></Button></header>
  <section aria-label="Wersja aplikacji"><h2>Seventy Seven Labs · {version}</h2><p>Ta aplikacja ma własny pakiet i cykl wydawania. Automatyczny aktualizator podpisanych pakietów Seventy Seven Labs nie został jeszcze skonfigurowany. Aktualizację aplikacji wykonuje się przez jej nową kompilację lub instalator.</p><p>Lista poniżej dotyczy źródeł używanych przez silnik. Wydanie jego zależności nie oznacza dostępnej aktualizacji Seventy Seven Labs.</p></section>
  {#if !ready}<p role="status">Uruchom prywatny silnik, aby odczytać pochodzenie osadzonego pakietu.</p>{/if}
  <section aria-label="Pochodzenie silnika"><h2>Pochodzenie silnika</h2><p>Silnik Seventy Seven Labs korzysta z przypiętych źródeł VoiceStudio. Poniższe dane opisują ten pakiet źródłowy, nie wersję aplikacji.</p><p>Backend: VoiceStudio · AGPL-3.0-only. Copyright 2024-present Palash Debnath and VoiceStudio contributors.</p>{#if source}<dl><dt>Wersja źródeł</dt><dd>{source.source.sourceVersion || 'nieustalona'}</dd><dt>Commit źródłowy</dt><dd><code>{source.source.commit || 'nieodczytany'}</code></dd><dt>SHA-256 archiwum</dt><dd><code>{source.source.archive_sha256 || 'nieodczytany'}</code></dd><dt>Metadane dystrybucji Python</dt><dd>{source.source.installedDistributionVersion || 'brak'}</dd></dl>{/if}<p>Nowa wersja silnika wymaga przypięcia źródeł, aktualizacji archiwum, kontroli zgodności i testów. Aplikacja zachowuje osobne generacje kodu i wykonuje kopię prywatnych danych przed migracją. Biblioteki i modele mogą być współdzielone przez hardlinki i pozostają niezmienne.</p></section>
  <section aria-label="Wydania źródeł silnika"><h2>Publiczne wydania źródeł bazowych</h2><p>Lista opisuje wydania projektu bazowego, nie aktualizacje Seventy Seven Labs. Sprawdzenie łączy się z GitHub dopiero po kliknięciu. Pobiera wyłącznie opis wydań. Nie pobiera instalatora ani nie zmienia działającego środowiska.</p><Select label="Kanał publicznych wydań źródeł" value={channel} onchange={value => { channel = value; checked = false; releases = [] }} options={[{ value: 'stable', label: 'Stabilne' }, { value: 'preview', label: 'Stabilne i testowe' }]} disabled={locked}/><Button variant="outline" disabled={!ready || locked} onclick={check}><RefreshCw size={14}/>Sprawdź wydania na GitHub</Button><Button variant="ghost" href="https://github.com/debpalash/VoiceStudio/releases" target="_blank" rel="noreferrer">Otwórz historię wydań źródeł bazowych</Button>{#if checked && !releases.length}<p role="status">GitHub nie zwrócił wydań w wybranym kanale.</p>{/if}{#each releases as release (release.url)}<details><summary>{release.name || release.tag}{release.prerelease ? ' · wydanie testowe' : ''} · {release.published_at.slice(0, 10)}</summary><p class="notes">{release.notes || 'Brak opisu wydania.'}</p><Button variant="ghost" href={release.url} target="_blank" rel="noreferrer">Otwórz źródłowy opis wydania</Button></details>{/each}</section>
  <section aria-label="Zmiany w osadzonym silniku"><h2>Zmiany w osadzonym pakiecie silnika</h2>{#if loaded && !changelog.length}<p>Pakiet nie udostępnił opisu zmian.</p>{/if}{#each changelog as release (release.version)}<details><summary>{release.version} · {release.date}</summary><p class="notes">{release.intro}</p>{#each release.sections as section, index (`${release.version}-${index}`)}<h3>{section.title}</h3><ul>{#each section.bullets as bullet, bulletIndex (`${index}-${bulletIndex}`)}<li>{bullet}</li>{/each}</ul>{/each}</details>{/each}</section>
  {#if busy}<p role="status">{busy}…</p>{/if}{#if error}<p class="failure" role="alert">{error}</p>{/if}
</div>

<style>
  .update-settings{display:flex;flex-direction:column;gap:20px;min-width:0}.update-settings header{display:flex;align-items:flex-start;gap:14px}.update-settings header>div{flex:1}.update-settings h1{font-size:var(--ui-text-22);font-weight:600;letter-spacing:-.4px}.update-settings h2{font-size:var(--ui-text-14);font-weight:600}.update-settings h3{font-size:var(--ui-text-12);font-weight:600;margin:14px 0 6px}.update-settings p,.update-settings li{font-size:var(--ui-text-12);color:var(--muted);line-height:1.75;margin:6px 0}.update-settings section{display:flex;flex-direction:column;gap:12px;padding:20px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}.update-settings section>:global([data-slot=button]){align-self:flex-start}.update-settings dl{display:grid;grid-template-columns:minmax(100px,1fr) 3fr;gap:12px;font-size:var(--ui-text-12)}.update-settings dt{color:var(--muted)}.update-settings dd{margin:0;overflow-wrap:anywhere}.update-settings code{font-size:var(--ui-text-11)}.update-settings summary{font-size:var(--ui-text-12);cursor:pointer;line-height:1.7}.notes{white-space:pre-wrap;overflow-wrap:anywhere}.failure{color:var(--danger)!important}.update-settings ul{padding-left:18px}@media(max-width:600px){.update-settings section{padding:16px}.update-settings dl{grid-template-columns:1fr}}
</style>
