import { translateUi } from '../i18n';
import { productionJson, postJson } from './production/production';
import { request } from '../platform/api';
import { withConfirmed, beginCatalogRead, invalidateCatalogReads, publishEngineCatalog } from '../models/engine-catalog-state';
import type { EngineReadiness } from '../models/engine-readiness';

export type BatchJob = { id: string; filename: string; status: string; langs: string[]; progress?: { stage?: string; percent?: number } | number | null; error?: string; retry_ready?: boolean; outputs?: Record<string, unknown> };
export type Engine = EngineReadiness & { id: string; display_name?: string; name?: string; description?:string; available?: boolean; installed?: boolean; reason?: string; unavailable_reason?: string; routing_status?: string; routing_reason?: string; supports_cloning?: boolean | null; supports_voice_design?: boolean | null; preset_voices?: string[]; default_voice?: string | null; supported_language_names?: string[]; license_required?: boolean; license_accepted?: boolean };
export type EngineFamily = { active: string; configured_active?: string; active_model?: string; availability_mode?: 'metadata_only'; env_override?: boolean; backends: Engine[] };
export type EngineCatalog = Record<'tts' | 'asr' | 'llm', EngineFamily>;
export type Model = { repo_id: string; label: string; role: string; installed: boolean; supported: boolean; incomplete?: boolean; size_gb?: number; size_on_disk_bytes?: number };
export type BackendRecording = { id: string; text: string; profile_name?: string; audio_path: string; created_at: string | number; duration?: number; starred: boolean | number };
const part = encodeURIComponent;
const json = productionJson;
export const batch = {
  list: (signal?: AbortSignal) => json<BatchJob[]>('/batch/jobs?limit=100', { signal }),
  enqueue: (file: File, langs: string[], voice: string, preserveBg: boolean, signal?: AbortSignal) => {
    const body = new FormData(); body.append('video', file); body.append('langs', langs.join(',')); body.append('preserve_bg', String(preserveBg)); if (voice) body.append('voice_id', voice);
    return json<{ job_id: string }>('/batch/enqueue', { method: 'POST', body, signal });
  },
  action: (id: string, action: 'cancel' | 'retry', signal?: AbortSignal) => json(`/batch/jobs/${part(id)}/${action}`, { method: 'POST', signal }),
};
export async function convertVoice(file: File, profileId: string, matchDuration: boolean, signal?: AbortSignal) {
  if (file.size > 64 * 1024 * 1024) throw new Error(translateUi("Wybierz nagranie mniejsze niż 64 MB."));
  const body = new FormData(); body.append('audio', file); body.append('profile_id', profileId); body.append('match_duration', String(matchDuration));
  return json<{ id: string; audio_url: string; text: string; duration_s: number }>('/convert', { method: 'POST', body, signal });
}
export async function engineCatalog(signal?: AbortSignal) {
  const revision = beginCatalogRead();
  const catalog = await json<EngineCatalog>('/engines', { signal });
  signal?.throwIfAborted();
  if (!publishEngineCatalog(catalog, revision)) throw new DOMException(translateUi("Odczyt zastąpiony nowszym katalogiem modeli."), 'AbortError');
  return withConfirmed(catalog);
}
export const modelsCatalog = (signal?: AbortSignal) => json<{ models: Model[]; disk_free_gb?: number; total_installed_bytes?: number }>('/models', { signal });
/** `modelId` is honoured by the engine only for family=asr with faster-whisper(-isolated) and tts mlx-audio. */
export const selectEngine = (family: string, backendId: string, signal?: AbortSignal, modelId?: string) => {
  invalidateCatalogReads();
  return json<{ active: string; env_override: boolean }>('/engines/select', postJson({ family, backend_id: backendId, ...(modelId ? { model_id: modelId } : {}) }, signal));
};
export const backendHistory = (signal?: AbortSignal) => json<BackendRecording[]>('/history', { signal });
export const starRecording = (id: string, starred: boolean, signal?: AbortSignal) => json(`/history/${part(id)}/starred`, { ...postJson({ starred }, signal), method: 'PUT' });
export const deleteBackendRecording = (id: string, signal?: AbortSignal) => json(`/history/${part(id)}`, { method: 'DELETE', signal });

/** Only fetch app-owned audio routes; never treat backend output as an arbitrary URL. */
export async function loadBackendAudio(path: string, signal?: AbortSignal) {
  const normalized = path.startsWith('/audio/') ? path : `/audio/${part(path)}`;
  const response = await request(normalized, { signal });
  if (!response.ok) throw new Error(translateUi("Nie można wczytać nagrania ({arg0}).", { arg0: String(response.status) }));
  const blob = await response.blob();
  if (!blob.type.startsWith('audio/')) throw new Error(translateUi("Silnik nie zwrócił pliku audio."));
  return blob;
}

export function saveTextFile(text: string, filename: string, type = 'application/json;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export type TranscriptSegment = { start: number; end: number; text: string };
export function subtitleText(segments: TranscriptSegment[], format: 'srt' | 'vtt') {
  const time = (value: number) => {
    const ms = Math.max(0, Math.round(value * 1000));
    return `${String(Math.floor(ms / 3_600_000)).padStart(2, '0')}:${String(Math.floor(ms / 60_000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${format === 'srt' ? ',' : '.'}${String(ms % 1000).padStart(3, '0')}`;
  };
  const cues = segments.filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start && s.text.trim()).map((s, i) => `${format === 'srt' ? `${i + 1}\n` : ''}${time(s.start)} --> ${time(s.end)}\n${s.text.trim()}\n`).join('\n');
  return `${format === 'vtt' ? 'WEBVTT\n\n' : ''}${cues}`;
}
