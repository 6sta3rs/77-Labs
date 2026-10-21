import { translateUi } from '../../i18n';
import { generate, request, prepareRequest } from '../../platform/api';
import { productionJson, postJson } from '../production/production';
import { decodeAudioFile, processAudio, encodeAudioWav, type AudioEdit } from '../audio-lab/audio-lab';

export type AutomationKind = 'transcribe' | 'speak' | 'translate' | 'convert' | 'edit-audio';
export type ValueKind = 'text' | 'audio';
export type AutomationValue = { kind: 'text'; text: string; language?: string } | { kind: 'audio'; blob: Blob; name: string };
export type AutomationAudioEdit = Omit<AudioEdit, 'end'> & { end?: number };
export type AutomationStep = { id: string; kind: AutomationKind; voiceId?: string; language?: string; sourceLanguage?: string; speed?: number; provider?: 'argos' | 'nllb'; audioEdit?: AutomationAudioEdit };
export type AutomationRecipe = { schema: 1; id: string; name: string; inputKind: ValueKind; steps: AutomationStep[]; updatedAt: number };
export type RunStatus = 'queued' | 'running' | 'stopping' | 'done' | 'failed' | 'cancelled' | 'interrupted';
export type AutomationRun = { id: string; recipe: AutomationRecipe; input: AutomationValue; result?: AutomationValue; status: RunStatus; stepIndex: number; completedSteps: number; error: string; createdAt: number; updatedAt: number; attempt: number };
export type AutomationSnapshot = { recipes: AutomationRecipe[]; runs: AutomationRun[] };
export const automationLabels: Record<AutomationKind, string> = { transcribe: 'Rozpoznaj mowę', speak: 'Czytaj wybranym głosem', translate: 'Przetłumacz lokalnie', convert: 'Zmień głos nagrania', 'edit-audio': 'Obróbka audio' };
export const runLabels: Record<RunStatus, string> = { queued: 'W kolejce', running: 'Wykonywanie', stopping: 'Zatrzymanie po bieżącym kroku', done: 'Gotowe', failed: 'Błąd', cancelled: 'Zatrzymane', interrupted: 'Przerwane — wymagane sprawdzenie' };
export const activeAutomationRun = (run: AutomationRun) => ['queued', 'running', 'stopping'].includes(run.status);
export const automationNeedsRuntime = (recipe: AutomationRecipe) => recipe.steps.some(step => step.kind !== 'edit-audio');
export const automationCanRun = (recipe: AutomationRecipe, ready: boolean) => ready || !automationNeedsRuntime(recipe);
const kinds: AutomationKind[] = ['transcribe', 'speak', 'translate', 'convert', 'edit-audio'];
const expected: Record<AutomationKind, ValueKind> = { transcribe: 'audio', speak: 'text', translate: 'text', convert: 'audio', 'edit-audio': 'audio' };
const produced: Record<AutomationKind, ValueKind> = { transcribe: 'text', speak: 'audio', translate: 'text', convert: 'audio', 'edit-audio': 'audio' };
const maxBytes = 64 * 1024 * 1024;

export const defaultAutomationAudioEdit = (): AutomationAudioEdit => ({ start: 0, normalize: true, targetDb: -3, gainDb: 0, fadeInMs: 0, fadeOutMs: 0 });
function validateAudioEdit(value?: AutomationAudioEdit): AutomationAudioEdit {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error(translateUi("Parametry obróbki audio muszą być obiektem ustawień."));
  const raw = { ...defaultAutomationAudioEdit(), ...value };
  if (typeof raw.normalize !== 'boolean' || ![raw.start, raw.targetDb, raw.gainDb, raw.fadeInMs, raw.fadeOutMs].every(Number.isFinite) || raw.start < 0 || raw.start >= 300 || raw.targetDb < -24 || raw.targetDb > 0 || raw.gainDb < -60 || raw.gainDb > 24 || raw.fadeInMs < 0 || raw.fadeOutMs < 0 || raw.fadeInMs > 300_000 || raw.fadeOutMs > 300_000) throw new Error(translateUi("Sprawdź zakres obróbki audio: do 5 minut, normalizacja −24–0 dBFS, głośność −60–24 dB i nieujemne wygaszanie."));
  if (raw.end !== undefined && (!Number.isFinite(raw.end) || raw.end <= raw.start || raw.end > 300 || Math.max(raw.fadeInMs, raw.fadeOutMs) > (raw.end - raw.start) * 1000)) throw new Error(translateUi("Koniec obróbki musi być po początku, do 300 s. Wygaszanie nie może przekraczać długości fragmentu."));
  // Rebuild the known fields instead of passing arbitrary imported options.
  return { start: raw.start, ...(raw.end === undefined ? {} : { end: raw.end }), normalize: raw.normalize, targetDb: raw.targetDb, gainDb: raw.gainDb, fadeInMs: raw.fadeInMs, fadeOutMs: raw.fadeOutMs };
}

