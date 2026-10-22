import { translateUi } from '../i18n';
import { invoke, isTauri } from '@tauri-apps/api/core';

export type RuntimeStatus = {
  state: 'stopped' | 'starting' | 'ready' | 'error';
  message: string;
  port: number;
  dataDir?: string;
  source?: 'private-python' | 'shared-python' | 'configured-python';
  managed: boolean;
  startup?: RuntimeStartupProgress;
};

export type RuntimeStartupProgress = {
  runId: string; phase: string; revision: number;
  copiedPages: number; totalPages: number | null;
  copiedBytes: number; totalBytes: number | null;
  files: number | null; backupComplete: boolean; logReadError: boolean;
};

const STARTUP_BUDGET_MS = 305_000;
const startupNow = () => performance.now();
const safeCounter = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Independently bound UI waiting: only new copied data or one completion renews it. */
export class RuntimeStartupDeadline {
  private deadline: number;
  private runId = '';
  private revision = 0;
  private pages = 0;
  private bytes = 0;
  private totalPages: number | null = null;
  private totalBytes: number | null = null;
  private complete = false;
  private backupStarted = false;
  private relocationClosed = false;
  private relocation = { pages: 0, bytes: 0, totalPages: null as number | null, totalBytes: null as number | null };
  constructor(now = startupNow()) { this.deadline = now + STARTUP_BUDGET_MS; }
  expired(now = startupNow()) { return now >= this.deadline; }
  observe(status: RuntimeStatus, now = startupNow()) {
    const progress = status.startup;
    if (!progress || typeof progress.runId !== 'string' || !progress.runId || progress.runId.length > 128) return;
    if (this.runId && this.runId !== progress.runId) throw new Error(translateUi("Sesja uruchamiania silnika zmieniła się. Ponów zadanie w aktualnej sesji."));
    this.runId = progress.runId;
    if (this.complete || !safeCounter(progress.revision) || !safeCounter(progress.copiedPages) || !safeCounter(progress.copiedBytes)) return;
    const totalPages = progress.totalPages, totalBytes = progress.totalBytes;
    if (totalPages !== null && (!safeCounter(totalPages) || progress.copiedPages > totalPages)
      || totalBytes !== null && (!safeCounter(totalBytes) || progress.copiedBytes > totalBytes)) return;
    if (progress.phase === 'relocation_database' || progress.phase === 'relocation_files') {
      // Copying DATA and creating its pre-upgrade backup are separate jobs.
      // Their byte/page totals can differ, and a polling reader may never see
      // the brief reset between them. Keep independent monotone counters.
      const previous = this.relocation;
      if (this.backupStarted || this.relocationClosed || progress.backupComplete || progress.revision <= this.revision
        || progress.copiedPages < previous.pages || progress.copiedBytes < previous.bytes
        || previous.totalPages !== null && totalPages !== previous.totalPages
        || previous.totalBytes !== null && totalBytes !== previous.totalBytes) return;
      const advanced = progress.phase === 'relocation_database' && totalPages !== null && progress.copiedPages > previous.pages
        || progress.phase === 'relocation_files' && totalBytes !== null && progress.copiedBytes > previous.bytes;
      if (!advanced) return;
      this.relocation = { pages: progress.copiedPages, bytes: progress.copiedBytes, totalPages, totalBytes };
      this.revision = progress.revision;
      this.deadline = now + STARTUP_BUDGET_MS;
      return;
    }
    if (progress.phase === 'preparing' && progress.revision > this.revision
      && progress.copiedPages === 0 && progress.copiedBytes === 0 && totalPages === null && totalBytes === null
      && (this.relocation.pages > 0 || this.relocation.bytes > 0)) this.relocationClosed = true;
    if (['backup_plan', 'backup_database', 'backup_files', 'backend_starting'].includes(progress.phase)) this.backupStarted = true;
    if (progress.copiedPages < this.pages || progress.copiedBytes < this.bytes) return;
    if (this.totalPages !== null && totalPages !== this.totalPages) return;
    const finished = progress.phase === 'backend_starting' && progress.backupComplete === true && safeCounter(progress.files) && progress.files > 0;
    if (!finished && this.totalBytes !== null && totalBytes !== this.totalBytes) return;
    const advanced = progress.phase === 'backup_database' && progress.copiedPages > this.pages
      || progress.phase === 'backup_files' && progress.copiedBytes > this.bytes;
    if (progress.revision > this.revision && (advanced || finished)) {
      this.deadline = now + STARTUP_BUDGET_MS;
      this.revision = progress.revision;
      this.pages = progress.copiedPages; this.bytes = progress.copiedBytes;
      this.totalPages = totalPages; this.totalBytes = totalBytes;
      this.complete = finished;
    }
  }
}

