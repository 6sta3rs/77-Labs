<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { RefreshCw, Save, Copy, ShieldCheck, Settings2 } from '@lucide/svelte'
  import Button from './ui/Button.svelte'
  import Input from './ui/Input.svelte'
  import Textarea from './ui/Textarea.svelte'
  import Select from './ui/Select.svelte'
  import Switch from './ui/Switch.svelte'
  import RuntimeDiagnostics from './RuntimeDiagnostics.svelte'
  import { isDesktop } from './runtime'
  import { productionJson, postJson } from './production'
  import { redactDiagnosticText, type PerformanceState, type WatermarkState } from './runtime-diagnostics'
  import {
    durationLabel, gpuEngineLabels, gpuOptionLabels, gpuStateLabels, hfMirrorAddress, preflightCheckLabels, putSettings, settingsError, settingsPort, settingsTimeout, sharingLinks, systemSectionTitles,
    type AnalyticsState, type CredentialState, type CudaState, type MediaState, type NetworkState, type PreflightReport,
    type GpuReport, type HfMirrorState, type ProxyState, type SystemInfo, type SystemSection, type TailscaleState, type UsageState,
  } from './system-settings'

  let { section, ready, onrestart, onnavigate }: { section: SystemSection; ready: boolean; onrestart?: () => Promise<void>; onnavigate?: (section: string) => void } = $props()
  const uid = $props.id()
  let loading = $state(false), busy = $state(''), error = $state(''), message = $state('')
  let loaded = $state(false), disposed = false
  let reader: AbortController | undefined, writer: AbortController | undefined
  let credentials = $state<CredentialState>(), token = $state(''), credential = $state(''), credentialValue = $state('')
  let proxy = $state<ProxyState>(), proxyInput = $state('')
  let hfMirror = $state<HfMirrorState>(), hfMirrorMode = $state('manual'), hfMirrorUrl = $state('')
  let info = $state<SystemInfo>(), network = $state<NetworkState>(), tailscale = $state<TailscaleState>()
  let sharePort = $state(''), confirmShare = $state(false), tailscaleUrl = $state('')
  let cuda = $state<CudaState>(), cudaValue = $state('auto'), offload = $state<{ enabled: boolean; env_pinned: boolean; device: string }>()
  let gpuTimeout = $state(''), cpuTimeout = $state('')
  let performance = $state<PerformanceState>(), globalTier = $state('balanced'), gpuReport = $state<GpuReport>()
  let usage = $state<UsageState>(), preflight = $state<PreflightReport>()
  let analytics = $state<AnalyticsState>(), watermark = $state<WatermarkState>()
  let media = $state<MediaState>(), logLines = $state<string[]>([]), logFilter = $state(''), logExists = $state(false), confirmClear = $state(false)
  let permission = $state('unknown'), permissionChecked = $state(false)
  const locked = $derived(loading || !!busy)
  const available = $derived(ready && loaded && !locked)
  const title = $derived(systemSectionTitles[section])
  const visibleLogs = $derived(logLines.filter(line => line.toLocaleLowerCase('pl').includes(logFilter.toLocaleLowerCase('pl'))))
  const selectedCredential = $derived(credentials?.fields.find(field => field.key === credential))
  const mediaWorking = $derived(Object.values(media?.ops || {}).some(operation => operation.state === 'running'))

  async function read<T>(path: string, signal: AbortSignal, apply: (value: T) => void) {
    const result = await productionJson<T>(path, { signal })
    signal.throwIfAborted()
    if (!disposed) apply(result)
  }
  async function load(signal: AbortSignal) {
    const tasks: Promise<unknown>[] = []
    const getInfo = () => read<SystemInfo>('/system/info', signal, next => { info = next; gpuTimeout = String(next.generate_timeout_s); cpuTimeout = String(next.cpu_generate_timeout_s); sharePort = String(next.share_port_base) })
    if (section === 'network') tasks.push(read<ProxyState>('/next/settings/proxy', signal, next => proxy = next), read<HfMirrorState>('/api/settings/hf-mirror', signal, next => { hfMirror = next; hfMirrorMode = next.mode; hfMirrorUrl = next.configured }))
    if (section === 'credentials') tasks.push(read<CredentialState>('/next/settings/credentials', signal, next => { credentials = next; if (!credential) credential = next.fields[0]?.key || '' }))
    if (section === 'sharing') tasks.push(getInfo(), read<NetworkState>('/system/network/state', signal, next => network = next), read<TailscaleState>('/system/tailscale/status', signal, next => tailscale = next))
    if (section === 'compute') tasks.push(getInfo(), read<CudaState>('/api/settings/cuda-device', signal, next => { cuda = next; cudaValue = next.value }), read<typeof offload>('/api/settings/perf/offload-after-generation', signal, next => offload = next), read<PerformanceState>('/api/settings/performance-profile', signal, next => { performance = next; globalTier = next.global }))
    if (section === 'usage') tasks.push(read<UsageState>('/stats/usage', signal, next => usage = next))
    if (section === 'privacy') tasks.push(getInfo(), read<AnalyticsState>('/api/settings/analytics', signal, next => analytics = next), read<WatermarkState>('/watermark/status', signal, next => watermark = next))
    if (section === 'audio-tools') tasks.push(read<MediaState>('/media-tools/status', signal, next => media = next))
    if (section === 'logs') tasks.push(read<{ lines: string[]; exists: boolean }>('/system/logs?tail=1000', signal, next => { logLines = (next.lines || []).map(line => redactDiagnosticText(line)); logExists = next.exists }))
    const results = await Promise.allSettled(tasks)
    signal.throwIfAborted()
    const failures = results.filter(result => result.status === 'rejected').map(result => settingsError((result as PromiseRejectedResult).reason))
    if (failures.length) error = failures.join('\n')
    loaded = results.some(result => result.status === 'fulfilled') || tasks.length === 0
  }
  async function refresh() {
    if (!ready || locked || disposed) return
    reader?.abort(); const controller = new AbortController(); reader = controller
    loading = true; error = ''; message = ''
    try { await load(controller.signal) }
    catch (cause) { if (!controller.signal.aborted) error = settingsError(cause) }
    finally { if (reader === controller && !disposed) loading = false }
  }
  async function work(label: string, run: (signal: AbortSignal) => Promise<void>) {
    if (!ready || locked || disposed) return
    const controller = new AbortController(); writer = controller; busy = label; error = ''; message = ''
    try { await run(controller.signal) }
    catch (cause) { if (!controller.signal.aborted) error = settingsError(cause) }
    finally { if (writer === controller && !disposed) busy = '' }
  }
  async function copy(value: string) { try { await navigator.clipboard.writeText(value); message = 'Skopiowano do schowka.' } catch { error = 'Nie udało się skopiować. Zaznacz tekst i skopiuj ręcznie.' } }
  function saveToken() { const value = token.trim(); token = ''; void work('Zapisywanie tokenu', async signal => { const next = await putSettings<NonNullable<typeof credentials>['hf']>('/next/settings/hf-token', { token: value }, signal); if (credentials) credentials = { ...credentials, hf: next }; message = 'Zapisano szyfrowany token wyłącznie w prywatnej bazie tej aplikacji.' }) }
  function clearToken() { if (!confirm('Usunąć prywatny token Hugging Face z tej aplikacji?')) return; void work('Usuwanie tokenu', async signal => { const next = await productionJson<NonNullable<typeof credentials>['hf']>('/next/settings/hf-token', { method: 'DELETE', signal }); if (credentials) credentials = { ...credentials, hf: next }; message = 'Usunięto prywatny token.' }) }
  function testToken() { void work('Test Hugging Face', async signal => { const next = await productionJson<NonNullable<typeof credentials>['hf']>('/next/settings/hf-token/test', { method: 'POST', signal }); if (credentials) credentials = { ...credentials, hf: next }; message = `Hugging Face potwierdziło token${next.user ? ` konta ${next.user}` : ''}.` }) }
  function saveCredential(clear = false) { const key = credential, value = clear ? '' : credentialValue.trim(); credentialValue = ''; void work('Zapis poświadczenia', async signal => { credentials = await putSettings<CredentialState>('/next/settings/credential', { key, value }, signal); message = clear ? 'Usunięto zapisane poświadczenie.' : 'Zapisano poświadczenie. Test połączenia wykonasz w ustawieniach tłumaczenia.' }) }
  function saveProxy(clear = false) { const url = clear ? '' : proxyInput.trim(); proxyInput = ''; void work('Zapis proxy', async signal => { proxy = await putSettings<ProxyState>('/next/settings/proxy', { url }, signal); message = 'Zapisano ustawienie proxy HTTP/HTTPS. Biblioteki, które odczytują proxy przy starcie, wymagają restartu silnika.' }) }
  function saveHfMirror(clear = false) {
    const mode = clear ? 'manual' : hfMirrorMode, draftUrl = clear || mode === 'auto' ? '' : hfMirrorUrl
    void work('Zapis źródła modeli', async signal => {
      const url = hfMirrorAddress(draftUrl)
      hfMirror = await putSettings<HfMirrorState>('/api/settings/hf-mirror', { url, mode }, signal)
      hfMirrorMode = hfMirror.mode; hfMirrorUrl = hfMirror.configured
      message = hfMirror.auto_opt_out && mode === 'auto' ? 'Zapisano preferencję, ale konfiguracja uruchomienia blokuje automatyczny wybór.' : hfMirror.mode === 'auto' ? 'Zapisano automatyczny wybór. Wyniki próby połączenia znajdują się poniżej.' : 'Zapisano ręczne źródło modeli. Zapis nie sprawdza dostępności serwera.'
    })
  }
  function testHfMirror() { void work('Test źródeł modeli', async signal => {
    hfMirror = await productionJson<HfMirrorState>('/api/settings/hf-mirror/test', { method: 'POST', signal })
    message = hfMirror.mode !== 'auto' ? 'W zapisanym trybie ręcznym ten test nie wykonuje połączenia ani nie zmienia adresu. Dostępność sprawdzisz w kontroli systemu.' : !hfMirror.auto ? 'Silnik nie zwrócił wyniku próby połączenia.' : hfMirror.auto.reachable ? 'Próba połączenia potwierdziła osiągalność przynajmniej jednego źródła. Nie pobierano modelu.' : 'Żadne z badanych źródeł nie odpowiedziało. Szczegóły znajdują się poniżej.'
  }) }
  function setSharing(enable: boolean) { void work(enable ? 'Włączanie sieci LAN' : 'Zatrzymywanie udostępniania', async signal => { await productionJson(`/system/network/${enable ? 'enable' : 'disable'}`, { method: 'POST', signal }); network = await productionJson<NetworkState>('/system/network/state', { signal }); confirmShare = false; if (network.enabled !== enable) throw new Error('Silnik nie potwierdził żądanego stanu udostępniania.'); message = enable ? 'Uruchomiono osobny serwer API w sieci LAN. Poniżej znajdują się rzeczywiste adresy i PIN.' : 'Silnik potwierdził wyłączenie udostępniania LAN.' }) }
  function savePort() { void work('Zapis portu', async signal => { const port = settingsPort(sharePort); await productionJson('/system/set-env', postJson({ key: 'OMNIVOICE_SHARE_PORT', value: String(port) }, signal)); info = await productionJson<SystemInfo>('/system/info', { signal }); sharePort = String(info.share_port_base); message = 'Zapisano bazowy port następnego udostępnienia.' }) }
  function setTailscale(enable: boolean) { void work('Tailscale', async signal => { const next = await productionJson<{ ok: boolean; url?: string; note?: string; error?: string }>(`/system/tailscale/${enable ? 'enable' : 'disable'}`, { method: 'POST', signal }); if (!next.ok) throw new Error(next.error || 'Tailscale nie potwierdziło zmiany.'); tailscaleUrl = next.url || ''; tailscale = await productionJson<TailscaleState>('/system/tailscale/status', { signal }); message = next.note || (enable ? 'Tailscale potwierdziło utworzenie przekierowania.' : 'Tailscale potwierdziło wyłączenie przekierowania.') }) }
  function saveCuda() { void work('Zapis karty GPU', async signal => { cuda = await putSettings<CudaState>('/api/settings/cuda-device', { value: cudaValue }, signal); message = cuda.restart_required ? 'Zapisano kartę GPU. Uruchom ponownie prywatny silnik.' : 'Zapisano wybór karty GPU.' }) }
  function saveBudget(cpu: boolean) { void work('Zapis limitu czasu', async signal => { const value = settingsTimeout(cpu ? cpuTimeout : gpuTimeout); const next = await productionJson<{ shadowed?: boolean }>('/system/set-env', postJson({ key: cpu ? 'OMNIVOICE_CPU_GENERATE_TIMEOUT_S' : 'OMNIVOICE_GENERATE_TIMEOUT_S', value: String(value) }, signal)); message = next.shadowed ? 'Zapisano, ale zewnętrzna konfiguracja procesu ma pierwszeństwo.' : 'Zapisano limit. Zostanie zastosowany po ponownym uruchomieniu silnika.' }) }
  function saveOffload(enabled: boolean) { void work('Zapis pamięci modelu', async signal => { offload = await putSettings<typeof offload>('/api/settings/perf/offload-after-generation', { enabled }, signal); message = 'Zapisano przenoszenie modelu do RAM po generowaniu. Dotyczy kolejnych generacji obsługujących tę opcję.' }) }
  function saveGlobalTier() { void work('Zapis globalnej wydajności', async signal => { performance = await putSettings<PerformanceState>('/api/settings/performance-profile', { tier: globalTier, family: null }, signal); globalTier = performance.global; message = 'Zapisano globalny preset i odczytano stan. Możliwe zmiany modeli dotyczą wyłącznie już zainstalowanych składników.' }) }
  function checkGpu() { void work('Sprawdzanie przydziału GPU', async signal => { gpuReport = await productionJson<GpuReport>('/api/settings/gpu-report', { signal }); message = 'Odczytano deklarowany przydział GPU dla silników. Nie wykonywano inferencji.' }) }
  function flushMemory(unload: boolean) { if (unload && !confirm('Zwolnić wszystkie modele, które nie są używane przez aktywne zadania? Następne użycie wymaga ponownego wczytania.')) return; void work('Zwalnianie pamięci', async signal => { const next = await productionJson<{ flushed: boolean; unloaded_model: boolean; ram_after: number; vram_after: number; vram_reserved: number }>(`/system/flush-memory?unload_model=${unload}`, { method: 'POST', signal }); if (!next.flushed) throw new Error('Silnik nie potwierdził czyszczenia pamięci.'); message = `Pamięć po operacji: RAM systemu ${next.ram_after} GiB, aktywne tensory GPU ${next.vram_after} GiB, rezerwacja GPU ${next.vram_reserved} GiB.${unload ? next.unloaded_model ? ' Zwolniono co najmniej jeden model.' : 'Nie potwierdzono zwolnienia modelu; modele mogą być zajęte lub niezaładowane.' : ''}` }) }
  function saveAnalytics(enabled: boolean) { void work('Zapis prywatności', async signal => { analytics = await putSettings<AnalyticsState>('/api/settings/analytics', { enabled }, signal); message = analytics.enabled ? 'Włączono dobrowolną analitykę produktu upstream.' : 'Analityka produktu jest wyłączona.' }) }
  function saveWatermark(enabled: boolean) { void work('Zapis znaku wodnego', async signal => { await productionJson(`/watermark/settings?invisible=${enabled}`, { method: 'POST', signal }); watermark = await productionJson<WatermarkState>('/watermark/status', { signal }); if (watermark.invisible_enabled !== enabled) throw new Error('Środowisko procesu nadpisuje zapisany stan znaku wodnego.'); message = 'Potwierdzono ustawienie niewidocznego znaku wodnego w nowych generacjach.' }) }
  function runPreflight() { void work('Kontrola systemu', async signal => { preflight = await productionJson<PreflightReport>('/setup/preflight', { signal }); message = 'Zakończono kontrolę środowiska. Nie wykonywano syntezy ani renderu.' }) }
  function mediaAction(path: string) { void work('Narzędzia audio', async signal => { await productionJson(`/media-tools/${path}`, { method: 'POST', signal }); media = await productionJson<MediaState>('/media-tools/status', { signal }); message = Object.values(media.ops || {}).some(operation => operation.state === 'running') ? 'Operacja rozpoczęta. Stan i postęp poniżej pochodzą z silnika.' : 'Odczytano stan narzędzi po wykonaniu operacji.' }) }
  function chooseMedia(tool: string) { void work('Wybór narzędzia', async signal => { const result = await invoke<unknown>('settings_choose_media_tool', { tool }); signal.throwIfAborted(); if (result === null) return; media = await productionJson<MediaState>('/media-tools/status', { signal }); message = 'Wybrano i sprawdzono narzędzie w natywnym oknie.' }) }
  function clearLogs() { void work('Czyszczenie logu', async signal => { await productionJson('/system/logs/clear', { method: 'POST', signal }); const next = await productionJson<{ lines: string[]; exists: boolean }>('/system/logs?tail=1000', { signal }); logLines = (next.lines || []).map(line => redactDiagnosticText(line)); confirmClear = false; message = 'Wyczyszczono logi silnika. Nowe wpisy mogą pojawić się od razu.' }) }
  async function checkPermission() {
    error = ''; permissionChecked = true
    try { permission = (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state }
    catch { permission = 'unknown' }
  }
  async function testMicrophone() {
    if (busy) return
    busy = 'Test mikrofonu'; error = ''; message = ''
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach(track => track.stop()); permission = 'granted'; permissionChecked = true; message = 'Uzyskano dostęp do mikrofonu i od razu zamknięto strumień. Nie zapisano nagrania.' }
    catch (cause) { permission = (cause as Error).name === 'NotAllowedError' ? 'denied' : 'unknown'; error = `Nie uzyskano dostępu do mikrofonu. ${settingsError(cause)}` }
    finally { busy = '' }
  }
  async function openMicrophoneSettings() { try { await invoke('settings_open_microphone'); message = 'Otwarto ustawienia mikrofonu Windows.' } catch (cause) { error = settingsError(cause) } }
  function downloadLogs() { const blob = new Blob([visibleLogs.join('\n')], { type: 'text/plain;charset=utf-8' }), url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = 'seventy-seven-labs-log.txt'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000) }
  $effect(() => {
    // Every section has its own read lifetime. A late response from a previous
    // section must not replace current drafts or report a stale success.
    const currentSection = section, canRead = ready
    loaded = false; error = ''; message = ''; confirmShare = false; confirmClear = false
    token = ''; credentialValue = ''; proxyInput = ''
    if (currentSection === 'permissions') untrack(() => { void checkPermission() })
    if (!canRead) return
    const controller = new AbortController(); reader = controller; loading = true
    untrack(() => { void load(controller.signal).catch(cause => { if (!controller.signal.aborted) error = settingsError(cause) }).finally(() => { if (reader === controller) loading = false }) })
    return () => { controller.abort(); writer?.abort(); loading = false; busy = '' }
  })
  $effect(() => {
    const currentMedia = media
    if (section !== 'audio-tools' || !ready || !currentMedia || !mediaWorking || locked) return
    const controller = new AbortController()
    const timer = setTimeout(() => { void read<MediaState>('/media-tools/status', controller.signal, next => media = next).catch(cause => { if (!controller.signal.aborted) error = settingsError(cause) }) }, 1500)
    return () => { clearTimeout(timer); controller.abort() }
  })
  onDestroy(() => { disposed = true; reader?.abort(); writer?.abort() })
