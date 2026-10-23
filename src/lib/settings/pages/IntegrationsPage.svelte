<script lang="ts">
  // "Integracje": local OpenAI-compatible API, MCP server + client voice bindings, OpenAPI reference of the running engine.
  import { uiLanguage, createUiTranslator } from '../../i18n'
  import { onDestroy, untrack } from 'svelte'
  import { Copy, Check, LoaderCircle, Trash2, Download, Plug, Send, Search } from '@lucide/svelte'
  import { toast } from '../../ui/toast'
  import type { SettingsSection } from '../settings-catalog'
  import Button from '../../ui/Button.svelte'
  import Select from '../../ui/Select.svelte'
  import Switch from '../../ui/Switch.svelte'
  import Input from '../../ui/Input.svelte'
  import StatusBadge from '../../ui/StatusBadge.svelte'
  import { request, profiles as loadProfiles, prepareRequest, type Profile } from '../../platform/api'
  import { productionJson, postJson } from '../../tools/production/production'
  import { saveTextFile } from '../../tools/studio-tools'
  import { LOCAL_API_BASE, LOCAL_MCP_URL, bindingPayload, integrationError, mcpClientConfig, testMcpConnection, type ApiModel, type IntegrationConfig, type IntegrationState, type McpBinding, type SpeechCapabilities } from '../../platform/integrations'

  let { ready = false, onnavigate }: { ready?: boolean; onnavigate?: (id: SettingsSection, intent?: string) => void } = $props()
  const tr = $derived(createUiTranslator($uiLanguage))

  /* ---------- helpers ---------- */
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const later = (fn: () => void, ms: number) => { const id = setTimeout(() => { timers.delete(id); fn() }, ms); timers.add(id) }
  let disposed = false, reader: AbortController | undefined, writer: AbortController | undefined
  onDestroy(() => { disposed = true; reader?.abort(); writer?.abort(); timers.forEach(id => clearTimeout(id)) })
  let copied = $state('')
  async function copy(key: string, text: string) {
    try { await navigator.clipboard.writeText(text) } catch { toast.bad(tr('Nie udało się skopiować. Zaznacz tekst i skopiuj ręcznie.')); return }
    copied = key; later(() => { if (copied === key) copied = '' }, 1800)
  }
  let savedMsg = $state('')
  const flashSaved = (k: string) => { savedMsg = k; later(() => { if (savedMsg === k) savedMsg = '' }, 1800) }
  const pl = (n: number, one: string, few: string, many: string) => n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many
  let busy = $state('')
  async function work(label: string, run: (signal: AbortSignal) => Promise<void>) {
    if (!ready || busy || disposed) return
    const controller = new AbortController(); writer = controller; busy = label
    try { await run(controller.signal) }
    catch (cause) { if (!controller.signal.aborted && !disposed) toast.bad(integrationError(cause)) }
    finally { if (writer === controller && !disposed) busy = '' }
  }

  /* ---------- state read from the engine ---------- */
  type Tab = 'api' | 'mcp' | 'ref'
  const tabs: [Tab, string][] = [['api', 'API zgodne z OpenAI'], ['mcp', 'MCP'], ['ref', 'Referencja API']]
  let tab = $state<Tab>('api')
  let integrationState = $state<IntegrationState>(), config = $state<IntegrationConfig>({ mcp_enabled: false, mcp_output_mode: 'files' })
  let capabilities = $state<SpeechCapabilities>(), models = $state<ApiModel[]>([]), voices = $state<Profile[]>([]), bindings = $state<McpBinding[]>([])
  let loadError = $state('')
  async function load() {
    reader?.abort(); const controller = new AbortController(), signal = controller.signal; reader = controller
    const result = await Promise.allSettled([
      productionJson<IntegrationState>('/next/integrations/settings', { signal }),
      productionJson<SpeechCapabilities>('/v1/audio/capabilities', { signal }),
      productionJson<{ data: ApiModel[] }>('/v1/models', { signal }),
      productionJson<McpBinding[]>('/api/mcp/bindings', { signal }),
      loadProfiles(signal),
    ])
    if (signal.aborted || disposed) return
    const failures: string[] = []
    if (result[0].status === 'fulfilled') { integrationState = result[0].value; config = { ...integrationState.settings } } else failures.push(tr('Nie odczytano ustawień MCP.'))
    if (result[1].status === 'fulfilled') capabilities = result[1].value; else failures.push(tr('Nie odczytano kontraktu API audio.'))
    if (result[2].status === 'fulfilled') models = result[2].value.data; else failures.push(tr('Nie odczytano listy modeli API.'))
    if (result[3].status === 'fulfilled') bindings = result[3].value; else failures.push(tr('Nie odczytano przypisań klientów MCP.'))
    if (result[4].status === 'fulfilled') voices = result[4].value; else failures.push(tr('Nie odczytano profili głosów.'))
    loadError = failures.join(' ')
  }
  $effect(() => {
    if (!ready) return
    untrack(() => { void load() })
    return () => { reader?.abort(); writer?.abort(); busy = ''; apiTest = undefined; mcpTest = undefined }
  })

  /* API */
  const ENDPOINTS: [string, string, string][] = [['GET', '/v1/models', 'Lista identyfikatorów modeli'], ['GET', '/v1/audio/voices', 'Dostępne głosy'], ['POST', '/v1/audio/speech', 'Synteza mowy z tekstu'],
    ['POST', '/v1/audio/transcriptions', 'Rozpoznawanie mowy z pliku'], ['WS', '/v1/audio/transcriptions/stream', 'Rozpoznawanie mowy na żywo']]
  let apiTest = $state<{ models: number; protocol: string; version: string }>()
  function testApi() {
    apiTest = undefined
    void work('api', async signal => {
      const [health, contract, catalog] = await Promise.all([productionJson<{ status: string; version?: string }>('/health', { signal }), productionJson<SpeechCapabilities>('/v1/audio/capabilities', { signal }), productionJson<{ data: ApiModel[] }>('/v1/models', { signal })])
      if (health.status !== 'ok' || !Array.isArray(catalog.data) || !contract.protocol) throw new Error(tr('Serwer nie potwierdził wymaganego kontraktu API audio.'))
      capabilities = contract; models = catalog.data
      apiTest = { models: catalog.data.length, protocol: contract.protocol, version: contract.service_version || health.version || '' }
    })
  }

  /* MCP */
  const OUTPUTS = [{ value: 'files', label: 'Adres pliku · mniejszy kontekst klienta' }, { value: 'resources', label: 'Audio jako zasób base64' }, { value: 'both', label: 'Adres i zasób base64' }]
  const mcpApplied = $derived(!!integrationState?.effective.mcp_enabled && !!integrationState.effective.mounted)
  const mcpDirty = $derived(!!integrationState && (config.mcp_enabled !== integrationState.settings.mcp_enabled || config.mcp_output_mode !== integrationState.settings.mcp_output_mode))
  const mcpRestart = $derived(!!integrationState?.restart_required)
  let mcpTest = $state<Awaited<ReturnType<typeof testMcpConnection>>>()
  function saveMcp() {
    void work('mcp-save', async signal => {
      integrationState = await productionJson<IntegrationState>('/next/integrations/settings', { ...postJson(config, signal), method: 'PUT' })
      config = { ...integrationState.settings }; mcpTest = undefined; flashSaved('mcp')
      if (integrationState.restart_required) toast.ok(tr('Zapisano. Zmiana zadziała po ponownym uruchomieniu silnika.'))
    })
  }
  function testMcp() {
    mcpTest = undefined
    void work('mcp-test', async signal => { await prepareRequest('/mcp', signal); mcpTest = await testMcpConnection(request, signal); toast.ok(tr('Połączenie z serwerem MCP potwierdzone')) })
  }

  const voiceOptions = $derived([{ value: '', label: tr('Bez przypisania · domyślny profil silnika') }, ...voices.map(voice => ({ value: voice.id, label: voice.name }))])
  const engineOptions = $derived([{ value: '', label: tr('Aktywny silnik studia') }, ...models.filter(model => model.voicestudio?.kind === 'tts' && !model.voicestudio?.alias_for_active_engine).map(model => ({ value: model.id, label: model.id }))])
  let clientId = $state(''), label = $state(''), voice = $state(''), engine = $state(''), editing = $state(false)
  let confirmDel = $state<string | null>(null)
  const voiceName = (id?: string | null) => voices.find(item => item.id === id)?.name || id || tr('profil domyślny')
  const clientConfig = $derived.by(() => { try { return mcpClientConfig(clientId) } catch { return mcpClientConfig() } })
  function choose(b?: McpBinding) { clientId = b?.client_id ?? ''; label = b?.label ?? ''; voice = b?.profile_id ?? ''; engine = b?.default_engine ?? ''; editing = !!b }
  function saveBinding() {
    void work('bind', async signal => {
      await productionJson('/api/mcp/bindings', { ...postJson(bindingPayload(clientId, label, voice, engine), signal), method: 'PUT' })
      bindings = await productionJson<McpBinding[]>('/api/mcp/bindings', { signal })
      choose(); flashSaved('bind'); toast.ok(tr('Zapisano przypisanie głosu'))
    })
  }
  function removeBinding(id: string) {
    void work('unbind', async signal => {
      await productionJson(`/api/mcp/bindings/${encodeURIComponent(id)}`, { method: 'DELETE', signal })
      bindings = await productionJson<McpBinding[]>('/api/mcp/bindings', { signal })
      confirmDel = null; if (clientId === id) choose(); toast.ok(tr('Usunięto przypisanie'))
    })
  }

  /* Reference: the OpenAPI document of the running engine */
  type Parameter = { name?: string; required?: boolean }
  type Operation = { summary?: string; operationId?: string; parameters?: Parameter[]; requestBody?: { required?: boolean } }
  type OpenApi = { openapi?: string; info?: { title?: string; version?: string }; paths?: Record<string, Record<string, Operation | Parameter[]>> }
  type Op = { method: string; path: string; sum: string; safe: boolean }
  const VERBS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']
  // GET alone does not prove a read-only operation in the upstream API, so only these reads can be sent.
  const SAFE_READS = new Set(['/health', '/sysinfo', '/system/info', '/openapi.json', '/engines', '/engines/tts', '/engines/asr', '/engines/llm', '/model/status', '/profiles', '/models', '/v1/models', '/v1/audio/capabilities', '/watermark/status', '/pronunciation', '/pronunciation/export', '/api/settings/performance-profile', '/api/settings/compute-device', '/api/settings/cuda-device', '/api/settings/history-retention', '/api/settings/dictation-refinement', '/api/settings/llm-providers', '/api/settings/llm-skills', '/api/settings/asr-openai-compat', '/api/settings/changelog', '/api/settings/db-backup', '/api/settings/analytics'])
  let spec = $state.raw<OpenApi>(), specBusy = $state(false)
  // ponytail: $ref parameters are not resolved for the "required" check; FastAPI inlines them. Resolve if a $ref route ever slips through as sendable.
  const OPS = $derived.by(() => Object.entries(spec?.paths || {}).flatMap(([path, item]) => VERBS.flatMap(verb => {
    const op = item[verb] as Operation | undefined
    if (!op) return []
    const params = [...((item.parameters as Parameter[] | undefined) || []), ...(op.parameters || [])]
    const method = verb.toUpperCase()
    return [{ method, path, sum: op.summary || op.operationId || '', safe: ['GET', 'HEAD'].includes(method) && SAFE_READS.has(path) && !/[{}]/.test(path) && !params.some(p => p.required) && !op.requestBody?.required }]
  })))
  const METHODS = $derived([...new Set(OPS.map(o => o.method))])
  async function loadSpec() {
    specBusy = true
    try {
      const doc = await productionJson<OpenApi>('/openapi.json')
      if (!doc.paths || typeof doc.paths !== 'object') throw new Error(tr('Silnik nie zwrócił dokumentu OpenAPI z listą tras.'))
      if (disposed) return
      spec = doc
      const ids = OPS.map(opId)
      if (!ids.includes(sel)) sel = ids.includes('GET /health') ? 'GET /health' : ids[0] || ''
    } catch (cause) { if (!disposed) toast.bad(integrationError(cause)) }
    finally { if (!disposed) specBusy = false }
  }
  $effect(() => { if (ready && tab === 'ref' && !spec) untrack(() => { if (!specBusy) void loadSpec() }) })
  let q = $state(''), meth = $state('all'), sel = $state('')
  const opId = (o: Op) => `${o.method} ${o.path}`
  const filtered = $derived.by(() => { const w = q.toLocaleLowerCase('pl').trim().split(/\s+/).filter(Boolean); return OPS.filter(o => (meth === 'all' || o.method === meth) && w.every(x => `${o.method} ${o.path} ${o.sum}`.toLocaleLowerCase('pl').includes(x))) })
  const selOp = $derived(OPS.find(o => opId(o) === sel))
  let tryOut = $state<{ status: string; text: string }>()
  function choosOp(o: Op) { sel = opId(o); tryOut = undefined }
  function send() {
    const o = selOp; if (!o?.safe) return
    tryOut = undefined
    void work('send', async signal => {
      await prepareRequest(o.path, signal, o.method)
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)])
      const response = await request(o.path, { method: o.method, signal: deadline })
      let text = '', bytes = 0, truncated = false
      if (o.method !== 'HEAD' && response.body) {
        const stream = response.body.getReader(), decoder = new TextDecoder()
        try {
          while (true) {
            const item = await stream.read(); deadline.throwIfAborted()
            if (item.done) { text += decoder.decode(); break }
            const remaining = 65536 - bytes; bytes += item.value.byteLength
            text += decoder.decode(item.value.subarray(0, Math.max(0, remaining)), { stream: true })
            if (bytes > 65536) { truncated = true; await stream.cancel(); break }
          }
        } finally { stream.releaseLock() }
      }
      if (!truncated && text) { try { text = JSON.stringify(JSON.parse(text), null, 2).slice(0, 65536) } catch { /* plain text stays text */ } }
      tryOut = { status: `HTTP ${response.status} · ${response.headers.get('content-type') || tr('brak nagłówka typu')}${truncated ? ` · ${tr('podgląd ograniczono do 64 KB')}` : ''}`, text: text || tr('(pusta treść odpowiedzi)') }
    })
  }
  function exportSpec() { if (!spec) return; saveTextFile(JSON.stringify(spec, null, 2), 'seventy-seven-labs-openapi.json', 'application/json'); toast.ok(tr('Pobrano dokument OpenAPI')) }
