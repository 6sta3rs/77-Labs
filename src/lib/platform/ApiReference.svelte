<script lang="ts">
  import { onDestroy, untrack, tick } from 'svelte'
  import { Braces, Download, RefreshCw } from '@lucide/svelte'
  import Button from '../ui/Button.svelte'
  import Input from '../ui/Input.svelte'
  import Select from '../ui/Select.svelte'
  import { request, prepareRequest } from './api'
  import { productionJson } from '../tools/production/production'
  import { saveTextFile } from '../tools/studio-tools'

  type Schema = { $ref?: string; type?: string | string[]; title?: string; description?: string; format?: string; nullable?: boolean; properties?: Record<string, Schema>; required?: string[]; items?: Schema; enum?: unknown[]; default?: unknown; anyOf?: Schema[]; oneOf?: Schema[]; allOf?: Schema[] }
  type Parameter = { $ref?: string; name?: string; in?: string; required?: boolean; description?: string; schema?: Schema }
  type Content = Record<string, { schema?: Schema }>
  type RequestBody = { $ref?: string; description?: string; required?: boolean; content?: Content }
  type ApiResponse = { $ref?: string; description?: string; content?: Content }
  type Operation = { summary?: string; description?: string; operationId?: string; tags?: string[]; parameters?: Parameter[]; requestBody?: RequestBody; responses?: Record<string, ApiResponse>; deprecated?: boolean }
  type PathItem = { parameters?: Parameter[]; [key: string]: Operation | Parameter[] | undefined }
  type Document = { openapi?: string; info?: { title?: string; version?: string; description?: string }; paths?: Record<string, PathItem>; components?: { schemas?: Record<string, Schema> }; [key: string]: unknown }
  type ApiOperation = { id: string; method: string; path: string; definition: Operation; parameters: Parameter[] }
  let { ready }: { ready: boolean } = $props()
  let document = $state.raw<Document>(), query = $state(''), method = $state('all'), selectedId = $state(''), modelName = $state(''), page = $state(0)
  let busy = $state(''), error = $state(''), loaded = $state(false), tryOutput = $state<{ status: number; type: string; text: string; truncated: boolean }>()
  let controller: AbortController | undefined, disposed = false
  let modelAnchor = $state<HTMLDivElement>()
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']
  const pageSize = 30
  // GET is not sufficient proof of a read-only operation in the upstream API.
  const safeReads = new Set(['/health', '/sysinfo', '/system/info', '/openapi.json', '/engines', '/engines/tts', '/engines/asr', '/engines/llm', '/model/status', '/profiles', '/models', '/v1/models', '/v1/audio/capabilities', '/watermark/status', '/pronunciation', '/pronunciation/export', '/api/settings/performance-profile', '/api/settings/compute-device', '/api/settings/cuda-device', '/api/settings/history-retention', '/api/settings/dictation-refinement', '/api/settings/llm-providers', '/api/settings/llm-skills', '/api/settings/asr-openai-compat', '/api/settings/changelog', '/api/settings/db-backup', '/api/settings/analytics'])
  const operations = $derived.by(() => {
    const result: ApiOperation[] = []
    for (const [path, item] of Object.entries(document?.paths || {})) for (const verb of methods) {
      const definition = item[verb] as Operation | undefined
      if (definition) result.push({ id: `${verb} ${path}`, method: verb.toUpperCase(), path, definition, parameters: [...(item.parameters || []), ...(definition.parameters || [])] })
    }
    return result
  })
  const filtered = $derived.by(() => {
    const words = query.toLocaleLowerCase('pl').trim().split(/\s+/).filter(Boolean)
    return operations.filter(row => (method === 'all' || row.method === method) && words.every(word => `${row.method} ${row.path} ${row.definition.summary || ''} ${row.definition.operationId || ''} ${(row.definition.tags || []).join(' ')}`.toLocaleLowerCase('pl').includes(word)))
  })
  const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / pageSize)))
  const currentPage = $derived(Math.min(page, pageCount - 1))
  const visible = $derived(filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize))
  const selected = $derived(operations.find(row => row.id === selectedId))
  const parameters = $derived(selected?.parameters.map(value => resolve(value)).filter((value): value is Parameter => !!value) || [])
  const requestBody = $derived(resolve(selected?.definition.requestBody))
  const responses = $derived(Object.entries(selected?.definition.responses || {}).slice(0, 12).map(([status, value]) => ({ status, value: resolve(value) })))
  const schemaNames = $derived(Object.keys(document?.components?.schemas || {}).sort((a, b) => a.localeCompare(b, 'pl')))
  const canTry = $derived(!!selected && ['GET', 'HEAD'].includes(selected.method) && safeReads.has(selected.path) && !/[{}]/.test(selected.path) && !parameters.some(value => value.required) && !requestBody?.required)
  const locked = $derived(!!busy)
  function pointer(reference: string): unknown {
    if (!reference.startsWith('#/')) return undefined
    let value: unknown = document
    try {
      for (const part of reference.slice(2).split('/')) {
        const name = decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~')
        if (!value || typeof value !== 'object' || !Object.hasOwn(value, name)) return undefined
        value = (value as Record<string, unknown>)[name]
      }
    } catch { return undefined }
    return value
  }
  function resolve<T extends { $ref?: string }>(value: T | undefined): T | undefined {
    const seen = new Set<string>()
    for (let depth = 0; value?.$ref && depth < 8; depth++) {
      const reference = value.$ref
      if (seen.has(reference)) break
      seen.add(reference)
      const target = pointer(reference)
      if (!target || typeof target !== 'object') break
      value = { ...target, ...value, $ref: undefined } as T
      const nested = (target as { $ref?: string }).$ref
      if (nested) value.$ref = nested
    }
    return value
  }
  function referenceName(value: Schema | undefined) { return value?.$ref?.startsWith('#/components/schemas/') ? value.$ref.slice('#/components/schemas/'.length).replace(/~1/g, '/').replace(/~0/g, '~') : '' }
  function referencedModel(value: Schema | undefined) { return referenceName(value) || referenceName(resolve(value)?.items) }
  async function showModel(name: string) { modelName = name; await tick(); modelAnchor?.scrollIntoView({ block: 'start' }) }
  function typeLabel(input: Schema | undefined, depth = 0): string {
    if (!input) return 'Nie określono schematu'
    if (depth > 3) return referenceName(input) || input.type?.toString() || 'złożony'
    const value = resolve(input) || input
    if (input.$ref && !pointer(input.$ref)) return `Nierozwiązane odwołanie: ${input.$ref}`
    const variants = value.anyOf || value.oneOf
    if (variants) return variants.slice(0, 8).map(item => typeLabel(item, depth + 1)).join(' lub ')
    if (value.type === 'array') return `Lista: ${typeLabel(value.items, depth + 1)}`
    const base = Array.isArray(value.type) ? value.type.join(' lub ') : value.type || (value.properties ? 'object' : value.allOf ? 'złożony obiekt' : 'dowolny')
    return `${referenceName(input) ? `${referenceName(input)} · ` : ''}${base}${value.format ? ` (${value.format})` : ''}${value.nullable ? ' · dopuszcza null' : ''}`
  }
  function schemaRows(input?: Schema) {
    const value = resolve(input)
    const properties = { ...value?.properties }, required = new Set(value?.required || [])
    for (const part of value?.allOf?.slice(0, 8) || []) { const child = resolve(part); Object.assign(properties, child?.properties); child?.required?.forEach(name => required.add(name)) }
    const all = Object.entries(properties)
    return { count: all.length, rows: all.slice(0, 30).map(([name, schema]) => ({ name, schema, required: required.has(name) })) }
  }
  function printable(value: unknown) { const text = JSON.stringify(value); return text ? text.slice(0, 500) : '' }
  function contentEntries(content?: Content) { return Object.entries(content || {}).slice(0, 3) }
  function choose(row: ApiOperation) { selectedId = row.id; tryOutput = undefined; error = '' }
  async function work(label: string, action: (signal: AbortSignal) => Promise<void>) {
    if (!ready || busy || disposed) return
    const abort = new AbortController(); controller = abort; busy = label; error = ''
    try { await action(abort.signal) } catch (cause) { if (!disposed) error = abort.signal.aborted ? 'Przerwano oczekiwanie na odpowiedź.' : cause instanceof Error ? cause.message : String(cause) }
    finally { if (!disposed) busy = '' }
  }
  async function refresh() {
    await work('Odczyt OpenAPI', async signal => {
      const result = await productionJson<Document>('/openapi.json', { signal })
      if (!result.paths || typeof result.paths !== 'object') throw new Error('Silnik nie zwrócił dokumentu OpenAPI z listą tras.')
      signal.throwIfAborted(); document = result; loaded = true; page = 0; tryOutput = undefined
      const first = Object.entries(result.paths).flatMap(([path, item]) => methods.flatMap(verb => item[verb] ? [`${verb} ${path}`] : []))
      selectedId = first.includes(selectedId) ? selectedId : first.includes('get /health') ? 'get /health' : first[0] || ''
      if (!result.components?.schemas?.[modelName]) modelName = ''
    })
  }
  async function tryRequest() {
    if (!canTry || !selected) return
    const operation = selected; tryOutput = undefined
    await work('Odczyt odpowiedzi API', async signal => {
      await prepareRequest(operation.path, signal, operation.method)
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)])
      const response = await request(operation.path, { method: operation.method, signal: deadline })
      let text = '', truncated = false
      if (operation.method !== 'HEAD' && response.body) {
        const reader = response.body.getReader(), decoder = new TextDecoder(); let bytes = 0
        try {
          while (true) {
            deadline.throwIfAborted(); const item = await reader.read(); deadline.throwIfAborted()
            if (item.done) { text += decoder.decode(); break }
            const remaining = 65536 - bytes; bytes += item.value.byteLength
            text += decoder.decode(item.value.subarray(0, Math.max(0, remaining)), { stream: true })
            if (bytes > 65536) { truncated = true; await reader.cancel(); break }
          }
        } finally { reader.releaseLock() }
      }
      deadline.throwIfAborted()
      if (!truncated && text) { try { const pretty = JSON.stringify(JSON.parse(text), null, 2); truncated = pretty.length > 65536; text = pretty.slice(0, 65536) } catch { /* Render plain text as text. */ } }
      tryOutput = { status: response.status, type: response.headers.get('content-type') || 'brak nagłówka typu', text, truncated }
    })
  }
  $effect(() => { if (ready && !loaded) untrack(() => { void refresh() }) })
  onDestroy(() => { disposed = true; controller?.abort() })
