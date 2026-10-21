<script lang="ts">
  import Button from './ui/Button.svelte';
  import { onMount } from 'svelte';
  import { Download, X, Check, Cpu } from '@lucide/svelte';
  import { installingRuntime, runtimeInstaller, type RuntimeInstallStatus } from './runtime-installer';
  import { byteLabel } from './model-management';
  import Select from './ui/Select.svelte';
  let { runtimeStopped = false, onactivated }: { runtimeStopped?: boolean; onactivated?: () => Promise<void> } = $props();
  let status = $state<RuntimeInstallStatus>(), profile = $state<'cpu' | 'cuda'>('cpu'), error = $state(''), acting = $state(false), available = $state(false);
  let disposed = false;
  const active = $derived(installingRuntime(status));
  const phases: Record<string, string> = { preflight: 'Przygotowanie katalogu', uv: 'Pobieranie menedżera pakietów', python: 'Instalacja CPython', engine: 'Źródła silnika', lock: 'Przypięte wymagania', venv: 'Osobne środowisko', dependencies: 'Instalacja zależności', doctor: 'Kontrola bibliotek', health: 'Kontrola uruchomienia', ready: 'Gotowe do aktywacji', idle: 'Nie rozpoczęto' };
  function fail(cause: unknown) { if (!disposed) error = cause instanceof Error ? cause.message : String(cause); }
  async function action(operation: () => Promise<RuntimeInstallStatus>) {
    if (acting || disposed) return;
    acting = true; error = '';
    try { const result = await operation(); if (!disposed) status = result; }
    catch (cause) { fail(cause); }
    finally { if (!disposed) acting = false; }
  }
  onMount(() => {
    available = runtimeInstaller.available();
    if (!available) return;
    let polling = false;
    const refresh = async () => {
      if (polling || disposed || document.hidden) return;
      polling = true;
      try { const result = await runtimeInstaller.status(); if (!disposed) status = result; }
      catch (cause) { fail(cause); }
      finally { polling = false; }
    };
    void refresh();
    const timer = setInterval(() => { if (!acting) void refresh(); }, 1000);
    return () => { disposed = true; clearInterval(timer); };
  });
</script>

<section class="runtime-install" aria-label="Instalacja samodzielnego środowiska">
  <h2><Cpu size={18}/> Samodzielne środowisko Python</h2>
  <p>Przygotuj nowe środowisko bez wcześniejszej instalacji VoiceStudio. Istniejący silnik pozostaje zachowany. Wagi modeli pobiera się osobno w katalogu modeli.</p>
  {#if !available}<p class="runtime-install-note">Instalator jest dostępny w aplikacji Windows x64.</p>{:else}
    <Select ariaLabel="Wariant środowiska" bind:value={profile} options={[{ value: 'cpu', label: 'CPU — bez karty NVIDIA' }, { value: 'cuda', label: 'NVIDIA CUDA 12.8' }]} disabled={active || acting}/>
    <p class="runtime-install-note">{profile === 'cpu' ? 'CPU: kilka GB pobierania, wymagane co najmniej 20 GB wolnego miejsca. Generowanie będzie wolniejsze.' : 'CUDA: kilka–kilkanaście GB pobierania i co najmniej 35 GB wolnego miejsca. Wymaga zgodnej karty NVIDIA i sterownika obsługującego CUDA 12.8.'} To szacunek dla bibliotek, bez wag modeli.</p>
    <p class="runtime-install-note">Instalator pobierze przypięty uv i CPython, zweryfikuje źródła oraz zainstaluje zależności jako osobne kopie. Nie zmienia globalnego Pythona ani PATH. Aktywacja jest osobną czynnością po pomyślnym teście uruchomienia.</p>
    {#if error}<p class="tool-error" role="alert">{error}</p>{/if}
    {#if status}
      <div class="runtime-install-status" role="status"><strong>{phases[status.phase] || status.phase}</strong><span>{status.message}</span>{#if status.candidate}<code>{status.candidate}</code>{/if}</div>
      {#if active}{#if status.phase === 'uv' && status.totalBytes}<progress max={status.totalBytes} value={status.downloadedBytes} aria-label="Pobieranie uv"></progress><small>{byteLabel(status.downloadedBytes)} / {byteLabel(status.totalBytes)}</small>{:else}<progress aria-label="Instalacja środowiska"></progress>{/if}{/if}
      {#if status.logs.length}<details><summary>Dziennik instalacji</summary><pre>{status.logs.join('\n')}</pre></details>{/if}
    {/if}
    <div class="runtime-install-actions">
      {#if active}<Button variant="outline" disabled={acting || status?.state === 'cancelling'} onclick={() => action(runtimeInstaller.cancel)}><X size={15}/>Anuluj instalację</Button>
      {:else}<Button variant="outline" disabled={acting} onclick={() => action(() => runtimeInstaller.start(profile))}><Download size={15}/>{status && ['failed', 'cancelled', 'interrupted'].includes(status.state) ? 'Ponów w nowym środowisku' : 'Pobierz i przygotuj środowisko'}</Button>{/if}
      {#if status?.state === 'ready'}<Button variant="default" disabled={acting || !runtimeStopped} onclick={() => action(async () => { const result = await runtimeInstaller.activate(); await onactivated?.(); return result; })}><Check size={15}/>Użyj tego środowiska</Button>{#if !runtimeStopped}<span>Zatrzymaj silnik przed aktywacją.</span>{/if}{/if}
    </div>
  {/if}
</section>

<style>
  .runtime-install{display:flex;flex-direction:column;align-items:stretch;gap:14px;margin-top:28px;padding:22px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}h2{display:flex;align-items:center;gap:9px;font-size:var(--ui-text-17);margin:0}p{font-size:var(--ui-text-13);line-height:1.8;margin:0}.runtime-install-note{font-size:var(--ui-text-12);color:var(--muted)}.runtime-install-status{display:flex;flex-direction:column;gap:8px;font-size:var(--ui-text-13);line-height:1.7}.runtime-install-status code{font-size:var(--ui-text-11);overflow-wrap:anywhere;color:var(--muted)}progress{width:100%;height:7px;accent-color:var(--foreground)}small{font-size:var(--ui-text-11);color:var(--muted)}details{font-size:var(--ui-text-12)}pre{max-height:230px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--ui-text-11);line-height:1.7}.runtime-install-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.runtime-install-actions>span{font-size:var(--ui-text-12);color:var(--muted)}
</style>