export const isDesktop = () => isTauri();

const preview: RuntimeStatus = {
  state: 'stopped', message: 'Podgląd interfejsu', port: 4312, managed: false,
};

export function getRuntimeStatus(): Promise<RuntimeStatus> {
  return isDesktop() ? invoke('runtime_status') : Promise.resolve({ ...preview });
}

export const engineIdleKey = 'voicestudio.engineIdleMinutes';
export const engineIdleOptions = [5, 15, 30, 60] as const;
export type EngineIdleMinutes = typeof engineIdleOptions[number];

/** Odczyt wyboru użytkownika; brak lub wartość spoza listy oznacza domyślne 15 minut. */
export function readEngineIdleMinutes(): EngineIdleMinutes {
  try {
    const saved = Number(localStorage.getItem(engineIdleKey));
    return engineIdleOptions.find(option => option === saved) ?? 15;
  } catch { return 15; }
}

/** Rust przyjmuje tylko 5/15/30/60; w przeglądarce nie ma silnika do przestawienia. */
export function applyEngineIdleMinutes(minutes: EngineIdleMinutes): Promise<number | undefined> {
  return isDesktop() ? invoke<number>('runtime_set_idle_minutes', { minutes }) : Promise.resolve(undefined);
}

/** Zapis dopiero po akceptacji w Rust, żeby nieudana zmiana nie zostawiła innego ustawienia niż aktywne. */
export async function saveEngineIdleMinutes(minutes: EngineIdleMinutes): Promise<void> {
  if (!engineIdleOptions.includes(minutes)) throw new Error('Nieprawidłowy czas utrzymania silnika.');
  await applyEngineIdleMinutes(minutes);
  localStorage.setItem(engineIdleKey, String(minutes));
}

// ponytail: apply once per app session (Rust keeps the value); retried on the next use if the first call fails.
let idleApplied: Promise<unknown> | undefined;
function applyStoredIdleOnce(): Promise<unknown> {
  if (!isDesktop()) return Promise.resolve();
  idleApplied ??= applyEngineIdleMinutes(readEngineIdleMinutes()).catch(() => { idleApplied = undefined; });
  return idleApplied;
}

export function startRuntime(): Promise<RuntimeStatus> {
  return isDesktop() ? applyStoredIdleOnce().then(() => invoke<RuntimeStatus>('runtime_start')) : Promise.resolve({ ...preview });
}

export function stopRuntime(): Promise<RuntimeStatus> {
  return isDesktop() ? invoke('runtime_stop') : Promise.resolve({ ...preview });
}

let readiness: Promise<RuntimeStatus> | undefined;
const changed = (status: RuntimeStatus) => {
  window.dispatchEvent(new CustomEvent('studio-runtime', { detail: status }));
  return status;
};

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

async function waitForReady(initial: RuntimeStatus): Promise<RuntimeStatus> {
  const deadline = new RuntimeStartupDeadline();
  deadline.observe(initial);
  while (!deadline.expired()) {
    const status = changed(await getRuntimeStatus());
    if (status.state === 'ready') return status;
    if (status.state !== 'starting') throw new Error(status.message);
    deadline.observe(status);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(translateUi("Przekroczono czas uruchamiania lokalnego silnika. Sprawdź Silnik."));
}

/** A Rust-owned lease protects startup/request dispatch against idle shutdown. */
export async function acquireRuntime(signal?: AbortSignal, keepWarm = true): Promise<() => Promise<void>> {
  if (!isDesktop()) return async () => {};
  signal?.throwIfAborted();
  await applyStoredIdleOnce();
  const { lease, status } = await invoke<{ lease: number; status: RuntimeStatus }>('runtime_acquire', { keepWarm });
  let released = false;
  const release = async (cancelStartup = false) => { if (!released) { released = true; await invoke('runtime_release', { lease, cancelStartup }); } };
  try {
    changed(status);
    signal?.throwIfAborted();
    if (status.state === 'error' || status.state === 'stopped') throw new Error(status.message);
    if (status.state !== 'ready') {
      readiness ??= waitForReady(status).finally(() => { readiness = undefined; });
      await abortable(readiness, signal);
    }
    signal?.throwIfAborted();
    return release;
  } catch (error) { await release(signal?.aborted === true); throw error; }
}

export async function ensureRuntime(signal?: AbortSignal): Promise<void> {
  const release = await acquireRuntime(signal);
  await release();
}
