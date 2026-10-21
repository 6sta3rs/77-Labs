import { translateUi } from '../i18n';
import { postJson, productionJson } from '../tools/production/production';

export type RuntimeInstallState = 'starting' | 'installing' | 'verifying' | 'cancelling' | 'cancelled' | 'interrupted' | 'complete' | 'failed';
export type EngineRuntimeRecipe = {
  engine_id: string; display_name: string; kind: 'sidecar' | 'native'; disclosure_id: string;
  supported: boolean; host_note: string; source_urls: string[];
  required_bytes: number; temporary_free_bytes?: number | null; dependency_bytes?: number | null; weights_bytes?: number | null;
  download_bytes: number | null; size_confidence: string; dependency_policy: string;
  license_required: boolean; license_accepted: boolean; license_summary: string;
  license_links: Array<{ title: string; url: string }>;
  venv_args?: string[]; install_args?: string[]; torch_pins?: string[];
  source_revision?: string; weights_repo_id?: string | null; weights_revision?: string | null;
  version?: string; archive_sha256?: string;
};
export type EngineRuntimeJob = {
  engine_id: string; disclosure_id: string; attempt_id: string; state: RuntimeInstallState; phase: string;
  steps: Array<{ id: string; state: string; detail?: string | null }>; log: string[]; error: string;
  downloaded_bytes?: number | null; total_bytes?: number | null;
  weights_progress?: { filename?: string; downloaded?: number; total?: number; pct?: number } | null;
  updated_at: number; activation?: string | null; restart_required: boolean; effective?: boolean; verified?: boolean;
};
export type EngineRuntimeCatalog = { engines: EngineRuntimeRecipe[]; root: string; copy_only: boolean };
export type EngineRuntimeJobs = { jobs: EngineRuntimeJob[]; busy: boolean };

export const runtimeInstallActive = (job?: EngineRuntimeJob) => !!job && ['starting', 'installing', 'verifying', 'cancelling'].includes(job.state);
export const runtimeInstallLabels: Record<RuntimeInstallState, string> = {
  starting: 'Uruchamianie prywatnego instalatora', installing: 'Przygotowywanie silnika', verifying: 'Sprawdzanie instalacji',
  cancelling: 'Zatrzymywanie instalatora', cancelled: 'Anulowano instalację', interrupted: 'Instalacja przerwana',
  complete: 'Przygotowano środowisko', failed: 'Instalacja nie powiodła się',
};
export const runtimePhaseLabels: Record<string, string> = {
  preflight: 'Sprawdzenie miejsca i narzędzi', prepare_uv: 'Przygotowanie przypiętego uv',
  fetch_source: 'Pobieranie źródeł', create_venv: 'Tworzenie osobnego środowiska Python',
  install_deps: 'Instalacja zależności w osobnym środowisku', verify: 'Test importu silnika',
  fetch_weights: 'Pobieranie wymaganych wag', persist: 'Zapis przygotowanej instalacji',
  native_runtime: 'Przygotowanie programu audio.cpp', native_download: 'Pobieranie programu audio.cpp',
  native_verify: 'Sprawdzanie programu audio.cpp',
};
export function runtimeSize(bytes?: number | null) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return translateUi("nie podano");
  if (!bytes) return '0 B';
  const index = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} ${['B', 'KiB', 'MiB', 'GiB'][index]}`;
}
/** Byte counts are independent of the number of phases; never fabricate %. */
export function runtimeTransfer(job: EngineRuntimeJob) {
  const measured = job.weights_progress;
  const downloaded = measured?.downloaded ?? job.downloaded_bytes;
  const total = measured?.total ?? job.total_bytes;
  if (typeof downloaded !== 'number' || !Number.isFinite(downloaded) || downloaded < 0) return '';
  const knownTotal = typeof total === 'number' && Number.isFinite(total) && total > 0;
  return `${runtimeSize(downloaded)}${knownTotal ? ` / ${runtimeSize(total)}` : " " + translateUi("· łączny rozmiar nieznany")}`;
}
export function validateRuntimeConsent(recipe: EngineRuntimeRecipe, disclosureId: string, accepted: boolean) {
  if (!recipe.supported) throw new Error(recipe.host_note || translateUi("Ten system nie obsługuje instalacji tego silnika."));
  if (!accepted || disclosureId !== recipe.disclosure_id) throw new Error(translateUi("Potwierdź aktualne źródła, warunki i zakres instalacji."));
  if (recipe.license_required && !recipe.license_accepted) throw new Error('Najpierw zaakceptuj warunki tego silnika w katalogu modeli.');
  return { engine_id: recipe.engine_id, disclosure_id: disclosureId, accepted: true };
}
const base = '/next/engine-runtimes';
export const engineInstallation = {
  catalog: (signal?: AbortSignal) => productionJson<EngineRuntimeCatalog>(`${base}/catalog`, { signal }),
  jobs: (signal?: AbortSignal) => productionJson<EngineRuntimeJobs>(`${base}/jobs`, { signal }),
  install: (recipe: EngineRuntimeRecipe, disclosureId: string, accepted: boolean, signal?: AbortSignal) =>
    productionJson<EngineRuntimeJob>(`${base}/install`, postJson(validateRuntimeConsent(recipe, disclosureId, accepted), signal)),
  cancel: (engine_id: string, signal?: AbortSignal) => productionJson<{ requested: boolean }>(`${base}/cancel`, postJson({ engine_id }, signal)),
  activate: (recipe: EngineRuntimeRecipe, signal?: AbortSignal) => productionJson<{ engine_id: string; restart_required: boolean; install_dir: string }>(
    `${base}/activate`, postJson({ engine_id: recipe.engine_id, disclosure_id: recipe.disclosure_id }, signal)),
};