export function validateRecipe(value: AutomationRecipe): AutomationRecipe {
  if (value?.schema !== 1 || typeof value.id !== 'string' || !value.id || value.id.length > 100 || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120) throw new Error(translateUi("Podaj nazwę receptury, maksymalnie 120 znaków."));
  if (!['audio', 'text'].includes(value.inputKind) || !Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 8) throw new Error(translateUi("Receptura wymaga od 1 do 8 kroków i wejścia audio albo tekstowego."));
  let current = value.inputKind;
  let languageKnown = false;
  const ids = new Set<string>();
  const steps = value.steps.map((step, index): AutomationStep => {
    if (!step || !kinds.includes(step.kind) || typeof step.id !== 'string' || !step.id || ids.has(step.id)) throw new Error(translateUi("Receptura zawiera nieobsługiwany lub powtórzony krok."));
    ids.add(step.id);
    if (expected[step.kind] !== current) throw new Error(`Krok ${index + 1}: „${automationLabels[step.kind]}” wymaga ${expected[step.kind] === 'text' ? 'tekstu' : 'nagrania audio'}.`);
    current = produced[step.kind];
    const result: AutomationStep = { id: step.id, kind: step.kind };
    if (step.kind === 'edit-audio') result.audioEdit = validateAudioEdit(step.audioEdit);
    if (step.kind === 'speak' || step.kind === 'convert') {
      if (!step.voiceId || !/^[A-Za-z0-9_-]{1,100}$/.test(step.voiceId)) throw new Error(translateUi("Wybierz zapisany głos dla kroku {arg0}.", { arg0: String(index + 1) }));
      result.voiceId = step.voiceId;
    }
    if (step.kind === 'speak') {
      result.language = typeof step.language === 'string' && /^[A-Za-z-]{2,40}$/.test(step.language) ? step.language : 'Polish';
      result.speed = step.speed ?? 1;
      if (!Number.isFinite(result.speed) || result.speed < 0.5 || result.speed > 2) throw new Error(translateUi("Tempo w kroku {arg0} musi wynosić od 0,5 do 2.", { arg0: String(index + 1) }));
    }
    if (step.kind === 'translate') {
      if (!step.language || !/^[a-z]{2,3}(?:-[A-Za-z]+)?$/.test(step.language)) throw new Error(translateUi("Wybierz język docelowy dla kroku {arg0}.", { arg0: String(index + 1) }));
      if (!['argos', 'nllb'].includes(step.provider || '')) throw new Error(translateUi("Tłumaczenie w recepturze obsługuje wyłącznie lokalne silniki Argos i NLLB."));
      result.language = step.language;
      result.sourceLanguage = step.sourceLanguage === 'auto' || !step.sourceLanguage ? 'auto' : step.sourceLanguage;
      if (!/^(?:auto|[a-z]{2,3}(?:-[A-Za-z]+)?)$/.test(result.sourceLanguage)) throw new Error(translateUi("Nieprawidłowy język źródłowy."));
      if (result.sourceLanguage === 'auto' && !languageKnown) throw new Error(translateUi("Wybierz język źródłowy tłumaczenia w kroku {arg0}.", { arg0: String(index + 1) }));
      result.provider = step.provider;
    }
    if (step.kind === 'transcribe' || step.kind === 'translate') languageKnown = true;
    return result;
  });
  return { schema: 1, id: value.id, name: value.name.trim(), inputKind: value.inputKind, steps, updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now() };
}