</script>

<div class="system-settings">
  <header><Settings2 size={23}/><div><h1>{title}</h1><p>Ustawienia prywatnego silnika Seventy Seven Labs.</p></div></header>
  {#if !ready && !['permissions', 'remote-workers'].includes(section)}<p class="notice" role="status">Uruchom prywatny silnik w „Modele i silnik”, aby odczytać i zmienić te ustawienia.</p>{/if}
  {#if !['permissions', 'remote-workers', 'preflight'].includes(section)}<Button variant="outline" disabled={!ready || locked} onclick={refresh}><RefreshCw size={14}/>{loading ? 'Odczytywanie…' : 'Odśwież stan'}</Button>{/if}

  {#if section === 'network'}
    <section><h2>Serwer proxy HTTP i HTTPS</h2><p>Połączenia pobierania i zewnętrznych dostawców mogą korzystać z własnego proxy. Synteza na lokalnych modelach pozostaje lokalna.</p>
      {#if proxy}<p>Bieżący proxy: <code>{proxy.set ? proxy.address : 'Nie ustawiono'}</code>{proxy.has_credentials ? ' · zawiera ukryte dane logowania' : ''}.</p>{/if}
      <label for={`${uid}-proxy`}>Nowy adres proxy</label><Input id={`${uid}-proxy`} type="password" bind:value={proxyInput} autocomplete="new-password" placeholder="http://127.0.0.1:8080" disabled={!available}/>
      <div class="actions"><Button disabled={!available || !proxyInput.trim()} onclick={() => saveProxy()}><Save size={14}/>Zapisz proxy</Button><Button variant="ghost" disabled={!available || !proxy?.set} onclick={() => saveProxy(true)}>Wyczyść proxy</Button></div>
      <p>Adres i hasło są przechowywane w szyfrowanej prywatnej bazie. Zapis obejmuje proxy HTTP, HTTPS i ALL_PROXY, także warianty nazw małymi literami. Nie wykonuje testowego połączenia.</p>
    </section>
    <section><h2>Źródło modeli Hugging Face</h2><p>Wybierz oficjalne repozytorium, własny mirror lub automatyczny wybór pomiędzy huggingface.co i hf-mirror.com. Sam odczyt tych ustawień nie wykonuje połączenia.</p>
      {#if hfMirror}<p>Zapisany tryb: {hfMirror.mode === 'auto' ? 'automatyczny' : 'ręczny'}. Ręczny adres: <code>{hfMirror.configured || 'oficjalne Hugging Face'}</code>.</p><p>HF_ENDPOINT w bieżącym procesie: <code>{hfMirror.effective || 'bez ręcznego przypięcia'}</code>.</p>{/if}
      <Select label="Wybór źródła modeli" value={hfMirrorMode} onchange={value => { hfMirrorMode = value; message = '' }} options={[{ value: 'manual', label: 'Ręczny wybór źródła' }, { value: 'auto', label: 'Automatyczny wybór i test połączenia', disabled: hfMirror?.auto_opt_out }]} disabled={!available || !hfMirror}/>
      <label for={`${uid}-hf-mirror`}>Ręczny adres mirroru</label><Input id={`${uid}-hf-mirror`} type="url" bind:value={hfMirrorUrl} placeholder="https://huggingface.co" autocomplete="off" spellcheck={false} disabled={!available || !hfMirror || hfMirrorMode === 'auto'}/>
      <p>Puste pole w trybie ręcznym oznacza oficjalne Hugging Face. Dozwolone HTTPS oraz HTTP do localhost; adres bez loginu, hasła, parametrów i fragmentu.</p>
      <div class="actions">{#each hfMirror?.presets || [] as preset (preset.url)}<Button variant="ghost" disabled={!available} onclick={() => { hfMirrorMode = 'manual'; hfMirrorUrl = preset.url; message = '' }}>{preset.url || 'Oficjalne Hugging Face'}</Button>{/each}</div>
      <div class="actions"><Button disabled={!available || !hfMirror} onclick={() => saveHfMirror()}><Save size={14}/>{hfMirrorMode === 'auto' ? 'Zapisz i sprawdź wybór automatyczny' : 'Zapisz źródło modeli'}</Button><Button variant="ghost" disabled={!available || !hfMirror} onclick={() => saveHfMirror(true)}>Przywróć oficjalne źródło</Button><Button variant="outline" disabled={!available || !hfMirror || hfMirror.mode !== 'auto' || hfMirrorMode !== 'auto' || hfMirror.auto_opt_out} onclick={testHfMirror}>Ponów test automatycznego wyboru</Button></div>
      <p>Automatyczny wybór i jego test wykonują połączenia z dwoma wskazanymi serwerami; mogą pobrać małą próbkę do porównania szybkości. Token HF pozostaje przeznaczony wyłącznie dla oficjalnych hostów Hugging Face. Mirror może nie udostępniać modeli wymagających tokenu.</p>
      {#if hfMirror?.auto_opt_out}<p>Automatyczny wybór jest zablokowany przez konfigurację uruchomienia silnika.</p>{/if}
      {#if hfMirror?.restart_required}<p role="status">Zmiana źródła jest zapisana. Biblioteki, które odczytują adres przy uruchomieniu, wymagają restartu prywatnego silnika.</p>{/if}
      {#if hfMirror?.auto}<p>Ostatni automatyczny wybór: <code>{hfMirror.auto.endpoint}</code> · {hfMirror.auto.reachable ? 'osiągalny' : 'brak połączenia'}{hfMirror.auto.latency_ms != null ? ` · ${hfMirror.auto.latency_ms} ms` : ''}. Pomiar: {new Date(hfMirror.auto.checked_at * 1000).toLocaleString('pl-PL')}.</p><dl>{#each hfMirror.auto.results as result (result.endpoint)}<dt>{result.endpoint}</dt><dd>{result.reachable ? 'Osiągalny' : ({ timeout: 'Przekroczono czas', dns: 'Błąd DNS', tls: 'Błąd TLS', refused: 'Odmowa połączenia', unreachable: 'Nieosiągalny' } as Record<string, string>)[result.error || ''] || 'Brak połączenia'}{result.latency_ms != null ? ` · ${result.latency_ms} ms` : ''}</dd>{/each}</dl>{/if}
      <Button variant="ghost" onclick={() => onnavigate?.('preflight')}>Otwórz kontrolę połączenia i systemu</Button>
    </section>
    <Button variant="ghost" onclick={() => onnavigate?.('audio-tools')}>Otwórz narzędzia audio</Button>
  {:else if section === 'credentials'}
    <section><h2>Hugging Face</h2><p>Token używany do pobierania modeli wymagających konta. Zapis nie oznacza przyjęcia licencji modelu.</p>
      {#if credentials}<p>Prywatny token aplikacji: {credentials.hf.set ? 'zapisany' : 'nie ustawiono'} <code>{credentials.hf.masked || ''}</code>{credentials.hf.verified ? ` · potwierdzony${credentials.hf.user ? ` (${credentials.hf.user})` : ''}` : ''}.</p>{/if}
      <label for={`${uid}-token`}>Nowy osobisty token HF</label><Input id={`${uid}-token`} type="password" bind:value={token} autocomplete="new-password" spellcheck={false} disabled={!available}/>
      <div class="actions"><Button disabled={!available || !token.trim()} onclick={saveToken}><Save size={14}/>Zapisz token</Button><Button variant="outline" disabled={!available || !credentials?.hf.set} onclick={testToken}>Sprawdź na huggingface.co</Button><Button variant="ghost" disabled={!available || !credentials?.hf.set} onclick={clearToken}>Usuń token aplikacji</Button></div><p>Test kontaktuje się z oficjalnym Hugging Face. Nie zmienia globalnego logowania HF CLI.</p>
    </section>
    <section><h2>Poświadczenia tłumaczenia</h2><Select label="Dostawca i pole" value={credential} onchange={value => { credential = value; credentialValue = ''; message = '' }} options={(credentials?.fields || []).map(field => ({ value: field.key, label: field.label }))} disabled={!available}/>
      {#if selectedCredential}<p>{selectedCredential.set ? 'Pole zapisane' : 'Pole nieustawione'}{selectedCredential.secret ? ` ${selectedCredential.masked || ''}` : selectedCredential.value ? ` · ${selectedCredential.value}` : ''}.</p>{/if}
      <label for={`${uid}-credential`}>Nowa wartość</label><Input id={`${uid}-credential`} type={selectedCredential?.secret ? 'password' : 'text'} bind:value={credentialValue} autocomplete="new-password" spellcheck={false} disabled={!available}/>
      <div class="actions"><Button disabled={!available || !credential || !credentialValue.trim()} onclick={() => saveCredential()}>Zapisz wartość</Button><Button variant="ghost" disabled={!available || !selectedCredential?.set} onclick={() => saveCredential(true)}>Wyczyść wartość</Button></div>
      <p>Klucze API są szyfrowane przez oryginalny magazyn silnika i nigdy nie wracają do formularza. AWS korzysta z wybranego profilu lokalnej konfiguracji AWS.</p>
    </section>
  {:else if section === 'sharing'}
    <section><h2>Dostęp z sieci lokalnej</h2><p>Główny silnik pracuje na 127.0.0.1:4312. Włączenie udostępniania otwiera osobny port we wszystkich interfejsach sieciowych; dostęp konsumencki chroni PIN silnika.</p>
      <p>Stan: {network ? network.enabled ? 'Udostępnianie włączone' : 'Udostępnianie wyłączone' : 'Nieodczytany'}.</p>
      {#if network?.enabled}<Button variant="outline" disabled={!available} onclick={() => setSharing(false)}>Zatrzymaj udostępnianie LAN</Button><p>Port: {network.share_port} · PIN: <code>{network.pin || 'nieodczytany'}</code></p>{#each sharingLinks(network) as link (link)}<div class="address"><code>{link}</code><Button variant="ghost" size="icon" aria-label="Kopiuj adres udostępniania" onclick={() => copy(link)}><Copy size={14}/></Button></div>{/each}
      {:else if confirmShare}<div class="confirmation"><p>Uruchomić dostęp do API silnika z innych urządzeń w tej sieci? Osoby z PIN-em będą mogły korzystać z udostępnionych funkcji i głosów.</p><div class="actions"><Button disabled={!available} onclick={() => setSharing(true)}>Włącz dostęp w sieci LAN</Button><Button variant="ghost" disabled={locked} onclick={() => confirmShare = false}>Anuluj</Button></div></div>
      {:else}<Button disabled={!available || !network} onclick={() => confirmShare = true}>Udostępnij w sieci LAN</Button>{/if}
      <p>Adresy dotyczą API. Własny desktopowy interfejs tej aplikacji nie jest publikowany pod portem LAN.</p>
    </section>
    <section><h2>Port udostępniania</h2><p>Port silnika: {info?.backend_port || 'nieodczytany'}. Zmianę portu LAN zastosujesz przy następnym udostępnieniu.</p><label for={`${uid}-port`}>Bazowy port LAN</label><Input id={`${uid}-port`} type="number" min="1024" max="65535" bind:value={sharePort} disabled={!available || network?.enabled}/><Button variant="outline" disabled={!available || network?.enabled || !sharePort} onclick={savePort}>Zapisz port LAN</Button></section>
    <section><h2>Dostęp przez Tailscale</h2><p>{tailscale ? tailscale.installed ? tailscale.running ? 'Tailscale jest zainstalowane i uruchomione.' : 'Tailscale jest zainstalowane, ale nie działa lub wymaga zalogowania.' : 'Nie wykryto Tailscale.' : 'Stan nieodczytany'}</p><p>Przyciski konfigurują Tailscale Serve dla prywatnego portu silnika. Nie włączają publicznego Tailscale Funnel.</p><div class="actions"><Button variant="outline" disabled={!available || !tailscale?.running} onclick={() => setTailscale(true)}>Włącz Tailscale Serve</Button><Button variant="ghost" disabled={!available || !tailscale?.installed} onclick={() => setTailscale(false)}>Wyłącz Tailscale Serve</Button></div>{#if tailscaleUrl}<div class="address"><code>{tailscaleUrl}</code><Button variant="ghost" onclick={() => copy(tailscaleUrl)}>Kopiuj adres</Button></div>{/if}</section>
    <Button variant="ghost" onclick={() => onnavigate?.('integrations')}>Otwórz API, MCP i przypisania głosów</Button>
  {:else if section === 'compute'}
    <RuntimeDiagnostics {ready} {onrestart}/>
    <section><h2>Globalny preset wydajności</h2><p>Globalny wybór zeruje nadpisania rodzin. Może przełączyć już zainstalowane modele; nie rozpoczyna pobierania.</p><Select label="Globalna szybkość i jakość" value={globalTier} onchange={value => globalTier = value} options={[{ value: 'auto', label: 'Automatycznie według sprzętu' }, ...(performance?.tiers || []).map(value => ({ value, label: ({ fast: 'Szybkość', balanced: 'Zrównoważony', quality: 'Jakość', max: 'Maksymalny' } as Record<string, string>)[value] || value }))]} disabled={!available || !performance}/><Button variant="outline" disabled={!available || !performance} onclick={saveGlobalTier}>Zapisz globalny preset</Button></section>
    <section><h2>Karta NVIDIA i pamięć po generacji</h2><Select label="Fizyczna karta CUDA" value={cudaValue} onchange={value => cudaValue = value} options={[{ value: 'auto', label: 'Automatycznie' }, ...(cuda?.devices || []).map(device => ({ value: device.value, label: `GPU ${device.index} · ${device.name}` }))]} disabled={!available || !cuda || cuda.env_pinned}/><Button variant="outline" disabled={!available || !cuda || cuda.env_pinned || cudaValue === cuda.value} onclick={saveCuda}>Zapisz kartę GPU</Button>{#if cuda?.restart_required}<p role="status">Zmiana karty wymaga ponownego uruchomienia silnika.</p>{/if}{#if cuda?.env_pinned}<p>Karta jest przypięta przez konfigurację uruchomienia.</p>{/if}
      <div class="option"><div><h3>Przenieś model TTS do RAM po generowaniu</h3><p>{offload?.device === 'cpu' ? 'Na CPU model już znajduje się w RAM.' : 'Zwalnia VRAM dla innych aplikacji; następna generacja może rozpocząć się wolniej.'}</p></div><Switch label="Przenieś model do RAM po generowaniu" checked={!!offload?.enabled} onchange={saveOffload} disabled={!available || !offload || offload.env_pinned}/></div>
    </section>
    <section><h2>Limity czasu generowania</h2><label for={`${uid}-gpu-timeout`}>Limit GPU w sekundach</label><Input id={`${uid}-gpu-timeout`} type="number" min="0.001" max="21600" step="any" bind:value={gpuTimeout} disabled={!available || !info}/><Button variant="outline" disabled={!available || !info} onclick={() => saveBudget(false)}>Zapisz limit GPU</Button><label for={`${uid}-cpu-timeout`}>Limit CPU w sekundach</label><Input id={`${uid}-cpu-timeout`} type="number" min="0.001" max="21600" step="any" bind:value={cpuTimeout} disabled={!available || !info}/><Button variant="outline" disabled={!available || !info} onclick={() => saveBudget(true)}>Zapisz limit CPU</Button><p>Wartość większa od 0, najwyżej 21600 s. Zewnętrzne zmienne środowiska mogą mieć pierwszeństwo.</p></section>
    <section><h2>Zarządzanie pamięcią</h2><p>Czyszczenie cache nie usuwa wag z dysku. Modele używane przez aktywne zadania mogą odmówić zwolnienia pamięci.</p><div class="actions"><Button variant="outline" disabled={!available} onclick={() => flushMemory(false)}>Wyczyść pamięć podręczną</Button><Button variant="outline" disabled={!available} onclick={() => flushMemory(true)}>Zwolnij modele i wyczyść cache</Button></div></section>
    <section><h2>Zgodność akceleracji GPU</h2><Button variant="outline" disabled={!available} onclick={checkGpu}>Sprawdź przydział GPU dla silników</Button>{#if gpuReport}<p>{gpuStateLabels[gpuReport.state] || 'Silnik zwrócił nierozpoznany stan akceleracji'}. PyTorch: {gpuReport.torch.version || gpuReport.torch.kind}.</p>{#each gpuReport.gpus as gpu (`${gpu.vendor}:${gpu.name}`)}<p>{gpu.name}{gpu.vram_gb ? ` · ${gpu.vram_gb} GB` : ''}</p>{/each}{#each gpuReport.options as option (option)}{#if gpuOptionLabels[option]}<p>{gpuOptionLabels[option]}</p>{/if}{/each}<details><summary>Przydział poszczególnych silników</summary><dl>{#each gpuReport.engines as engine (`${engine.kind}:${engine.id}`)}<dt>{engine.name}</dt><dd>{gpuEngineLabels[engine.code] || 'Stan nieustalony'}{engine.params?.device ? ` · ${engine.params.device}` : ''}</dd>{/each}</dl></details>{/if}</section>
  {:else if section === 'usage'}
    <section><h2>Lokalne statystyki</h2><p><ShieldCheck size={14}/>Liczniki pochodzą z prywatnej bazy silnika. Ich odczyt nie wysyła danych ani tekstów do internetu.</p>{#if usage}<div class="stats">{#each [{ label: 'Nagrania', value: usage.takes }, { label: 'Długość audio', value: durationLabel(usage.audio_seconds) }, { label: 'Głosy', value: usage.voices }, { label: 'Aktywne dni', value: usage.active_days }, { label: 'Dubbingi', value: usage.dubs }, { label: 'Ulubione', value: usage.starred }] as stat (stat.label)}<article><strong>{stat.value}</strong><span>{stat.label}</span></article>{/each}</div>{#if usage.first_at}<p>Od {new Date(usage.first_at * 1000).toLocaleDateString('pl-PL')}.</p>{/if}{#if usage.takes === 0}<p>W prywatnej historii silnika nie ma jeszcze nagrań. Nagrania zapisane tylko w lokalnych projektach przeglądarki nie są liczone w tej bazie.</p>{/if}{#each [{ title: 'Tryby', rows: usage.by_mode || [] }, { title: 'Języki', rows: usage.by_language || [] }] as group (group.title)}{#if group.rows.length}<h3>{group.title}</h3><dl>{#each group.rows as row (row.name)}<dt>{row.name}</dt><dd>{row.count}</dd>{/each}</dl>{/if}{/each}{/if}</section>
  {:else if section === 'remote-workers'}
    <section><h2>Zdalne GPU w wersji referencyjnej</h2><p>Przypięty VoiceStudio 0.5.7 (7a6c898) usunął dawny menedżer pracowników i endpointy /workers. Schemat tabel migracyjnych zachowano dla zgodności danych; nie uruchamia on zdalnych pracowników.</p><p>Ta aplikacja wykonuje zadania we własnym lokalnym runtime. Zdalny klient może korzystać z udostępnionego API lub MCP z sekcji poniżej. Połączenie z innym backendem skonfigurujesz w sekcji „Udostępnianie i dostęp zdalny”.</p><div class="actions"><Button variant="outline" onclick={() => onnavigate?.('sharing')}>Udostępnianie i dostęp zdalny</Button><Button variant="ghost" onclick={() => onnavigate?.('integrations')}>Lokalne API i MCP</Button></div></section>
  {:else if section === 'privacy'}
    <section><h2>Przetwarzanie danych</h2><p>Synteza z lokalnym modelem odbywa się na tym komputerze. Wybrany dostawca tłumaczenia: <strong>{info?.translate_provider || 'nieodczytany'}</strong>. Dostawcy zdalni otrzymują tekst używany przez ich funkcję; sprawdź wybór przed tłumaczeniem.</p><div class="option"><div><h3>Niewidoczny znak wodny AudioSeal</h3><p>Dotyczy nowych generacji obsługujących tę funkcję. Dostępność biblioteki: {watermark ? watermark.audioseal_available ? 'wykryto' : 'nie wykryto' : 'nieodczytana'}.</p></div><Switch label="Niewidoczny znak wodny" checked={!!watermark?.invisible_enabled} onchange={saveWatermark} disabled={!available || !watermark}/></div></section>
    <section><h2>Dobrowolna analityka produktu upstream</h2><p>To oddzielna funkcja od lokalnych statystyk użycia. Włączenie wysyła do skonfigurowanej usługi analitycznej dozwolone metadane zdarzeń produktu.</p><div class="option"><span>Zgoda na analitykę produktu</span><Switch label="Zgoda na analitykę produktu" checked={!!analytics?.opted_in} onchange={saveAnalytics} disabled={!available || !analytics?.available}/></div><p>{analytics ? analytics.available ? `Stan efektywny: ${analytics.enabled ? 'włączona' : 'wyłączona'}.` : 'Ta dystrybucja nie ma skonfigurowanego odbiorcy analityki.' : 'Stan analityki nieodczytany.'}</p></section>
    <Button variant="ghost" onclick={() => onnavigate?.('storage')}>Otwórz przechowywanie danych i limit historii</Button>
  {:else if section === 'permissions'}
    <section><h2>Dostęp do mikrofonu</h2><p>Mikrofon służy do dyktowania i nagrywania referencji głosu. Samo otwarcie tego panelu nie uruchamia mikrofonu.</p><p>Stan dla tego okna: {permissionChecked ? ({ granted: 'Dostęp przyznany', denied: 'Dostęp odmówiony', prompt: 'System poprosi o zgodę', unknown: 'Nie można odczytać bez próby dostępu' } as Record<string, string>)[permission] || permission : 'Nieodczytany'}.</p><div class="actions"><Button variant="outline" disabled={!!busy} onclick={checkPermission}>Odśwież uprawnienia</Button><Button disabled={!!busy || !navigator.mediaDevices?.getUserMedia} onclick={testMicrophone}>Sprawdź dostęp do mikrofonu</Button>{#if isDesktop()}<Button variant="ghost" disabled={!!busy} onclick={openMicrophoneSettings}>Otwórz ustawienia mikrofonu Windows</Button>{/if}</div><p>Test otwiera strumień i od razu go zamyka; nie zapisuje audio. Jeżeli inna aplikacja blokuje urządzenie, stan zgody nie dowodzi jego dostępności.</p></section>
    <section><h2>Skróty i wklejanie</h2><p>Dyktowanie korzysta z osobnego skrótu i jawnej akcji wklejenia. Na Windows nie ma uprawnienia macOS „Accessibility”. Zgodę na mikrofon sprawdzasz powyżej.</p><Button variant="ghost" onclick={() => onnavigate?.('shortcuts')}>Otwórz skróty i ustawienia desktopowe</Button></section>
  {:else if section === 'preflight'}
    <section><h2>Kontrola środowiska przed pracą</h2><p>Sprawdź sprzęt, biblioteki, miejsce na dysku i lokalne narzędzia. Kontrola nie dowodzi działania syntezy, dubbingu ani wszystkich modeli.</p><Button variant="outline" disabled={!ready || locked} onclick={runPreflight}>Sprawdź system</Button>{#if preflight}<div class="checks">{#each preflight.checks || [] as check (check.id)}<article><strong>{preflightCheckLabels[check.id] || 'Dodatkowa kontrola'} · {({ pass: 'Poprawnie', ok: 'Poprawnie', warn: 'Uwaga', fail: 'Błąd' } as Record<string, string>)[check.status] || check.status}</strong><p>{check.detail}</p>{#if check.fix}<p>{check.fix}</p>{/if}</article>{/each}</div>{/if}</section>
  {:else if section === 'audio-tools'}
    <section><h2>FFmpeg i FFprobe</h2><p>Wykorzystywane do odczytu, konwersji i eksportu mediów. Zmiany obejmują wyłącznie ustawienia i prywatny katalog narzędzi tej aplikacji.</p>{#each ['ffmpeg', 'ffprobe'] as tool (tool)}{@const current = media?.tools[tool]}<article class="tool"><h3>{tool === 'ffmpeg' ? 'FFmpeg' : 'FFprobe'} · {current ? current.ok ? 'Dostępne' : 'Niedostępne' : 'Nieodczytane'}</h3>{#if current}<p>{current.version || 'Brak wersji'} · {current.origin || 'Brak pochodzenia'}</p><code>{current.path || 'Nie wykryto ścieżki'}</code>{/if}<div class="actions">{#if isDesktop()}<Button variant="outline" disabled={!available || mediaWorking} onclick={() => chooseMedia(tool)}>Wybierz plik EXE</Button>{/if}<Button variant="ghost" disabled={!available || mediaWorking} onclick={() => mediaAction(`${tool}/use-system`)}>Użyj wersji systemowej</Button><Button variant="ghost" disabled={!available || mediaWorking} onclick={() => mediaAction(`${tool}/restore`)}>Przywróć wersję dostarczaną</Button></div></article>{/each}<Button variant="outline" disabled={!available || mediaWorking} onclick={() => mediaAction('acquire')}>Pobierz zweryfikowany pakiet FFmpeg i FFprobe</Button><p>Pobieranie korzysta z przypiętych sum kontrolnych oryginalnego silnika.</p></section>
    <section><h2>yt-dlp</h2><p>Wersja bieżąca: {media?.tools.ytdlp?.version || 'Nieodczytana'}. Wersja nakładki: {media?.tools.ytdlp?.overlay_version || 'Brak'}. Zmiana nakładki wymaga restartu silnika.</p><div class="actions"><Button variant="outline" disabled={!available || mediaWorking} onclick={() => mediaAction('ytdlp/update')}>Pobierz aktualizację yt-dlp</Button><Button variant="ghost" disabled={!available || mediaWorking || !media?.tools.ytdlp?.overlay_version} onclick={() => mediaAction('ytdlp/restore')}>Przywróć przypiętą wersję yt-dlp</Button></div></section>
    {#each Object.entries(media?.ops || {}) as [name, operation] (name)}{#if operation.state && operation.state !== 'idle'}<p role={operation.state === 'error' ? 'alert' : 'status'} class:failure={operation.state === 'error'}>{name === 'acquire' ? 'Pakiet narzędzi' : 'yt-dlp'}: {({ running: 'w toku', done: 'ukończono', error: 'błąd' } as Record<string, string>)[operation.state] || operation.state}{operation.state === 'running' ? ` · ${Math.round((operation.progress || 0) * 100)}%` : ''}{operation.error ? ` · ${redactDiagnosticText(operation.error)}` : ''}</p>{/if}{/each}
  {:else if section === 'logs'}
    <section><h2>Dziennik prywatnego silnika</h2><p>Ostatnie 1000 linii. Znane wzorce kluczy i dane logowania w adresach są ukrywane przed wyświetleniem, kopiowaniem i pobraniem.</p><Input type="search" aria-label="Filtruj linie dziennika" placeholder="Filtruj linie…" bind:value={logFilter}/><div class="actions"><Button variant="outline" disabled={!visibleLogs.length} onclick={() => copy(visibleLogs.join('\n'))}>Kopiuj widoczne</Button><Button variant="ghost" disabled={!visibleLogs.length} onclick={downloadLogs}>Pobierz TXT</Button><Button variant="ghost" disabled={!available || !logExists} onclick={() => confirmClear = true}>Wyczyść logi silnika</Button></div>{#if confirmClear}<div class="confirmation"><p>Wyczyścić pliki dzienników silnika? {logLines.length} linii znajduje się obecnie w odczytanej końcówce. Ta operacja usuwa także starsze wpisy z logów obsługiwanych przez silnik.</p><div class="actions"><Button variant="destructive" disabled={!available} onclick={clearLogs}>Potwierdź wyczyszczenie logów</Button><Button variant="ghost" disabled={locked} onclick={() => confirmClear = false}>Anuluj</Button></div></div>{/if}<Textarea class="logs" aria-label="Dziennik prywatnego silnika" readonly rows={18} value={visibleLogs.length ? visibleLogs.join('\n') : logExists ? 'Brak pasujących linii.' : 'Nie znaleziono jeszcze pliku logu silnika.'}/></section>
  {/if}
  {#if busy}<p class="notice" role="status">{busy}…</p>{/if}
  {#if error}<p class="failure" role="alert">{error}</p>{/if}
  {#if message}<p class="notice" role="status">{message}</p>{/if}
</div>

<style>
  .system-settings{display:flex;flex-direction:column;gap:20px;min-width:0}.system-settings>header{display:flex;gap:14px;align-items:flex-start}.system-settings>header>:global(svg){color:var(--muted);flex-shrink:0}.system-settings h1{font-size:var(--ui-text-22);font-weight:600;letter-spacing:-.4px}.system-settings h2{font-size:var(--ui-text-14);font-weight:600;margin:0}.system-settings h3{font-size:var(--ui-text-12);font-weight:550;margin:0}.system-settings p{font-size:var(--ui-text-12);line-height:1.8;color:var(--muted);margin:5px 0;overflow-wrap:anywhere}.system-settings section{display:flex;flex-direction:column;gap:14px;padding:22px;border:1px solid var(--border);border-radius:10px;background:var(--surface);min-width:0}.system-settings label{font-size:var(--ui-text-12);color:var(--muted)}.system-settings code{font-size:var(--ui-text-11);overflow-wrap:anywhere}.actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.system-settings .notice,.system-settings .failure{padding:12px 14px;border:1px solid var(--border);border-radius:8px;white-space:pre-wrap}.system-settings .failure{color:var(--danger)}.address{display:flex;align-items:center;gap:10px}.address>code{flex:1;min-width:0}.confirmation{border:1px solid var(--border);padding:16px;border-radius:8px;display:flex;flex-direction:column;gap:12px}.option{display:flex;align-items:center;justify-content:space-between;gap:24px}.option>div{flex:1}.option>span{font-size:var(--ui-text-12)}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}.stats article{padding:16px;border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;gap:8px}.stats strong{font-size:var(--ui-text-20);font-weight:550}.stats span{font-size:var(--ui-text-11);color:var(--muted)}.system-settings dl{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;font-size:var(--ui-text-12)}.system-settings dd{margin:0;font-variant-numeric:tabular-nums}.tool,.checks>article{display:flex;flex-direction:column;gap:12px;padding:15px 0;border-bottom:1px solid var(--border)}.system-settings :global(.logs){max-height:500px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:var(--ui-text-11)/1.8 var(--font-mono,monospace);padding:16px;border:1px solid var(--border);border-radius:8px;background:var(--background)}.system-settings>:global([data-slot="button"]),.system-settings section>:global([data-slot="button"]){align-self:flex-start}.system-settings :global(.runtime-diagnostics){margin-top:0}@media(max-width:600px){.system-settings section{padding:16px}.option{gap:12px}.stats{grid-template-columns:1fr 1fr}}
</style>
