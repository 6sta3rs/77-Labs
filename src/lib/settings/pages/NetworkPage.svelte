<script lang="ts">
  // "Sieć i dostęp": LAN sharing + Tailscale Serve, connecting to a remote engine, HTTP(S)/SOCKS proxy.
  import { uiLanguage, createUiTranslator } from '../../i18n'
  import { Copy, Check, RefreshCw, Save, ArrowRight, ArrowUpRight } from '@lucide/svelte'
  import { onDestroy, untrack } from 'svelte'
  import Button from '../../ui/Button.svelte'
  import Input from '../../ui/Input.svelte'
  import StatusBadge from '../../ui/StatusBadge.svelte'
  import { toast } from '../../ui/toast'
  import type { SettingsSection } from '../settings-catalog'
  import { productionJson, postJson } from '../../tools/production/production'
  import { putSettings, settingsError, settingsPort, type NetworkState, type ProxyState, type SystemInfo, type TailscaleState } from '../system-settings'
  import { remoteBackend, remoteBackendState } from '../../platform/remote-backend'

  let { ready = false, intent = '', onremotechange, onnavigate }: { ready?: boolean; intent?: string; onremotechange?: () => void | Promise<void>; onnavigate?: (id: SettingsSection, intent?: string) => void } = $props()
  const tr = $derived(createUiTranslator($uiLanguage))
  const uid = $props.id()

  type Tab = 'share' | 'remote' | 'proxy'
  const tabs: { id: Tab; label: string }[] = [
    { id: 'share', label: 'Udostępnianie' },
    { id: 'remote', label: 'Zdalny silnik' },
    { id: 'proxy', label: 'Serwer proxy' },
  ]
  let tab = $state<Tab>('share')
  $effect(() => { if (intent === 'remote') untrack(() => tab = 'remote') })

  // Engine state. Every value below is read from the engine; nothing is invented.
  type Tailscale = TailscaleState & { magic_dns_name?: string }
  let network = $state<NetworkState>(), info = $state<SystemInfo>(), tailscale = $state<Tailscale>(), proxy = $state<ProxyState>()
  let loadError = $state(''), busy = $state(''), disposed = false
  let reader: AbortController | undefined, writer: AbortController | undefined

  async function read<T>(path: string, signal: AbortSignal, apply: (value: T) => void) {
    const value = await productionJson<T>(path, { signal }); signal.throwIfAborted(); if (!disposed) apply(value)
  }
  async function load() {
    reader?.abort(); const controller = new AbortController(); reader = controller
    const results = await Promise.allSettled([
      read<NetworkState>('/system/network/state', controller.signal, next => network = next),
      read<SystemInfo>('/system/info', controller.signal, next => { info = next; port = String(next.share_port_base) }),
      read<Tailscale>('/system/tailscale/status', controller.signal, next => tailscale = next),
      read<ProxyState>('/next/settings/proxy', controller.signal, next => proxy = next),
      remoteBackend.state(controller.signal).then(next => { if (!disposed && next.url && !remUrl) remUrl = next.url }),
    ])
    if (controller.signal.aborted || disposed) return
    loadError = results.flatMap(result => result.status === 'rejected' ? [settingsError(result.reason)] : []).join('\n')
  }
  $effect(() => {
    if (!ready) return
    untrack(() => { void load() })
    return () => { reader?.abort(); writer?.abort(); busy = ''; remKey = '' }
  })
  onDestroy(() => { disposed = true; reader?.abort(); writer?.abort(); Object.values(armTimers).forEach(clearTimeout) })

  // One action at a time; the result of a click is a toast, a failure a red toast.
  async function work(label: string, run: (signal: AbortSignal) => Promise<string | void>) {
    if (!ready || busy || disposed) return
    const controller = new AbortController(); writer = controller; busy = label
    try { const done = await run(controller.signal); if (done && !disposed) toast.ok(tr(done)) }
    catch (cause) { if (!controller.signal.aborted && !disposed) toast.bad(settingsError(cause)) }
    finally { if (writer === controller && !disposed) busy = '' }
  }

  // Two-step inline confirmation for stop/clear actions: the first click arms the button for 4 s.
  let armed = $state<Record<string, boolean>>({})
  const armTimers: Record<string, ReturnType<typeof setTimeout>> = {}
  function arm(key: string, fn: () => void) {
    if (armed[key]) { clearTimeout(armTimers[key]); armed[key] = false; fn(); return }
    armed[key] = true; armTimers[key] = setTimeout(() => armed[key] = false, 4000)
  }

  // Copy buttons: the label switches to "Skopiowano" for a moment.
  let copied = $state('')
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value) } catch { toast.bad(tr('Nie udało się skopiować. Zaznacz tekst i skopiuj ręcznie.')); return }
    copied = value; setTimeout(() => { if (copied === value) copied = '' }, 1200)
  }

  // --- Udostępnianie ---
  let confirmLan = $state(false)
  const lan = $derived(!!network?.enabled)
  const pin = $derived(network?.pin || '')
  const addresses = $derived(network?.enabled && network.share_port ? network.lan_addresses.filter(address => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)).map(address => `http://${address}:${network!.share_port}`) : [])
  function setSharing(enable: boolean) {
    void work('lan', async signal => {
      await productionJson(`/system/network/${enable ? 'enable' : 'disable'}`, { method: 'POST', signal })
      network = await productionJson<NetworkState>('/system/network/state', { signal }); confirmLan = false
      if (network.enabled !== enable) throw new Error(tr('Silnik nie potwierdził żądanego stanu udostępniania.'))
      return enable ? 'Udostępnianie w sieci LAN włączone.' : 'Udostępnianie w sieci LAN zatrzymane.'
    })
  }
  let port = $state(''), portSaved = $state(false)
  const savedPort = $derived(info ? String(info.share_port_base) : '')
  const portValid = $derived(/^\d+$/.test(String(port)) && +port >= 1024 && +port <= 65535)
  function savePort() {
    void work('port', async signal => {
      await productionJson('/system/set-env', postJson({ key: 'OMNIVOICE_SHARE_PORT', value: String(settingsPort(port)) }, signal))
      info = await productionJson<SystemInfo>('/system/info', { signal }); port = String(info.share_port_base)
      portSaved = true; setTimeout(() => portSaved = false, 1200)
    })
  }
  let tsUrl = $state(''), tsOn = $state(false)
  function setTailscale(enable: boolean) {
    void work('ts', async signal => {
      const next = await productionJson<{ ok: boolean; url?: string; error?: string }>(`/system/tailscale/${enable ? 'enable' : 'disable'}`, { method: 'POST', signal })
      if (!next.ok) throw new Error(next.error || tr('Tailscale nie potwierdziło zmiany.'))
      tsOn = enable; tsUrl = enable ? next.url || '' : ''
      tailscale = await productionJson<Tailscale>('/system/tailscale/status', { signal })
      return enable ? 'Tailscale Serve włączony.' : 'Tailscale Serve wyłączony.'
    })
  }
  const tsState = $derived(!tailscale ? 'nieodczytany' : !tailscale.installed ? 'nie wykryto' : !tailscale.running ? 'nie działa lub wymaga zalogowania' : tailscale.magic_dns_name ? '' : 'połączony')

  // --- Zdalny silnik ---
  let remUrl = $state(''), remKey = $state('')
  const remote = $derived($remoteBackendState.active)
  function remoteAction(kind: 'test' | 'connect' | 'local') {
    const submitted = remKey; remKey = ''
    void work(kind, async signal => {
      if (kind === 'test') { const result = await remoteBackend.test(remUrl, submitted, signal); toast.ok(tr('Połączono. Zdalny silnik odpowiada ({detail}).', { detail: result.detail })); return }
      if (kind === 'connect') await remoteBackend.connect(remUrl, submitted, signal); else await remoteBackend.local(signal)
      signal.throwIfAborted(); await onremotechange?.()
      return kind === 'connect' ? 'Aplikacja używa teraz silnika na innym komputerze.' : 'Wrócono do lokalnego silnika.'
    })
  }
  function refreshRemote() { void work('refresh', async signal => { const next = await remoteBackend.state(signal); if (next.url && !remUrl) remUrl = next.url; return 'Stan połączenia odświeżony.' }) }

  // --- Serwer proxy ---
  let pxInput = $state(''), pxErr = $state('')
  function saveProxy(clear = false) {
    const value = clear ? '' : pxInput.trim()
    if (!clear && !/^(https?|socks5h?):\/\/.+/i.test(value)) { pxErr = 'Podaj adres w formacie http://host:port lub socks5://host:port.'; return }
    pxErr = ''; pxInput = ''
    void work('proxy', async signal => {
      proxy = await putSettings<ProxyState>('/next/settings/proxy', { url: value }, signal)
      return clear ? 'Proxy wyczyszczone.' : 'Zapisano. Nowe połączenia użyją serwera proxy.'
    })
  }
  function refreshProxy() { void work('proxy-read', async signal => { proxy = await productionJson<ProxyState>('/next/settings/proxy', { signal }); return 'Stan odświeżony.' }) }
