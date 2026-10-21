<script lang="ts">
  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import Button from '../ui/Button.svelte';
  import FilePicker from '../ui/FilePicker.svelte';
  import { onDestroy, untrack } from 'svelte'
  import { Plug, ShieldCheck, Copy, RefreshCw, LoaderCircle, Upload, Save, Trash2 } from '@lucide/svelte'
  import Select from '../ui/Select.svelte'
  import Switch from '../ui/Switch.svelte'
  import { request, profiles as loadProfiles, prepareRequest, type Profile } from './api'
  import { productionJson, postJson } from '../tools/production/production'
  import { LOCAL_API_BASE, LOCAL_MCP_URL, bindingPayload, integrationError, mcpClientConfig, parseWatermarkResult, testMcpConnection, watermarkFileError, watermarkSettingsPath, watermarkTitle, type ApiModel, type IntegrationConfig, type IntegrationState, type McpBinding, type SpeechCapabilities, type WatermarkResult, type WatermarkSettings } from './integrations'

  let { ready }: { ready: boolean } = $props()
  const uid = $props.id()
  let integrationState = $state<IntegrationState>(), config = $state<IntegrationConfig>({ mcp_enabled: false, mcp_output_mode: 'files' })
  let capabilities = $state<SpeechCapabilities>(), models = $state<ApiModel[]>([]), voices = $state<Profile[]>([]), bindings = $state<McpBinding[]>([])
  let watermark = $state<WatermarkSettings>(), detection = $state<WatermarkResult>(), file = $state<File>()
  let clientId = $state(''), bindingLabel = $state(''), bindingVoice = $state(''), bindingEngine = $state('')
  let apiTest = $state<{ version: string; models: number; protocol: string; checkedAt: string }>(), mcpTest = $state<Awaited<ReturnType<typeof testMcpConnection>>>()
  let loading = $state(false), busy = $state(''), error = $state(''), message = $state(''), loaded = $state(false)
  let controller: AbortController | undefined, refreshController: AbortController | undefined, disposed = false
  const locked = $derived(!!busy || loading)
  const engines = $derived(models.filter(model => model.voicestudio?.kind === 'tts' && !model.voicestudio?.alias_for_active_engine))
  const clientConfig = $derived.by(() => { try { return mcpClientConfig(clientId) } catch { return mcpClientConfig() } })
  const sourceCommit = $derived(integrationState?.source.commit && /^[a-fA-F0-9]{40}$/.test(integrationState.source.commit) ? integrationState.source.commit : '')
  const mcpStatus = $derived(!integrationState ? 'Stan nieodczytany' : !integrationState.effective.mcp_enabled ? 'Wyłączone w bieżącym procesie' : !integrationState.effective.mounted ? 'Nie udało się zamontować endpointu' : mcpTest ? 'Połączenie protokołu potwierdzone' : 'Endpoint zamontowany · wykonaj test')

  function fail(cause: unknown) { if (!disposed && !(cause instanceof Error && cause.name === 'AbortError')) error = integrationError(cause) }
  async function refresh() {
    if (!ready || locked || disposed) return
    const abort = new AbortController(); refreshController?.abort(); refreshController = abort; loading = true; error = ''; apiTest = undefined; mcpTest = undefined
    try {
      const result = await Promise.allSettled([
        productionJson<IntegrationState>('/next/integrations/settings', { signal: abort.signal }),
        productionJson<SpeechCapabilities>('/v1/audio/capabilities', { signal: abort.signal }),
        productionJson<{ data: ApiModel[] }>('/v1/models', { signal: abort.signal }),
        productionJson<WatermarkSettings>('/watermark/status', { signal: abort.signal }),
        productionJson<McpBinding[]>('/api/mcp/bindings', { signal: abort.signal }), loadProfiles(abort.signal),
      ])
      abort.signal.throwIfAborted(); if (disposed) return
      const failures: string[] = []
      if (result[0].status === 'fulfilled') { integrationState = result[0].value; config = { ...integrationState.settings }; loaded = true } else failures.push('Nie odczytano prywatnych ustawień MCP. Adapter integracji wymaga podłączenia w launcherze.')
      if (result[1].status === 'fulfilled') capabilities = result[1].value; else failures.push('Nie odczytano kontraktu API audio.')
      if (result[2].status === 'fulfilled') models = result[2].value.data; else failures.push('Nie odczytano listy modeli API.')
      if (result[3].status === 'fulfilled') watermark = result[3].value; else failures.push('Nie odczytano ustawień znaku wodnego.')
      if (result[4].status === 'fulfilled') bindings = result[4].value; else failures.push('Nie odczytano przypisań klientów MCP.')
      if (result[5].status === 'fulfilled') voices = result[5].value; else failures.push('Nie odczytano profili głosów.')
      if (failures.length) error = failures.join(' ')
    } catch (cause) { if (!abort.signal.aborted) fail(cause) }
    finally { if (refreshController === abort && !disposed) loading = false }
  }
  async function work(name: string, action: (signal: AbortSignal) => Promise<void>) {
    if (!ready || locked || disposed) return
    const abort = new AbortController(); controller = abort; busy = name; error = ''; message = ''
    try { await action(abort.signal) } catch (cause) { if (!disposed && abort.signal.aborted) message = 'Przerwano oczekiwanie. Silnik może nadal kończyć bieżącą operację.'; else fail(cause) }
    finally { if (controller === abort) { controller = undefined; if (!disposed) busy = '' } }
  }
  async function copy(value: string) { try { await navigator.clipboard.writeText(value); message = 'Skopiowano do schowka.' } catch { error = 'Nie udało się skopiować. Zaznacz widoczny adres lub konfigurację ręcznie.' } }
  function saveMcp() { void work('MCP', async signal => { integrationState = await productionJson<IntegrationState>('/next/integrations/settings', { ...postJson(config, signal), method: 'PUT' }); config = { ...integrationState.settings }; mcpTest = undefined; message = integrationState.restart_required ? 'Zapisano. Uruchom ponownie prywatny silnik w „Modele i silnik”, aby zastosować MCP.' : 'Zapisano prywatne ustawienia MCP.' }) }
  function checkApi() { void work('API', async signal => {
    const [health, contract, catalog] = await Promise.all([productionJson<{ status: string; version?: string }>('/health', { signal }), productionJson<SpeechCapabilities>('/v1/audio/capabilities', { signal }), productionJson<{ data: ApiModel[] }>('/v1/models', { signal })])
    if (health.status !== 'ok' || !Array.isArray(catalog.data) || !contract.protocol) throw new Error('Serwer nie potwierdził wymaganego kontraktu API audio.')
    capabilities = contract; models = catalog.data; apiTest = { version: contract.service_version || health.version || '', models: catalog.data.length, protocol: contract.protocol, checkedAt: new Date().toISOString() }; message = 'Połączenie HTTP potwierdzone. Odczytano kontrakt i listę modeli; nie generowano audio.'
  }) }
  function checkMcp() { void work('Test MCP', async signal => { await prepareRequest('/mcp', signal); mcpTest = await testMcpConnection(request, signal); message = 'MCP odpowiedziało na initialize i tools/list. Nie wywołano narzędzi syntezy ani klonowania.' }) }
  function chooseBinding(row?: McpBinding) { clientId = row?.client_id || ''; bindingLabel = row?.label || ''; bindingVoice = row?.profile_id || ''; bindingEngine = row?.default_engine || '' }
  function saveBinding() { void work('Przypisanie', async signal => { await productionJson('/api/mcp/bindings', { ...postJson(bindingPayload(clientId, bindingLabel, bindingVoice, bindingEngine), signal), method: 'PUT' }); bindings = await productionJson<McpBinding[]>('/api/mcp/bindings', { signal }); message = 'Zapisano przypisanie głosu klienta MCP.' }) }
  function removeBinding(row: McpBinding) {
    if (!confirm(`Usunąć jedno przypisanie MCP „${row.label || row.client_id}”? Profil głosu pozostanie w bibliotece.`)) return
    void work('Usuwanie przypisania', async signal => { await productionJson(`/api/mcp/bindings/${encodeURIComponent(row.client_id)}`, { method: 'DELETE', signal }); bindings = await productionJson<McpBinding[]>('/api/mcp/bindings', { signal }); if (clientId === row.client_id) chooseBinding(); message = 'Usunięto jedno przypisanie klienta.' })
  }
  function saveWatermark() { if (!watermark) return; const desired = { ...watermark }; void work('Znak wodny', async signal => {
    await productionJson(watermarkSettingsPath(desired), { method: 'POST', signal }); watermark = await productionJson<WatermarkSettings>('/watermark/status', { signal })
    message = watermark.invisible_enabled === desired.invisible_enabled && watermark.visible_audio_enabled === desired.visible_audio_enabled && watermark.visible_video_enabled === desired.visible_video_enabled ? 'Zapisano i potwierdzono ustawienia znaku wodnego.' : 'Zapisano preferencje, ale bieżący silnik zwraca inne ustawienia. Sprawdź nadpisanie przez środowisko.'
  }) }
  function chooseFile(next?: File) { if (locked) return; detection = undefined; file = undefined; if (!next) return; const invalid = watermarkFileError(next); if (invalid) error = invalid; else { file = next; error = '' } }
  function detect() { if (!file) return; const selected = file; void work('Detekcja', async signal => { const body = new FormData(); body.append('file', selected); const result = await productionJson<unknown>('/watermark/detect', { method: 'POST', body, signal }); detection = parseWatermarkResult(result); message = 'Zakończono analizę znaku wodnego.' }) }
  $effect(() => { if (ready) untrack(() => { void refresh() }); else { controller?.abort(); refreshController?.abort(); apiTest = undefined; mcpTest = undefined } })
  onDestroy(() => { disposed = true; controller?.abort(); refreshController?.abort() })