</script>

{#snippet addr(key: string, value: string, aria: string)}
  <div class="address"><code>{value}</code><Button variant="outline" aria-label={tr(aria)} onclick={() => copy(key, value)}>{#if copied === key}<Check size={15}/>{tr('Skopiowano')}{:else}<Copy size={15}/>{tr('Kopiuj')}{/if}</Button></div>
{/snippet}

<div class="p-page integrations-page">
  <div class="page-heading">
    <div><h1>{tr('Integracje')}</h1><p>{tr('Podłącz inne aplikacje do silnika działającego na tym komputerze.')}</p></div>
  </div>

  {#if !ready}
    <p class="p-notice">{tr('Silnik jest zatrzymany, więc integracje są niedostępne. Uruchom go na stronie Silnik.')}{#if onnavigate} <Button size="sm" onclick={() => onnavigate?.('engine')}>{tr('Przejdź do strony Silnik')}</Button>{/if}</p>
  {:else}
  {#if loadError}<p class="p-notice bad" role="alert">{loadError}</p>{/if}
  <div class="filter-tabs p-tabs" role="tablist" aria-label={tr('Sekcje integracji')}>
    {#each tabs as [id, name]}<button role="tab" aria-selected={tab === id} class:chosen={tab === id} onclick={() => tab = id}>{tr(name)}{#if id === 'mcp' && mcpRestart}<StatusBadge kind="wait" text={tr('Restart')} compact/>{/if}</button>{/each}
  </div>

  <div class="p-card panel">
  {#if tab === 'api'}
    <div class="p-section">
      <header class="split"><div><h3>{tr('Lokalne API zgodne z OpenAI')}</h3><p>{tr('Programy obsługujące API OpenAI mogą korzystać z tego silnika. Z tego komputera nie trzeba klucza.')}</p></div>{#if capabilities}<StatusBadge kind="ok" text={tr('Działa')}/>{:else}<StatusBadge kind="neutral" text={tr('Stan nieodczytany')}/>{/if}</header>
      {@render addr('api', LOCAL_API_BASE, 'Kopiuj adres lokalnego API')}
      <div class="p-actions">
        <Button disabled={!!busy} onclick={testApi}>{#if busy === 'api'}<LoaderCircle size={15} class="spin"/>{tr('Testuję…')}{:else}<Plug size={15}/>{tr('Testuj lokalne API')}{/if}</Button>
        {#if apiTest}<StatusBadge kind="ok" text={tr('Połączenie potwierdzone')}/><span class="p-sub">{tr('{models} · protokół {protocol} · silnik {version} · bez generowania audio', { models: `${apiTest.models} ${tr(pl(apiTest.models, 'model', 'modele', 'modeli'))}`, protocol: apiTest.protocol, version: apiTest.version })}</span>{/if}
      </div>
    </div>
    <div class="p-section">
      <header><h3>{tr('Endpointy')}</h3><p>{tr('Pełny adres = {base} + ścieżka z listy.', { base: LOCAL_API_BASE.replace('/v1', '') })}</p></header>
      <div class="list">{#each ENDPOINTS as [m, path, d]}<div class="li"><span class="m"><StatusBadge kind="neutral" text={m}/></span><div class="nm"><code>{path}</code><span>{tr(d)}</span></div></div>{/each}</div>
    </div>
    <div class="p-section">
      <header><h3>{tr('Modele')}</h3><p>{tr('Nazwy typu tts-1 to aliasy silnika. Lista nie oznacza, że model jest pobrany.')}</p></header>
      <div class="chips">{#each models as model (model.id)}<span class="chip">{model.id}{#if model.voicestudio?.alias_for_active_engine}<em>alias</em>{/if}</span>{:else}<span class="p-sub">{tr('Silnik nie zwrócił listy modeli.')}</span>{/each}</div>
    </div>

  {:else if tab === 'mcp'}
    <div class="p-section">
      <header class="split"><div><h3>{tr('Serwer MCP')}</h3><p>{tr('Pozwala programowi AI pracować z głosami i nagraniami. Działa tylko na tym komputerze.')}</p></div>
        {#if mcpTest}<StatusBadge kind="ok" text={tr('Połączenie potwierdzone')}/>{:else if mcpApplied}<StatusBadge kind="neutral" text={tr('Wykonaj test')}/>{:else if integrationState?.effective.mcp_enabled}<StatusBadge kind="bad" text={tr('Nie zamontowano')}/>{:else}<StatusBadge kind="neutral" text={tr('Wyłączone')}/>{/if}</header>
      {#if integrationState?.configuration_error}<p class="p-notice bad" role="alert">{tr(integrationState.configuration_error)}</p>{/if}
      {@render addr('mcp', LOCAL_MCP_URL, 'Kopiuj adres lokalnego MCP')}
      <div class="p-rows">
        <div class="p-row"><div class="t"><b>{tr('Włącz MCP')}</b><span>{tr('Zmiana zostaje na stałe i działa po ponownym uruchomieniu silnika.')}</span></div>
          <div class="inline">{#if mcpRestart}<StatusBadge kind="wait" text={tr('Wymaga ponownego uruchomienia')}/>{/if}<Switch label={tr('Włącz lokalne MCP')} checked={config.mcp_enabled} disabled={!integrationState || !!busy} onchange={v => { config = { ...config, mcp_enabled: v }; mcpTest = undefined }}/></div></div>
        <div class="p-row"><div class="t"><b>{tr('Audio zwracane klientowi MCP')}</b><span>{tr('Adres pliku jest lżejszy dla klienta niż osadzone audio (base64).')}</span></div>
          <Select class="w" ariaLabel={tr('Audio zwracane klientowi MCP')} value={config.mcp_output_mode} disabled={!integrationState || !!busy} options={OUTPUTS.map(o => ({ value: o.value, label: tr(o.label) }))} onchange={v => { config = { ...config, mcp_output_mode: v as IntegrationConfig['mcp_output_mode'] }; mcpTest = undefined }}/></div>
      </div>
      <div class="p-actions">
        <Button disabled={!mcpDirty || !!busy} onclick={saveMcp}>{tr('Zapisz ustawienia MCP')}</Button>
        <Button variant="outline" disabled={!!busy || !mcpApplied} onclick={testMcp}>{#if busy === 'mcp-test'}<LoaderCircle size={15} class="spin"/>{tr('Testuję…')}{:else}{tr('Testuj połączenie MCP')}{/if}</Button>
        {#if savedMsg === 'mcp'}<span class="saved on" role="status">{tr('Zapisano')}</span>{/if}
      </div>
      {#if mcpTest}<div class="chips"><span class="p-sub">{tr('{server} · protokół {protocol} · {count} narzędzi:', { server: mcpTest.server, protocol: mcpTest.protocol, count: mcpTest.tools.length })}</span>{#each mcpTest.tools as t (t)}<span class="chip">{t}</span>{/each}</div>{/if}
    </div>

    <div class="p-section">
      <header class="split"><div><h3>{tr('Konfiguracja klienta')}</h3><p>{tr('Dla klientów obsługujących Streamable HTTP. W innych wklej sam adres serwera.')}</p></div>
        <Button variant="outline" onclick={() => copy('cfg', clientConfig)}>{#if copied === 'cfg'}<Check size={15}/>{tr('Skopiowano')}{:else}<Copy size={15}/>{tr('Kopiuj konfigurację')}{/if}</Button></header>
      <pre class="code" aria-label={tr('Konfiguracja klienta MCP')}>{clientConfig}</pre>
    </div>

    <div class="p-section">
      <header><h3>{tr('Głos dla klienta MCP')}</h3><p>{tr('Klient przesyła nagłówek X-OmniVoice-Client-Id. Głos podany w zapytaniu ma pierwszeństwo.')}</p></header>
      <div class="p-rows">
        <div class="p-row"><div class="t"><b>{tr('Id klienta')}</b><span>{tr('Identyfikator, po którym rozpoznajemy klienta. To nie hasło.')}</span></div><Input class="w" aria-label={tr('Id klienta')} placeholder={tr('moj-klient')} maxlength={128} bind:value={clientId}/></div>
        <div class="p-row"><div class="t"><b>{tr('Nazwa w tej aplikacji')}</b><span>{tr('Jak klient ma się nazywać na liście.')}</span></div><Input class="w" aria-label={tr('Nazwa w tej aplikacji')} maxlength={160} bind:value={label}/></div>
        <div class="p-row"><div class="t"><b>{tr('Profil głosu')}</b><span>{tr('Głos używany, gdy klient nie poda własnego.')}</span></div><Select class="w" ariaLabel={tr('Domyślny profil klienta')} value={voice} options={voiceOptions} onchange={v => voice = v}/></div>
        <div class="p-row"><div class="t"><b>{tr('Silnik klienta')}</b><span>{tr('Puste = silnik aktywny w studiu.')}</span></div><Select class="w" ariaLabel={tr('Silnik klienta')} value={engine} options={engineOptions} onchange={v => engine = v}/></div>
      </div>
      <div class="p-actions">
        <Button disabled={!clientId.trim() || !!busy} onclick={saveBinding}>{tr('Zapisz przypisanie')}</Button>
        {#if editing || clientId || label}<Button variant="ghost" onclick={() => choose()}>{tr('Nowe przypisanie')}</Button>{/if}
        {#if savedMsg === 'bind'}<span class="saved on" role="status">{tr('Zapisano')}</span>{/if}
      </div>
      <div class="list">
        {#each bindings as b (b.client_id)}
          {#if confirmDel === b.client_id}
            <div class="p-confirm" role="alert"><span>{tr('Usunąć przypisanie „{name}”? Profil głosu pozostanie w bibliotece.', { name: b.label || b.client_id })}</span><div class="p-actions"><Button variant="destructive" disabled={!!busy} onclick={() => removeBinding(b.client_id)}>{tr('Usuń przypisanie')}</Button><Button variant="outline" onclick={() => confirmDel = null}>{tr('Anuluj')}</Button></div></div>
          {:else}
            <div class="li"><div class="nm"><b>{b.label || b.client_id}</b><span>{b.client_id} · {voiceName(b.profile_id)}{b.default_engine ? ` · ${b.default_engine}` : ''}</span></div>
              <div class="inline"><Button variant="ghost" onclick={() => choose(b)}>{tr('Edytuj')}</Button><Button variant="ghost" size="icon" aria-label={tr('Usuń przypisanie {arg0}', { arg0: b.client_id })} onclick={() => confirmDel = b.client_id}><Trash2 size={15}/></Button></div></div>
          {/if}
        {:else}<p class="p-sub">{tr('Brak przypisań. Nie przeszkadza to w połączeniu klienta MCP.')}</p>{/each}
      </div>
    </div>

  {:else}
    <div class="p-section">
      <header class="split"><div><h3>{tr('Referencja API silnika')}</h3><p>{#if spec}{tr('Opis tras działającego silnika (OpenAPI) · wersja {version} · OpenAPI {openapi} · {count} operacji.', { version: spec.info?.version || '?', openapi: spec.openapi || '?', count: OPS.length })}{:else if specBusy}{tr('Wczytywanie dokumentu OpenAPI…')}{:else}{tr('Nie odczytano dokumentu OpenAPI.')}{/if}</p></div>
        {#if spec}<Button variant="outline" onclick={exportSpec}><Download size={15}/>{tr('Eksportuj OpenAPI JSON')}</Button>{:else if !specBusy}<Button variant="outline" onclick={loadSpec}>{tr('Spróbuj ponownie')}</Button>{/if}</header>
      {#if spec}
      <div class="filters">
        <Input type="search" class="grow" aria-label={tr('Szukaj operacji API')} placeholder={tr('Ścieżka, metoda lub opis…')} bind:value={q}/>
        <Select class="w-s" ariaLabel={tr('Metoda HTTP')} value={meth} onchange={v => meth = v} options={[{ value: 'all', label: tr('Wszystkie metody') }, ...METHODS.map(m => ({ value: m, label: m }))]}/>
      </div>
      <span class="p-sub">{filtered.length} {tr(pl(filtered.length, 'wynik', 'wyniki', 'wyników'))}</span>
      <div class="ops" role="listbox" aria-label={tr('Operacje API')}>
        {#each filtered as o (opId(o))}
          <Button variant={opId(o) === sel ? 'secondary' : 'ghost'} class="op" role="option" aria-selected={opId(o) === sel} onclick={() => choosOp(o)}><span class="m"><StatusBadge kind="neutral" text={o.method}/></span><span class="nm"><code>{o.path}</code><span>{o.sum || tr('Brak opisu operacji')}</span></span></Button>
        {:else}<p class="p-sub pad"><Search size={14}/> {tr('Brak operacji pasujących do wyszukiwania.')}</p>{/each}
      </div>
      {/if}
    </div>
    {#if selOp}
      <div class="p-section">
        <header class="split"><div><h3><code>{selOp.method} {selOp.path}</code></h3><p>{selOp.sum || tr('Brak opisu operacji')}{selOp.safe ? '' : tr(' · tę operację można tylko przejrzeć lub wyeksportować.')}</p></div>
          <Button disabled={!selOp.safe || !!busy} onclick={send}>{#if busy === 'send'}<LoaderCircle size={15} class="spin"/>{tr('Wysyłam…')}{:else}<Send size={15}/>{tr('Wyślij')}{/if}</Button></header>
        {#if tryOut}<div class="resp" role="status"><span class="p-sub">{tryOut.status}</span><pre class="code">{tryOut.text}</pre></div>{/if}
      </div>
    {/if}
  {/if}
  </div>
  {/if}
</div>

<style>
  .panel{display:flex;flex-direction:column;gap:18px;padding:22px}
  .inline{display:flex;align-items:center;gap:8px}
  .integrations-page :global(.w){width:300px}.integrations-page :global(.w-s){width:190px}.integrations-page :global(.grow){flex:1;min-width:0}
  .integrations-page :global(.spin){animation:rot .8s linear infinite}@keyframes rot{to{transform:rotate(360deg)}}
  @media(prefers-reduced-motion:reduce){.integrations-page :global(.spin){animation:none}}
  .integrations-page :global(.vs-button svg.spin){color:var(--accent)}
  .saved{color:var(--success);font-size:var(--ui-text-12);opacity:0;transition:opacity .2s}.saved.on{opacity:1}
  .address{display:flex;align-items:center;gap:10px}.address>code{flex:1;min-width:0;font-size:var(--ui-text-11);overflow-wrap:anywhere;padding:9px 12px;border:1px solid var(--border);border-radius:8px;background:var(--background);font-family:var(--font-mono,monospace)}
  .list{display:flex;flex-direction:column}
  .li{display:flex;align-items:center;gap:14px;justify-content:space-between;padding:11px 0;border-top:1px solid var(--border)}.li:first-child{border-top:0}
  .li .m,.ops .m{flex:0 0 72px;display:flex}
  .li:has(.m){justify-content:flex-start}
  .nm{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
  .nm b{font-size:var(--ui-text-13);font-weight:550}.nm code{font-size:var(--ui-text-12);font-family:var(--font-mono,monospace);overflow-wrap:anywhere}
  .nm span{color:var(--muted);font-size:var(--ui-text-12);line-height:1.6;overflow-wrap:anywhere}
  .chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
  .chip{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border:1px solid var(--border);border-radius:6px;font:var(--ui-text-11) var(--font-mono,monospace);color:var(--foreground)}.chip em{font-style:normal;font-family:inherit;color:var(--muted)}
  .code{margin:0;padding:14px 16px;border:1px solid var(--border);border-radius:8px;background:var(--background);font:var(--ui-text-11)/1.8 var(--font-mono,monospace);white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto}
  .filters{display:flex;gap:12px;align-items:center}
  .ops{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:8px;padding:4px;max-height:340px;overflow:auto}
  .ops :global(.op){width:100%;height:auto;min-height:46px;justify-content:flex-start;text-align:left;white-space:normal;gap:12px;font-weight:400}
  .ops .nm{align-items:flex-start}
  .pad{padding:12px}
  .resp{display:flex;flex-direction:column;gap:6px}
  h3 code{font-family:var(--font-mono,monospace);font-size:inherit}
  .p-notice :global([data-slot=button]){margin-left:8px}
  @media(max-width:600px){.panel{padding:16px}.integrations-page :global(.w),.integrations-page :global(.w-s){width:100%}.filters{flex-direction:column;align-items:stretch}.address{flex-wrap:wrap}}
</style>