export function validateAutomationInput(input: AutomationValue, recipe: AutomationRecipe) {
  if (input.kind !== recipe.inputKind) throw new Error(translateUi("Rodzaj wejścia nie pasuje do receptury."));
  if (input.kind === 'text') {
    if (!input.text.trim() || input.text.length > 20_000) throw new Error(translateUi("Wpisz tekst: od 1 do 20 000 znaków."));
  } else if (!(input.blob instanceof Blob) || input.blob.size === 0 || input.blob.size > maxBytes || !/\.(?:wav|mp3|flac|ogg|m4a|aac|opus|webm)$/i.test(input.name)) {
    throw new Error(translateUi("Wybierz plik audio WAV, MP3, FLAC, OGG, M4A, AAC, Opus lub WebM, nie większy niż 64 MB."));
  }
}

export interface AutomationStore {
  recipes(): Promise<AutomationRecipe[]>;
  runs(): Promise<AutomationRun[]>;
  putRecipe(recipe: AutomationRecipe): Promise<void>;
  removeRecipe(id: string): Promise<void>;
  putRun(run: AutomationRun): Promise<void>;
  removeRun(id: string): Promise<void>;
  putWatchedRun?(run: AutomationRun, sourceKey: string): Promise<{ runId: string; inserted: boolean }>;
}

function openAutomationDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opened = indexedDB.open('voicestudio-next-automation', 2);
    opened.onupgradeneeded = () => {
      for (const table of ['recipes', 'runs']) if (!opened.result.objectStoreNames.contains(table)) opened.result.createObjectStore(table, { keyPath: 'id' });
      if (!opened.result.objectStoreNames.contains('watchReceipts')) opened.result.createObjectStore('watchReceipts', { keyPath: 'sourceKey' });
    };
    opened.onsuccess = () => resolve(opened.result);
    opened.onerror = () => reject(new Error(translateUi("Nie można otworzyć lokalnego magazynu automatyzacji.")));
    opened.onblocked = () => reject(new Error(translateUi("Inne okno blokuje magazyn automatyzacji. Zamknij je i spróbuj ponownie.")));
  });
}
async function stored<T>(table: 'recipes' | 'runs', action: 'list' | 'put' | 'remove', value?: unknown): Promise<T> {
  const database = await openAutomationDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(table, action === 'list' ? 'readonly' : 'readwrite');
      const object = transaction.objectStore(table);
      const operation = action === 'list' ? object.getAll() : action === 'put' ? object.put(value) : object.delete(value as string);
      let result: T;
      operation.onsuccess = () => result = operation.result as T;
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(new Error(translateUi("Nie zapisano danych automatyzacji. Sprawdź wolne miejsce i dostęp do lokalnego magazynu.")));
      transaction.onabort = () => reject(new Error(translateUi("Zapis automatyzacji został przerwany. Poprzednie dane pozostały zachowane.")));
    });
  } finally { database.close(); }
}
export const automationStore: AutomationStore = {
  recipes: () => stored('recipes', 'list'), runs: () => stored('runs', 'list'),
  putRecipe: recipe => stored('recipes', 'put', recipe), removeRecipe: id => stored('recipes', 'remove', id),
  putRun: run => stored('runs', 'put', run), removeRun: id => stored('runs', 'remove', id),
  async putWatchedRun(run, sourceKey) {
    const database = await openAutomationDatabase();
    try {
      return await new Promise<{ runId: string; inserted: boolean }>((resolve, reject) => {
        const transaction = database.transaction(['runs', 'watchReceipts'], 'readwrite');
        const receipts = transaction.objectStore('watchReceipts');
        const existing = receipts.get(sourceKey);
        let runId = run.id, inserted = false;
        existing.onsuccess = () => {
          if (existing.result) runId = existing.result.runId;
          else {
            inserted = true;
            transaction.objectStore('runs').put(run);
            receipts.put({ sourceKey, runId, createdAt: Date.now() });
          }
        };
        transaction.oncomplete = () => resolve({ runId, inserted });
        transaction.onerror = transaction.onabort = () => reject(new Error(translateUi("Nie zapisano wejścia z obserwowanego folderu. Obserwacja została zatrzymana; oryginał pozostaje w folderze.")));
      });
    } finally { database.close(); }
  },
};