</script>

<div class="integration-settings">
  <header><Plug size={24}/><div><h1>{tr("Integracje lokalne i pochodzenie")}</h1><p>{tr("Podłącz aplikacje do własnego silnika i sprawdź znak wodny w nagraniu.")}</p></div></header>
  {#if !ready}<p class="integration-note" role="status">{tr("Uruchom prywatny silnik w „Modele i silnik”, aby odczytać rzeczywiste możliwości integracji.")}</p>{/if}
  <Button variant="outline" disabled={!ready || locked} onclick={refresh}><RefreshCw size={14}/>{loading ? 'Odczytywanie stanu…' : tr("Odśwież stan integracji")}</Button>
  <section aria-label={tr("Lokalne API zgodne z OpenAI")}>
    <div class="integration-heading"><h2>{tr("OpenAI-compatible API")}</h2><span>{apiTest ? tr("Połączenie HTTP potwierdzone") : capabilities ? 'Kontrakt API odczytany' : 'Stan nieodczytany'}</span></div>
    <p>{tr("Lokalne endpointy audio zgodne z formatem OpenAI. Żądania trafiają do tej aplikacji na Twoim komputerze.")}</p>
    <div class="integration-address"><code>{LOCAL_API_BASE}</code><Button variant="ghost" size="icon" aria-label={tr("Skopiuj adres lokalnego API")} onclick={() => copy(LOCAL_API_BASE)}><Copy size={15}/></Button></div>
    <p>{tr("Dla klienta z tego komputera klucz API nie jest wymagany. Panel nie tworzy kluczy ani nie włącza dostępu z sieci.")}</p>
    <Button variant="outline" disabled={!ready || locked} onclick={checkApi}><RefreshCw size={14}/>{tr("Testuj lokalne API")}</Button>
    {#if apiTest}<p class="integration-success" role="status">{tr("HTTP działa ·")} {apiTest.models} {tr("identyfikatorów ·")} {apiTest.protocol} {tr("· silnik")} {apiTest.version}{tr(". Test nie wykonywał syntezy.")}</p>{/if}
    <details><summary>{tr("Adresy i identyfikatory modeli")}</summary><div class="integration-endpoints"><code>{tr("GET /v1/models")}</code><code>{tr("GET /v1/audio/voices")}</code><code>{tr("POST /v1/audio/speech")}</code><code>{tr("POST /v1/audio/transcriptions")}</code><code>{tr("WS /v1/audio/transcriptions/stream")}</code></div><p>{tr("Identyfikatory takie jak")} <code>{tr("tts-1")}</code> {tr("są aliasami lokalnego silnika. Lista API nie potwierdza pobrania wag ani powodzenia syntezy.")}</p><div class="integration-models">{#each models as model}<span>{model.id}{model.voicestudio?.alias_for_active_engine ? ' · alias' : ''}</span>{/each}</div><pre>{tr("curl.exe")} {LOCAL_API_BASE}{tr("/models")}</pre></details>
  </section>
  <section aria-label={tr("Lokalny serwer MCP")}>
    <div class="integration-heading"><h2>{tr("MCP dla lokalnych klientów")}</h2><span>{tr(mcpStatus)}</span></div>
    <p>{tr("MCP udostępnia klientowi narzędzia pracy z głosami i nagraniami. Adres pozostaje ograniczony do tego komputera.")}</p>
    <div class="integration-address"><code>{LOCAL_MCP_URL}</code><Button variant="ghost" size="icon" aria-label={tr("Skopiuj adres lokalnego MCP")} onclick={() => copy(LOCAL_MCP_URL)}><Copy size={15}/></Button></div>
    <div class="integration-option"><div><h3>{tr("Włącz MCP")}</h3><p>{tr("Zmiana jest trwała i zaczyna działać po ponownym uruchomieniu prywatnego silnika.")}</p></div><Switch label={tr("Włącz lokalne MCP")} checked={config.mcp_enabled} onchange={value => { config = { ...config, mcp_enabled: value }; mcpTest = undefined }} disabled={!loaded || locked}/></div>
    <Select label={tr("Audio zwracane klientowi MCP")} value={config.mcp_output_mode} onchange={value => { config = { ...config, mcp_output_mode: value as IntegrationConfig['mcp_output_mode'] }; mcpTest = undefined }} options={[{ value: 'files', label: 'Adres pliku · mniejszy kontekst klienta' }, { value: 'resources', label: tr("Audio jako zasób base64") }, { value: 'both', label: tr("Adres i zasób base64") }]} disabled={!loaded || locked}/>
    <p>{tr("Klient nie dostaje dostępu do dowolnego katalogu na dysku. Włączone MCP utrzymuje prywatny silnik dostępny dla klientów. Ręczne zatrzymanie silnika lub zamknięcie aplikacji kończy połączenie.")}</p>
    <div class="integration-actions"><Button variant="default" disabled={!ready || !loaded || locked} onclick={saveMcp}><Save size={14}/>{tr("Zapisz ustawienia MCP")}</Button><Button variant="outline" disabled={!ready || locked || !integrationState?.effective.mounted} onclick={checkMcp}>{tr("Testuj połączenie MCP")}</Button></div>
    {#if integrationState?.restart_required}<p class="integration-note" role="status">{tr("Wymagany restart w „Modele i silnik”. Bieżący proces zachowuje poprzednie ustawienie.")}</p>{/if}
    {#if integrationState?.configuration_error}<p class="integration-error" role="alert">{tr(integrationState.configuration_error)}</p>{/if}
    {#if mcpTest}<div class="integration-test"><strong>{tr("Połączenie MCP potwierdzone")}</strong><p>{mcpTest.server} {mcpTest.version} {tr("· protokół")} {mcpTest.protocol} · {mcpTest.tools.length} {tr("narzędzi")}</p><div class="integration-models">{#each mcpTest.tools as tool}<span>{tool}</span>{/each}</div></div>{/if}
    <details><summary>{tr("Parametry klienta MCP HTTP")}</summary><p>{tr("Wymagany jest klient obsługujący Streamable HTTP. Poniższy JSON pasuje do klientów z konfiguracją")} <code>{tr("mcpServers/url")}</code>{tr("; w innych wklej sam adres serwera. Id klienta jest opcjonalnym wyborem głosu, a nie hasłem.")}</p><pre>{clientConfig}</pre><Button variant="outline" onclick={() => copy(clientConfig)}><Copy size={14}/>{tr("Kopiuj konfigurację MCP")}</Button></details>
  </section>
  <section aria-label={tr("Przypisania głosów klientów MCP")}>
    <h2>{tr("Głos dla klienta MCP")}</h2><p>{tr("Klient przekazuje nagłówek")} <code>{tr("X-OmniVoice-Client-Id")}</code>{tr(". Jawny profil w wywołaniu narzędzia ma pierwszeństwo przed tym przypisaniem.")}</p>
    <label for={`${uid}-client`}>{tr("Id klienta")}</label><input id={`${uid}-client`} class="text-input" placeholder={tr("moj-klient")} bind:value={clientId} maxlength="128" disabled={locked}/>
    <label for={`${uid}-label`}>{tr("Nazwa w tej aplikacji")}</label><input id={`${uid}-label`} class="text-input" bind:value={bindingLabel} maxlength="160" disabled={locked}/>
    <Select label={tr("Domyślny profil klienta")} value={bindingVoice} onchange={value => bindingVoice = value} options={[{ value: '', label: tr("Bez przypisania · domyślny profil silnika") }, ...voices.map(voice => ({ value: voice.id, label: voice.name }))]} disabled={locked}/>
    <Select label={tr("Silnik klienta")} value={bindingEngine} onchange={value => bindingEngine = value} options={[{ value: '', label: tr("Aktywny silnik studia") }, ...engines.map(engine => ({ value: engine.id, label: engine.id }))]} disabled={locked}/>
    <div class="integration-actions"><Button variant="outline" disabled={!ready || locked || !clientId.trim()} onclick={saveBinding}><Save size={14}/>{tr("Zapisz przypisanie")}</Button><Button variant="ghost" disabled={locked} onclick={() => chooseBinding()}>{tr("Nowe przypisanie")}</Button></div>
    <div class="integration-bindings">{#each bindings as row}<article><div><strong>{row.label || row.client_id}</strong><small>{row.client_id} · {voices.find(voice => voice.id === row.profile_id)?.name || row.profile_id || tr("profil domyślny")}{row.default_engine ? ` · ${row.default_engine}` : ''}</small></div><Button variant="ghost" disabled={locked} onclick={() => chooseBinding(row)}>{tr("Edytuj")}</Button><Button variant="ghost" size="icon" aria-label={tr("Usuń przypisanie {arg0}", { arg0: String(row.client_id) })} disabled={!ready || locked} onclick={() => removeBinding(row)}><Trash2 size={14}/></Button></article>{/each}</div>
    {#if !bindings.length}<p>{tr("Brak zapisanych przypisań. Nie jest to przeszkodą w połączeniu MCP.")}</p>{/if}
  </section>
  <section aria-label={tr("Znak wodny i pochodzenie audio")}>
    <div class="integration-heading"><h2>{tr("Znak wodny i pochodzenie")}</h2><ShieldCheck size={19}/></div>
    {#if watermark}<p>{tr("Biblioteka AudioSeal:")} {watermark.audioseal_available ? tr("dostępna") : tr("niedostępna")}{tr(". Nie oznacza to jeszcze załadowanego detektora.")}</p>
      <div class="integration-option"><span>{tr("Niewidoczny znak w nowych generacjach")}</span><Switch label={tr("Niewidoczny znak wodny")} checked={watermark.invisible_enabled} onchange={value => watermark = watermark ? { ...watermark, invisible_enabled: value } : watermark} disabled={locked}/></div>
      <div class="integration-option"><span>{tr("Sygnał dźwiękowy w eksportach")}</span><Switch label={tr("Słyszalny znak eksportu audio")} checked={watermark.visible_audio_enabled} onchange={value => watermark = watermark ? { ...watermark, visible_audio_enabled: value } : watermark} disabled={locked}/></div>
      <div class="integration-option"><span>{tr("Widoczny znak w eksporcie wideo")}</span><Switch label={tr("Widoczny znak eksportu wideo")} checked={watermark.visible_video_enabled} onchange={value => watermark = watermark ? { ...watermark, visible_video_enabled: value } : watermark} disabled={locked}/></div>
      <p>{tr("Preferencje dotyczą nowych wyników i obsługujących je eksportów. Nie zmieniają wcześniej zapisanych nagrań.")}</p><Button variant="outline" disabled={!ready || locked} onclick={saveWatermark}><Save size={14}/>{tr("Zapisz ustawienia znaku")}</Button>
    {/if}
    <div class="integration-upload"><FilePicker label={tr("Wybierz nagranie")} ariaLabel={tr("Nagranie do wykrywania znaku wodnego")} accept=".wav,.mp3,.flac,.ogg,.m4a,.aac,.opus" disabled={locked} showName={false} onchange={files => chooseFile(files[0])}/><span>{file?.name || tr('Nie wybrano nagrania')}</span></div><p>{tr("WAV, MP3, FLAC, OGG, M4A, AAC lub OPUS · do 64 MB. Detekcja może załadować lokalny model. Zacznie się dopiero po kliknięciu.")}</p>
    <Button variant="default" disabled={!ready || locked || !file || !watermark?.audioseal_available} onclick={detect}><ShieldCheck size={14}/>{tr("Sprawdź znak wodny")}</Button>
    {#if detection}<div class="integration-test" role="status"><strong>{watermarkTitle(detection)}</strong><p>{tr("Wynik detektora:")} {detection.confidence.toLocaleString('pl-PL', { maximumFractionDigits: 4 })} {tr("w skali 0–1.")}</p>{#if detection.message_bits}<p>{tr("Odczytana sygnatura:")} <code>{detection.message_bits}</code></p>{/if}<p>{tr("Brak detekcji nie przesądza o pochodzeniu nagrania. Zgodna sygnatura opisuje wynik detektora; nie potwierdza właściciela głosu ani praw do nagrania.")}</p></div>{/if}
  </section>
  {#if busy}<p class="integration-progress" role="status"><LoaderCircle size={14} class="spin"/>{busy === 'Detekcja' ? tr("Sprawdzanie znaku wodnego… Pierwsze wczytanie modelu może potrwać dłużej.") : tr('Trwa: {busy}…',{busy:tr(busy)})}<Button variant="ghost" onclick={() => controller?.abort()}>{tr("Przerwij oczekiwanie")}</Button></p>{/if}
  {#if error}<p class="integration-error" role="alert">{tr(String(error))}</p>{/if}{#if message}<p class="integration-note" role="status">{tr(String(message))}</p>{/if}
  <details class="integration-diagnostics"><summary>{tr("Szczegóły diagnostyczne i źródła")}</summary>{#if integrationState}<p>{tr("Transport: loopback. Udostępnianie sieciowe:")} {integrationState.network_sharing_enabled === true ? tr("włączone poza tym panelem") : integrationState.network_sharing_enabled === false ? tr("wyłączone") : 'stan nieustalony'}.</p><p>{tr("Wersja źródeł silnika:")} {integrationState.source.sourceVersion || integrationState.source.version || 'nieustalona'}.</p><p>{tr("Metadane zainstalowanej dystrybucji:")} {integrationState.source.installedDistributionVersion || tr("brak")}.</p><p>{tr("Commit upstream:")} {sourceCommit || tr("brak przypiętego SHA w metadanych aktywnego pakietu")}.</p><p>{tr("SHA-256 archiwum:")} <code>{integrationState.source.archive_sha256 || 'nieodczytany'}</code></p><p>{tr("Dostarczone notices:")} {integrationState.source.notices.join(', ') || tr("sprawdź pakiet źródeł")}.</p>{/if}<p>{tr("Źródło silnika:")} <a href={sourceCommit ? `https://github.com/debpalash/VoiceStudio/commit/${sourceCommit}` : 'https://github.com/debpalash/VoiceStudio'} target="_blank" rel="noreferrer">{tr("debpalash/VoiceStudio")}</a>{tr(". Aplikacja upstream i poszczególne modele mają odrębne warunki licencyjne. Panel nie włącza konta, chmury ani telefonii.")}</p></details>
</div>

<style>
  .integration-settings{display:flex;flex-direction:column;gap:20px;min-width:0}.integration-settings>header{display:flex;gap:14px;align-items:flex-start}.integration-settings>header>:global(svg){color:var(--muted);flex-shrink:0}.integration-settings h1{font-size:var(--ui-text-22);font-weight:600;letter-spacing:-.4px}.integration-settings h2{font-size:var(--ui-text-14);font-weight:600}.integration-settings h3{font-size:var(--ui-text-12);font-weight:500}.integration-settings p{font-size:var(--ui-text-12);line-height:1.75;color:var(--muted);margin:10px 0}.integration-settings section{display:flex;flex-direction:column;gap:12px;padding:20px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}.integration-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.integration-heading>span{font-size:var(--ui-text-10);color:var(--muted);text-align:right}.integration-address{display:flex;align-items:center;gap:8px;border:1px solid var(--border);border-radius:7px;padding:6px 8px}.integration-address>code{flex:1;min-width:0;overflow-wrap:anywhere;font-size:var(--ui-text-12)}.integration-option{display:flex;align-items:center;justify-content:space-between;gap:20px;font-size:var(--ui-text-12)}.integration-option>div{flex:1}.integration-option p{margin:5px 0}.integration-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.integration-settings label{font-size:var(--ui-text-12);color:var(--muted)}.integration-settings pre{padding:14px;border:1px solid var(--border);border-radius:7px;background:var(--background);white-space:pre-wrap;overflow-wrap:anywhere;font:var(--ui-text-11)/1.8 var(--font-mono,monospace);margin:12px 0}.integration-settings summary{cursor:pointer;font-size:var(--ui-text-12);font-weight:500}.integration-endpoints{display:flex;flex-direction:column;gap:7px;margin:14px 0;font-size:var(--ui-text-11)}.integration-models{display:flex;flex-wrap:wrap;gap:6px}.integration-models>span{padding:4px 8px;border:1px solid var(--border);border-radius:5px;font-size:var(--ui-text-10);color:var(--muted);overflow-wrap:anywhere}.integration-test{display:flex;flex-direction:column;gap:8px;border:1px solid var(--border);border-radius:8px;padding:14px;font-size:var(--ui-text-12)}.integration-test p{margin:0}.integration-bindings{display:flex;flex-direction:column;gap:8px}.integration-bindings article{display:flex;align-items:center;gap:8px;padding:12px 0;border-bottom:1px solid var(--border)}.integration-bindings article>div{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;font-size:var(--ui-text-12)}.integration-bindings small{font-size:var(--ui-text-10);color:var(--muted);overflow-wrap:anywhere}.integration-upload{display:flex;align-items:center;gap:12px;position:relative;padding:16px;border:1px dashed var(--border);border-radius:7px;margin-top:10px}.integration-error{color:var(--danger)!important;font-size:var(--ui-text-12);line-height:1.8}.integration-success{color:var(--foreground)!important}.integration-progress{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:var(--ui-text-12)}.integration-diagnostics code{overflow-wrap:anywhere;font-size:var(--ui-text-10)}.integration-diagnostics a{color:var(--foreground);text-decoration:underline}.integration-settings>:global([data-slot="button"]){align-self:flex-start}@media(max-width:600px){.integration-settings section{padding:16px}.integration-heading{align-items:flex-start}.integration-upload{flex-wrap:wrap}.integration-bindings article{flex-wrap:wrap}}
</style>
