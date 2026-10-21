import { postJson, productionJson } from './production';
import type { Model } from './studio-tools';

export type ModelStorage = { configured: string; effective: string; restart_required: boolean; inference_offline: boolean; active_downloads: number };
export type ModelDownload = { repo_id: string; cache_dir?: string; state: 'starting' | 'planning' | 'downloading' | 'verifying' | 'cancelling' | 'cancelled' | 'interrupted' | 'complete' | 'failed'; downloaded_bytes: number; total_bytes: number | null; filename?: string; error?: string; updated_at: number };
export type ModelJobs = { jobs: ModelDownload[]; storage: ModelStorage };
export type ManagedModel = Model & { engines?: string[]; note?: string; gated?: boolean; curated?: boolean; license?: string; dependencies?: Array<{ repo_id: string }> };
export const activeDownload = (job?: ModelDownload) => !!job && ['starting', 'planning', 'downloading', 'verifying', 'cancelling'].includes(job.state);
export const modelFamily = (role: string) => ({ tts: 'tts', asr: 'asr', llm: 'llm' }[role.toLowerCase()] || 'other') as 'tts' | 'asr' | 'llm' | 'other';
export const downloadLabels: Record<ModelDownload['state'], string> = { starting: 'Uruchamianie pobierania', planning: 'Sprawdzanie plików i miejsca na dysku', downloading: 'Pobieranie', verifying: 'Sprawdzanie pobranych wag', cancelling: 'Anulowanie pobierania', cancelled: 'Pobieranie anulowane', interrupted: 'Pobieranie przerwane — można wznowić', complete: 'Pobieranie ukończone', failed: 'Pobieranie nie powiodło się' };
export function byteLabel(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const unit = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toLocaleString('pl', { maximumFractionDigits: unit ? 1 : 0 })} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}
export function downloadPercent(job: ModelDownload) {
  return job.total_bytes && job.total_bytes > 0 ? Math.min(99, Math.max(0, Math.floor(job.downloaded_bytes / job.total_bytes * 100))) : undefined;
}
const endpoint = '/next/models';
export const modelManagement = {
  status: (signal?: AbortSignal) => productionJson<ModelJobs>(`${endpoint}/jobs`, { signal }),
  storage: (path: string, signal?: AbortSignal) => productionJson<ModelStorage>(`${endpoint}/storage`, { ...postJson({ path }, signal), method: 'PUT' }),
  install: (repo_id: string, signal?: AbortSignal) => productionJson<ModelDownload>(`${endpoint}/install`, postJson({ repo_id }, signal)),
  cancel: (repo_id: string, signal?: AbortSignal) => productionJson(`${endpoint}/cancel`, postJson({ repo_id }, signal)),
  remove: (repo_id: string, confirmation: string, signal?: AbortSignal) => productionJson(`${endpoint}/delete`, postJson({ repo_id, confirmation }, signal)),
  license: (engine_id: string, accepted: boolean, signal?: AbortSignal) => productionJson('/api/settings/license', postJson({ engine_id, accepted }, signal)),
  tokenState: (signal?: AbortSignal) => productionJson<{ active: { source: string } | null; sources: Array<{ source: string; set: boolean }> }>('/api/settings/hf-token/state', { signal }),
  token: (token: string, signal?: AbortSignal) => productionJson('/api/settings/hf-token', postJson({ token }, signal)),
  clearToken: (signal?: AbortSignal) => productionJson('/api/settings/hf-token', { method: 'DELETE', signal }),
};

export const engineLicenses: Record<string, { name: string; summary: string; links: Array<{ title: string; url: string }> }> = {
  kittentts2: { name: 'KittenTTS 2', summary: 'Wagi: Stellon Labs Community License. Zawiera osobne warunki komercyjne, rejestrację i progi. Licencja Apache 2.0 kodu nie zastępuje licencji wag.', links: [{ title: 'Licencja wag KittenTTS 2', url: 'https://huggingface.co/KittenML/kitten-tts-2/blob/d9c7be8fbbeff3ebd3cb156c8f46a40ddc06b232/LICENSE.md' }] },
  'fish-s2-pro': { name: 'Fish S2 Pro', summary: 'Wagi mają Fish Audio Research License. Zastosowanie komercyjne wymaga odrębnej licencji. Przeczytaj warunki właściwego modelu przed użyciem.', links: [{ title: 'Licencja wag S2 Pro', url: 'https://huggingface.co/fishaudio/s2-pro/blob/1de9996b6be38b745688de084d87a5633f714e4e/LICENSE.md' }] },
  supertonic3: { name: 'Supertonic 3', summary: 'Przed użyciem przeczytaj licencję kodu i wag. Licencja wag i warunki wykorzystania mogą różnić się od licencji aplikacji.', links: [
    { title: 'Licencja kodu', url: 'https://github.com/supertone-inc/supertonic/blob/main/LICENSE' },
    { title: 'Licencja modelu', url: 'https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE' },
  ] },
  pockettts: { name: 'PocketTTS', summary: 'Kod: MIT. Model: CC BY 4.0 oraz dodatkowe warunki dostępu do wag. Pobranie może wymagać osobnej zgody na stronie Hugging Face.', links: [
    { title: 'Licencja kodu', url: 'https://github.com/kyutai-labs/pocket-tts/blob/main/LICENSE' },
    { title: 'Model i warunki dostępu', url: 'https://huggingface.co/kyutai/pocket-tts' },
  ] },
};