export type AutomationOperation = (input: AutomationValue, step: AutomationStep) => Promise<AutomationValue>;
async function audioValue(response: Response, name: string): Promise<AutomationValue> {
  if (!response.ok) throw new Error(translateUi("Silnik odrzucił operację audio ({arg0}). {arg1}", { arg0: String(response.status), arg1: String((await response.text()).slice(0, 250)) }));
  const blob = await response.blob();
  if (!blob.type.startsWith('audio/') || blob.size < 44) throw new Error(translateUi("Silnik nie zwrócił kompletnego pliku audio."));
  if (blob.type.includes('wav')) {
    const head = new TextDecoder('ascii').decode(await blob.slice(0, 12).arrayBuffer());
    if (!head.startsWith('RIFF') || head.slice(8) !== 'WAVE') throw new Error(translateUi("Wynik silnika ma nieprawidłowy nagłówek WAV."));
  }
  return { kind: 'audio', blob, name };
}
export const automationOperations: Record<AutomationKind, AutomationOperation> = {
  'edit-audio': async (input, step) => {
    if (input.kind !== 'audio') throw new Error(translateUi("Obróbka wymaga nagrania audio."));
    const settings = validateAudioEdit(step.audioEdit);
    try {
      const signal = AbortSignal.timeout(60_000);
      const pcm = await decodeAudioFile(new File([input.blob], input.name, { type: input.blob.type }), signal);
      signal.throwIfAborted();
      const result = processAudio(pcm, { ...settings, end: settings.end ?? pcm.channels[0].length / pcm.sampleRate });
      const blob = encodeAudioWav(result.pcm);
      return { kind: 'audio', blob, name: `obrobione-${input.name.replace(/\.[^.]+$/, '').slice(0, 100)}.wav` };
    } catch (cause) {
      // A browser decoder TypeError is a failed local file operation, never an
      // uncertain remote mutation that might still occupy a backend/GPU.
      throw new Error(translateUi("Nie ukończono lokalnej obróbki audio. {arg0}", { arg0: String(cause instanceof Error ? cause.message : String(cause)) }));
    }
  },
  transcribe: async (input) => {
    if (input.kind !== 'audio') throw new Error('Transkrypcja wymaga audio.');
    const signal = AbortSignal.timeout(15 * 60_000);
    const readiness = await productionJson<{ ready: boolean }>('/dictation/readiness?purpose=transcribe', { signal });
    if (!readiness.ready) throw new Error(translateUi("Brak gotowego lokalnego modelu ASR. Przygotuj go w ustawieniach modeli."));
    const body = new FormData(); body.set('audio', input.blob, input.name); body.set('mode', 'reference'); body.set('refine', 'false');
    const result = await productionJson<{ text: string; language?: string }>('/transcribe', { method: 'POST', body, signal });
    if (!result.text?.trim()) throw new Error(translateUi("Silnik nie rozpoznał tekstu."));
    return { kind: 'text', text: result.text, language: result.language };
  },
  speak: async (input, step) => {
    if (input.kind !== 'text') throw new Error('Synteza wymaga tekstu.');
    if (!input.text.trim() || input.text.length > 20_000) throw new Error(translateUi("Krok syntezy wymaga tekstu od 1 do 20 000 znaków."));
    const signal = AbortSignal.timeout(15 * 60_000);
    const family = await productionJson<{ active: string }>('/engines/tts', { signal });
    if (!family.active || family.active === 'off') throw new Error(translateUi("Brak aktywnego silnika syntezy."));
    const result = await generate({ text: input.text, profileId: step.voiceId!, language: step.language || 'Polish', speed: step.speed ?? 1, steps: 16, seed: '', effect: 'none', engine: family.active }, signal);
    return audioValue(new Response(result.blob, { headers: { 'Content-Type': result.blob.type } }), 'narracja.wav');
  },
  convert: async (input, step) => {
    if (input.kind !== 'audio') throw new Error('Konwersja wymaga audio.');
    const signal = AbortSignal.timeout(15 * 60_000);
    const body = new FormData(); body.set('audio', input.blob, input.name); body.set('profile_id', step.voiceId!); body.set('match_duration', 'true');
    const result = await productionJson<{ audio_url: string }>('/convert', { method: 'POST', body, signal });
    if (!/^\/audio\/[A-Za-z0-9_.%/-]+$/.test(result.audio_url) || result.audio_url.includes('..') || result.audio_url.includes('//')) throw new Error(translateUi("Silnik zwrócił nieprawidłową ścieżkę wyniku."));
    await prepareRequest(result.audio_url, signal);
    return audioValue(await request(result.audio_url, { signal }), 'zmieniony-glos.wav');
  },
  translate: async (input, step) => {
    if (input.kind !== 'text') throw new Error(translateUi("Tłumaczenie wymaga tekstu."));
    if (!['argos', 'nllb'].includes(step.provider || '')) throw new Error(translateUi("Wybierz lokalny silnik tłumaczenia Argos albo NLLB."));
    const signal = AbortSignal.timeout(15 * 60_000);
    const source = step.sourceLanguage === 'auto' ? input.language || null : step.sourceLanguage;
    const result = await productionJson<{ translated: Array<{ id: string; text: string; error?: string }> }>('/dub/translate', postJson({ segments: [{ id: 'automation', text: input.text }], source_lang: source, target_lang: step.language, provider: step.provider, quality: 'fast', auto_glossary: false, reflect: false, condense: false }, signal));
    const item = result.translated?.find(row => row.id === 'automation');
    if (!item?.text?.trim() || item.error) throw new Error(item?.error || translateUi("Tłumaczenie nie zwróciło tekstu."));
    return { kind: 'text', text: item.text, language: step.language };
  },
};

