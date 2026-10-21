<script lang="ts">
  import Button from './ui/Button.svelte';
  import { dismissiblePopup } from './ui/overlay';
  import { tick } from 'svelte';
  import { Cpu, MemoryStick, Monitor, ChevronRight, X, ChartNoAxesColumnIncreasing } from '@lucide/svelte';
  import { productionJson } from './production';
  import { isDesktop } from './runtime';
  import { simulatedDevice, type SystemInfo } from './device-simulation';
  let { state: runtimeState, onmodels }: { state: string; onmodels: () => void } = $props();
  let open = $state(false), stats = $state<SystemInfo>(), error = $state(''), anchor: HTMLButtonElement;
  let position = $state({ left: 12, bottom: 64 });
  let demo = $state(!isDesktop()), sample = $state(0);
  const simulated = $derived(simulatedDevice(sample));
  const displayed = $derived(demo ? simulated.stats : stats);
  const percent = (used: number, total: number) => total > 0 ? Math.max(0, Math.min(100, used / total * 100)) : 0;
  const amount = (value: number) => value.toLocaleString('pl-PL', { maximumFractionDigits: 1 });
  const label = $derived(demo ? simulated.phase : error ? 'Brak połączenia z silnikiem' : runtimeState === 'ready' ? 'Silnik gotowy' : runtimeState === 'starting' ? 'Uruchamianie silnika' : runtimeState === 'error' ? 'Silnik wymaga uwagi' : 'Silnik zatrzymany');
  async function toggle() {
    open = !open;
    if (open) { stats = undefined; error = ''; await tick(); const rect = anchor.getBoundingClientRect(), box = document.querySelector<HTMLElement>('.device-popover')!.getBoundingClientRect(); position = { left: Math.max(12, Math.min(rect.left, innerWidth - box.width - 12)), bottom: Math.max(12, Math.min(innerHeight - rect.top + 8, innerHeight - box.height - 12)) }; document.querySelector<HTMLButtonElement>('.device-popover .close-device')?.focus(); }
  }
  function close() { open = false; anchor?.focus(); }
  $effect(() => {
    if (!open) return;
    const controller = new AbortController(); let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (demo) { sample = 0; stats = undefined; error = ''; }
    const schedule = () => {
      if (!controller.signal.aborted && !document.hidden) timer = setTimeout(() => { timer = undefined; void refresh(); }, 2000);
    };
    const refresh = async () => {
      if (pending || controller.signal.aborted || document.hidden) return;
      if (demo) { sample += 1; schedule(); return; }
      pending = true;
      try { const result = await productionJson<SystemInfo>('/sysinfo', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]) }); if (!controller.signal.aborted && !document.hidden) { stats = result; error = ''; } }
      catch { if (!controller.signal.aborted && !document.hidden) { stats = undefined; error = 'Parametry urządzenia będą dostępne po uruchomieniu lokalnego silnika.'; } }
      finally { pending = false; schedule(); }
    };
    if (demo) schedule(); else void refresh();
    const visibility = () => { clearTimeout(timer); timer = undefined; if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
  });
</script>

