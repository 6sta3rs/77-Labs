import { translateUi } from '../../i18n';
import type { DubSegment, ResumableBook } from './production';

export type LongformActivity = {
  busy: boolean;
  longform_draining: number;
  reason: string | null;
  physical: { gpu_running: number; gpu_queued: number; model_loading: boolean } | null;
};
export type ProductionTransport = (path: string, options?: RequestInit) => Promise<Response>;
const resumeStatuses = new Set(['cancelled', 'failed', 'interrupted']);
const activityReasons = new Set(['http-request', 'longform-draining', 'longform-proof-error', 'interrupted-request', 'background-job', 'probe-error']);

export function bookCanResume(job?: ResumableBook) {
  return !!job && job.type === 'audiobook' && resumeStatuses.has(job.status);
}

export function bookJobsBusy(jobs: ResumableBook[]) {
  return jobs.some(job => ['queued', 'pending', 'running', 'processing', 'cancelling'].includes(job.status));
}

export function bookJobStatus(status: string) {
  return ({ queued: 'w kolejce', pending: 'oczekuje', running: 'w trakcie generowania', processing: 'przetwarzanie', cancelling: 'zatrzymywanie', cancelled: 'zatrzymane', failed: translateUi("zakończone błędem"), interrupted: 'przerwane', done: translateUi("ukończone") } as Record<string, string>)[status] || 'stan nieustalony';
}

/** The ownership marker is used only for this probe. Never store or report it. */
export async function readLongformActivity(transport: ProductionTransport, parentSignal: AbortSignal): Promise<LongformActivity | undefined> {
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(5000)]);
  try {
    const health = await transport('/health', { signal });
    const marker = health.ok ? health.headers.get('X-VoiceStudio-Next') || '' : '';
    await health.body?.cancel().catch(() => {});
    if (!/^[\x21-\x7e]{1,256}$/.test(marker)) return undefined;
    const response = await transport('/next/activity', { signal, headers: { 'X-VoiceStudio-Next': marker } });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); return undefined; }
    const data = await response.json();
    signal.throwIfAborted();
    if (!data || typeof data.busy !== 'boolean' || !Number.isSafeInteger(data.longform_draining) || data.longform_draining < 0) return undefined;
    const physical = data.physical;
    if (physical != null && (!Number.isSafeInteger(physical.gpu_running) || physical.gpu_running < 0 || !Number.isSafeInteger(physical.gpu_queued) || physical.gpu_queued < 0 || typeof physical.model_loading !== 'boolean')) return undefined;
    return { busy: data.busy, longform_draining: data.longform_draining, reason: data.reason === null ? null : activityReasons.has(data.reason) ? data.reason : 'probe-error', physical: physical == null ? null : { gpu_running: physical.gpu_running, gpu_queued: physical.gpu_queued, model_loading: physical.model_loading } };
  } catch { parentSignal.throwIfAborted(); return undefined; }
}

/** A closed SSE connection is not evidence that its executor or ffmpeg stopped. */
export function bookDrainState(jobs: ResumableBook[], activity: LongformActivity | undefined, jobId: string): 'confirmed' | 'draining' | 'unavailable' {
  const job = jobs.find(row => row.job_id === jobId);
  if (job && !resumeStatuses.has(job.status) && job.status !== 'done') return 'draining';
  if (!activity) return 'unavailable';
  if (activity.busy || activity.longform_draining || activity.reason !== null || activity.physical && (activity.physical.gpu_running || activity.physical.gpu_queued || activity.physical.model_loading)) return 'draining';
  return 'confirmed';
}

/** Reject invalid timing before a request can replace an existing rendered track. */
export function validateDubSegments(segments: DubSegment[], defaultVoice: string) {
  if (!segments.length) throw new Error(translateUi("Dodaj co najmniej jeden segment."));
  let previousEnd = 0;
  for (const [index, segment] of segments.entries()) {
    const label = `Segment ${index + 1}`;
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end <= segment.start) throw new Error(translateUi("{arg0}: koniec musi być późniejszy niż początek, a czas nie może być ujemny.", { arg0: String(label) }));
    if (segment.start < previousEnd - 0.001) throw new Error(translateUi("{arg0}: segmenty nie mogą się nakładać. Popraw początek lub koniec.", { arg0: String(label) }));
    if (!segment.text.trim()) throw new Error(translateUi("{arg0}: wpisz tekst do nagrania.", { arg0: String(label) }));
    if (!(segment.profile_id || defaultVoice)) throw new Error(translateUi("{arg0}: wybierz głos.", { arg0: String(label) }));
    if (segment.speed !== undefined && (!Number.isFinite(segment.speed) || segment.speed < 0.5 || segment.speed > 2)) throw new Error(translateUi("{arg0}: szybkość musi mieścić się w zakresie 0,5–2.", { arg0: String(label) }));
    previousEnd = segment.end;
  }
}

export function dubRequestSegments(segments: DubSegment[], voice: string, language: string, speed: number) {
  validateDubSegments(segments, voice);
  return segments.map(segment => ({ start: segment.start, end: segment.end, text: segment.text, profile_id: segment.profile_id || voice, target_lang: language, direction: segment.direction || '', gain: segment.gain ?? 1, effect_preset: 'raw', speed: segment.speed ?? speed }));
}

/** Parameters refer to a single generated language, never an arbitrary URL/path. */
export function dubExportPath(id: string, language: string, format: 'wav' | 'mp3' | 'video', preserveBackground: boolean, burn: boolean, dual: boolean, karaoke: boolean) {
  const query = new URLSearchParams({ lang: language, preserve_bg: String(preserveBackground) });
  if (format === 'video') {
    query.delete('lang');
    query.set('include_tracks', language);
    query.set('default_track', language);
    query.set('burn_subs', String(burn)); query.set('dual', String(dual)); query.set('karaoke', String(karaoke));
    return `/dub/download/${encodeURIComponent(id)}?${query}`;
  }
  return `/dub/${format === 'mp3' ? 'download-mp3' : 'download-audio'}/${encodeURIComponent(id)}?${query}`;
}