</script>

{#snippet copyButton(value: string, label: string)}
  <Button variant="outline" size="sm" aria-label={tr(label)} onclick={() => copy(value)}>
    {#if copied === value}<Check size={14}/>{tr('Skopiowano')}{:else}<Copy size={14}/>{tr('Kopiuj')}{/if}
  </Button>
{/snippet}

<div class="p-page network-page">
  <div class="page-heading"><div><h1>{tr('Sieć i dostęp')}</h1><p>{tr('Kto korzysta z Twojego silnika, z którego silnika korzystasz Ty i jak aplikacja łączy się z internetem.')}</p></div></div>

  {#if !ready}
    <p class="p-notice">{tr('Silnik jest zatrzymany, więc ustawienia sieci są niedostępne. Uruchom go na stronie Silnik.')}{#if onnavigate} <Button size="sm" onclick={() => onnavigate?.('engine')}>{tr('Przejdź do strony Silnik')}</Button>{/if}</p>
  {:else}
  {#if loadError}<p class="p-notice bad" role="alert">{loadError}</p>{/if}
  <div class="filter-tabs p-tabs" role="tablist" aria-label={tr('Sieć i dostęp')}>
    {#each tabs as item (item.id)}
      <button role="tab" id={`${uid}-tab-${item.id}`} aria-selected={tab === item.id} aria-controls={`${uid}-panel`} class:chosen={tab === item.id} onclick={() => tab = item.id}>{tr(item.label)}</button>
    {/each}
  </div>

  <div class="p-card" role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${tab}`}>
  {#if tab === 'share'}
    <div class="p-section">
      <header class="split">
        <div><h3>{tr('Sieć lokalna (LAN)')}</h3><p>{tr('Inne urządzenia w Twojej sieci łączą się adresem i kodem PIN.')}</p></div>
        <div class="ctl" role="status">
          {#if lan}<StatusBadge kind="ok" text={tr('Udostępnianie włączone')}/>{:else}<StatusBadge kind="neutral" text={tr('Udostępnianie wyłączone')}/>{/if}
          {#if lan}<Button variant={armed.lan ? 'destructive' : 'outline'} disabled={!!busy} onclick={() => arm('lan', () => setSharing(false))}>{armed.lan ? tr('Potwierdź zatrzymanie') : tr('Zatrzymaj udostępnianie')}</Button>
          {:else}<Button disabled={confirmLan || !network || !!busy} onclick={() => confirmLan = true}>{tr('Udostępnij w sieci LAN')}</Button>{/if}
        </div>
      </header>

      {#if confirmLan && !lan}
        <div class="p-confirm" role="alertdialog" aria-labelledby={`${uid}-lan-title`}>
          <span><b id={`${uid}-lan-title`}>{tr('Włączyć dostęp w sieci LAN?')}</b><br>{tr('Każdy w tej sieci, kto zna adres i PIN, może generować mowę na tym komputerze. Nie włączaj tego w sieciach publicznych.')}</span>
          <div class="p-actions"><Button disabled={!!busy} onclick={() => setSharing(true)}>{tr('Włącz dostęp')}</Button><Button variant="outline" onclick={() => confirmLan = false}>{tr('Anuluj')}</Button></div>
        </div>
      {/if}

      <div class="p-rows">
        <div class="p-row">
          <div class="t"><label for={`${uid}-port`}><b>{tr('Bazowy port LAN')}</b></label><span>{tr('Zmiana działa od następnego włączenia udostępniania.')}</span></div>
          <div class="ctl"><div class="w-port"><Input id={`${uid}-port`} type="number" min="1024" max="65535" bind:value={port} disabled={!info}/></div><Button variant="outline" disabled={!info || !!busy || !portValid || String(port) === savedPort && !portSaved} onclick={savePort}><Save size={14}/>{portSaved ? tr('Zapisano') : tr('Zapisz port')}</Button></div>
        </div>
      </div>
      {#if info && !portValid}<p class="p-field-err" role="alert">{tr('Podaj port z zakresu 1024–65535.')}</p>{/if}

      {#if lan}
        <dl class="p-kv">
          <div><dt>{tr('Kod PIN')}</dt><dd>{#if pin}<code class="pin">{pin.replace(/(\d{3})(?=\d)/g, '$1 ')}</code>{@render copyButton(pin, 'Kopiuj kod PIN')}{:else}<span>{tr('nieodczytany')}</span>{/if}</dd></div>
          <div><dt>{tr('Port')}</dt><dd><code>{network?.share_port}</code></dd></div>
          {#each addresses as address, index (address)}
            <div><dt>{index ? tr('Adres alternatywny') : tr('Adres w sieci')}</dt><dd><code>{address}</code>{@render copyButton(address, index ? 'Kopiuj adres alternatywny' : 'Kopiuj adres w sieci')}</dd></div>
          {/each}
        </dl>
        <p class="p-sub">{tr('Na drugim urządzeniu wpisz adres w zakładce „Zdalny silnik” i podaj PIN. Adresy dotyczą API, nie interfejsu aplikacji.')}</p>
      {/if}
    </div>

    <div class="p-section">
      <header class="split">
        <div><h3>{tr('Tailscale Serve')}</h3><p>{tr('Prywatny dostęp dla Twoich urządzeń także poza domem. Bez publicznego Funnel.')}</p></div>
        <div class="ctl" role="status">
          {#if tsOn}<StatusBadge kind="ok" text={tr('Włączony')}/>{:else}<StatusBadge kind="neutral" text={tr('Wyłączony')}/>{/if}
          {#if tsOn}<Button variant={armed.ts ? 'destructive' : 'outline'} disabled={!!busy} onclick={() => arm('ts', () => setTailscale(false))}>{armed.ts ? tr('Potwierdź wyłączenie') : tr('Wyłącz Tailscale Serve')}</Button>
          {:else}<Button disabled={!tailscale?.running || !!busy} onclick={() => setTailscale(true)}>{tr('Włącz Tailscale Serve')}</Button>{/if}
        </div>
      </header>
      <dl class="p-kv">
        <div><dt>Tailscale</dt><dd>{tsState ? tr(tsState) : tr('połączony jako {name}', { name: tailscale?.magic_dns_name || '' })}</dd></div>
        {#if tsOn && tsUrl}<div><dt>{tr('Adres w sieci Tailscale')}</dt><dd><code>{tsUrl}</code>{@render copyButton(tsUrl, 'Kopiuj adres Tailscale')}</dd></div>{/if}
      </dl>
    </div>

    <div class="p-section">
      <div class="p-row flat"><div class="t"><b>{tr('Integracje')}</b><span>{tr('API zgodne z OpenAI, serwer MCP i głosy przypisane do klientów.')}</span></div><Button variant="outline" onclick={() => onnavigate?.('integrations')}>{tr('Otwórz Integracje')}<ArrowUpRight size={14}/></Button></div>
    </div>

  {:else if tab === 'remote'}
    <div class="p-section">
      <header class="split">
        <div><h3>{tr('Silnik używany przez aplikację')}</h3><p>{tr('Możesz użyć mocniejszego komputera z kartą graficzną zamiast lokalnego silnika.')}</p></div>
        <div class="ctl" role="status">{#if remote}<StatusBadge kind={$remoteBackendState.error ? 'bad' : 'ok'} text={tr('Zdalny silnik')}/>{:else}<StatusBadge kind="neutral" text={tr('Lokalny silnik')}/>{/if}</div>
      </header>
      {#if $remoteBackendState.error}<p class="p-notice bad" role="alert">{tr($remoteBackendState.error)}</p>{/if}
      <div class="flow" role="img" aria-label={tr('Kierunek połączenia: To urządzenie → silnik na innym komputerze')}>
        <div class="node" class:active={!remote}><b>{tr('To urządzenie')}</b><span>{tr('Aplikacja, którą teraz widzisz')}</span></div>
        <div class="arrow"><ArrowRight size={16}/><span>{tr('To urządzenie → silnik na innym komputerze')}</span></div>
        <div class="node" class:active={remote}><b>{tr('Silnik na innym komputerze')}</b><span>{remote ? $remoteBackendState.url : tr('Nie połączono')}</span></div>
      </div>
      <div class="p-row flat"><span class="p-sub">{tr('Odwrotnie, czyli udostępnienie tego komputera innym?')}</span><Button variant="ghost" onclick={() => tab = 'share'}>{tr('Przejdź do Udostępniania')}</Button></div>
    </div>

    <div class="p-section">
      <header class="split">
        <div><h3>{tr('Połączenie ze zdalnym silnikiem')}</h3><p>{tr('Adres i klucz znajdziesz na drugim komputerze, w jego zakładce Udostępnianie.')}</p></div>
        <Button variant="outline" disabled={!!busy} onclick={refreshRemote}><RefreshCw size={14}/>{tr('Odśwież połączenie')}</Button>
      </header>
      <div class="p-rows">
        <div class="p-row"><div class="t"><label for={`${uid}-url`}><b>{tr('Adres API')}</b></label><span>{tr('Na przykład http://192.168.1.20:8765')}</span></div>
          <div class="w-field"><Input id={`${uid}-url`} type="url" bind:value={remUrl} spellcheck={false} autocomplete="off"/></div></div>
        <div class="p-row"><div class="t"><label for={`${uid}-key`}><b>{tr('Klucz administratora')}</b></label><span>{tr('Używany jednorazowo, nie jest zapisywany.')}</span></div>
          <div class="w-field"><Input id={`${uid}-key`} type="password" bind:value={remKey} spellcheck={false} autocomplete="off" placeholder={$remoteBackendState.session_available ? tr('Puste pole — użyj zapisanej, ważnej sesji') : ''}/></div></div>
      </div>
      <div class="p-actions">
        <Button variant="outline" disabled={!remUrl.trim() || !!busy} onclick={() => remoteAction('test')}>{busy === 'test' ? tr('Sprawdzanie…') : tr('Testuj połączenie')}</Button>
        {#if remote}<Button variant="outline" disabled={!!busy} onclick={() => remoteAction('local')}>{tr('Użyj lokalnego silnika')}</Button>
        {:else}<Button disabled={!remUrl.trim() || !!busy} onclick={() => remoteAction('connect')}>{tr('Połącz i używaj zdalnego silnika')}</Button>{/if}
      </div>
      <p class="p-sub">{tr('Wymaga uruchomionego lokalnego silnika. Po restarcie aplikacja zaczyna od lokalnego.')}</p>
    </div>

  {:else}
    <div class="p-section">
      <header class="split">
        <div><h3>{tr('Serwer proxy')}</h3><p>{tr('Dla pobierania modeli, tłumaczy i dostawców LLM. Lokalna synteza pozostaje lokalna.')}</p></div>
        <div class="ctl" role="status">{#if proxy?.set}<StatusBadge kind="ok" text={tr('Proxy ustawione')}/>{:else}<StatusBadge kind="neutral" text={tr('Brak proxy')}/>{/if}</div>
      </header>
      {#if proxy?.set}<dl class="p-kv"><div><dt>{tr('Aktualny adres')}</dt><dd><code>{proxy.address}</code></dd></div></dl>{/if}
      <div class="p-rows">
        <div class="p-row"><div class="t"><label for={`${uid}-proxy`}><b>{tr('Nowy adres proxy')}</b></label><span>{tr('http://host:port lub socks5://host:port. Dane logowania są ukrywane.')}</span></div>
          <div class="w-field"><Input id={`${uid}-proxy`} type="password" bind:value={pxInput} oninput={() => pxErr = ''} autocomplete="new-password" spellcheck={false} placeholder="http://proxy.example.net:3128"/></div></div>
        {#if pxErr}<p class="p-field-err" role="alert">{tr(pxErr)}</p>{/if}
      </div>
      <div class="p-actions">
        <Button disabled={!pxInput.trim() || !!busy} onclick={() => saveProxy()}><Save size={14}/>{tr('Zapisz proxy')}</Button>
        <Button variant={armed.px ? 'destructive' : 'outline'} disabled={!proxy?.set || !!busy} onclick={() => arm('px', () => saveProxy(true))}>{armed.px ? tr('Potwierdź wyczyszczenie') : tr('Wyczyść proxy')}</Button>
        <Button variant="outline" disabled={!!busy} onclick={refreshProxy}><RefreshCw size={14}/>{tr('Odśwież stan')}</Button>
      </div>
      <p class="p-sub">{tr('Zapis nie testuje połączenia. Część bibliotek odczytuje proxy przy starcie, więc wymaga restartu silnika.')}</p>
    </div>

    <div class="p-section">
      <div class="p-row flat"><div class="t"><b>{tr('Mirror i token Hugging Face')}</b><span>{tr('Ustawisz je w Modele, w zakładce Pobieranie i dostęp.')}</span></div><Button variant="outline" onclick={() => onnavigate?.('models')}>{tr('Otwórz Modele')}<ArrowUpRight size={14}/></Button></div>
    </div>
  {/if}
  </div>
  {/if}
</div>

<style>
  .ctl{display:flex;align-items:center;flex-wrap:wrap;justify-content:flex-end;gap:8px;min-width:0}
  .network-page label b{font-size:var(--ui-text-13);font-weight:550}
  .w-port{width:120px}
  .w-field{width:min(100%,320px)}
  .p-confirm .p-actions{flex-shrink:0}
  .p-kv dd{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;min-width:0}
  .p-kv code{font-size:var(--ui-text-11);overflow-wrap:anywhere}
  .p-kv code.pin{font-family:var(--font-mono,monospace);font-size:var(--ui-text-18);font-weight:600;letter-spacing:4px}
  .flow{display:flex;align-items:stretch;flex-wrap:wrap;gap:12px}
  .node{flex:1;min-width:180px;display:flex;flex-direction:column;gap:3px;padding:12px 14px;border:1px solid var(--border);border-radius:8px;background:var(--surface-raised)}
  .node.active{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,var(--surface-raised))}
  .node b{font-size:var(--ui-text-13);font-weight:550}
  .node span{font-size:var(--ui-text-11);color:var(--muted);overflow-wrap:anywhere}
  .arrow{align-self:center;display:flex;align-items:center;gap:6px;color:var(--muted);font-size:var(--ui-text-11)}
  .p-row.flat{justify-content:space-between;gap:16px;flex-wrap:wrap}
  .p-notice :global([data-slot=button]){margin-left:8px}
</style>