<button class="device-trigger" bind:this={anchor} aria-label="Parametry urządzenia" title="Parametry urządzenia" aria-expanded={open} onclick={toggle}><ChartNoAxesColumnIncreasing size={16}/></button>
{#if open}<div class="device-popover" use:dismissiblePopup={{ trigger: () => anchor, close: () => { open = false } }} role="dialog" tabindex="-1" aria-label="Urządzenie lokalne" style={`left:${position.left}px;bottom:${position.bottom}px`}>
  <header><span class="device-dot" class:ready={!demo && runtimeState === 'ready' && !error}></span><div><strong>Urządzenie lokalne</strong><span>{label}</span></div><Button variant="ghost" size="icon" class="close-device " aria-label="Zamknij parametry urządzenia" onclick={close}><X size={15}/></Button></header>
  <div class="device-source" aria-label="Źródło parametrów"><button aria-pressed={!demo} onclick={() => demo = false}>Rzeczywiste</button><button aria-pressed={demo} onclick={() => demo = true}>Dane testowe</button></div>
  {#if demo}<p class="simulation-note" role="status"><strong>SYMULACJA</strong><span>Przykładowe dane zmieniają się co 2 s.</span></p>{/if}
  {#if displayed}<div class="device-metrics">
    <div class="metric"><div><Cpu size={16}/><strong>CPU</strong><b>{Math.round(displayed.cpu)}%</b></div><small title={displayed.cpu_model}>{displayed.cpu_model || 'Procesor'} <span>{displayed.cpu_physical_cores}C / {displayed.cpu_logical_cores}T / {amount(displayed.cpu_frequency_ghz)} GHz</span></small><div class="meter" role="meter" aria-label="Użycie CPU" aria-valuenow={displayed.cpu} aria-valuemin="0" aria-valuemax="100"><i style={`width:${Math.min(100, Math.max(0, displayed.cpu))}%`}></i></div></div>
    <div class="metric"><div><MemoryStick size={16}/><strong>RAM</strong><b>{amount(displayed.ram)} / {amount(displayed.total_ram)} GB</b></div><div class="meter" role="meter" aria-label="Użycie RAM" aria-valuenow={displayed.ram} aria-valuemin="0" aria-valuemax={displayed.total_ram}><i style={`width:${percent(displayed.ram, displayed.total_ram)}%`}></i></div></div>
    <div class="metric"><div><Monitor size={16}/><strong>GPU</strong><b>{displayed.gpu_utilization === null ? '—' : `${Math.round(displayed.gpu_utilization)}%`}</b></div><small title={displayed.gpu_name}>{displayed.gpu_name || 'Brak dedykowanej karty'}<span>{displayed.total_vram > 0 ? `${amount(displayed.vram)} / ${amount(displayed.total_vram)} GB` : 'Pamięć współdzielona lub brak odczytu'}</span></small><div class="meter" role="meter" aria-label="Użycie pamięci GPU" aria-valuenow={displayed.vram} aria-valuemin="0" aria-valuemax={displayed.total_vram || 1}><i style={`width:${percent(displayed.vram, displayed.total_vram)}%`}></i></div></div>
  </div>{:else}<p class="device-message" role="status">{error || 'Odczytywanie parametrów…'}</p>{/if}
  <button class="device-settings" onclick={() => { open = false; onmodels(); }}><Cpu size={15}/><span>Modele i silnik</span><ChevronRight size={15}/></button>
</div>{/if}

<style>
  .device-source{display:flex;gap:4px;padding:3px;border:1px solid var(--border);border-radius:8px;margin-bottom:12px}.device-source button{flex:1;padding:6px;border-radius:5px;font-size:var(--ui-text-11);color:var(--muted)}.device-source button[aria-pressed=true]{background:var(--surface-hover);color:var(--foreground)}.simulation-note{display:flex;align-items:center;gap:9px;font-size:var(--ui-text-10);color:var(--muted);margin-bottom:13px;line-height:1.5}.simulation-note strong{font-size:var(--ui-text-9);color:var(--accent);letter-spacing:.6px}

  .device-trigger{width:var(--footer-action-size,32px);height:var(--footer-action-size,32px);display:grid;place-items:center;border-radius:var(--nav-radius,8px);position:relative;color:var(--sidebar-muted,var(--muted))}.device-trigger[aria-expanded=true],.device-trigger:hover{background:var(--sidebar-hover)}.device-dot{width:7px;height:7px;border-radius:50%;background:var(--muted);flex-shrink:0}.device-dot.ready{background:var(--success,#32bd90)}.device-popover{position:fixed;z-index:110;width:min(280px,calc(100vw - 24px));padding:12px;border:1px solid var(--border);border-radius:var(--menu-radius,14px);box-shadow:var(--popup-shadow);color:var(--foreground);font-size:var(--ui-text-13);max-height:calc(100dvh - 24px);overflow:auto}.device-popover header{display:flex;align-items:center;gap:10px;margin-bottom:12px}.device-popover header>div{flex:1;display:flex;flex-direction:column;gap:4px}.device-popover header strong{font-size:var(--ui-text-13)}.device-popover header span:not(.device-dot){font-size:var(--ui-text-11);color:var(--muted)}.device-metrics{display:flex;flex-direction:column;gap:14px}.metric+.metric{padding-top:12px;border-top:1px solid var(--border)}.metric>div:first-child{display:flex;gap:8px;align-items:center}.metric b{margin-left:auto;font-size:var(--ui-text-12);font-variant-numeric:tabular-nums}.metric small{display:flex;flex-direction:column;gap:4px;overflow-wrap:anywhere;font-size:var(--ui-text-10);color:var(--muted);margin:8px 0}.metric small span{flex-shrink:0}.meter{height:4px;background:var(--border);border-radius:4px;overflow:hidden;margin-top:9px}.meter i{display:block;height:100%;background:var(--accent);border-radius:inherit;transition:width .25s}.device-settings{display:flex;align-items:center;gap:9px;width:100%;margin-top:12px;padding:10px 2px 0;border-top:1px solid var(--border);font-size:var(--ui-text-12)}.device-settings span{flex:1;text-align:left}.device-message{font-size:var(--ui-text-12);color:var(--muted);line-height:1.7;padding:12px 2px}
</style>
