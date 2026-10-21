import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './runtime';
import { automation, activeAutomationRun, automationNeedsRuntime, validateRecipe, type AutomationRecipe } from './automation';

export type WatchedFile = { key: string; name: string; size: number; modifiedNs: string };
export type WatchFolderStatus = { enabled: boolean; state: 'off' | 'watching' | 'error'; path: string; recipeId: string; message: string; pending: WatchedFile[]; acknowledged: number; skipped: number; lastScan: number };
export const emptyWatchStatus = (): WatchFolderStatus => ({ enabled: false, state: 'off', path: '', recipeId: '', message: 'Obserwacja jest wyłączona.', pending: [], acknowledged: 0, skipped: 0, lastScan: 0 });
export interface WatchFolderBridge {
  status(): Promise<WatchFolderStatus>;
  start(path: string, recipeId: string): Promise<WatchFolderStatus>;
  stop(): Promise<WatchFolderStatus>;
  read(key: string): Promise<ArrayBuffer>;
  acknowledge(key: string, runId: string): Promise<WatchFolderStatus>;
  pick(): Promise<string | null>;
}
export const watchFolderBridge: WatchFolderBridge = {
  status: () => invoke('watch_folder_status'),
  start: (path, recipeId) => invoke('watch_folder_start', { path, recipeId }),
  stop: () => invoke('watch_folder_stop'),
  read: key => invoke<ArrayBuffer>('watch_folder_read', { key }),
  acknowledge: (key, runId) => invoke('watch_folder_acknowledge', { key, runId }),
  pick: () => invoke('watch_folder_pick'),
};
const mimeTypes: Record<string, string> = { wav: 'audio/wav', mp3: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', webm: 'audio/webm' };
const mime = (name: string) => mimeTypes[name.split('.').pop()?.toLowerCase() || ''] || 'application/octet-stream';

export function createWatchFolderService({ bridge = watchFolderBridge, queue = automation, now = () => Date.now(), schedule = (callback: () => void) => setTimeout(callback, 1000), unschedule = (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer) } = {}) {
  let status = emptyWatchStatus(), recipe: AutomationRecipe | undefined, generation = 0, startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined, ticking: Promise<void> | undefined, starting = false;
  const listeners = new Set<(value: WatchFolderStatus) => void>();
  const publish = (value: WatchFolderStatus) => { status = structuredClone(value); for (const listener of listeners) listener(structuredClone(status)); return status; };
  const clearTimer = () => { if (timer !== undefined) unschedule(timer); timer = undefined; };
  async function stop(message?: string) {
    generation++; recipe = undefined; clearTimer();
    publish({ ...status, enabled: false, state: 'off', pending: [], message: 'Zatrzymywanie źródła wejść…' });
    const stopped = await bridge.stop();
    return publish(message ? { ...stopped, state: 'error', message } : stopped);
  }
  function tick(): Promise<void> {
    if (ticking) return ticking;
    const version = generation, selected = recipe;
    if (!selected) return Promise.resolve();
    ticking = (async () => {
      try {
        let current = await bridge.status();
        if (version !== generation) return;
        publish(current);
        if (!current.enabled) { recipe = undefined; return; }
        if (current.recipeId !== selected.id) throw new Error('Źródło folderu ma inną recepturę. Włącz obserwację ponownie.');
        const runs = queue.snapshot().runs;
        if (runs.some(run => run.status === 'interrupted' && run.updatedAt >= startedAt)) throw new Error('Kolejka utraciła potwierdzenie silnika. Obserwacja zatrzymana; sprawdź zadania przed ponownym włączeniem.');
        // Backpressure also bounds the number of persisted 64 MB Blobs.
        if (runs.filter(activeAutomationRun).length >= 10) return;
        const file = current.pending[0];
        if (!file) return;
        if (!/^[a-f0-9]{64}$/.test(file.key) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 64 * 1024 * 1024 || !/\.(?:wav|mp3|flac|ogg|m4a|aac|opus|webm)$/i.test(file.name)) throw new Error('Most folderu zwrócił nieprawidłowy plik audio.');
        const bytes = await bridge.read(file.key);
        if (version !== generation) return;
        if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== file.size) throw new Error('Plik zmienił się podczas odczytu. Obserwacja zatrzymana; oryginał pozostaje w folderze.');
        const runId = await queue.enqueueWatched(selected, { kind: 'audio', blob: new Blob([bytes], { type: mime(file.name) }), name: file.name }, file.key);
        if (version !== generation) return;
        // A crash here is safe: the queue's durable receipt suppresses replay.
        current = await bridge.acknowledge(file.key, runId);
        if (version === generation) publish(current);
      } catch (cause) {
        if (version !== generation) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        try { await stop(message); }
        catch (stopError) { publish({ ...status, enabled: false, state: 'error', message: `${message} Nie potwierdzono zatrzymania źródła: ${String(stopError)}` }); }
      }
    })().finally(() => {
      ticking = undefined;
      if (recipe && status.enabled) timer = schedule(() => { timer = undefined; void tick(); });
    });
    return ticking;
  }
  return {
    available: isDesktop,
    snapshot: () => structuredClone(status),
    requiresRuntime: () => !recipe || automationNeedsRuntime(recipe),
    subscribe(listener: (value: WatchFolderStatus) => void) { listeners.add(listener); listener(structuredClone(status)); return () => { listeners.delete(listener); }; },
    async initialize() {
      const value = await bridge.status();
      if (!recipe) { if (value.enabled) await stop('Przeładowano aplikację. Obserwacja wymaga ponownego jawnego włączenia.'); else publish(value); }
    },
    async start(path: string, value: AutomationRecipe) {
      if (starting || recipe || ticking) throw new Error('Najpierw zatrzymaj bieżącą obserwację i poczekaj na zakończenie odczytu.');
      const selected = validateRecipe(value);
      if (selected.inputKind !== 'audio') throw new Error('Obserwowany folder wymaga zapisanej receptury z wejściem audio.');
      starting = true; const version = ++generation;
      try {
        await queue.initialize();
        if (version !== generation) return;
        const current = await bridge.start(path, selected.id);
        if (version !== generation) { await bridge.stop(); return; }
        startedAt = now(); recipe = structuredClone(selected); publish(current);
        void tick();
      } finally { starting = false; }
    },
    stop, tick, pick: () => bridge.pick(),
  };
}

/** Source consumption survives changing pages; native state starts OFF per app. */
export const watchFolder = createWatchFolderService();
