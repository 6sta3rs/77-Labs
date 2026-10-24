<script lang="ts">
  // Settings → "Silnik": engine status, live load, generation speed and the four engine tabs.
  // Port of the approved prototype (docs/features/settings-style.md); every value comes from the engine, Tauri or local settings.
  import { uiLanguage, createUiTranslator } from '../../i18n';
  import { onDestroy, tick, untrack } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { Play, Square, RotateCw, RefreshCw, Copy, Download, X, Check, ChevronRight, LoaderCircle, Trash2, Activity, FileText, Search } from '@lucide/svelte';
  import Button from '../../ui/Button.svelte';
  import ButtonGroup from '../../ui/ButtonGroup.svelte';
  import Select from '../../ui/Select.svelte';
  import Switch from '../../ui/Switch.svelte';
  import Input from '../../ui/Input.svelte';
  import StatusBadge, { type BadgeKind } from '../../ui/StatusBadge.svelte';
  import { toast } from '../../ui/toast';
  import '../../tools/studio-tools.css';
  import { productionJson, postJson } from '../../tools/production/production';
  import {
    computeChoices, diagnosticCheckLabels, recentRuntimeErrors, redactDiagnosticText, redactDiagnosticValue, runOfflineDiagnostics, runtimeSnapshot,
    saveCompileDisabled, saveComputeDevice, savePerformance, unloadRuntimeModel,
    type ComputeState, type LoadedModel, type PerformanceState, type RecentError, type RuntimeMemory,
  } from '../../platform/runtime-diagnostics';
  import {
    gpuEngineLabels, gpuOptionLabels, gpuStateLabels, preflightCheckLabels, putSettings, settingsError, settingsTimeout,
    type CudaState, type GpuReport, type MediaState, type PreflightReport, type SystemInfo,
  } from '../system-settings';
  import { readEngineIdleMinutes, saveEngineIdleMinutes, engineIdleOptions, readEngineAutostart, saveEngineAutostart, readEnginePreload, saveEnginePreload, type EngineIdleMinutes } from '../../platform/runtime';
  import { readModelWarmup, warmupNote, type ModelWarmup, type WarmupNote } from '../../platform/engine-startup';
  import { get } from 'svelte/store';
  import { engineCatalog, modelsCatalog } from '../../tools/studio-tools';
  import { engineCatalogSnapshot } from '../../models/engine-catalog-state';
  import { runtimeInstaller, installingRuntime, type RuntimeInstallStatus } from '../../platform/runtime-installer';
  import { engineInstallation, runtimeInstallActive, runtimeInstallLabels, runtimePhaseLabels, runtimeSize, runtimeTransfer,
    type EngineRuntimeCatalog, type EngineRuntimeJob, type EngineRuntimeRecipe } from '../../models/engine-installation';
  import { openLicenseSource, validateLicenseSource } from '../../models/license-sources';
  import { byteLabel } from '../../models/model-management';
  import type { SystemInfo as LiveInfo } from '../../platform/device-simulation';

  type Runtime = { state: string; message: string; port: number; managed: boolean; dataDir?: string; source?: string; startup?: { copiedBytes: number; totalBytes: number | null } };
  let { runtime, busy = false, generating = false, desktop = false, intent = '', onstart, onstop, onrestart, onrefresh, onchange, onnavigate }: {
    runtime: Runtime; busy?: boolean; generating?: boolean; desktop?: boolean; intent?: string
    onstart: () => void | Promise<void>; onstop: () => void | Promise<void>; onrestart?: () => Promise<void>
    onrefresh: () => void | Promise<void>; onchange?: () => void | Promise<void>; onnavigate?: (section: any, intent?: string) => void
  } = $props();
  const tr = $derived(createUiTranslator($uiLanguage));

  /* ---------- helpers ---------- */
  let disposed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  const controllers = new Set<AbortController>();
  onDestroy(() => { disposed = true; timers.forEach(clearTimeout); controllers.forEach(c => c.abort()); });
  const pad = (n: number) => String(n).padStart(2, '0');
  const hms = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const pl = (n: number, one: string, few: string, many: string) => n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;
  const num = (n: number, digits = 1) => n.toLocaleString(tr.locale, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  let copied = $state('');
  async function copy(key: string, text: string) { try { await navigator.clipboard.writeText(text); copied = key; later(() => { if (copied === key) copied = ''; }, 1800); } catch { toast.bad(tr('Nie udało się skopiować. Zaznacz tekst i skopiuj go ręcznie.')); } }
  function download(name: string, text: string, type: string) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
    later(() => URL.revokeObjectURL(a.href), 30_000);
  }
  // Two-step inline confirmation: the first click arms the button (label changes), the second runs the action; disarms after 4 s.
  let armed = $state<Record<string, boolean>>({});
  const armTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  function arm(key: string, fn: () => void) {
    if (armed[key]) { clearTimeout(armTimers[key]); armed[key] = false; fn(); return; }
    armed[key] = true; armTimers[key] = later(() => armed[key] = false, 4000);
  }
  // One action at a time per key; errors become a red toast.
  let working = $state<Record<string, boolean>>({});
  async function act(key: string, fn: (signal: AbortSignal) => Promise<void>) {
    if (working[key] || disposed) return;
    const controller = new AbortController(); controllers.add(controller); working[key] = true;
    try { await fn(controller.signal); }
    catch (cause) { if (!controller.signal.aborted && !disposed) toast.bad(tr(settingsError(cause))); }
    finally { controllers.delete(controller); if (!disposed) working[key] = false; }
  }
  const flashTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  let savedFlag = $state<Record<string, boolean>>({});
  function flash(key: string) { clearTimeout(flashTimers[key]); savedFlag[key] = true; flashTimers[key] = later(() => savedFlag[key] = false, 1800); }

  /* ---------- engine state ---------- */
  const ready = $derived(runtime.state === 'ready');
  let action = $state<'start' | 'stop' | 'restart' | null>(null);
  const starting = $derived(runtime.state === 'starting' || busy || !!action);
  const stopped = $derived(!ready && !starting);
  const on = $derived(ready && !starting);
  const actionLabel = $derived(action === 'stop' ? 'Zatrzymywanie' : action === 'restart' ? 'Ponowne uruchamianie' : 'Uruchamianie');
  async function run(kind: 'start' | 'stop' | 'restart') {
    if (action) return;
    action = kind;
    try {
      if (kind === 'start') await onstart();
      else if (kind === 'stop') await onstop();
      else await onrestart?.();
      if (disposed) return;
      if (kind === 'stop') { if (runtime.state === 'stopped') toast.ok(tr('Silnik zatrzymany')); }
      else if (runtime.state === 'ready') { restartPending = false; toast.ok(tr(kind === 'start' ? 'Silnik uruchomiony' : 'Silnik uruchomiony ponownie')); }
    } catch (cause) { if (!disposed) toast.bad(tr(settingsError(cause))); }
    finally { if (!disposed) action = null; }
  }
  const startupPct = $derived(runtime.startup?.totalBytes ? Math.min(100, runtime.startup.copiedBytes / runtime.startup.totalBytes * 100) : null);

  /* ---------- engine data (read only while ready) ---------- */
  let memory = $state<RuntimeMemory>();
  let models = $state<LoadedModel[] | null>(null);
  let compute = $state<ComputeState>(), performance = $state<PerformanceState>(), compileOff = $state<boolean | null>(null);
  let cuda = $state<CudaState>(), offload = $state<{ enabled: boolean; env_pinned: boolean; device: string }>(), info = $state<SystemInfo>();
  let media = $state<MediaState>();
  type Gen = { id: string; created_at: number; duration_seconds?: number | null; generation_time?: number | null; mode?: string | null };
  let history = $state<Gen[] | null>(null);
  let logLines = $state<string[]>([]), logExists = $state(true);
  let restartPending = $state(false);
  let loadedFor = '';

  async function readLogs(signal?: AbortSignal) {
    const next = await productionJson<{ lines: string[]; exists: boolean }>('/system/logs?tail=1000', { signal });
    logLines = (next.lines || []).map(line => redactDiagnosticText(line).slice(0, 2000)); logExists = next.exists;
  }
  async function readHistory(signal?: AbortSignal) {
    const rows = await productionJson<Gen[]>('/history', { signal });
    history = rows.filter(r => (r.duration_seconds ?? 0) > 0 && (r.generation_time ?? 0) > 0).sort((a, b) => a.created_at - b.created_at).slice(-12);
  }
  async function readModels(signal?: AbortSignal) {
    const next = await productionJson<{ models: LoadedModel[] }>('/model/loaded', { signal });
    models = redactDiagnosticValue(next.models || []);
  }
  // Rows are hidden until their value is read, so a failed read must be named instead of silently leaving the row out.
  type Unread = { label: string; tab: Tab };
  let unread = $state<Unread[]>([]);
  async function load(signal: AbortSignal) {
    const fails: Unread[] = [];
    const read = async <T,>(label: string, failTab: Tab, path: string, apply: (value: T) => void) => {
      try { const value = await productionJson<T>(path, { signal }); signal.throwIfAborted(); if (!disposed) apply(value); }
      catch (cause) { signal.throwIfAborted(); fails.push({ label, tab: failTab }); }
    };
    const [snap] = await Promise.allSettled([
      runtimeSnapshot(signal),
      read<CudaState>('wybór karty CUDA', 'obliczenia', '/api/settings/cuda-device', v => { cuda = v; cardDraft = v.value; }),
      read<typeof offload>('przenoszenie modelu do RAM', 'uruchamianie', '/api/settings/perf/offload-after-generation', v => offload = v),
      read<SystemInfo>('limity czasu generowania', 'obliczenia', '/system/info', v => { info = v; limGpu = String(v.generate_timeout_s); limCpu = String(v.cpu_generate_timeout_s); }),
      readHistory(signal), readLogs(signal),
    ]);
    signal.throwIfAborted();
    if (snap.status === 'fulfilled' && !disposed) {
      const s = snap.value;
      if (s.compute.error) fails.push({ label: 'urządzenie obliczeń', tab: 'obliczenia' });
      if (s.performance.error) fails.push({ label: 'presety szybkości i jakości', tab: 'obliczenia' });
      if (s.compile.error) fails.push({ label: 'torch.compile', tab: 'obliczenia' });
      if (s.memory.error) fails.push({ label: 'zużycie pamięci i karty', tab: 'stan' });
      if (s.models.error) fails.push({ label: 'załadowane modele', tab: 'uruchamianie' });
      if (s.memory.data) memory = s.memory.data;
      models = s.models.data ? s.models.data.models : null;
      if (s.compute.data) { compute = s.compute.data; devDraft = s.compute.data.value; }
      if (s.performance.data) { performance = s.performance.data; if (!s.performance.data.applicable_families.includes(fam)) fam = s.performance.data.applicable_families[0] || ''; }
      if (s.compile.data) compileOff = s.compile.data.enabled;
      if (s.media.data) media = s.media.data as MediaState;
    }
    if (!disposed) unread = fails;
  }
  function reload() {
    const controller = new AbortController(); controllers.add(controller);
    return load(controller.signal).catch(cause => { if (!controller.signal.aborted && !disposed) toast.bad(tr(settingsError(cause))); }).finally(() => controllers.delete(controller));
  }
  // First read once the engine is ready; again after every restart.
  $effect(() => {
    const key = ready ? `${runtime.port}:${runtime.message}` : '';
    if (!ready) { loadedFor = ''; untrack(() => { memory = undefined; models = null; liveHist = { cpu: [], ram: [], gpu: [], vram: [] }; }); return; }
    if (loadedFor) return;
    loadedFor = key; untrack(() => void reload());
  });
  // A finished TTS run adds a generation record: refresh the speed card.
  let wasGenerating = false;
  $effect(() => {
    const now = generating;
    if (wasGenerating && !now && ready) untrack(() => { void readHistory().catch(() => {}); void readModels().catch(() => {}); });
    wasGenerating = now;
  });
  async function refreshState() {
    await act('refresh', async () => { await onrefresh(); if (ready) await reload(); }); // App reports the result (studio refresh)
  }

  /* ---------- live load (/sysinfo is a monitor read: does not keep the engine awake) ---------- */
  type Key = 'cpu' | 'ram' | 'gpu' | 'vram';
  const HIST = 40;
  let liveHist = $state<Record<Key, number[]>>({ cpu: [], ram: [], gpu: [], vram: [] });
  $effect(() => {
    if (!ready) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const tickLive = async () => {
      if (!document.hidden) {
        try {
          const s = await productionJson<LiveInfo>('/sysinfo', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]) });
          if (controller.signal.aborted) return;
          memory = { ...(memory ?? {} as RuntimeMemory), ...s };
          const push = (k: Key, v: number | null) => liveHist[k] = [...liveHist[k], Math.max(0, Math.min(100, v ?? 0))].slice(-HIST);
          push('cpu', s.cpu); push('ram', s.total_ram > 0 ? s.ram / s.total_ram * 100 : 0);
          push('gpu', s.gpu_utilization); push('vram', s.total_vram > 0 ? s.vram / s.total_vram * 100 : 0);
        } catch { /* The next tick retries; the tiles keep the last reading. */ }
      }
      if (!controller.signal.aborted) timer = setTimeout(tickLive, 2000);
    };
    void tickLive();
    return () => { controller.abort(); clearTimeout(timer); };
  });

  /* ---------- names ---------- */
  const DEV_NAMES: Record<string, string> = { auto: 'Automatycznie', cuda: 'Karta NVIDIA', cpu: 'Procesor', rocm: 'Karta AMD (ROCm)', mps: 'Apple (MPS)', xpu: 'Intel (XPU)', npu: 'Układ NPU' };
  const devName = (d?: string) => d ? tr(DEV_NAMES[d] ?? d.toUpperCase()) : '—';
  const TIER_NAMES: Record<string, string> = { auto: 'Automatycznie', fast: 'Szybko', balanced: 'Zrównoważony', quality: 'Jakość', max: 'Maksymalny' };
  const tierName = (t?: string) => t ? tr(TIER_NAMES[t] ?? t) : '—';
  const TIER_HINT: Record<string, string> = { auto: 'Silnik dobiera preset do wykrytego sprzętu.', fast: 'Najkrótszy czas, nieco mniej naturalne brzmienie.', balanced: 'Dobry kompromis. Zalecany na co dzień.', quality: 'Najlepsze brzmienie, generowanie trwa 2–3 razy dłużej.', max: 'Największe modele; generowanie trwa najdłużej.' };
  const FAMILY_NAMES: Record<string, string> = { tts: 'Synteza mowy', asr: 'Rozpoznawanie mowy', translation: 'Tłumaczenie', dictation: 'Dyktowanie', diarisation: 'Rozdzielanie mówców', llm: 'Model językowy' };
  const famName = (f: string) => tr(FAMILY_NAMES[f] ?? f);

  /* ---------- header + tiles ---------- */
  const usesGpu = $derived(compute ? compute.effective_family !== 'cpu' : !!memory && memory.total_vram > 0);
  let lastHw = $state<string[]>([]);
  const hwParts = $derived.by(() => {
    if (!memory) return [] as string[];
    const m = memory as RuntimeMemory & Partial<LiveInfo>;
    if (usesGpu && m.gpu_name) return [m.gpu_name, ...(m.total_vram > 0 ? [`${num(m.total_vram, 0)} GB VRAM`] : [])];
    return [m.cpu_model || tr('Procesor'), ...(m.cpu_physical_cores ? [`${m.cpu_physical_cores} ${tr(pl(m.cpu_physical_cores, 'rdzeń', 'rdzenie', 'rdzeni'))}`] : []), `${num(m.total_ram, 0)} GB RAM`];
  });
  $effect(() => { if (hwParts.length) lastHw = hwParts; });
  const shownHw = $derived(hwParts.length ? hwParts : lastHw);
  const devPending = $derived(!!compute?.restart_required || !!cuda?.restart_required);
  const pending = $derived(devPending || restartPending);
  const level = (v: number) => v > 90 ? 'vhi' : v > 75 ? 'hi' : '';
  const pts = (a: number[]) => a.map((v, i) => `${((HIST - a.length + i) / (HIST - 1) * 120).toFixed(1)},${(26 - v / 100 * 24).toFixed(1)}`).join(' ');
  const tiles = $derived.by(() => {
    const m = memory as (RuntimeMemory & Partial<LiveInfo>) | undefined;
    const defs: [Key, string, () => string, boolean][] = [
      ['cpu', 'Procesor (CPU)', () => [m?.cpu_model, m?.cpu_physical_cores ? `${m.cpu_physical_cores} ${tr(pl(m.cpu_physical_cores, 'rdzeń', 'rdzenie', 'rdzeni'))}` : ''].filter(Boolean).join(' · '), true],
      ['ram', 'Pamięć RAM', () => m ? `${num(m.ram)} / ${num(m.total_ram, 0)} GB` : '', true],
      ['gpu', 'Karta graficzna (GPU)', () => m?.gpu_name || tr('Nie wykryto karty'), m?.gpu_utilization != null],
      ['vram', 'Pamięć karty (VRAM)', () => m && m.total_vram > 0 ? `${num(m.vram)} / ${num(m.total_vram, 0)} GB` : tr('Brak odczytu'), !!m && m.total_vram > 0]];
    return defs.map(([k, label, detail, measured]) => {
      const v = liveHist[k].at(-1) ?? 0, gpuOff = (k === 'gpu' || k === 'vram') && !usesGpu, off = !on || !m || gpuOff || !measured || !liveHist[k].length;
      return { k, label, v: off ? 0 : v, off, level: off ? '' : level(v), big: off ? '—' : `${Math.round(v)}%`,
        detail: !on || !m ? tr('brak danych') : gpuOff ? tr('nie używana (tryb procesora)') : detail() };
    });
  });

  /* ---------- generation speed (from /history: duration_seconds + generation_time) ---------- */
  const gens = $derived(history ?? []);
  const hasGens = $derived(on && gens.length > 0);
  const genMax = $derived(gens.length ? Math.max(...gens.map(g => g.generation_time!)) * 1.1 : 1);
  const genAvg = $derived(gens.length ? gens.reduce((a, g) => a + g.generation_time!, 0) / gens.length : 0);
  const speed = $derived.by(() => { const v = gens.map(g => g.duration_seconds! / g.generation_time!).sort((a, b) => a - b), h = v.length >> 1; return !v.length ? 0 : v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2; });
  const fmtT = (s: number) => { s = Math.round(s); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`; };
  const fmtX = (x: number) => x >= 10 ? String(Math.round(x)) : num(x);
  const dur = (s: number) => {
    if (s < 1) return tr('poniżej 1 s');
    if (s < 59.5) return tr('ok. {n} s', { n: Math.round(s) });
    if (s < 600) { const r = Math.round(s / 10) * 10; return r % 60 ? tr('ok. {m} min {s} s', { m: Math.floor(r / 60), s: r % 60 }) : tr('ok. {m} min', { m: r / 60 }); }
    if (s < 5400) return tr('ok. {m} min', { m: Math.round(s / 60) });
    let h = Math.floor(s / 3600), m = Math.round(s % 3600 / 300) * 5; if (m === 60) { h++; m = 0; }
    return m ? tr('ok. {h} godz. {m} min', { h, m }) : tr('ok. {h} godz.', { h });
  };
  const MODES: Record<string, string> = { clone: 'Klonowanie głosu', design: 'Projektowanie głosu', auto: 'Głos automatyczny' };
  const when = (g: Gen) => { const d = new Date(g.created_at * 1000); return `${d.toLocaleDateString(tr.locale, { day: 'numeric', month: 'short' })} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const genTip = (g: Gen) => [when(g), tr('Czas: {t}', { t: fmtT(g.generation_time!) }), tr('Nagranie: {t}', { t: fmtT(g.duration_seconds!) }), tr('Szybkość: {x}×', { x: fmtX(g.duration_seconds! / g.generation_time!) }), g.mode ? tr(MODES[g.mode] ?? g.mode) : ''];
  const bars = $derived(Array.from({ length: 12 }, (_, i) => gens[i - (12 - gens.length)]));
  const activeModel = $derived(models?.[0] ? `${models[0].name}${models[0].device ? ` · ${models[0].device.split(':')[0].toUpperCase()}` : ''}` : '');
  const memTotal = $derived((models ?? []).reduce((a, x) => a + (x.vram_mb ?? 0), 0));
  const mb = (v: number) => `${Math.round(v).toLocaleString(tr.locale)} MB`;
  function freeModel(model: LoadedModel) {
    void act('free:' + model.id, async signal => { await unloadRuntimeModel(model, signal); await readModels(signal); toast.ok(tr('Zwolniono: {name}', { name: model.name })); });
  }

  /* ---------- tabs ---------- */
  type Tab = 'stan' | 'uruchamianie' | 'obliczenia' | 'srodowiska' | 'dzienniki';
  const tabs: [Tab, string][] = [['stan', 'Stan'], ['uruchamianie', 'Uruchamianie i pamięć'], ['obliczenia', 'Obliczenia'], ['srodowiska', 'Środowiska'], ['dzienniki', 'Dzienniki i diagnostyka']];
  const INTENTS: Record<string, Tab> = { stan: 'stan', state: 'stan', uruchamianie: 'uruchamianie', startup: 'uruchamianie', memory: 'uruchamianie', obliczenia: 'obliczenia', compute: 'obliczenia', srodowiska: 'srodowiska', environments: 'srodowiska', 'audio-tools': 'srodowiska', dzienniki: 'dzienniki', logs: 'dzienniki', preflight: 'dzienniki' };
  let tab = $state<Tab>('stan');
  $effect(() => { const target = INTENTS[intent]; if (target) untrack(() => goTab(target)); });
  let tabsEl = $state<HTMLDivElement>();
  const goTab = (t: Tab) => { tab = t; tick().then(() => tabsEl?.scrollIntoView({ behavior: 'smooth', block: 'start' })); };

  /* ---------- Uruchamianie i pamięć (app-side choices live in localStorage; Rust and the engine apply them) ---------- */
  let idle = $state<EngineIdleMinutes>(readEngineIdleMinutes());
  async function changeIdle(value: string) {
    const minutes = Number(value) as EngineIdleMinutes, previous = idle; idle = minutes;
    try { await saveEngineIdleMinutes(minutes); flash('idle'); }
    catch (cause) { idle = previous; toast.bad(tr('Nie udało się zmienić czasu utrzymania silnika: {reason}', { reason: settingsError(cause) })); }
  }
  const idleItems = $derived(engineIdleOptions.map(m => ({ value: String(m), label: m === 0 ? tr('Zawsze') : m === 60 ? tr('1 godz.') : `${m} min` })));
  let autostart = $state(readEngineAutostart()), preload = $state(readEnginePreload());
  function changeAutostart(on: boolean) {
    const previous = autostart; autostart = on;
    try { saveEngineAutostart(on); flash('auto'); }
    catch (cause) { autostart = previous; toast.bad(tr('Nie udało się zapisać ustawienia: {reason}', { reason: settingsError(cause) })); }
  }
  async function changePreload(on: boolean) {
    const previous = preload; preload = on;
    try { await saveEnginePreload(on); flash('pre'); }
    catch (cause) { preload = previous; toast.bad(tr('Nie udało się zapisać ustawienia: {reason}', { reason: settingsError(cause) })); }
  }
  // Voice model state: /model/status is a monitor read (it does not keep the engine awake).
  let warm = $state<ModelWarmup | null>(null), preloading = $state(false), warmHint = $state<WarmupNote>();
  // An idle model on a running engine means the preload was skipped; the engine only logs why, so derive the reason like the start-up card does.
  async function explainIdle(signal: AbortSignal) {
    try {
      const family = get(engineCatalogSnapshot)?.catalog.tts ?? (await engineCatalog(signal)).tts;
      const weights = (await modelsCatalog(signal)).models;
      if (!signal.aborted) warmHint = warmupNote({ status: 'idle' }, family, weights);
    } catch { /* no catalogue: the row keeps its plain "Nie załadowany" */ }
  }
  const ttsModel = $derived(models?.find(m => m.id === 'tts'));
  $effect(() => {
    if (!on || tab !== 'uruchamianie') { warm = null; warmHint = undefined; if (!on) preloading = false; return; }
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined, quiet = 0;
    const poll = async () => {
      try {
        const next = readModelWarmup(await productionJson<Record<string, unknown>>('/model/status', { signal: controller.signal }));
        if (controller.signal.aborted) return;
        const wasReady = warm?.status === 'ready', wasIdle = warm?.status === 'idle'; warm = next;
        if (next.status !== 'idle') warmHint = undefined; else if (!wasIdle) void explainIdle(controller.signal);
        if (next.status === 'ready' && !wasReady) void readModels().catch(() => {});
        if (preloading) {
          // The engine starts the load right after answering; "idle" twice in a row means it skipped (no licence or no weights).
          quiet = next.status === 'idle' ? quiet + 1 : 0;
          if (next.status === 'ready') { preloading = false; toast.ok(tr('Model głosowy jest w pamięci')); }
          else if (next.status === 'error') { preloading = false; toast.bad(tr('Nie udało się załadować modelu: {reason}', { reason: redactDiagnosticText(next.error ?? '') })); }
          else if (quiet >= 2) { preloading = false; toast.warn(tr('Model nie został załadowany. Sprawdź w sekcji Modele, czy jest pobrany i czy warunki licencji są zaakceptowane.')); }
        }
      } catch { /* The next tick retries; the engine may be stopping. */ }
      if (!controller.signal.aborted) timer = setTimeout(poll, preloading || warm?.status === 'loading' ? 1000 : 4000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  });
  function loadModelNow() {
    void act('preload', async signal => { await productionJson('/next/settings/model-preload', { method: 'POST', signal }); preloading = true; });
  }

  /* ---------- Obliczenia ---------- */
  let devDraft = $state('auto'), cardDraft = $state('auto');
  const devOptions = $derived(compute ? computeChoices(compute).map(value => ({ value, label: devName(value), description: tr(({
    auto: 'Zalecane. Silnik użyje karty graficznej, jeśli jest dostępna, a w innym razie procesora.',
    cuda: 'Najszybsza opcja. Wymaga karty z obsługą CUDA i aktualnych sterowników.',
    cpu: 'Działa na każdym komputerze, ale generowanie trwa wielokrotnie dłużej.' } as Record<string, string>)[value] ?? '') || undefined })) : []);
  const cardChanged = $derived(!!cuda && cardDraft !== cuda.value);
  const devChanged = $derived(!!compute && devDraft !== compute.value);
  const showCards = $derived(!!cuda && cuda.devices.length > 1 && devDraft !== 'cpu');
  function saveDevice() {
    void act('device', async signal => {
      if (devChanged) { compute = await saveComputeDevice(devDraft, compute!, signal); devDraft = compute.value; }
      if (cardChanged) { cuda = await putSettings<CudaState>('/api/settings/cuda-device', { value: cardDraft }, signal); cardDraft = cuda.value; }
      toast.ok(tr(devPending ? 'Zapisano. Uruchom ponownie silnik, aby zastosować.' : 'Zapisano.'));
    });
  }
  const tierItems = $derived(performance ? [...(performance.tiers.includes('auto') ? [] : ['auto']), ...performance.tiers].map(value => ({ value, label: tierName(value) })) : []);
  function saveGlobalTier(tier: string) {
    void act('tier', async signal => { performance = await putSettings<PerformanceState>('/api/settings/performance-profile', { tier, family: null }, signal); flash('tier'); });
  }
  let fam = $state('tts');
  const famTier = $derived(performance ? performance.effective[fam] || performance.global : '');
  const famNote = $derived(performance && fam ? `${famName(fam)}: ${tierName(famTier)}${performance.overrides?.[fam] ? '' : ' ' + tr('(jak globalny)')}${performance.selections?.[fam]?.engine ? ` · ${performance.selections[fam].engine}${performance.selections[fam].model ? ' / ' + performance.selections[fam].model : ''}` : ''}` : '');
  function saveFamTier(tier: string) {
    void act('famTier', async signal => { performance = await savePerformance(tier, fam, performance!, signal); flash('famTier'); });
  }
  function flush(unload: boolean) {
    void act(unload ? 'flushAll' : 'flush', async signal => {
      const next = await productionJson<{ flushed: boolean; unloaded_model: boolean; ram_after: number; vram_after: number; vram_reserved: number }>(`/system/flush-memory?unload_model=${unload}`, { method: 'POST', signal });
      if (!next.flushed) throw new Error(tr('Silnik nie potwierdził czyszczenia pamięci.'));
      await readModels(signal).catch(() => {});
      if (unload && !next.unloaded_model) toast.warn(tr('Wyczyszczono pamięć podręczną, ale nie potwierdzono zwolnienia modelu; modele mogą być zajęte lub niezaładowane.'));
      else toast.ok(tr(unload ? 'Zwolniono modele. RAM: {ram} GiB, karta: {vram} GiB' : 'Wyczyszczono pamięć podręczną. RAM: {ram} GiB, karta: {vram} GiB', { ram: num(next.ram_after), vram: num(next.vram_reserved) }));
    });
  }
  function saveOffload(enabled: boolean) {
    void act('offload', async signal => { offload = await putSettings<typeof offload>('/api/settings/perf/offload-after-generation', { enabled }, signal); flash('offload'); });
  }
  function saveCompile(enabled: boolean) {
    void act('compile', async signal => { const next = await saveCompileDisabled(enabled, signal); compileOff = next.enabled; flash('compile'); });
  }
  let limGpu = $state(''), limCpu = $state(''), limErr = $state('');
  function saveLimits() {
    let gpu: number, cpu: number;
    try { gpu = settingsTimeout(limGpu); cpu = settingsTimeout(limCpu); limErr = ''; } catch (cause) { limErr = (cause as Error).message; return; }
    void act('limits', async signal => {
      const set = (key: string, value: number) => productionJson<{ shadowed?: boolean }>('/system/set-env', postJson({ key, value: String(value) }, signal));
      const [a, b] = [await set('OMNIVOICE_GENERATE_TIMEOUT_S', gpu), await set('OMNIVOICE_CPU_GENERATE_TIMEOUT_S', cpu)];
      restartPending = true;
      if (a.shadowed || b.shadowed) toast.warn(tr('Zapisano, ale zewnętrzna konfiguracja procesu ma pierwszeństwo.'));
      else toast.ok(tr('Zapisano limity czasu. Zadziałają po restarcie silnika.'));
    });
  }
  let gpuReport = $state<GpuReport>();
  const ENGINE_BADGE: Record<string, [BadgeKind, string]> = { gpu: ['ok', 'Karta graficzna'], gpu_caveat: ['warn', 'Z ograniczeniami'], cpu_by_design: ['neutral', 'Procesor'], pinned_cpu: ['neutral', 'Procesor'], not_installed: ['warn', 'Niezainstalowany'] };
  function gpuCheck() { void act('gpu', async signal => { gpuReport = await productionJson<GpuReport>('/api/settings/gpu-report', { signal, timeoutMs: 120_000 }); }); }

  /* ---------- Środowiska: standalone Python environment (desktop; works without the engine) ---------- */
  let em = $state<RuntimeInstallStatus>(), emOpen = $state(false), emVar = $state<'cpu' | 'cuda'>('cuda');
  const emActive = $derived(installingRuntime(em));
  const emProfile = (p?: string) => p === 'cuda' ? 'NVIDIA CUDA 12.8' : p === 'cpu' ? 'CPU' : '';
  const EM_PHASES: Record<string, string> = { preflight: 'Przygotowanie katalogu', uv: 'Pobieranie menedżera pakietów', python: 'Instalacja CPython', engine: 'Źródła silnika', lock: 'Przypięte wymagania', venv: 'Osobne środowisko', dependencies: 'Instalacja zależności', doctor: 'Kontrola bibliotek', health: 'Kontrola uruchomienia', ready: 'Gotowe do aktywacji', idle: 'Nie rozpoczęto' };
  const emName = $derived(em && emProfile(em.profile) && ['activated', 'ready'].includes(em.state) ? `Python · ${emProfile(em.profile)}` : ({ 'private-python': tr('Prywatne środowisko Python'), 'shared-python': tr('Wspólne środowisko Python'), 'configured-python': tr('Wskazany interpreter Python') } as Record<string, string>)[runtime.source ?? ''] ?? tr('Środowisko Python'));
  const emBadge = $derived<[BadgeKind, string]>(!em ? ['neutral', 'Nieodczytane'] : emActive ? ['wait', 'Instalowanie…'] : em.state === 'ready' ? ['warn', 'Gotowe — nieaktywne'] : em.state === 'failed' ? ['bad', 'Błąd instalacji'] : ['cancelled', 'interrupted'].includes(em.state) ? ['neutral', 'Przerwano'] : em.environmentPresent === false ? ['neutral', 'Brak środowiska'] : ['ok', 'Aktywne']);
  const emShowMore = $derived(emOpen || emActive || (!!em && (em.environmentPresent === false || ['ready', 'failed', 'cancelled', 'interrupted'].includes(em.state))));
  async function emAct(fn: () => Promise<RuntimeInstallStatus>, done?: string) {
    await act('em', async () => { em = await fn(); if (done) toast.ok(tr(done)); });
  }
  // Tauri status reads are local and cheap: poll while the tab is open or an installation runs.
  $effect(() => {
    if (!desktop) return;
    const keep = tab === 'srodowiska' || emActive;
    let stop = false, timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (!document.hidden && !untrack(() => working.em)) { try { const next = await runtimeInstaller.status(); if (!stop) em = next; } catch { /* Keep the last status. */ } }
      if (!stop && keep) timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => { stop = true; clearTimeout(timer); };
  });

  /* ---------- Środowiska: extra engine environments ---------- */
  let catalog = $state<EngineRuntimeCatalog>(), jobs = $state<EngineRuntimeJob[]>([]);
  let reviewing = $state(''), accepted = $state(false);
  const jobsActive = $derived(jobs.some(runtimeInstallActive));
  const jobFor = (id: string) => jobs.find(job => job.engine_id === id);
  async function readRecipes(signal?: AbortSignal, withCatalog = true) {
    const [c, j] = await Promise.all([withCatalog ? engineInstallation.catalog(signal) : Promise.resolve(undefined), engineInstallation.jobs(signal)]);
    if (c) { catalog = c; if (reviewing && !c.engines.some(r => r.disclosure_id === reviewing)) { reviewing = ''; accepted = false; } }
    jobs = j.jobs;
  }
  const recipeBadge = (r: EngineRuntimeRecipe): [BadgeKind, string] => {
    const job = jobFor(r.engine_id);
    if (!job) return r.supported ? ['neutral', 'Niezainstalowane'] : ['neutral', 'Nieobsługiwane'];
    if (runtimeInstallActive(job)) return ['wait', runtimeInstallLabels[job.state]];
    if (job.state === 'complete') return job.verified === false ? ['bad', 'Niekompletne'] : job.effective ? ['ok', 'Gotowe'] : job.restart_required ? ['wait', 'Zainstalowane — czeka na restart'] : ['wait', 'Zainstalowane'];
    if (job.state === 'failed') return ['bad', 'Błąd instalacji'];
    return ['neutral', runtimeInstallLabels[job.state]];
  };
  const canOpen = (url: string) => { try { validateLicenseSource(url); return true; } catch { return false; } };
  async function openSource(url: string) { try { await openLicenseSource(url); } catch (cause) { toast.bad(tr(settingsError(cause))); } }
  function recipeInstall(r: EngineRuntimeRecipe) {
    void act('recipe', async signal => { await engineInstallation.install(r, reviewing, accepted, signal); reviewing = ''; accepted = false; await readRecipes(signal, false); toast.info(tr('Uruchomiono instalację. Postęp zapisuje się także po zamknięciu ustawień.')); await onchange?.(); });
  }
  function recipeCancel(r: EngineRuntimeRecipe) {
    void act('recipe', async signal => { await engineInstallation.cancel(r.engine_id, signal); await readRecipes(signal, false); toast.info(tr('Wysłano żądanie anulowania instalacji')); });
  }
  function recipeActivate(r: EngineRuntimeRecipe) {
    void act('recipe', async signal => { const res = await engineInstallation.activate(r, signal); if (res.restart_required) restartPending = true; await readRecipes(signal, false); toast.info(tr(res.restart_required ? '{name} pojawi się po restarcie silnika' : 'Zapisano środowisko silnika', { name: r.display_name })); await onchange?.(); });
  }

  /* ---------- Środowiska: extra TTS libraries + Fish ---------- */
  type TtsEnv = { id: string; name: string; dependencies_ready: boolean; weights_ready: boolean; configured: boolean; reason: string; setup?: { state: string; message: string } | null };
  let ttsEnvs = $state<TtsEnv[]>([]), ttsComp = $state('cpu');
  let fishUrl = $state('http://127.0.0.1:8080'), fishOk = $state(false);
  const ttsInstalling = $derived(ttsEnvs.some(e => e.setup && ['creating', 'installing', 'checking'].includes(e.setup.state)));
  const isFish = (e: TtsEnv) => /fish/i.test(e.id);
  async function readTts(signal?: AbortSignal) { const data = await productionJson<{ engines: TtsEnv[] }>('/next/tts/status', { signal }); ttsEnvs = data.engines; }
  function ttsPrepare(id: string) { void act('tts', async signal => { await productionJson('/next/tts/prepare', postJson({ engine_id: id, device: ttsComp }, signal)); await readTts(signal); }); }
  function fishSave() {
    void act('tts', async signal => { await productionJson('/next/tts/fish-service', { ...postJson({ url: fishUrl, confirmed_model: fishOk }, signal), method: 'PUT' }); await readTts(signal); toast.ok(tr('Zapisano połączenie Fish')); await onchange?.(); });
  }

  /* ---------- Środowiska: audio tools ---------- */
  const mediaRunning = $derived(Object.values(media?.ops || {}).some(op => op.state === 'running'));
  async function readMedia(signal?: AbortSignal) { media = await productionJson<MediaState>('/media-tools/status', { signal }); }
  function mediaAction(path: string, done: string) {
    void act('media', async signal => { await productionJson(`/media-tools/${path}`, { method: 'POST', signal }); await readMedia(signal); if (!mediaRunning) toast.ok(tr(done)); });
  }
  function chooseMedia(tool: string) {
    void act('media', async signal => { const result = await invoke<unknown>('settings_choose_media_tool', { tool }); signal.throwIfAborted(); if (result === null) return; await readMedia(signal); toast.ok(tr('Wybrano własny plik EXE')); });
  }
  const mediaOp = $derived(Object.entries(media?.ops || {}).find(([, op]) => op.state === 'running'));
  const toolMeta = (t?: { version?: string; origin?: string; path?: string }) => t ? [t.version || tr('brak wersji'), t.origin, t.path].filter(Boolean).join(' · ') : tr('Nieodczytane');

  // Tab-scoped reads and polling while something installs.
  $effect(() => {
    if (!ready || tab !== 'srodowiska') return;
    const controller = new AbortController();
    void Promise.allSettled([readRecipes(controller.signal), readTts(controller.signal), readMedia(controller.signal)]).then(results => {
      const failed = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
      if (failed && !controller.signal.aborted) toast.bad(tr(settingsError(failed.reason)));
    });
    return () => controller.abort();
  });
  $effect(() => {
    if (!ready || tab !== 'srodowiska' || !(jobsActive || ttsInstalling || mediaRunning)) return;
    // The flags stay `true` between reads, so this effect does not re-run: the poll re-arms itself until one turns false.
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      await Promise.allSettled([jobsActive ? readRecipes(controller.signal, false) : 0, ttsInstalling ? readTts(controller.signal) : 0, mediaRunning ? readMedia(controller.signal) : 0]);
      if (!controller.signal.aborted) timer = setTimeout(poll, 1500);
    };
    timer = setTimeout(poll, 1500);
    return () => { clearTimeout(timer); controller.abort(); };
  });

  /* ---------- Dzienniki i diagnostyka ---------- */
  type Lvl = 'info' | 'warn' | 'err';
  const lineLevel = (line: string): Lvl => /\b(ERROR|CRITICAL|FATAL|Traceback)\b/.test(line) ? 'err' : /\bWARN(ING)?\b/.test(line) ? 'warn' : 'info';
  const STAMP = /^\d{4}-\d\d-\d\d[ T][\d:.,]+/;
  const logRows = $derived(logLines.map(m => ({ m, l: lineLevel(m) })));
  let lvl = $state<'all' | Lvl>('all'), q = $state('');
  let logEl = $state<HTMLPreElement>();
  const counts = $derived({ all: logRows.length, info: logRows.filter(r => r.l === 'info').length, warn: logRows.filter(r => r.l === 'warn').length, err: logRows.filter(r => r.l === 'err').length });
  const rows = $derived(logRows.filter(r => (lvl === 'all' || r.l === lvl) && (!q || r.m.toLocaleLowerCase(tr.locale).includes(q.toLocaleLowerCase(tr.locale)))));
  const lvlItems = $derived([{ value: 'all', label: `${tr('Wszystko')} (${counts.all})` }, { value: 'info', label: `${tr('Informacje')} (${counts.info})` }, { value: 'warn', label: `${tr('Ostrzeżenia')} (${counts.warn})` }, { value: 'err', label: `${tr('Błędy')} (${counts.err})` }]);
  const issues = $derived(counts.err + counts.warn);
  $effect(() => { rows.length; logEl; tick().then(() => { if (logEl) logEl.scrollTop = logEl.scrollHeight; }); });
  function showInLog(key: string) { lvl = 'all'; q = key; tick().then(() => logEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })); }
  let errors = $state<RecentError[] | null>(null);
  $effect(() => {
    if (!ready || tab !== 'dzienniki') return;
    const controller = new AbortController();
    void Promise.allSettled([recentRuntimeErrors(controller.signal).then(r => { errors = r.errors.slice(0, 3); }), readLogs(controller.signal)]);
    return () => controller.abort();
  });
  const errKey = (e: RecentError) => redactDiagnosticText(e.message || e.error_class || '').split('\n')[0].slice(0, 40);
  const errTime = (e: RecentError) => { const raw = e.last_seen || e.timestamp || e.first_seen; const d = raw ? new Date(raw) : null; return d && !isNaN(+d) ? hms(d) : ''; };

  type Res = 'ok' | 'warn' | 'bad' | 'skip';
  type CheckRow = { id: string; label: string; res: Res; detail: string; hint?: string };
  let pf = $state<{ checks: CheckRow[]; at: Date; local: boolean } | null>(null);
  let nowTick = $state(Date.now());
  $effect(() => { const id = setInterval(() => nowTick = Date.now(), 20_000); return () => clearInterval(id); });
  const pfCount = $derived({ ok: pf?.checks.filter(c => c.res === 'ok').length ?? 0, warn: pf?.checks.filter(c => c.res === 'warn').length ?? 0, bad: pf?.checks.filter(c => c.res === 'bad').length ?? 0 });
  const BADGE: Record<Res, [BadgeKind, string]> = { ok: ['ok', 'W porządku'], warn: ['warn', 'Ostrzeżenie'], bad: ['bad', 'Błąd'], skip: ['neutral', 'Pominięto'] };
  const resOf = (status: string): Res => ['pass', 'ok'].includes(status) ? 'ok' : status === 'warn' ? 'warn' : ['fail', 'error'].includes(status) ? 'bad' : 'skip';
  const ago = (d: Date) => { const m = Math.floor((nowTick - d.getTime()) / 60000); return m < 1 ? tr('przed chwilą') : m < 60 ? tr('{n} min temu', { n: m }) : tr('{n} godz. temu', { n: Math.floor(m / 60) }); };
  const diag = $derived(!pf ? '' : pfCount.bad + pfCount.warn ? [pfCount.bad ? `${pfCount.bad} ${tr(pl(pfCount.bad, 'błąd', 'błędy', 'błędów'))}` : '', pfCount.warn ? `${pfCount.warn} ${tr(pl(pfCount.warn, 'ostrzeżenie', 'ostrzeżenia', 'ostrzeżeń'))}` : ''].filter(Boolean).join(', ') : tr('bez uwag'));
  function runPf(local: boolean) {
    void act('pf', async signal => {
      let checks: CheckRow[];
      if (local) { const r = await runOfflineDiagnostics(signal); checks = r.checks.map(c => ({ id: c.id, label: diagnosticCheckLabels[c.id] || c.label, res: resOf(c.status), detail: c.detail, hint: c.hint })); }
      else { const r = await productionJson<PreflightReport>('/setup/preflight', { signal }); checks = (r.checks || []).map(c => ({ id: c.id, label: preflightCheckLabels[c.id] || c.label || 'Dodatkowa kontrola', res: resOf(c.status), detail: redactDiagnosticText(c.detail), hint: c.fix })); }
      pf = { checks, at: new Date(), local };
      toast.ok(tr('Kontrola zakończona'));
    });
  }
  function clearLogs() {
    void act('clear', async signal => { await productionJson('/system/logs/clear', { method: 'POST', signal }); await readLogs(signal); q = ''; toast.ok(tr('Dziennik silnika wyczyszczony')); });
  }
  function report() {
    void act('report', async signal => {
      const snapshot = await runtimeSnapshot(signal);
      download('raport-silnika.json', JSON.stringify(redactDiagnosticValue({ generated: new Date().toISOString(), runtime: { state: runtime.state, message: runtime.message }, snapshot,
        checks: pf ? { kind: pf.local ? 'local' : 'full', at: pf.at.toISOString(), results: pf.checks } : null, recentErrors: errors ?? [], logTail: logLines.slice(-100) }), null, 2), 'application/json');
      toast.ok(tr('Pobrano raport'));
    });
  }

  /* ---------- quick overview ---------- */
  const missingEngines = $derived(catalog ? catalog.engines.filter(r => r.supported && !jobFor(r.engine_id)).length : 0);
