<script lang="ts">
  // "Prywatność i użycie": analytics consent, watermark (all toggles + detector, one endpoint), local usage stats.
  import { onDestroy, untrack } from 'svelte'
  import { ShieldCheck, Save, LoaderCircle, ChevronRight } from '@lucide/svelte'
  import { uiLanguage, createUiTranslator } from '../../i18n'
  import type { SettingsSection } from '../settings-catalog'
  import { toast } from '../../ui/toast'
  import Button from '../../ui/Button.svelte'
  import Switch from '../../ui/Switch.svelte'
  import FilePicker from '../../ui/FilePicker.svelte'
  import StatusBadge from '../../ui/StatusBadge.svelte'
  import { productionJson } from '../../tools/production/production'
  import { ANALYTICS_OFFERED, longDurationLabel, putSettings, settingsError, type AnalyticsState, type SystemInfo, type UsageState } from '../system-settings'
  import { parseWatermarkResult, watermarkFileError, watermarkSettingsPath, watermarkTitle, type WatermarkResult, type WatermarkSettings } from '../../platform/integrations'

  let { ready = false, onnavigate }: { ready?: boolean; onnavigate?: (id: SettingsSection) => void } = $props()
  const tr = $derived(createUiTranslator($uiLanguage))

  type Tab = 'privacy' | 'watermark' | 'usage'
  const tabs: [Tab, string][] = [['privacy', 'Prywatność'], ['watermark', 'Znak wodny'], ['usage', 'Użycie']]
  let tab = $state<Tab>('privacy')

  let analytics = $state.raw<AnalyticsState>(), info = $state.raw<SystemInfo>(), usage = $state.raw<UsageState>()
  let watermark = $state.raw<WatermarkSettings>(), draft = $state({ invisible_enabled: false, visible_audio_enabled: false, visible_video_enabled: false })
  let loadError = $state(''), loading = $state(false), busy = $state(''), disposed = false
  let controller: AbortController | undefined
  const locked = $derived(!ready || loading || !!busy)
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const flash = (set: (v: boolean) => void) => { set(true); const id = setTimeout(() => { timers.delete(id); set(false) }, 1800); timers.add(id) }
  onDestroy(() => { disposed = true; controller?.abort(); timers.forEach(clearTimeout) })

  const applyWatermark = (next: WatermarkSettings) => { watermark = next; draft = { invisible_enabled: next.invisible_enabled, visible_audio_enabled: next.visible_audio_enabled, visible_video_enabled: next.visible_video_enabled } }
  async function load() {
    controller?.abort(); const request = new AbortController(); controller = request
    loading = true; loadError = ''
    const signal = request.signal
    const results = await Promise.allSettled([
      productionJson<AnalyticsState>('/api/settings/analytics', { signal }).then(v => analytics = v),
      productionJson<SystemInfo>('/system/info', { signal }).then(v => info = v),
      productionJson<WatermarkSettings>('/watermark/status', { signal }).then(applyWatermark),
      productionJson<UsageState>('/stats/usage', { signal }).then(v => usage = v),
    ])
    if (signal.aborted || disposed) return
    loadError = [...new Set(results.filter(x => x.status === 'rejected').map(x => settingsError((x as PromiseRejectedResult).reason)))].join('\n')
    loading = false
  }
  $effect(() => {
    if (!ready) return
    untrack(() => { void load() })
    return () => { controller?.abort(); loading = false }
  })
  async function work(label: string, run: (signal: AbortSignal) => Promise<void>) {
    if (locked || disposed) return
    const request = new AbortController(); controller = request; busy = label
    try { await run(request.signal) }
    catch (cause) { if (!request.signal.aborted && !disposed) toast.bad(settingsError(cause)) }
    finally { if (!disposed) busy = '' }
  }

  /* ---------- privacy ---------- */
  let analyticsOk = $state(false), analyticsOn = $state(false)
  $effect(() => { analyticsOn = !!analytics?.opted_in })
  const saveAnalytics = (enabled: boolean) => work('analytics', async signal => {
    analytics = await putSettings<AnalyticsState>('/api/settings/analytics', { enabled }, signal); flash(v => analyticsOk = v)
  }).then(() => { analyticsOn = !!analytics?.opted_in })
  const provider = $derived(info?.translate_provider && info.translate_provider !== 'unknown' ? info.translate_provider : '')

  /* ---------- watermark: one control set, one endpoint (POST /watermark/settings with all three flags) ---------- */
  const dirty = $derived(!!watermark && (['invisible_enabled', 'visible_audio_enabled', 'visible_video_enabled'] as const).some(k => watermark![k] !== draft[k]))
  let wmOk = $state(false)
  const saveWm = () => { const desired = { ...watermark!, ...draft }; return work('watermark', async signal => {
    await productionJson(watermarkSettingsPath(desired), { method: 'POST', signal })
    applyWatermark(await productionJson<WatermarkSettings>('/watermark/status', { signal }))
    if (watermark!.invisible_enabled === desired.invisible_enabled && watermark!.visible_audio_enabled === desired.visible_audio_enabled && watermark!.visible_video_enabled === desired.visible_video_enabled) flash(v => wmOk = v)
    else toast.warn(tr('Zapisano preferencje, ale bieżący silnik zwraca inne ustawienia. Sprawdź nadpisanie przez środowisko.'))
  }) }
  let file = $state<File>(), fileErr = $state(''), result = $state<WatermarkResult>()
  function choose(files: File[]) {
    result = undefined; file = undefined; fileErr = ''
    const f = files[0]; if (!f) return
    const invalid = watermarkFileError(f)
    if (invalid) fileErr = invalid; else file = f
  }
  const detect = () => { const selected = file!; return work('detect', async signal => {
    result = undefined
    const body = new FormData(); body.append('file', selected)
    result = parseWatermarkResult(await productionJson<unknown>('/watermark/detect', { method: 'POST', body, signal }))
  }) }

  /* ---------- usage ---------- */
  const stats = $derived(usage ? [['Nagrania', usage.takes.toLocaleString(tr.locale)], ['Długość audio', longDurationLabel(usage.audio_seconds)], ['Głosy', usage.voices.toLocaleString(tr.locale)], ['Aktywne dni', usage.active_days.toLocaleString(tr.locale)], ['Dubbingi', usage.dubs.toLocaleString(tr.locale)], ['Ulubione', usage.starred.toLocaleString(tr.locale)]] : [])
  const top = (rows: { count: number }[]) => Math.max(1, ...rows.map(r => r.count))