export function createAutomationService({ store = automationStore, operations = automationOperations, id = () => crypto.randomUUID(), now = () => Date.now() }: { store?: AutomationStore; operations?: Record<AutomationKind, AutomationOperation>; id?: () => string; now?: () => number } = {}) {
  const recipes = new Map<string, AutomationRecipe>(), runs = new Map<string, AutomationRun>();
  const listeners = new Set<(snapshot: AutomationSnapshot) => void>();
  let initialized: Promise<void> | undefined, pumping = false;
  const snapshot = (): AutomationSnapshot => structuredClone({ recipes: [...recipes.values()].sort((a, b) => b.updatedAt - a.updatedAt), runs: [...runs.values()].sort((a, b) => b.createdAt - a.createdAt) });
  const notify = () => { for (const listener of listeners) listener(snapshot()); };
  async function saveRun(run: AutomationRun) { run.updatedAt = now(); await store.putRun(structuredClone(run)); notify(); }
  async function initialize() {
    initialized ??= (async () => {
      const [savedRecipes, savedRuns] = await Promise.all([store.recipes(), store.runs()]);
      for (const recipe of savedRecipes) recipes.set(recipe.id, validateRecipe(recipe));
      for (const run of savedRuns) {
        validateRecipe(run.recipe); validateAutomationInput(run.input, run.recipe);
        if (activeAutomationRun(run)) { run.status = 'interrupted'; run.error = translateUi("Aplikację zamknięto przed potwierdzeniem wyniku. Sprawdź silnik przed ręcznym ponowieniem; żadne zadanie nie zostało uruchomione automatycznie."); await store.putRun(run); }
        runs.set(run.id, run);
      }
      notify();
    })().catch(error => { initialized = undefined; throw error; });
    return initialized;
  }
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (true) {
        const run = [...runs.values()].find(value => value.status === 'queued');
        if (!run) break;
        try {
          run.status = 'running'; await saveRun(run);
          let value = run.input;
          for (let index = 0; index < run.recipe.steps.length; index++) {
            if ((run.status as RunStatus) === 'stopping') break;
            run.stepIndex = index; await saveRun(run);
            value = await operations[run.recipe.steps[index].kind](value, run.recipe.steps[index]);
            run.completedSteps = index + 1; run.result = value;
            await saveRun(run);
          }
          run.status = (run.status as RunStatus) === 'stopping' ? 'cancelled' : 'done';
          await saveRun(run);
        } catch (cause) {
          run.status = cause instanceof Error && ['TimeoutError', 'AbortError', 'TypeError'].includes(cause.name) ? 'interrupted' : 'failed';
          run.error = cause instanceof Error ? cause.message : String(cause);
          if (run.status === 'interrupted') run.error += " " + translateUi("Odbieranie wyniku przerwano; silnik może kończyć bieżący krok. Sprawdź go przed ponowieniem.");
          try { await saveRun(run); } catch { run.error += " " + translateUi("Wyniku nie udało się zachować w lokalnym magazynie."); notify(); }
          if (run.status === 'interrupted') {
            // A disconnected mutation can still be running in the engine.
            // Do not automatically dispatch later inputs into that uncertainty.
            for (const waiting of runs.values()) if (waiting.status === 'queued') {
              waiting.status = 'interrupted'; waiting.error = translateUi("Kolejka zatrzymana po utracie potwierdzenia silnika. Sprawdź go i ręcznie ponów to zadanie.");
              try { await saveRun(waiting); } catch { notify(); }
            }
            break;
          }
        }
      }
    } finally { pumping = false; }
  }
  async function enqueue(recipe: AutomationRecipe, input: AutomationValue, attempt = 1) {
    await initialize();
    const validated = validateRecipe(recipe); validateAutomationInput(input, validated);
    const run: AutomationRun = { id: id(), recipe: structuredClone(validated), input: structuredClone(input), status: 'queued', stepIndex: 0, completedSteps: 0, error: '', createdAt: now(), updatedAt: now(), attempt };
    // Persist the input before scheduling work. Storage failures never launch
    // an untracked synthesis or discard the only copy of an uploaded input.
    await store.putRun(structuredClone(run)); runs.set(run.id, run); notify(); void pump();
    return run.id;
  }
  return {
    initialize, snapshot, enqueue,
    async enqueueWatched(recipe: AutomationRecipe, input: AutomationValue, sourceKey: string) {
      await initialize();
      if (!/^[a-f0-9]{64}$/.test(sourceKey)) throw new Error(translateUi("Nieprawidłowy identyfikator wejścia z folderu."));
      const validated = validateRecipe(recipe); validateAutomationInput(input, validated);
      if (validated.inputKind !== 'audio' || !store.putWatchedRun) throw new Error(translateUi("Brak trwałego magazynu wejść obserwowanego folderu."));
      const runId = `watch-${sourceKey}`;
      if (runs.has(runId)) return runId;
      const run: AutomationRun = { id: runId, recipe: structuredClone(validated), input: structuredClone(input), status: 'queued', stepIndex: 0, completedSteps: 0, error: '', createdAt: now(), updatedAt: now(), attempt: 1 };
      // Receipt and Blob share one IndexedDB transaction. The receipt survives
      // deleting a history row and a crash before the native acknowledgement.
      const saved = await store.putWatchedRun(run, sourceKey);
      if (saved.runId !== runId) throw new Error(translateUi("Niespójny identyfikator potwierdzenia obserwowanego pliku."));
      // An existing receipt can refer to a deleted row. Never recreate it.
      if (saved.inserted && !runs.has(runId)) { runs.set(runId, run); notify(); void pump(); }
      return runId;
    },
    subscribe(listener: (snapshot: AutomationSnapshot) => void) { listeners.add(listener); listener(snapshot()); return () => { listeners.delete(listener); }; },
    async saveRecipe(recipe: AutomationRecipe) { await initialize(); const value = validateRecipe({ ...recipe, updatedAt: now() }); await store.putRecipe(value); recipes.set(value.id, value); notify(); },
    async removeRecipe(recipeId: string) { await initialize(); await store.removeRecipe(recipeId); recipes.delete(recipeId); notify(); },
    async cancel(runId: string) {
      const run = runs.get(runId); if (!run || !activeAutomationRun(run)) return;
      if (run.status === 'queued') { run.status = 'cancelled'; await saveRun(run); return; }
      run.status = 'stopping'; await saveRun(run);
    },
    async retry(runId: string) { const previous = runs.get(runId); if (!previous || activeAutomationRun(previous)) throw new Error(translateUi("Zadanie nadal trwa albo nie istnieje.")); return enqueue(previous.recipe, previous.input, previous.attempt + 1); },
    async removeRun(runId: string) { const run = runs.get(runId); if (run && activeAutomationRun(run)) throw new Error(translateUi("Najpierw zakończ zadanie.")); await store.removeRun(runId); runs.delete(runId); notify(); },
  };
}

/** Kept alive while changing pages; leaving the UI does not detach a render. */
export const automation = createAutomationService();
