<script lang="ts">
  import { untrack, onDestroy } from 'svelte'
  import { Computer, Network, RefreshCw } from '@lucide/svelte'
  import Button from './ui/Button.svelte'
  import Input from './ui/Input.svelte'
  import { remoteBackend, remoteBackendState, type RemoteBackendState } from './remote-backend'

  let { ready = false, onchanged }: { ready?: boolean; onchanged?: (value: RemoteBackendState) => void | Promise<void> } = $props()
  let url = $state(''), key = $state(''), busy = $state(false), loading = $state(false), error = $state(''), message = $state('')
  let controller: AbortController | undefined
  let disposed = false
  const disabled = $derived(!ready || busy || loading)
  function fail(cause: unknown) {
    if (cause instanceof Error && cause.name === 'AbortError') return
    error = cause instanceof Error && cause.name === 'TimeoutError' ? 'Silnik nie odpowiedział na czas. Sprawdź połączenie i ponów test.' : cause instanceof Error ? cause.message : 'Nie udało się sprawdzić połączenia.'
  }
  async function refresh() {
    if (!ready || busy || loading || disposed) return
    controller?.abort(); const request = new AbortController(); controller = request; loading = true
    try { const value = await remoteBackend.state(request.signal); if (!disposed) url = value.url }
    catch (cause) { if (!request.signal.aborted) fail(cause) }
    finally { if (controller === request) loading = false }
  }
  $effect(() => { if (!ready) return; untrack(() => { void refresh() }); return () => { controller?.abort(); key = ''; loading = false } })
  onDestroy(() => { disposed = true; key = ''; controller?.abort() })
  async function run(kind: 'test' | 'connect' | 'local') {
    if (disabled || disposed) return
    const submitted = key; key = ''; busy = true; error = ''; message = ''
    controller?.abort(); const request = new AbortController(); controller = request
    try {
      if (kind === 'test') {
        const result = await remoteBackend.test(url, submitted, request.signal)
        if (!disposed) message = `Połączenie sprawdzone: ${result.detail}. Test nie zmienia wybranego silnika.`
      } else {
        const value = kind === 'connect' ? await remoteBackend.connect(url, submitted, request.signal) : await remoteBackend.local(request.signal)
        request.signal.throwIfAborted(); await onchanged?.(value)
        if (!disposed) message = kind === 'local' ? 'Wybrano lokalny silnik. Sesję zdalną usunięto z tej aplikacji.' : `Połączono: ${value.detail}. Operacje studia będą korzystać z wybranego serwera.`
      }
    } catch (cause) { if (!request.signal.aborted) fail(cause) }
    finally { if (controller === request) busy = false }
  }
</script>

<section class="remote-backend-settings tool-card" aria-labelledby="remote-backend-title">
  <div class="remote-heading"><h2 id="remote-backend-title"><Network size={18}/> Zdalny silnik VoiceStudio</h2><Button variant="ghost" size="sm" disabled={disabled} onclick={refresh}><RefreshCw size={14}/>Odśwież połączenie</Button></div>
  <p>Użyj silnika na własnym serwerze lub drugim komputerze. Po wybraniu połączenia tekst, nagrania i pliki operacji studia będą przesyłane pod wskazany adres.</p>
  {#if !ready}<p class="tool-notice">Uruchom prywatny silnik aplikacji, aby połączyć bezpieczny lokalny transport.</p>{/if}
  {#if error}<p class="tool-error" role="alert">{error}</p>{/if}
  {#if message}<p class="tool-notice" role="status">{message}</p>{/if}
  {#if $remoteBackendState.error}<p class="tool-error" role="alert">{$remoteBackendState.error}</p>{/if}
  <p class="remote-status" role="status"><strong>{$remoteBackendState.active ? 'Aktywny zdalny silnik' : 'Aktywny lokalny silnik'}</strong>{#if $remoteBackendState.active}<code>{$remoteBackendState.url}</code><span>{$remoteBackendState.detail}</span>{/if}</p>
  <label for="remote-backend-url">Adres API zdalnego silnika</label>
  <Input id="remote-backend-url" type="url" bind:value={url} placeholder="https://twoj-serwer/studio" spellcheck={false} autocomplete="off" disabled={disabled}/>
  <label for="remote-backend-key">Klucz administratora serwera</label>
  <Input id="remote-backend-key" type="password" bind:value={key} autocomplete="off" spellcheck={false} disabled={disabled} placeholder={$remoteBackendState.session_available ? 'Puste pole — użyj zapisanej, ważnej sesji' : 'Wymagany, jeśli serwer chroni dostęp kluczem'}/>
  <p class="page-footnote">Klucz jest używany jednorazowo i nie jest zapisywany. Krótka sesja jest szyfrowana w prywatnej bazie; nie trafia do pamięci przeglądarki ani adresów połączeń. Po ponownym uruchomieniu aplikacja zaczyna od lokalnego silnika.</p>
  {#if $remoteBackendState.session_expires_at}<p class="page-footnote">Sesja ważna do {new Date($remoteBackendState.session_expires_at * 1000).toLocaleString('pl')}. Restart serwera lub zmiana klucza mogą ją unieważnić wcześniej.</p>{/if}
  <div class="tool-actions"><Button variant="outline" disabled={disabled || !url.trim()} onclick={() => run('test')}>{busy ? 'Sprawdzanie…' : 'Testuj połączenie'}</Button><Button disabled={disabled || !url.trim()} onclick={() => run('connect')}>Połącz i używaj zdalnego silnika</Button><Button variant="outline" disabled={disabled} onclick={() => run('local')}><Computer size={15}/>Użyj lokalnego silnika</Button></div>
  <p class="page-footnote">Zdalny serwer musi udostępniać API VoiceStudio, nie sam panel WWW. Zmiana połączenia nie kopiuje profili, historii ani projektów do lokalnej bazy. Po błędzie operacja nie przełącza się automatycznie na inny silnik.</p>
</section>

<style>
  .remote-backend-settings { display: flex; flex-direction: column; gap: 12px; }
  .remote-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
  .remote-heading h2 { display: flex; align-items: center; gap: 9px; font-size: 16px; margin: 0; }
  .remote-backend-settings p { margin: 0; line-height: 1.6; }
  .remote-backend-settings label { font-size: 13px; font-weight: 500; }
  .remote-status { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; font-size: 13px; }
  .remote-status code { overflow-wrap: anywhere; }
</style>