</script>

{#snippet bars(title: string, rows: { name: string; count: number }[])}
  <div class="pv-list"><h3 class="p-h3">{tr(title)}</h3>
    {#each rows as row (row.name)}
      <div class="pv-bar"><div class="pv-bar-h"><span>{tr(row.name)}</span><b>{row.count.toLocaleString(tr.locale)}</b></div>
        <div class="p-bar" role="meter" aria-label={tr(row.name)} aria-valuenow={row.count} aria-valuemin={0} aria-valuemax={top(rows)}><i style:width="{row.count / top(rows) * 100}%"></i></div></div>
    {/each}
  </div>
{/snippet}

<div class="p-page privacy-page">
  <div class="page-heading"><div><h1>{tr('Prywatność i użycie')}</h1><p>{tr('Co opuszcza komputer, jak oznaczane są nagrania i ile korzystasz z aplikacji.')}</p></div></div>

  {#if !ready}
    <p class="p-notice">{tr('Silnik jest zatrzymany, więc ustawienia prywatności, znaku wodnego i statystyki są niedostępne. Uruchom go na stronie Silnik.')}{#if onnavigate}{' '}<Button size="sm" onclick={() => onnavigate?.('engine')}>{tr('Przejdź do strony Silnik')}</Button>{/if}</p>
  {:else}
  <div class="filter-tabs p-tabs" role="tablist" aria-label={tr('Sekcje prywatności')}>
    {#each tabs as [id, label] (id)}<button role="tab" aria-selected={tab === id} class:chosen={tab === id} onclick={() => tab = id}>{tr(label)}</button>{/each}
  </div>
  {#if loadError}<p class="p-notice bad" role="alert">{loadError}</p>{/if}

  <div class="p-card pv-panel">
  {#if tab === 'privacy'}
    <p class="p-notice info">{tr('Synteza, rozpoznawanie mowy i statystyki działają lokalnie na tym komputerze. Dane wychodzą na zewnątrz tylko wtedy, gdy włączysz analitykę albo użyjesz zdalnego dostawcy tłumaczenia.')}</p>
    <div class="p-rows">
      {#if analytics}
      <div class="p-row"><div class="t"><b>{tr('Zgoda na analitykę produktu')}</b><span>{analytics.available && ANALYTICS_OFFERED ? tr('Dobrowolna. Wysyła tylko dane o użyciu programu, bez tekstów i nagrań.') : tr('Ta dystrybucja nie ma skonfigurowanego odbiorcy analityki.')}</span></div>
        <div class="pv-inline">{#if analyticsOk}<span class="saved on" role="status">{tr('Zapisano')}</span>{/if}<Switch label={tr('Zgoda na analitykę produktu')} bind:checked={analyticsOn} disabled={locked || !analytics.available || !ANALYTICS_OFFERED} onchange={saveAnalytics}/></div></div>
      {/if}
      {#if info}
      <div class="p-row"><div class="t"><b>{tr('Dostawca tłumaczenia')}</b><span>{tr('Zdalny dostawca otrzymuje tylko tekst, który tłumaczysz. Zmienisz go w „AI i klucze”.')}</span></div>
        <StatusBadge kind="neutral" text={provider || tr('nieodczytany')}/></div>
      {/if}
    </div>
    {#if onnavigate}<div class="p-actions"><Button variant="ghost" onclick={() => onnavigate?.('storage')}>{tr('Przechowywanie danych i limit historii')} <ChevronRight size={14}/></Button></div>{/if}

  {:else if tab === 'watermark'}
    {#if watermark}
    <div class="p-section">
      <header class="split"><div><h3>{tr('Znak wodny')}</h3><p>{tr('Dotyczy nowych nagrań i eksportów. Nie zmienia zapisanych wcześniej.')}</p></div>
        <StatusBadge kind={watermark.audioseal_available ? 'ok' : 'warn'} text={watermark.audioseal_available ? tr('AudioSeal dostępny') : tr('AudioSeal niedostępny')}/></header>
      <div class="p-rows">
        <div class="p-row"><div class="t"><b>{tr('Niewidoczny znak w nowych generacjach')}</b><span>{tr('Ukryta sygnatura (AudioSeal), której nie słychać.')}</span></div><Switch label={tr('Niewidoczny znak wodny')} bind:checked={draft.invisible_enabled} disabled={locked}/></div>
        <div class="p-row"><div class="t"><b>{tr('Sygnał dźwiękowy w eksportach')}</b><span>{tr('Słyszalny znak dodawany do wyeksportowanego audio.')}</span></div><Switch label={tr('Słyszalny znak eksportu audio')} bind:checked={draft.visible_audio_enabled} disabled={locked}/></div>
        <div class="p-row"><div class="t"><b>{tr('Widoczny znak w eksporcie wideo')}</b><span>{tr('Napis na obrazie wyeksportowanego wideo.')}</span></div><Switch label={tr('Widoczny znak eksportu wideo')} bind:checked={draft.visible_video_enabled} disabled={locked}/></div>
      </div>
      <div class="p-actions"><Button disabled={!dirty || locked} onclick={saveWm}><Save size={14}/>{tr('Zapisz ustawienia znaku')}</Button>{#if wmOk}<span class="saved on" role="status">{tr('Zapisano i potwierdzono')}</span>{/if}</div>
    </div>

    <div class="p-section">
      <header><h3>{tr('Sprawdź nagranie')}</h3><p>{tr('Pliki WAV, MP3, FLAC, OGG, M4A, AAC lub OPUS do 64 MB. Analiza rusza po kliknięciu i może załadować model.')}</p></header>
      <div class="pv-pick"><FilePicker label={tr('Wybierz nagranie')} ariaLabel={tr('Nagranie do wykrywania znaku wodnego')} accept=".wav,.mp3,.flac,.ogg,.m4a,.aac,.opus" disabled={locked} showName={false} onchange={choose}/><span class="pv-file">{file?.name ?? tr('Nie wybrano nagrania')}</span></div>
      {#if fileErr}<p class="p-field-err" role="alert">{fileErr}</p>{/if}
      <div class="p-actions"><Button disabled={!file || !watermark.audioseal_available || locked} onclick={detect}>{#if busy === 'detect'}<LoaderCircle size={15} class="spin"/>{tr('Analizuję…')}{:else}<ShieldCheck size={14}/>{tr('Sprawdź znak wodny')}{/if}</Button></div>
      {#if result}
        <div class="pv-result" role="status">
          <div class="pv-result-h"><StatusBadge kind={result.is_watermarked ? 'ok' : 'neutral'} text={watermarkTitle(result)}/></div>
          <dl class="p-kv"><div><dt>{tr('Wynik detektora (skala 0–1)')}</dt><dd>{result.confidence.toLocaleString(tr.locale, { maximumFractionDigits: 4 })}</dd></div>
            {#if result.message_bits}<div><dt>{tr('Odczytana sygnatura')}</dt><dd class="mono">{result.message_bits}</dd></div>{/if}</dl>
          <p class="p-sub">{tr('Brak wykrycia nie przesądza o pochodzeniu nagrania, a zgodna sygnatura nie potwierdza właściciela głosu ani praw do nagrania.')}</p>
        </div>
      {/if}
    </div>
    {:else if loading}<p class="p-sub" role="status">{tr('Odczytywanie…')}</p>{/if}

  {:else}
    {#if usage}
      <p class="p-sub pv-lead"><ShieldCheck size={14}/>{tr('Liczniki pochodzą z prywatnej bazy silnika. Ich odczyt nie wysyła niczego do internetu.')}{#if usage.first_at}{' '}{tr('Dane od {date}.', { date: new Date(usage.first_at * 1000).toLocaleDateString(tr.locale, { day: 'numeric', month: 'long', year: 'numeric' }) })}{/if}</p>
      <div class="pv-tiles">
        {#each stats as [label, value] (label)}<div class="pv-tile" role="group" aria-label={tr(label)}><span>{tr(label)}</span><b>{value}</b></div>{/each}
      </div>
      {#if usage.takes === 0}<p class="p-sub">{tr('W prywatnej historii silnika nie ma jeszcze nagrań. Nagrania zapisane tylko w lokalnych projektach przeglądarki nie są liczone w tej bazie.')}</p>{/if}
      {#if usage.by_mode?.length || usage.by_language?.length}
        <div class="pv-cols">{#if usage.by_mode?.length}{@render bars('Tryby', usage.by_mode)}{/if}{#if usage.by_language?.length}{@render bars('Języki', usage.by_language)}{/if}</div>
      {/if}
    {:else if loading}<p class="p-sub" role="status">{tr('Odczytywanie…')}</p>{/if}
  {/if}
  </div>
  {/if}
</div>

<style>
  .pv-panel{display:flex;flex-direction:column;gap:18px;padding:22px}
  .pv-inline,.pv-pick{display:flex;align-items:center;gap:10px}
  .saved{color:var(--success);font-size:var(--ui-text-12)}
  .pv-file{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--ui-text-12);color:var(--muted)}
  .mono{font-family:var(--font-mono,monospace);font-size:var(--ui-text-11)}
  .pv-result{display:flex;flex-direction:column;gap:8px;padding:14px;border:1px solid var(--border);border-radius:8px;background:var(--surface-raised)}
  .pv-result-h{display:flex}
  .pv-lead{display:flex;align-items:center;gap:8px;margin:0}
  .pv-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
  .pv-tile{display:flex;flex-direction:column;gap:6px;padding:16px;border:1px solid var(--border);border-radius:10px;background:var(--surface-raised);min-width:0}
  .pv-tile span{font-size:var(--ui-text-12);color:var(--muted);font-weight:500}
  .pv-tile b{font-size:var(--ui-text-25);font-weight:600;letter-spacing:-.6px;line-height:1.15;font-variant-numeric:tabular-nums}
  .pv-cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 36px;padding-top:6px}
  .pv-list{display:flex;flex-direction:column;gap:12px;min-width:0}
  .pv-bar{display:flex;flex-direction:column;gap:6px}
  .pv-bar-h{display:flex;justify-content:space-between;gap:12px;font-size:var(--ui-text-12)}
  .pv-bar-h b{font-weight:550;font-variant-numeric:tabular-nums}
  .privacy-page :global(.spin){animation:pv-rot .8s linear infinite}@keyframes pv-rot{to{transform:rotate(360deg)}}
  @media(prefers-reduced-motion:reduce){.privacy-page :global(.spin){animation:none}}
  .privacy-page :global(.vs-button svg.spin){color:var(--accent)}
  @media(max-width:800px){.pv-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.pv-cols{grid-template-columns:1fr}}
  @media(max-width:600px){.pv-panel{padding:16px}}
</style>