</script>

{#snippet schemaBlock(input: Schema | undefined)}
  {@const value = resolve(input)}{@const fields = schemaRows(input)}
  <div class="schema-block"><code>{typeLabel(input)}</code>{#if value?.description}<p>{value.description}</p>{/if}
    {#if referencedModel(input)}<Button variant="ghost" size="sm" onclick={() => showModel(referencedModel(input))}>Pokaż model {referencedModel(input)}</Button>{/if}
    {#if value?.enum}<p>Dozwolone wartości: <code>{printable(value.enum)}</code></p>{/if}{#if value && Object.hasOwn(value, 'default')}<p>Domyślnie: <code>{printable(value.default)}</code></p>{/if}
    {#if fields.rows.length}<div class="schema-fields">{#each fields.rows as field (field.name)}<div><strong>{field.name}{field.required ? ' · wymagane' : ''}</strong><code>{typeLabel(field.schema)}</code>{#if field.schema.description}<p>{field.schema.description}</p>{/if}{#if field.schema.enum}<p>Wartości: <code>{printable(field.schema.enum)}</code></p>{/if}</div>{/each}</div>{#if fields.count > fields.rows.length}<p>Pokazano {fields.rows.length} z {fields.count} pól. Pełny schemat znajduje się w eksporcie JSON.</p>{/if}{/if}
  </div>
{/snippet}

<section class="api-reference" aria-label="Interaktywna referencja OpenAPI"><header><Braces size={21}/><div><h2>Referencja API prywatnego silnika</h2><p>Dokument OpenAPI pochodzi z działającego silnika. Przeglądarka działa lokalnie, bez zewnętrznych skryptów.</p></div><Button variant="ghost" size="icon" aria-label="Odśwież dokument OpenAPI" disabled={!ready || locked} onclick={refresh}><RefreshCw size={15}/></Button></header>
  {#if !ready}<p role="status">Uruchom prywatny silnik, aby odczytać jego aktualne API.</p>{/if}
  {#if document}<p>{document.info?.title || 'API silnika'} · wersja {document.info?.version || 'niepodana'} · OpenAPI {document.openapi || 'niepodana'} · {operations.length} operacji.</p><Button variant="outline" disabled={locked} onclick={() => saveTextFile(JSON.stringify(document, null, 2), 'seventy-seven-labs-openapi.json', 'application/json')}><Download size={14}/>Pobierz pełny dokument OpenAPI JSON</Button>
    <div class="filters"><Input type="search" aria-label="Szukaj operacji API" placeholder="Ścieżka, metoda lub opis…" value={query} oninput={event => { query = event.currentTarget.value; page = 0 }}/><Select label="Metoda HTTP" value={method} onchange={value => { method = value; page = 0 }} options={[{ value: 'all', label: 'Wszystkie metody' }, ...methods.map(value => ({ value: value.toUpperCase(), label: value.toUpperCase() }))]}/></div>
    <div class="pagination"><span>{filtered.length} wyników · strona {currentPage + 1} z {pageCount}</span><div><Button variant="ghost" size="sm" disabled={currentPage === 0 || locked} onclick={() => page = currentPage - 1}>Poprzednia</Button><Button variant="ghost" size="sm" disabled={currentPage + 1 >= pageCount || locked} onclick={() => page = currentPage + 1}>Następna</Button></div></div>
    <div class="operations" aria-label="Operacje API">{#each visible as row (row.id)}<Button variant={row.id === selectedId ? 'secondary' : 'ghost'} class="operation-row" disabled={locked} aria-pressed={row.id === selectedId} onclick={() => choose(row)}><span class="verb">{row.method}</span><span class="operation-name"><code>{row.path}</code><small>{row.definition.summary || row.definition.operationId || 'Brak opisu operacji'}{row.definition.deprecated ? ' · przestarzałe' : ''}</small></span></Button>{/each}{#if !filtered.length}<p>Brak operacji pasujących do wyszukiwania.</p>{/if}</div>
    {#if selected}<article class="operation-detail" aria-label="Szczegóły wybranej operacji API"><h3><span class="verb">{selected.method}</span> <code>{selected.path}</code></h3><p>{selected.definition.summary || selected.definition.operationId || 'Operacja bez opisu'}</p>{#if selected.definition.description}<p class="description">{selected.definition.description}</p>{/if}{#if selected.definition.deprecated}<p>Ta operacja jest oznaczona jako przestarzała.</p>{/if}
      <h4>Parametry</h4>{#if parameters.length}<div class="parameters">{#each parameters.slice(0, 60) as parameter, index (`${parameter.in}-${parameter.name}-${index}`)}<div><strong>{parameter.name || 'Bez nazwy'} · {({ query: 'zapytanie', path: 'ścieżka', header: 'nagłówek', cookie: 'ciasteczko' } as Record<string, string>)[parameter.in || ''] || parameter.in || 'miejsce niepodane'}{parameter.required ? ' · wymagany' : ' · opcjonalny'}</strong><p>{parameter.description || ''}</p>{@render schemaBlock(parameter.schema)}</div>{/each}</div>{:else}<p>Brak zadeklarowanych parametrów.</p>{/if}
      {#if requestBody}<h4>Treść żądania {requestBody.required ? '· wymagana' : '· opcjonalna'}</h4>{#if requestBody.description}<p>{requestBody.description}</p>{/if}{#each contentEntries(requestBody.content) as [contentType, content] (contentType)}<h5>{contentType}</h5>{@render schemaBlock(content.schema)}{/each}{/if}
      <h4>Odpowiedzi</h4>{#each responses as response (response.status)}<div class="response"><strong>HTTP {response.status}</strong><p>{response.value?.description || 'Brak opisu odpowiedzi.'}</p>{#each contentEntries(response.value?.content) as [contentType, content] (contentType)}<h5>{contentType}</h5>{@render schemaBlock(content.schema)}{/each}</div>{/each}
      <h4>Sprawdzenie odczytu</h4><p>Żądanie korzysta z połączenia tej aplikacji z prywatnym silnikiem. Dostępne są wyłącznie jawnie rozpoznane odczyty GET/HEAD bez wymaganych argumentów. Pozostałe operacje możesz przejrzeć i wyeksportować.</p><Button variant="outline" disabled={!ready || locked || !canTry} onclick={tryRequest}>Wyślij {selected.method} {selected.path}</Button>{#if tryOutput}<div class="try-result" role="status"><strong>HTTP {tryOutput.status} · {tryOutput.type}</strong><pre>{tryOutput.text || '(pusta treść odpowiedzi)'}</pre>{#if tryOutput.truncated}<p>Podgląd ograniczono do 64 KB.</p>{/if}</div>{/if}
    </article>{/if}
    <div class="model-reference" bind:this={modelAnchor}><Select label="Modele danych OpenAPI" value={modelName} onchange={value => modelName = value} options={[{ value: '', label: 'Wybierz model danych…' }, ...schemaNames.map(name => ({ value: name, label: name }))]}/>{#if modelName}<article aria-label={`Model danych ${modelName}`}><h3>{modelName}</h3>{@render schemaBlock(document.components?.schemas?.[modelName])}</article>{/if}</div>
  {/if}
  {#if busy}<p role="status">{busy}… <Button variant="ghost" size="sm" onclick={() => controller?.abort()}>Przerwij oczekiwanie</Button></p>{/if}{#if error}<p class="failure" role="alert">{error}</p>{/if}
</section>

<style>
  .api-reference{display:flex;flex-direction:column;gap:14px;padding:20px;border:1px solid var(--border);border-radius:10px;background:var(--surface);min-width:0}.api-reference header{display:flex;align-items:flex-start;gap:12px}.api-reference header>div{flex:1;min-width:0}.api-reference h2{font-size:var(--ui-text-14);font-weight:600}.api-reference h3{font-size:var(--ui-text-14);line-height:1.8;overflow-wrap:anywhere}.api-reference h4{font-size:var(--ui-text-12);font-weight:600;margin-top:10px}.api-reference h5{font-size:var(--ui-text-11);font-weight:500;color:var(--muted);margin:8px 0}.api-reference p{font-size:var(--ui-text-12);line-height:1.75;color:var(--muted);margin:4px 0;overflow-wrap:anywhere}.api-reference code,.api-reference pre{font-size:var(--ui-text-11);overflow-wrap:anywhere}.filters{display:flex;align-items:flex-end;gap:12px}.filters>:global(input){flex:1;min-width:0}.pagination{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:var(--ui-text-11);color:var(--muted)}.operations{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:7px;padding:5px;max-height:420px;overflow:auto}.operations>:global(.operation-row){width:100%;min-height:46px;height:auto;justify-content:flex-start;text-align:left;white-space:normal;gap:12px}.verb{font-size:var(--ui-text-10);font-family:var(--font-mono,monospace);font-weight:600;min-width:52px}.operation-name{display:flex;flex-direction:column;gap:3px;min-width:0}.operation-name code{overflow-wrap:anywhere}.operation-name small{font-size:var(--ui-text-10);color:var(--muted)}.operation-detail,.model-reference article{display:flex;flex-direction:column;gap:10px;border:1px solid var(--border);border-radius:8px;padding:16px}.description{white-space:pre-wrap}.schema-block{display:flex;flex-direction:column;gap:5px;padding:10px;background:var(--background);border:1px solid var(--border);border-radius:6px}.schema-block>:global([data-slot=button]){align-self:flex-start}.schema-fields{display:flex;flex-direction:column;gap:9px}.schema-fields>div{display:flex;flex-direction:column;gap:3px;border-top:1px solid var(--border);padding-top:8px}.schema-fields strong,.parameters strong,.response>strong,.try-result>strong{font-size:var(--ui-text-11);font-weight:600}.parameters{display:flex;flex-direction:column;gap:12px}.response{border-top:1px solid var(--border);padding-top:12px}.try-result pre{white-space:pre-wrap;max-height:400px;overflow:auto;padding:12px;border:1px solid var(--border);border-radius:6px;line-height:1.7}.model-reference{display:flex;flex-direction:column;gap:12px}.failure{color:var(--danger)!important}.api-reference>:global([data-slot=button]),.operation-detail>:global([data-slot=button]){align-self:flex-start}@media(max-width:600px){.api-reference{padding:16px}.filters{flex-direction:column;align-items:stretch}.pagination{align-items:flex-start;flex-wrap:wrap}.operation-detail{padding:12px}}
</style>