</script>

<div class="p-page engine-page">
  <div class="page-heading"><div><h1>{tr('Silnik')}</h1></div></div>

  <!-- status header: sticky -->
  <div class="p-sticky-hdr"><section class="p-card hdr" aria-live="polite" aria-label={tr('Stan silnika')}>
    <div class="hdr-r1">
      <span class="status-dot big" class:ready={on} class:starting={starting}></span>
      <div class="hdr-t">
        <strong>{starting ? tr(actionLabel) : runtime.state === 'error' ? tr('Wymaga uwagi') : stopped ? tr('Zatrzymany') : tr('Gotowy')}</strong>
        <span>{#if starting}{tr(runtime.message || 'Proszę czekać')}…{:else if runtime.state === 'error'}{tr(runtime.message)}{:else if stopped}{desktop ? tr('Silnik nie działa. Generowanie i rozpoznawanie mowy jest niedostępne. Twoje dane są bezpieczne.') : tr(runtime.message)}{:else}{tr('Działa · teraz: {phase}', { phase: tr(generating ? 'generowanie mowy' : 'spoczynek') })}{pending ? ' · ' + tr('zmiany czekają na restart') : ''}{/if}</span>
      </div>
      {#if desktop}<div class="p-actions">
        {#if starting}<Button variant="secondary" disabled><LoaderCircle size={15} class="spin"/>{tr(actionLabel)}</Button>
        {:else if stopped}<Button onclick={() => run('start')}><Play size={15}/>{tr('Uruchom silnik')}</Button>
        {:else}<Button variant="destructive" onclick={() => arm('stop', () => run('stop'))}><Square size={15}/>{armed.stop ? tr('Potwierdź zatrzymanie') : tr('Zatrzymaj')}</Button>
          {#if onrestart}<Button variant={pending ? 'default' : 'outline'} onclick={() => run('restart')}><RotateCw size={15}/>{tr('Uruchom ponownie')}{#if pending}<i class="pend"></i>{/if}</Button>{/if}{/if}
      </div>{/if}
    </div>
    {#if starting && startupPct !== null}<div class="p-progress"><progress class="p-bar" max="100" value={startupPct} aria-label={tr(actionLabel)}></progress><span>{Math.floor(startupPct)}% · {tr(runtime.message)}</span></div>{/if}
    <div class="hdr-r2">
      <div class="hw">
        {#if shownHw.length}<div class="hw1">{#each shownHw as part, i}<span class="it">{i === 0 && !on ? tr('Ostatnio:') + ' ' : ''}{part}</span>{/each}</div>{/if}
        {#if compute || performance}<div class="hw2">{#if compute}<span class="it">{devName(compute.value)}</span>{/if}{#if performance}<span class="it">{tierName(performance.global)}</span>{/if}{#if compute && compute.restart_required && compute.value !== compute.applied}<span class="it">{tr('po restarcie: {device}', { device: devName(compute.value) })}</span>{/if}</div>{/if}
      </div>
      <div class="inline"><Button variant="ghost" onclick={() => goTab('dzienniki')}>{tr('Diagnostyka')}{on && diag ? ': ' + diag : ''}</Button><Button variant="ghost" disabled={starting || working.refresh} onclick={refreshState}><RefreshCw size={15}/>{tr('Odśwież stan')}</Button></div>
    </div>
  </section></div>

  <!-- dashboard -->
  {#if stopped}<p class="p-notice warn">{tr('Silnik jest zatrzymany, więc nie ma danych o obciążeniu.')}{#if desktop} {tr('Uruchom go przyciskiem u góry strony.')}{/if}</p>{/if}

  {@render unreadNote('stan')}

  <div class="tiles t4">
    {#each tiles as t (t.k)}
      <div class="tile" class:off={t.off} role="group" aria-label={tr(t.label)}>
        <span class="tl">{tr(t.label)}</span>
        <b class="big">{t.big}</b>
        <span class="det">{t.detail}</span>
        <div class="p-bar {t.level}" role="meter" aria-label={tr(t.label)} aria-valuenow={Math.round(t.v)} aria-valuemin="0" aria-valuemax="100"><i style:width="{t.v}%"></i></div>
        <svg class="spark" viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="27.5" x2="120" y2="27.5"/>{#if !t.off}<polyline class={t.level} points={pts(liveHist[t.k])}/>{/if}</svg>
      </div>
    {/each}
  </div>

  <div class="tiles t2">
    <div class="tile gen" class:off={!hasGens} role="group" aria-label={tr('Generowanie')}>
      <span class="tl">{tr('Generowanie')}</span>
      <div class="gtop"><b class="big">{hasGens ? fmtX(speed) + '×' : '—'}</b><span class="det">{hasGens ? tr(speed >= 1 ? 'szybciej niż czas rzeczywisty' : 'wolniej niż czas rzeczywisty') : tr('brak danych')}</span></div>
      <span class="plain">{!on ? tr('Silnik nie działa') : hasGens ? tr('W 1 minutę silnik wygeneruje {d} nagrania', { d: dur(60 * speed) }) : tr('Wygeneruj nagranie, aby zobaczyć szybkość')}</span>
      <div class="gbody">
        <div class="gchart">
          <span class="tl">{tr('Ostatnie generowania')}</span>
          <div class="gbars" role="group" aria-label={tr('Czas ostatnich generowań')}>
            {#if hasGens}<i class="avg" style:bottom="{genAvg / genMax * 100}%"></i>{/if}
            {#each bars as g, i}
              {#if g && hasGens}
                {@const tip = genTip(g)}
                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                <span class="gb" class:l={i < 3} class:r={i > 8} role="img" tabindex="0" aria-label={tip.filter(Boolean).join('. ')} style:--h="{g.generation_time! / genMax * 100}%">
                  <i style:height="var(--h)"></i>
                  <span class="tip" aria-hidden="true"><b>{tip[0]}</b><span>{tip[1]}</span><span>{tip[2]}</span><span>{tip[3]}</span>{#if tip[4]}<span class="m">{tip[4]}</span>{/if}</span>
                </span>
              {:else}<span class="gb" style:--h="4%"><i style:height="var(--h)"></i></span>{/if}
            {/each}
          </div>
          <div class="bar-ax"><span>{hasGens ? when(gens[0]) : ''}</span><span>{tr('linia przerywana: średnia')}</span><span>{hasGens ? when(gens.at(-1)!) : ''}</span></div>
        </div>
      </div>
      <div class="gstats">
        <div><span>{tr('Średni czas')}</span><b>{hasGens ? fmtT(genAvg) : '—'}</b></div>
        <div><span>{tr('Ostatnia generacja')}</span><b>{hasGens ? fmtT(gens.at(-1)!.generation_time!) : '—'}</b></div>
        <div><span>{tr('Aktywny model i urządzenie')}</span><b>{on && activeModel ? activeModel : '—'}</b></div>
      </div>
    </div>

    <div class="tile" role="group" aria-label={tr('Model w pamięci')}>
      <span class="tl">{tr('Model w pamięci')}</span>
      <b class="big">{!on || !models ? '—' : mb(memTotal)}</b>
      <span class="det">{!on ? tr('silnik zatrzymany') : !models ? tr('brak danych') : `${models.length} ${tr(pl(models.length, 'model załadowany', 'modele załadowane', 'modeli załadowanych'))}`}</span>
      <div class="mrows">
        {#if !on}<p class="p-sub">{tr('Silnik jest zatrzymany — żaden model nie jest w pamięci.')}</p>
        {:else if models?.length}{#each models as x (x.id)}<div class="mrow"><div class="t"><b>{x.name}</b><span>{x.vram_mb ? mb(x.vram_mb) : tr('zajęcie niezmierzone')}{x.device ? ` · ${x.device}` : ''}</span></div>
            <Button variant={armed['free' + x.id] ? 'destructive' : 'outline'} disabled={!on || !x.unloadable || working['free:' + x.id]} onclick={() => arm('free' + x.id, () => freeModel(x))}>{armed['free' + x.id] ? tr('Potwierdź') : tr('Zwolnij')}</Button></div>{/each}
        {:else if models}<p class="p-sub">{tr('Żaden model nie jest teraz w pamięci. Załadują się przy następnym użyciu.')}</p>{/if}
      </div>
    </div>
  </div>

  <!-- tab bar: only the active tab's content is rendered below -->
  <div class="filter-tabs p-tabs" role="tablist" aria-label={tr('Sekcje silnika')} bind:this={tabsEl}>
    {#each tabs as [id, label]}<button role="tab" aria-selected={tab === id} class:chosen={tab === id} onclick={() => tab = id}>{tr(label)}{#if id === 'obliczenia' && pending && on}<StatusBadge kind="wait" text={tr('Restart')} compact/>{:else if id === 'dzienniki' && issues && on}<StatusBadge kind={counts.err ? 'bad' : 'warn'} text={String(issues)} compact/>{/if}</button>{/each}
  </div>

  {#snippet unreadNote(which: Tab)}
    {@const missing = unread.filter(u => u.tab === which)}
    {#if on && missing.length}<p class="p-notice warn">{tr('Nie odczytano: {what}.', { what: missing.map(u => tr(u.label)).join(', ') })} <Button variant="ghost" disabled={working.reload} onclick={() => act('reload', async () => { await reload(); })}>{tr('Spróbuj ponownie')}</Button></p>{/if}
  {/snippet}

  <div class="p-card panel">
  {#if tab === 'stan'}
    {#if runtime.dataDir}<div class="p-section">
      <header><h3>{tr('Dane aplikacji')}</h3><p>{tr('Tu zapisane są Twoje głosy, projekty i nagrania.')}</p></header>
      <div class="address"><code>{runtime.dataDir}</code><Button variant="outline" onclick={() => copy('dir', runtime.dataDir!)}>{#if copied === 'dir'}<Check size={15}/>{tr('Skopiowano')}{:else}<Copy size={15}/>{tr('Kopiuj ścieżkę')}{/if}</Button></div>
    </div>{/if}
    <div class="p-section">
      <header><h3>{tr('Szybki podgląd')}</h3><p>{tr('Skróty do miejsc, w których sprawdzisz problemy.')}</p></header>
      <div class="jumps">
        <Button variant="ghost" class="jump" onclick={() => goTab('obliczenia')}><span class="k">{tr('Sprzęt')}</span><span class="v">{[...shownHw, ...(compute ? [devName(compute.value)] : [])].join(' · ') || tr('Brak odczytu — uruchom silnik')}</span><span class="go">{tr('Obliczenia')} <ChevronRight size={14}/></span></Button>
        <Button variant="ghost" class="jump" onclick={() => goTab('srodowiska')}><span class="k">{tr('Środowisko')}</span><span class="v">{emName}{missingEngines ? ` · ${missingEngines} ${tr(pl(missingEngines, 'dodatkowy silnik do zainstalowania', 'dodatkowe silniki do zainstalowania', 'dodatkowych silników do zainstalowania'))}` : ''}</span><span class="go">{tr('Środowiska')} <ChevronRight size={14}/></span></Button>
        <Button variant="ghost" class="jump" onclick={() => goTab('dzienniki')}><span class="k">{tr('Problemy')}</span><span class="v">{on ? `${counts.err} ${tr(pl(counts.err, 'błąd', 'błędy', 'błędów'))} ${tr('w dzienniku')}${diag ? ` · ${tr('kontrola systemu:')} ${diag}` : ''}` : tr('Dziennik dostępny po uruchomieniu silnika')}</span><span class="go">{tr('Dzienniki i diagnostyka')} <ChevronRight size={14}/></span></Button>
      </div>
    </div>

  {:else if tab === 'uruchamianie'}
    <div class="p-section">
      <header><h3>{tr('Uruchamianie')}</h3></header>
      <div class="p-rows">
        <div class="p-row"><div class="t"><b>{tr('Uruchamiaj silnik przy starcie aplikacji')}</b><span>{tr('Silnik włącza się sam po otwarciu programu. Wyłączony ruszy dopiero przy pierwszym zadaniu. Zmiana działa od następnego uruchomienia.')}</span></div>
          <div class="inline">{#if savedFlag.auto}<span class="saved on">{tr('Zapisano')}</span>{/if}<Switch label={tr('Uruchamiaj silnik przy starcie aplikacji')} checked={autostart} onchange={changeAutostart}/></div></div>
        <div class="p-row"><div class="t"><b>{tr('Ładuj model głosowy do pamięci po uruchomieniu')}</b><span>{autostart ? tr('Model głosowy ładuje się razem ze startem silnika, więc pierwsze generowanie nie czeka. Zmiana działa od następnego uruchomienia silnika.') : tr('Niedostępne, gdy silnik nie startuje z aplikacją.')}</span></div>
          <div class="inline">{#if savedFlag.pre}<span class="saved on">{tr('Zapisano')}</span>{/if}<Switch label={tr('Ładuj model głosowy do pamięci po uruchomieniu')} checked={preload && autostart} disabled={!autostart} onchange={changePreload}/></div></div>
      </div>
    </div>

    <div class="p-section">
      <header class="split"><div><h3>{tr('Utrzymuj silnik i model po bezczynności')}</h3><p>{tr('Gdy silnik nie jest używany, wyłączy się sam po wybranym czasie. „Zawsze” – nigdy się nie wyłączy (zajmuje ok. 1,9 GB pamięci karty).')}</p></div>
        <div class="inline">{#if savedFlag.idle}<span class="saved on">{tr('Zapisano')}</span>{/if}<ButtonGroup label={tr('Czas bezczynności')} mode="single" value={String(idle)} onchange={v => void changeIdle(String(v))} items={idleItems}/></div></header>
    </div>

    <div class="p-section">
      <header><h3>{tr('Model w pamięci')}</h3></header>
      {@render unreadNote('uruchamianie')}
      <div class="p-rows">
        <div class="p-row"><div class="t"><b>{tr('Stan modelu głosowego')}</b><span>{!on ? tr('Silnik jest zatrzymany.') : warm?.status === 'loading' || preloading ? tr('Ładowanie modelu…') + (warm?.progress !== undefined ? ` ${Math.round(warm.progress)}%` : '') : warm?.status === 'ready' ? tr('Załadowany') + (ttsModel?.vram_mb ? ` · ${mb(ttsModel.vram_mb)}` : '') : warm?.status === 'error' ? tr('Nie udało się załadować modelu.') : warm ? tr('Nie załadowany') : tr('Odczytywanie…')}{#if on && warm?.status === 'idle' && !preloading && warmHint} · {tr(warmHint.text)}{/if}</span></div>
          <div class="inline wrap">{#if on && warm?.status === 'idle' && !preloading && warmHint}<Button variant="ghost" onclick={() => onnavigate?.('models')}>{tr('Otwórz Modele')}</Button>{/if}<Button disabled={!on || !warm || warm.status === 'ready' || warm.status === 'loading' || preloading || working.preload} onclick={loadModelNow}>{#if preloading || warm?.status === 'loading'}<LoaderCircle size={15} class="spin"/>{tr('Ładuję…')}{:else}{tr('Załaduj model teraz')}{/if}</Button></div></div>
        <div class="p-row"><div class="t"><b>{tr('Pamięć modeli')}</b><span>{tr('Zwalnia modele z pamięci. Załadują się ponownie przy następnym użyciu.')}</span></div>
          <div class="inline wrap"><Button variant="outline" disabled={!on || working.flush} onclick={() => flush(false)}>{tr('Wyczyść pamięć podręczną')}</Button>
            <Button variant={armed.flushAll ? 'destructive' : 'outline'} disabled={!on || working.flushAll} onclick={() => arm('flushAll', () => flush(true))}>{armed.flushAll ? tr('Potwierdź zwolnienie') : tr('Zwolnij modele i wyczyść cache')}</Button></div></div>
        {#if offload}<div class="p-row"><div class="t"><b>{tr('Przenieś model do RAM po generowaniu')}</b><span>{offload.env_pinned ? tr('Ustawienie przypięto w konfiguracji uruchomienia.') : offload.device === 'cpu' ? tr('Na procesorze model już jest w RAM.') : tr('Po generowaniu model przechodzi z karty do zwykłej pamięci. Karta jest wolna, ale następne generowanie startuje kilka sekund dłużej. Domyślnie wyłączone.')}</span></div>
          <div class="inline">{#if savedFlag.offload}<span class="saved on">{tr('Zapisano')}</span>{/if}<Switch label={tr('Przenieś model do RAM po generowaniu')} checked={offload.enabled} disabled={offload.env_pinned || working.offload} onchange={saveOffload}/></div></div>{/if}
      </div>
      {#if idle === 0 && offload?.enabled}<p class="p-notice warn">{tr('Wybrano „Zawsze”, więc model ma zostać w pamięci karty. Przenoszenie go do RAM po generowaniu temu przeczy — wyłącz je albo wybierz skończony czas.')}</p>{/if}
    </div>

  {:else if tab === 'obliczenia'}
    {#if !on}<p class="p-notice warn">{tr('Silnik jest zatrzymany, więc ustawienia obliczeń nie są dostępne.')}{#if desktop} {tr('Uruchom go przyciskiem u góry strony.')}{/if}</p>
    {:else}
    <div class="p-section">
      <header class="split"><div><h3>{tr('Urządzenie i jakość')}</h3></div>{#if devPending}<StatusBadge kind="wait" text={tr('Czeka na restart')}/>{/if}</header>
      {@render unreadNote('obliczenia')}
      <div class="p-rows">
      {#if compute}<div class="p-row">
        <div class="t"><b>{tr('Urządzenie obliczeń')}</b><span>{compute.env_pinned ? tr('Urządzenie przypięto w konfiguracji uruchomienia.') : compute.override_ignored ? tr('Wybrane urządzenie jest niedostępne; silnik używa wyboru automatycznego.') : tr('Czym silnik liczy mowę: kartą graficzną czy procesorem. Zmiana działa po restarcie silnika.')}</span></div>
        <div class="inline"><Select ariaLabel={tr('Urządzenie obliczeń')} value={devDraft} options={devOptions} disabled={compute.env_pinned || working.device} onchange={v => devDraft = v}/>{#if devChanged || cardChanged}<Button disabled={working.device} onclick={saveDevice}>{tr('Zapisz')}</Button>{/if}</div>
      </div>{/if}
      {#if showCards && cuda}<div class="p-row"><div class="t"><b>{tr('Fizyczna karta CUDA')}</b><span>{cuda.env_pinned ? tr('Karta jest przypięta przez konfigurację uruchomienia.') : tr('Którą kartę NVIDIA ma używać silnik, gdy masz ich kilka.')}</span></div>
        <Select ariaLabel={tr('Fizyczna karta CUDA')} value={cardDraft} disabled={cuda.env_pinned || working.device} options={[{ value: 'auto', label: tr('Automatycznie') }, ...cuda.devices.map(d => ({ value: d.value, label: `GPU ${d.index} · ${d.name}` }))]} onchange={v => cardDraft = v}/></div>{/if}
      {#if performance}<div class="p-row">
        <div class="t"><b>{tr('Szybkość i jakość')}</b><span>{tr(TIER_HINT[performance.global] ?? 'Globalny wybór zeruje ustawienia rodzin.')}</span></div>
        <div class="inline">{#if savedFlag.tier}<span class="saved on">{tr('Zapisano')}</span>{/if}<ButtonGroup label={tr('Szybkość i jakość')} mode="single" value={performance.global} items={tierItems} disabled={working.tier} onchange={v => saveGlobalTier(String(v))}/></div>
      </div>{/if}
      </div>
      {#if cuda && cuda.devices.length <= 1}<p class="p-sub">{tr('Wybór fizycznej karty CUDA pojawia się tylko wtedy, gdy komputer ma więcej niż jedną kartę NVIDIA.')}</p>{/if}
    </div>

    <div class="p-section">
      <div class="p-rows">
      {#if performance && performance.applicable_families.length}
        <div class="p-row"><div class="t"><b>{tr('Wydajność i limity')}</b><span>{tr('Ustaw inny preset tylko dla jednej grupy silników, np. rozpoznawania mowy.')}</span></div><Select ariaLabel={tr('Rodzina silników')} value={fam} options={performance.applicable_families.map(f => ({ value: f, label: famName(f) }))} onchange={v => fam = v}/></div>
        <div class="p-row"><div class="t"><b>{tr('Szybkość i jakość tej rodziny')}</b><span>{famNote}</span></div>
          <div class="inline">{#if savedFlag.famTier}<span class="saved on">{tr('Zapisano')}</span>{/if}<ButtonGroup label={tr('Szybkość i jakość tej rodziny')} mode="single" value={famTier} items={performance.tiers.map(value => ({ value, label: tierName(value) }))} disabled={working.famTier} onchange={v => saveFamTier(String(v))}/></div></div>
      {/if}
      {#if compileOff !== null}<div class="p-row"><div class="t"><b>{tr('Wyłącz torch.compile')}</b><span>{tr('Włącz tylko, gdy pierwsze generowanie kończy się błędem. Generowanie może być wtedy wolniejsze. Zmiana działa przy kolejnym załadowaniu modelu.')}</span></div>
        <div class="inline">{#if savedFlag.compile}<span class="saved on">{tr('Zapisano')}</span>{/if}<Switch label={tr('Wyłącz torch.compile')} checked={compileOff} disabled={working.compile} onchange={saveCompile}/></div></div>{/if}
      {#if info}<div class="p-row"><div class="t"><b>{tr('Limity czasu generowania')}</b><span>{tr('Po tym czasie zadanie zostanie przerwane. Zwiększ przy bardzo długich tekstach.')}</span>{#if limErr}<p class="p-field-err" role="alert">{tr(limErr)}</p>{/if}</div>
        <div class="inline wrap"><label class="inline">{tr('GPU (s)')} <Input class="num" inputmode="numeric" aria-label={tr('Limit GPU w sekundach')} bind:value={limGpu}/></label><label class="inline">{tr('CPU (s)')} <Input class="num" inputmode="numeric" aria-label={tr('Limit CPU w sekundach')} bind:value={limCpu}/></label>
          <Button disabled={working.limits} onclick={saveLimits}>{tr('Zapisz limity')}</Button></div></div>{/if}
      </div>
    </div>

    <div class="p-section">
      <header><h3>{tr('Zgodność akceleracji GPU')}</h3></header>
      <div class="p-rows">
      <div class="p-row"><div class="t"><b>{tr('Przydział GPU')}</b><span>{gpuReport ? `${tr(gpuStateLabels[gpuReport.state] || 'Silnik zwrócił nierozpoznany stan akceleracji')} · PyTorch ${gpuReport.torch.version || gpuReport.torch.kind}` : tr('Sprawdza, które silniki mogą korzystać z karty graficznej.')}</span></div>
        <Button disabled={working.gpu} onclick={gpuCheck}>{#if working.gpu}<LoaderCircle size={15} class="spin"/>{tr('Sprawdzam…')}{:else}<Activity size={15}/>{tr('Sprawdź przydział GPU')}{/if}</Button></div>
      {#if gpuReport}
        {#each gpuReport.options.filter(o => gpuOptionLabels[o]) as option (option)}<div class="p-row"><div class="t"><span>{tr(gpuOptionLabels[option])}</span></div></div>{/each}
        {#each gpuReport.engines as e (`${e.kind}:${e.id}`)}{@const b = ENGINE_BADGE[e.code] ?? [e.available ? 'warn' : 'bad', gpuEngineLabels[e.code] || 'Stan nieustalony']}<div class="p-row"><div class="t"><b>{e.name}</b><span>{tr(gpuEngineLabels[e.code] || 'Stan nieustalony')}{e.params?.device ? ` · ${e.params.device}` : ''}</span></div><StatusBadge kind={b[0] as BadgeKind} text={tr(b[1])}/></div>{/each}
        <p class="p-sub">{tr('Wynik opisuje zgodność sprzętu z silnikami, których biblioteki wykryto. Działanie silnika potwierdza dopiero jego wybór w sekcji Modele.')}</p>
      {/if}
      </div>
    </div>
    {/if}

  {:else if tab === 'srodowiska'}
      <div class="p-section">
        <header><h3>{tr('Samodzielne środowisko Python')}</h3><p>{tr('Główne środowisko silnika. Działa także wtedy, gdy silnik jest wyłączony.')}</p></header>
        {#if !desktop}<p class="p-sub">{tr('Instalator jest dostępny w aplikacji Windows x64.')}</p>
        {:else}
        <div class="env">
          <div class="nm"><b>{emName}</b><span>{em ? [tr(EM_PHASES[em.phase] ?? em.phase), em.candidate].filter(Boolean).join(' · ') : tr('Odczytywanie…')}</span></div>
          <StatusBadge kind={emBadge[0]} text={tr(emBadge[1])}/>
          {#if !emShowMore || emOpen}<Button variant="outline" disabled={emActive} onclick={() => emOpen = !emOpen}>{tr('Zmień wariant…')}</Button>{:else}<span></span>{/if}
          {#if emShowMore && em}
            <div class="env-more">
              <div class="p-row flat"><div class="t"><b>{tr('Wariant środowiska')}</b><span>{tr('CUDA działa tylko z kartą NVIDIA. Wariant CPU jest mniejszy, ale wolniejszy.')}</span></div>
                <Select ariaLabel={tr('Wariant środowiska')} bind:value={emVar} disabled={emActive || working.em} options={[{ value: 'cpu', label: tr('CPU — bez karty NVIDIA') }, { value: 'cuda', label: 'NVIDIA CUDA 12.8' }]}/></div>
              {#if emActive}<div class="p-progress" role="status">{#if em.phase === 'uv' && em.totalBytes}<progress class="p-bar" max={em.totalBytes} value={em.downloadedBytes} aria-label={tr('Instalacja środowiska')}></progress><span>{byteLabel(em.downloadedBytes)} / {byteLabel(em.totalBytes)} · {tr(EM_PHASES[em.phase] ?? em.phase)}</span>{:else}<progress class="p-bar" aria-label={tr('Instalacja środowiska')}></progress><span>{tr(EM_PHASES[em.phase] ?? em.phase)}</span>{/if}</div>{/if}
              {#if em.message && !emActive}<p class="p-sub">{tr(em.message)}</p>{/if}
              <div class="p-actions">
                {#if emActive}<Button variant="outline" disabled={working.em || em.state === 'cancelling'} onclick={() => emAct(runtimeInstaller.cancel, 'Instalację anulowano')}><X size={15}/>{tr('Anuluj instalację')}</Button>
                {:else if em.state === 'ready'}<Button disabled={!stopped || working.em} onclick={() => emAct(async () => { const r = await runtimeInstaller.activate(); await onrefresh(); return r; }, 'Przełączono środowisko')}><Check size={15}/>{tr('Użyj tego środowiska')}</Button>
                {:else}<Button disabled={working.em} onclick={() => emAct(() => runtimeInstaller.start(emVar))}><Download size={15}/>{['failed', 'cancelled', 'interrupted'].includes(em.state) ? tr('Ponów w nowym środowisku') : tr('Pobierz i przygotuj środowisko')}</Button>{/if}
              </div>
              {#if em.state === 'ready' && !stopped}<p class="p-sub">{tr('Aby przełączyć środowisko, zatrzymaj najpierw silnik.')}</p>{/if}
              <h3 class="p-h3">{tr('Dziennik instalacji')}</h3><pre class="logs short">{em.logs.length ? em.logs.join('\n') : tr('Brak uruchomionej instalacji.')}</pre>
            </div>
          {/if}
        </div>
        {/if}
      </div>

      {#if !on}<p class="p-notice warn">{tr('Dodatkowe środowiska i narzędzia audio wymagają działającego silnika.')}{#if desktop} {tr('Uruchom go przyciskiem u góry strony.')}{/if}</p>{/if}
      {#if on}<div class="stack">
        <div class="p-section">
          <header class="split"><div><h3>{tr('Środowiska dodatkowych silników')}</h3><p>{tr('Osobne środowiska dla silników, które nie działają w głównym.')}</p></div><Button variant="outline" disabled={working.recipes} onclick={() => act('recipes', async s => { await readRecipes(s); toast.info(tr('Odświeżono listę instalacji')); })}><RefreshCw size={15}/>{tr('Odśwież instalacje')}</Button></header>
          {#if !catalog}<p class="p-sub">{tr('Odczytywanie…')}</p>{:else if !catalog.engines.length}<p class="p-sub">{tr('Brak dodatkowych silników do przygotowania.')}</p>{/if}
          {#each catalog?.engines ?? [] as r (r.engine_id)}
            {@const job = jobFor(r.engine_id)}
            {@const badge = recipeBadge(r)}
            {@const open = reviewing === r.disclosure_id}
            <div class="env">
              <div class="nm"><b>{r.display_name}</b><span>{[r.kind === 'native' ? tr('Osobny program natywny') : tr('Osobne środowisko Python'), r.version, r.download_bytes ? tr('{size} do pobrania', { size: runtimeSize(r.download_bytes) }) : '', tr('miejsce: około {size}', { size: runtimeSize(r.required_bytes) })].filter(Boolean).join(' · ')}</span>{#if r.host_note}<span>{tr(r.host_note)}</span>{/if}</div>
              <StatusBadge kind={badge[0]} text={tr(badge[1])}/>
              {#if job && runtimeInstallActive(job)}<span></span>
              {:else if job?.state === 'complete' && job.disclosure_id === r.disclosure_id && job.verified !== false}
                {#if job.restart_required || job.effective}<span></span>{:else}<Button disabled={working.recipe || jobsActive} onclick={() => recipeActivate(r)}>{tr('Udostępnij po restarcie')}</Button>{/if}
              {:else}<Button disabled={!r.supported || working.recipe || jobsActive || open} onclick={() => { reviewing = r.disclosure_id; accepted = false; }}>{job ? tr('Sprawdź i ponów instalację') : tr('Sprawdź instalację')}</Button>{/if}
              {#if open || (job && (runtimeInstallActive(job) || job.error))}
                <div class="env-more">
                  {#if job?.steps.length}<ol class="steps">{#each job.steps as step}<li>{tr(runtimePhaseLabels[step.id] || step.id)} · {tr(({ pending: 'Oczekuje', running: 'W toku', done: 'Gotowe', skipped: 'Pominięto', error: 'Błąd' } as Record<string, string>)[step.state] || step.state)}</li>{/each}</ol>{/if}
                  <p class="p-sub">{r.weights_repo_id ? tr('Ta receptura obejmuje wagi: {repo}', { repo: r.weights_repo_id }) : tr('Wagi modelu pobierzesz osobno w zakładce „Modele”.')}</p>
                  {#if open}
                    <p class="p-sub"><b>{tr('Źródła i warunki:')}</b> {r.dependency_policy} {r.license_summary}</p>
                    <div class="links">{#each [...r.source_urls.map(url => ({ title: url, url })), ...r.license_links] as link (link.url)}{#if canOpen(link.url)}<Button variant="ghost" onclick={() => openSource(link.url)}>{link.title}</Button>{:else}<code>{link.url}</code>{/if}{/each}</div>
                    <div class="option"><div>{tr('Rozumiem, skąd zostaną pobrane pliki i na jakich warunkach')}</div><Switch label={tr('Rozumiem, skąd zostaną pobrane pliki i na jakich warunkach')} bind:checked={accepted} disabled={working.recipe}/></div>
                    {#if r.license_required && !r.license_accepted}<p class="p-sub">{tr('Najpierw zaakceptuj warunki tego silnika w zakładce „Modele”, a następnie odśwież listę.')}</p>{/if}
                  {/if}
                  {#if job && runtimeInstallActive(job)}<div class="p-progress" role="status"><progress class="p-bar" aria-label={tr(runtimeInstallLabels[job.state])}></progress><span>{tr(runtimePhaseLabels[job.phase] || 'Przygotowanie instalacji')}{runtimeTransfer(job) ? ` · ${runtimeTransfer(job)}` : ''}</span></div>{/if}
                  {#if job?.error}<p class="p-field-err" role="alert">{tr(job.error)}</p>{/if}
                  <div class="p-actions">
                    {#if job && runtimeInstallActive(job)}<Button variant="outline" disabled={working.recipe || job.state === 'cancelling'} onclick={() => recipeCancel(r)}>{tr('Anuluj instalację')}</Button>
                    {:else if open}<Button disabled={!accepted || working.recipe || jobsActive || (r.license_required && !r.license_accepted)} onclick={() => recipeInstall(r)}>{tr('Potwierdź instalację')}</Button><Button variant="outline" onclick={() => { reviewing = ''; accepted = false; }}>{tr('Anuluj')}</Button>{/if}
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </div>

        <div class="p-section">
          <header><h3>{tr('Dodatkowe modele TTS')}</h3><p>{tr('Dodatkowe biblioteki dla modeli, które nie działają w głównym środowisku.')}</p></header>
          <div class="p-row flat"><div class="t"><b>{tr('Obliczenia dla nowych środowisk')}</b><span>{tr('Na czym liczyć nowo instalowane silniki. Nie zmienia już zainstalowanych.')}</span></div>
            <ButtonGroup label={tr('Obliczenia dla nowych środowisk')} mode="single" value={ttsComp} onchange={v => ttsComp = String(v)} items={[{ value: 'cpu', label: tr('Procesor') }, { value: 'cuda', label: 'CUDA' }]}/></div>
          {#each ttsEnvs as e (e.id)}
            {@const inst = !!e.setup && ['creating', 'installing', 'checking'].includes(e.setup.state)}
            <div class="env"><div class="nm"><b>{e.name}</b><span>{isFish(e) ? tr('Działa jako osobna usługa lokalna — silnik tylko się z nią łączy.') : tr(e.weights_ready ? 'Wagi lokalne' : 'Brak kompletnych wag')}{!e.configured && e.reason ? ` · ${tr(e.reason)}` : ''}</span>{#if e.setup?.state === 'failed'}<span class="p-field-err">{tr(e.setup.message)}</span>{/if}</div>
              {#if isFish(e)}<StatusBadge kind={e.configured ? 'ok' : 'neutral'} text={tr(e.configured ? 'Połączone' : 'Niepołączone')}/><span></span>
                <div class="env-more">
                  <label class="field-label">{tr('Adres lokalnej usługi')}<Input aria-label={tr('Adres lokalnej usługi')} bind:value={fishUrl}/></label>
                  <div class="option"><div>{tr('Usługa korzysta z fishaudio/s2-pro, rewizja 1de9996b6be38b745688de084d87a5633f714e4e.')}</div><Switch label={tr('Usługa korzysta z fishaudio/s2-pro')} bind:checked={fishOk}/></div>
                  <div class="p-actions"><Button variant="outline" disabled={!fishOk || working.tts} onclick={fishSave}>{tr('Zapisz połączenie Fish')}</Button></div>
                </div>
              {:else if e.dependencies_ready}<StatusBadge kind="ok" text={tr('Gotowe')}/><span></span>
              {:else if inst}<StatusBadge kind="wait" text={tr('Instalowanie…')}/><span></span><div class="env-more"><div class="p-progress" role="status"><progress class="p-bar" aria-label={tr('Instalowanie…')}></progress><span>{tr(e.setup!.message)}</span></div></div>
              {:else}<StatusBadge kind="neutral" text={tr('Brak bibliotek')}/><Button disabled={working.tts || ttsInstalling} onclick={() => ttsPrepare(e.id)}>{tr('Przygotuj biblioteki')}</Button>{/if}
            </div>
          {/each}
        </div>

        <div class="p-section">
          <header class="split"><div><h3>{tr('Narzędzia audio')}</h3><p>{tr('Programy pomocnicze do odczytu i konwersji dźwięku oraz wideo.')}</p></div><Button disabled={working.media || mediaRunning} onclick={() => mediaAction('acquire', 'Zainstalowano FFmpeg i FFprobe')}><Download size={15}/>{tr('Pobierz zweryfikowany pakiet FFmpeg i FFprobe')}</Button></header>
          {#if mediaOp}<div class="p-progress" role="status"><progress class="p-bar" max="100" value={Math.round((mediaOp[1].progress || 0) * 100)} aria-label={tr('Narzędzia audio')}></progress><span>{Math.round((mediaOp[1].progress || 0) * 100)}% · {mediaOp[0] === 'acquire' ? tr('Pakiet narzędzi') : 'yt-dlp'}</span></div>{/if}
          {#each Object.entries(media?.ops || {}).filter(([, op]) => op.state === 'error') as [name, op] (name)}<p class="p-field-err" role="alert">{name === 'acquire' ? tr('Pakiet narzędzi') : 'yt-dlp'}: {redactDiagnosticText(op.error)}</p>{/each}
          {#each [['ffmpeg', 'FFmpeg'], ['ffprobe', 'FFprobe']] as [id, name] (id)}
            {@const t = media?.tools[id]}
            <div class="env"><div class="nm"><b>{name}</b><span>{toolMeta(t)}</span></div><StatusBadge kind={!t ? 'neutral' : t.ok ? 'ok' : 'bad'} text={tr(!t ? 'Nieodczytane' : t.ok ? 'Działa' : 'Niedostępne')}/><span></span>
              <div class="tools-more">{#if desktop}<Button variant="ghost" disabled={working.media || mediaRunning} onclick={() => chooseMedia(id)}>{tr('Wybierz plik EXE')}</Button>{/if}<Button variant="ghost" disabled={working.media || mediaRunning} onclick={() => mediaAction(`${id}/use-system`, 'Używana wersja systemowa')}>{tr('Użyj wersji systemowej')}</Button><Button variant="ghost" disabled={working.media || mediaRunning} onclick={() => mediaAction(`${id}/restore`, 'Przywrócono wersję dostarczaną')}>{tr('Przywróć wersję dostarczaną')}</Button></div></div>
          {/each}
          {#if media?.tools.ytdlp}{@const y = media.tools.ytdlp}
          <div class="env"><div class="nm"><b>yt-dlp</b><span>{[y.version || tr('brak wersji'), y.overlay_version ? tr('nakładka {v}', { v: y.overlay_version }) : tr('przypięta wersja')].join(' · ')}</span></div><StatusBadge kind={y.ok ? (y.overlay_version ? 'ok' : 'neutral') : 'bad'} text={tr(!y.ok ? 'Niedostępne' : y.overlay_version ? 'Zaktualizowane' : 'Przypięta')}/>
            <Button variant="outline" disabled={working.media || mediaRunning} onclick={() => mediaAction('ytdlp/update', 'Zaktualizowano yt-dlp. Zadziała po restarcie silnika.')}>{tr('Pobierz aktualizację yt-dlp')}</Button>
            <div class="tools-more"><Button variant="ghost" disabled={working.media || mediaRunning || !y.overlay_version} onclick={() => mediaAction('ytdlp/restore', 'Przywrócono przypiętą wersję yt-dlp')}>{tr('Przywróć przypiętą wersję yt-dlp')}</Button></div></div>
          {/if}
        </div>
      </div>{/if}

  {:else}
      {#if !on}<p class="p-notice warn">{tr('Silnik jest zatrzymany, więc dziennik i kontrole nie są dostępne.')}{#if desktop} {tr('Uruchom go przyciskiem u góry strony.')}{/if}</p>
      {:else}
      <div class="p-section">
        <header><h3>{tr('Ostatnie błędy')}</h3><p>{tr('Ostatnie problemy zapisane przez silnik.')}</p></header>
        <div>{#each errors ?? [] as e, i (i)}<div class="err"><div><b>{e.error_class || tr('Błąd silnika')}{e.count && e.count > 1 ? ` · ${tr('wystąpienia: {n}', { n: e.count })}` : ''}</b><span>{[errTime(e), redactDiagnosticText(e.message || e.route || tr('Szczegóły w dzienniku silnika'))].filter(Boolean).join(' · ')}</span></div><Button variant="ghost" onclick={() => showInLog(errKey(e))}><Search size={15}/>{tr('Pokaż w dzienniku')}</Button></div>
        {:else}<p class="p-sub">{errors ? tr('Brak błędów od ostatniego uruchomienia.') : tr('Odczytywanie…')}</p>{/each}</div>
      </div>

      <div class="p-section">
        <header><h3>{tr('Kontrola systemu')}</h3><p>{tr('Sprawdza, czy komputer i silnik mają wszystko, czego potrzebują.')}</p></header>
        <div class="p-actions"><Button disabled={working.pf} onclick={() => runPf(false)}>{tr('Sprawdź system')}</Button><Button variant="outline" disabled={working.pf} onclick={() => runPf(true)}>{tr('Sprawdź gotowość lokalnie')}</Button><span class="p-sub">{tr('Wersja lokalna nie łączy się z internetem.')}</span></div>
        {#if working.pf}<div class="p-progress" role="status"><progress class="p-bar" aria-label={tr('Postęp kontroli')}></progress><span>{tr('Sprawdzam…')}</span></div>{/if}
        {#if pf}<p class="p-sub">{tr(pf.local ? 'Kontrola lokalna' : 'Kontrola pełna')}, {ago(pf.at)}: {pfCount.ok} {tr('w porządku')} · {pfCount.warn} {tr(pl(pfCount.warn, 'ostrzeżenie', 'ostrzeżenia', 'ostrzeżeń'))} · {pfCount.bad} {tr(pl(pfCount.bad, 'błąd', 'błędy', 'błędów'))}</p>
        <div>{#each pf.checks as c (c.id)}<div class="chk"><span class="status-dot big {c.res === 'ok' ? 'ready' : c.res}"></span><div><b>{tr(c.label)}</b><span>{tr(c.detail)}{#if c.res !== 'ok' && c.res !== 'skip' && c.hint}<br>{tr(c.hint)}{/if}{#if c.id === 'hf_token' && c.res !== 'ok' && c.res !== 'skip'}<br>{tr('Token Hugging Face ustawisz w Modele → Pobieranie i dostęp.')}{/if}</span>{#if c.id === 'hf_token' && c.res !== 'ok' && c.res !== 'skip'}<Button variant="ghost" onclick={() => onnavigate?.('models', 'access')}>{tr('Otwórz Pobieranie i dostęp')}</Button>{/if}</div><StatusBadge kind={BADGE[c.res][0]} text={tr(BADGE[c.res][1])}/></div>{/each}</div>{/if}
      </div>

      <div class="p-section">
        <header><h3>{tr('Dziennik silnika')}</h3><p>{tr('Ostatnie 1000 linii. Hasła i ścieżki osobiste są ukryte.')}</p></header>
        <Input placeholder={tr('Filtruj linie…')} aria-label={tr('Filtruj linie dziennika')} bind:value={q}/>
        <div><ButtonGroup label={tr('Poziom wpisów dziennika')} mode="single" value={lvl} items={lvlItems} onchange={v => lvl = v as typeof lvl}/></div>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <pre class="logs" bind:this={logEl} tabindex="0" aria-label={tr('Dziennik silnika')}>{#each rows as r}{@const ts = r.m.match(STAMP)?.[0] ?? ''}{#if ts}<span class="lt">{ts}</span>{/if}<span class={r.l === 'err' ? 'le' : r.l === 'warn' ? 'lw' : ''}>{r.m.slice(ts.length)}</span>
{:else}<span class="lt">{logExists ? tr('Brak linii pasujących do filtra.') : tr('Nie znaleziono jeszcze pliku logu silnika.')}</span>{/each}</pre>
        <div class="p-actions">
          <Button variant="outline" disabled={!rows.length} onclick={() => { navigator.clipboard?.writeText(rows.map(r => r.m).join('\n')).then(() => toast.ok(tr('Skopiowano {n} {lines}', { n: rows.length, lines: tr(pl(rows.length, 'linię', 'linie', 'linii')) })), () => toast.bad(tr('Nie udało się skopiować. Zaznacz tekst i skopiuj go ręcznie.'))); }}><Copy size={15}/>{tr('Kopiuj widoczne')}</Button>
          <Button variant="outline" disabled={!rows.length} onclick={() => { download('dziennik-silnika.txt', rows.map(r => r.m).join('\n'), 'text/plain;charset=utf-8'); toast.ok(tr('Pobrano dziennik')); }}><Download size={15}/>{tr('Pobierz TXT')}</Button>
          <Button variant={armed.clear ? 'destructive' : 'outline'} disabled={!logExists || working.clear} onclick={() => arm('clear', clearLogs)}><Trash2 size={15}/>{armed.clear ? tr('Potwierdź wyczyszczenie logów') : tr('Wyczyść logi silnika')}</Button>
        </div>
      </div>

      <div class="p-section">
        <header class="split"><div><h3>{tr('Raport dla pomocy technicznej')}</h3><p>{tr('Plik z informacjami o silniku, który wyślesz, gdy prosisz o pomoc.')}</p></div><Button disabled={working.report} onclick={report}><FileText size={15}/>{tr('Pobierz raport')}</Button></header>
      </div>
      {/if}
  {/if}
  </div>
</div>

<style>
  section.hdr{display:flex;flex-direction:column}
  .panel{display:flex;flex-direction:column;gap:18px;padding:22px}
  .address{display:flex;align-items:center;gap:10px}.address>code{flex:1;min-width:0;font-size:var(--ui-text-11);overflow-wrap:anywhere;padding:9px 12px;border:1px solid var(--border);border-radius:8px;background:var(--background);font-family:var(--font-mono,monospace)}
  .jumps{display:flex;flex-direction:column}
  .jumps :global(.jump){display:grid;grid-template-columns:110px 1fr auto;gap:12px;align-items:center;width:100%;height:auto;min-height:48px;justify-content:stretch;text-align:left;border-radius:0;border-top:1px solid var(--border);padding:13px 0;font-weight:400}
  .jumps :global(.jump:first-child){border-top:0}
  .jumps :global(.jump .k),.jumps :global(.jump .go){color:var(--muted);font-size:var(--ui-text-12)}.jumps :global(.jump .go){display:inline-flex;align-items:center;gap:2px}
  .jumps :global(.jump .v){white-space:normal;overflow-wrap:anywhere}
  .stack{display:flex;flex-direction:column;gap:18px}
  .inline{display:flex;align-items:center;gap:8px}.inline.wrap{flex-wrap:wrap;justify-content:flex-end}
  .inline label,.field-label{display:flex;align-items:center;gap:8px;font-size:var(--ui-text-12);color:var(--muted)}
  .field-label{flex-direction:column;align-items:stretch;gap:6px}
  .engine-page :global(.num){width:96px;text-align:right}
  .saved{color:var(--success);font-size:var(--ui-text-12)}
  /* status header */
  .hdr{gap:10px;padding:14px 16px}
  .hdr-r1{display:flex;align-items:center;gap:12px}
  .hdr-t{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}.hdr-t strong{font-size:var(--ui-text-15);font-weight:600}.hdr-t span{color:var(--muted);font-size:var(--ui-text-12)}
  .hdr-r2{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--border);padding-top:10px;font-size:var(--ui-text-12);color:var(--muted)}
  .hw{display:flex;flex-direction:column;gap:2px;min-width:0}
  .hw1,.hw2{display:flex;flex-wrap:wrap;column-gap:.45em}
  .hw1{color:var(--foreground);font-size:var(--ui-text-13)}.hw2{color:var(--muted);font-size:var(--ui-text-12)}
  .hw .it{white-space:nowrap}.hw .it+.it::before{content:'·';margin-right:.45em}
  .status-dot.big{width:11px;height:11px}.status-dot.starting{animation:pulse 1s ease-in-out infinite}
  .status-dot.warn{background:var(--settings-warn)}.status-dot.bad{background:var(--danger)}
  @keyframes pulse{50%{opacity:.35}}
  .engine-page :global(.spin){animation:rot .8s linear infinite}@keyframes rot{to{transform:rotate(360deg)}}
  @media(prefers-reduced-motion:reduce){.status-dot.starting,.engine-page :global(.spin){animation:none}}
  .pend{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--settings-warn);margin-left:8px}
  .engine-page :global(.vs-button svg.spin){color:var(--accent)}
  /* dashboard tiles */
  .tiles{display:grid;gap:12px}.t4{grid-template-columns:repeat(4,minmax(0,1fr))}.t2{grid-template-columns:minmax(0,2fr) minmax(0,1fr)}
  .tile .p-bar{margin-top:6px}
  .tile{display:flex;flex-direction:column;gap:6px;padding:16px;border:1px solid var(--border);border-radius:10px;background:var(--surface);min-width:0}
  .tile.off .big,.tile.off .gbars,.tile.off .spark{opacity:.45}
  .tl{font-size:var(--ui-text-12);color:var(--muted);font-weight:500}
  .big{font-size:var(--ui-text-25);font-weight:600;letter-spacing:-.6px;line-height:1.15;font-variant-numeric:tabular-nums}
  .det{font-size:var(--ui-text-11);color:var(--muted);overflow-wrap:anywhere;min-height:1.4em}
  .spark{width:100%;height:28px;margin-top:auto;display:block;overflow:visible}
  .spark line{stroke:var(--border);stroke-width:1;vector-effect:non-scaling-stroke}
  .spark polyline{fill:none;stroke:var(--accent);stroke-width:1.25;vector-effect:non-scaling-stroke;stroke-linejoin:round}
  .spark polyline.hi{stroke:var(--settings-warn)}.spark polyline.vhi{stroke:var(--danger)}
  .gtop{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.gtop .big{font-size:var(--ui-text-30,34px)}
  .plain{font-size:var(--ui-text-13);color:var(--foreground)}
  .gbody{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px 28px;flex:1;margin-top:6px}
  .gchart{display:flex;flex-direction:column;min-width:0}
  .gchart .tl{margin-bottom:4px}
  .gbars{position:relative;display:grid;grid-template-columns:repeat(12,1fr);gap:6px;flex:1;min-height:110px;border-bottom:1px solid var(--border)}
  .gb{position:relative;display:flex;align-items:flex-end;height:100%;outline:none}
  .gb i{display:block;width:100%;border-radius:2px 2px 0 0;background:color-mix(in srgb,var(--foreground) 38%,transparent);transition:height .4s,background .12s}
  .gb[role=img]:hover i,.gb[role=img]:focus i{background:var(--accent)}
  .gb:focus-visible{outline:2px solid var(--focus,var(--accent));outline-offset:2px;border-radius:2px}
  .tip{position:absolute;bottom:calc(var(--h) + 8px);left:50%;transform:translateX(-50%);z-index:6;display:none;flex-direction:column;gap:2px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface-raised);box-shadow:0 6px 16px #0006;font-size:var(--ui-text-11);color:var(--muted);white-space:nowrap;pointer-events:none;font-variant-numeric:tabular-nums}
  .tip b{color:var(--foreground);font-size:var(--ui-text-12);font-weight:600}.tip .m{margin-top:2px;padding-top:4px;border-top:1px solid var(--border);color:var(--foreground)}
  .gb.l .tip{left:0;transform:none}.gb.r .tip{left:auto;right:0;transform:none}
  .gb:hover .tip,.gb:focus .tip{display:flex}
  .gbars .avg{position:absolute;left:0;right:0;height:0;border-top:1px dashed var(--muted);pointer-events:none;z-index:1}
  .bar-ax{display:flex;justify-content:space-between;gap:8px;font-size:var(--ui-text-10);color:var(--muted)}
  .gstats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;padding-top:12px;border-top:1px solid var(--border)}
  .gstats>div{display:flex;flex-direction:column;gap:2px;min-width:0}.gstats span{font-size:var(--ui-text-10);color:var(--muted)}.gstats b{font-size:var(--ui-text-13);font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
  .mrows{display:flex;flex-direction:column;margin-top:6px}
  .mrow{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--border);min-height:52px}
  .mrow .t{display:flex;flex-direction:column;gap:1px;min-width:0}.mrow .t b{font-size:var(--ui-text-12);font-weight:550}.mrow .t span{font-size:var(--ui-text-11);color:var(--muted);overflow-wrap:anywhere}
  .nm,.err>div,.chk>div{display:flex;flex-direction:column;gap:2px;min-width:0}
  .nm b,.err b,.chk b{font-size:var(--ui-text-13);font-weight:550}
  .chk>div :global(button){align-self:flex-start}
  .nm span,.err span,.chk span{color:var(--muted);font-size:var(--ui-text-12);line-height:1.6;overflow-wrap:anywhere}
  .option{display:flex;align-items:center;justify-content:space-between;gap:24px;font-size:var(--ui-text-12)}
  /* environments */
  .env{display:grid;grid-template-columns:1fr auto auto;gap:14px;align-items:center;padding:13px 0;border-top:1px solid var(--border)}
  header+.env,header+.p-progress+.env,header+.p-sub+.env{border-top:0}
  .env-more{grid-column:1/-1;display:flex;flex-direction:column;gap:12px;border:1px solid var(--border);border-radius:8px;padding:14px;background:var(--surface-raised)}
  .steps{margin:0;padding-left:18px;color:var(--muted);font-size:var(--ui-text-12);line-height:1.7}
  .links{display:flex;flex-wrap:wrap;gap:4px 8px;font-size:var(--ui-text-11);overflow-wrap:anywhere}
  .tools-more{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap}
  /* diagnostics */
  .chk{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:start;padding:11px 0;border-top:1px solid var(--border)}.chk:first-child{border-top:0}.chk .status-dot{margin-top:5px}
  .err{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--border)}.err:first-of-type{border-top:0}
  .logs{height:340px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:var(--ui-text-11)/1.8 var(--font-mono,monospace);padding:16px;border:1px solid var(--border);border-radius:8px;background:var(--background);margin:0}
  .logs.short{height:120px}.lt{color:var(--muted);opacity:.7}.lw{color:var(--settings-warn)}.le{color:var(--danger)}
  @media(max-width:1000px){.t4{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:980px){.t2{grid-template-columns:1fr}}
  @media(max-width:600px){.panel{padding:16px}.hdr-r1{flex-wrap:wrap}.env{grid-template-columns:1fr auto}.t4{grid-template-columns:1fr}}
</style>
