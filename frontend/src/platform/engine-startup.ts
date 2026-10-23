import type { RuntimeStatus } from './runtime';

/** Order mirrors `STAGES` in desktop/src/runtime.rs; the last row is the TTS model warm-up. */
export const startupSteps = [
  ['engine_files', 'Przygotowanie plików silnika'],
  ['backup', 'Kopia bezpieczeństwa danych'],
  ['modules', 'Wczytywanie modułów silnika'],
  ['server', 'Uruchamianie serwera lokalnego'],
  ['env_prefs', 'Odczyt ustawień'],
  ['native_preload', 'Biblioteki GPU'],
  ['ml_imports', 'Środowisko PyTorch'],
  ['api_routes', 'Interfejs API'],
  ['db_migrate', 'Baza danych'],
  ['services_start', 'Usługi w tle'],
  ['model', 'Model głosowy'],
] as const;

export type StepState = 'done' | 'active' | 'pending';
export type StartupRow = { id: string; label: string; state: StepState; detail?: string };
export type ModelWarmup = { status: 'idle' | 'loading' | 'ready' | 'error'; stage?: string; progress?: number; error?: string };

const modelStages: Record<string, string> = {
  importing: 'Wczytywanie środowiska modelu',
  loading_weights: 'Ładowanie wag modelu',
  compiling: 'Optymalizacja modelu',
};

/** `/model/status` body → what the checklist needs; anything unexpected reads as idle. */
export function readModelWarmup(body: Record<string, unknown>): ModelWarmup {
  const sub = typeof body.sub_stage === 'string' ? body.sub_stage : undefined;
  const progress = typeof body.progress === 'number' && body.progress >= 0 && body.progress <= 100 ? body.progress : undefined;
  if (typeof body.error === 'string' && body.error) return { status: 'error', error: body.error.slice(0, 200) };
  if (body.loaded === true || body.status === 'ready') return { status: 'ready' };
  if (body.loading === true || body.status === 'loading') return { status: 'loading', stage: sub && modelStages[sub], progress };
  return { status: 'idle' };
}

export function startupRows(runtime: { state: string; startup?: RuntimeStatus['startup'] }, model: ModelWarmup | null): StartupRow[] {
  const engineSteps = startupSteps.length - 1;
  const current = runtime.state === 'ready' ? engineSteps : Math.max(0, startupSteps.findIndex(([id]) => id === runtime.startup?.stage));
  return startupSteps.map(([id, label], index) => {
    if (id === 'model') {
      const state: StepState = model?.status === 'ready' ? 'done' : model?.status === 'loading' ? 'active' : 'pending';
      return { id, label, state, detail: model?.status === 'loading' ? [model.stage, model.progress === undefined ? '' : `${Math.round(model.progress)}%`].filter(Boolean).join(' · ') : undefined };
    }
    return { id, label, state: runtime.state === 'starting' && index === current ? 'active' : index < current || runtime.state === 'ready' ? 'done' : 'pending' };
  });
}

/** Share of finished rows, with the active model row counted by its own percentage when known. */
export function startupFraction(rows: StartupRow[], model: ModelWarmup | null): number {
  const done = rows.filter(row => row.state === 'done').length;
  return Math.min(1, (done + (model?.status === 'loading' ? (model.progress ?? 0) / 100 : 0)) / rows.length);
}

type WarmupFamily = { active: string; backends: Array<{ id: string; license_required?: boolean; license_accepted?: boolean }> };
type WarmupWeight = { role: string; installed: boolean; engines?: string[] };
export type WarmupNote = { text: string; detail?: string };

/**
 * Why the TTS model is not warming up. The engine only logs the reason, so it is derived here from the
 * (idle or failed) warm-up plus the active TTS engine and the model catalogue: an idle model after the
 * start-up wait means the engine skipped the preload. Returns undefined when nothing specific is known.
 */
export function warmupNote(model: ModelWarmup | null, family?: WarmupFamily, weights?: WarmupWeight[]): WarmupNote | undefined {
  if (model?.status === 'error') return { text: 'Nie udało się załadować modelu głosowego', detail: model.error };
  if (model?.status !== 'idle') return undefined;
  const engine = family?.backends.find(item => item.id === family.active);
  if (!engine) return undefined;
  if (engine.license_required && !engine.license_accepted) return { text: 'Pominięto: brak akceptacji warunków modelu' };
  const own = (weights || []).filter(weight => weight.role.toLowerCase() === 'tts' && weight.engines?.includes(engine.id));
  if (own.length && !own.some(weight => weight.installed)) return { text: 'Pominięto: model nie jest pobrany' };
  return undefined;
}
