import { invoke, isTauri } from '@tauri-apps/api/core';
import { fetch as desktopFetch } from '@tauri-apps/plugin-http';
import { acquireRuntime, ensureRuntime, getRuntimeStatus, isDesktop } from './runtime';
import { referenceFileError } from './voice-reference';
import { routeBackendPath, setRemoteRouting, synchronizeRemoteRouting } from './remote-routing';
import { publishRemoteState, type RemoteBackendState } from './remote-state';
import { announceModelLicenseRequired, assertModelLicenseResponse, modelLicenseFailure } from './model-licenses';

export const runtimeMonitorPaths = [
  '/health',
  '/sysinfo',
  '/model/status',
  '/jobs',
  '/batch/jobs',
  '/next/activity',
  '/next/remote/state',
  '/profiles',
  '/engines',
  '/engines/tts',
  '/engines/asr',
  '/engines/llm',
  '/models',
  '/next/models/jobs',
  '/next/models/storage',
  '/next/models/onboarding',
  '/next/engine-runtimes/catalog',
  '/next/engine-runtimes/jobs',
  '/next/integrations/settings',
  '/api/settings/hf-token/state',
  '/next/storage/state',
  '/next/storage/report',
  '/next/storage/backups',
  '/next/preview-cache/state',
  '/next/settings/credentials',
  '/next/settings/proxy',
  '/next/settings/update-source',
  '/system/info',
  '/system/network/state',
  '/system/tailscale/status',
  '/system/logs',
  '/api/settings/llm-providers',
  '/api/settings/llm-skills',
  '/api/settings/dictation-refinement',
  '/api/settings/asr-openai-compat',
  '/api/settings/hf-mirror',
  '/api/settings/cuda-device',
  '/api/settings/compute-device',
  '/api/settings/performance-profile',
  '/api/settings/gpu-report',
  '/api/settings/perf/offload-after-generation',
  '/api/settings/perf/torch-compile-disabled',
  '/api/settings/analytics',
  '/api/settings/history-retention',
  '/api/settings/changelog',
  '/watermark/status',
  '/media-tools/status',
  '/stats/usage',
  '/v1/models',
  '/v1/audio/capabilities',
  '/openapi.json',
  '/pronunciation',
  '/pronunciation/export',
] as const;
export function isRuntimeMonitor(path: string, method = 'GET') {
  return method.toUpperCase() === 'GET' && (runtimeMonitorPaths as readonly string[]).includes(path.split('?')[0]);
}
export async function prepareRequest(path: string, signal?: AbortSignal, method = 'GET') {
  // Cold startup has its own 185 s deadline. A read timeout starts only once
  // the server is ready; caller cancellation still applies to both stages.
  if (isDesktop() && !isRuntimeMonitor(path, method)) await ensureRuntime(signal);
}
export async function request(path: string, options?: RequestInit): Promise<Response> {
  // Use the upstream browser CSRF marker consistently on local requests.
  // Browser fetch supplies its real Origin. The native HTTP client must
  // identify the packaged local renderer explicitly, without weakening CORS.
  const headers = new Headers(options?.headers);
  headers.set('X-VoiceStudio-CSRF', '1');
  if (isTauri()) {
    headers.set('Origin', 'http://tauri.localhost');
    headers.set('Sec-Fetch-Site', 'same-origin');
  }
  options = {...options, headers};
  if (path.split('?')[0] !== '/health' && !path.startsWith('/next/')) {
    const stopped = isTauri() && ['stopped', 'starting'].includes((await getRuntimeStatus()).state);
    options.signal?.throwIfAborted();
    if (stopped) setRemoteRouting(false);
    else await synchronizeRemoteRouting(async () => {
      const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000);
      const state = isTauri() ? await desktopFetch('http://127.0.0.1:4312/next/remote/state', {headers, signal}) : await fetch('/backend/next/remote/state', {headers, signal});
      if (!state.ok) throw new Error('Nie odczytano wybranego połączenia silnika. Odśwież stan w ustawieniach zdalnego silnika.');
      return await state.json() as RemoteBackendState;
    }, publishRemoteState);
    path = routeBackendPath(path);
    headers.set('X-VoiceStudio-Next-Mode', path.startsWith('/next/remote/proxy/') ? 'remote' : 'local');
  }
  if (!isTauri()) return fetch(`/backend${path}`, options);
  options?.signal?.throwIfAborted();
  const method = options?.method?.toUpperCase() || 'GET';
  if (method === 'GET' && path === '/profiles') {
    const data = await invoke<Profile[]>('library_profiles');
    options?.signal?.throwIfAborted();
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  }
  const portrait = method === 'GET' && /^\/profiles\/([a-zA-Z0-9_-]+)\/image(?:\?.*)?$/.exec(path);
  if (portrait) {
    try {
      const data = await invoke<ArrayBuffer>('library_portrait', { id: portrait[1] });
      options?.signal?.throwIfAborted();
      return new Response(data, { headers: { 'Content-Type': 'image/jpeg' } });
    } catch (error) { options?.signal?.throwIfAborted(); return new Response(String(error), { status: 404 }); }
  }
  const monitor = isRuntimeMonitor(path, method);
  const release = await acquireRuntime(options?.signal ?? undefined, !monitor);
  try { return await desktopFetch(`http://127.0.0.1:4312${path}`, options); }
  finally { await release(); }
}
async function json<T>(path:string, options?:RequestInit):Promise<T> {
  options?.signal?.throwIfAborted();
  const response = await request(path, options);
  options?.signal?.throwIfAborted();
  if (!response.ok) {
    await assertModelLicenseResponse(response, options?.signal ?? undefined);
    let message = await response.text();
    try { const body = JSON.parse(message); message = typeof body.detail === 'string' ? body.detail : body.detail?.message || message; } catch { /* Plain error. */ }
    throw new Error(message.slice(0, 300) || `Błąd silnika (${response.status}).`);
  }
  const body = await response.json() as T;
  options?.signal?.throwIfAborted();
  return body;
}
export const health = (signal?: AbortSignal) => json<{status:string;device?:string;version?:string}>('/health', {signal:signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000)});
export type Profile = { id:string;name:string;description?:string;language?:string;kind?:string;image_url?:string|null;created_at?:number|string|null;accent?:string;vd_states?:string|Record<string,unknown> };
export const profiles = (signal?: AbortSignal) => json<Profile[]>('/profiles', {signal:signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000)});
export async function generate(input: { text:string;profileId:string;language:string;speed:number;steps:number;seed:string;effect:string;engine?:string;parameters?:Record<string,string> }, signal:AbortSignal) {
  const form = new FormData();
  Object.entries({...input.parameters,text:input.text,profile_id:input.profileId,engine:input.engine||'omnivoice',language:input.language,speed:String(input.speed),num_step:String(input.steps),effect_preset:input.effect,...(input.seed.trim()?{seed:input.seed.trim()}:{})}).forEach(([key,value]) => form.append(key,value));
  const response = await request('/generate', {method:'POST',body:form,signal});
  if (!response.ok) {
    signal.throwIfAborted();
    const raw = await response.text();
    signal.throwIfAborted();
    let body: unknown;
    try { body = JSON.parse(raw); } catch { /* Plain backend error. */ }
    const licence = modelLicenseFailure(body, response.status);
    if (licence) {
      announceModelLicenseRequired(licence);
      throw licence;
    }
    const detail = body && typeof body === 'object' ? (body as { detail?: string | { message?: string }; error?: string }) : undefined;
    const serverDetail = detail?.detail;
    const message = typeof serverDetail === 'string' ? serverDetail : serverDetail?.message || detail?.error || raw;
    throw new Error(`Generowanie nie powiodło się (${response.status}). ${message.slice(0,220)}`);
  }
  const blob = await response.blob();
  if (!blob.type.includes('audio')) throw new Error('Silnik nie zwrócił pliku audio.');
  return {blob,duration:Number(response.headers.get('X-Audio-Duration')) || undefined,id:response.headers.get('X-Audio-Id') || crypto.randomUUID()};
}
export async function createVoice(name:string,file:File,referenceText:string, options: {language?:string;signal?:AbortSignal} = {}) {
  options.signal?.throwIfAborted();
  if (!name.trim()) throw new Error('Podaj nazwę głosu.');
  const invalid = referenceFileError(file); if (invalid) throw new Error(invalid);
  const form = new FormData(); form.append('name',name.trim()); form.append('ref_audio',file); form.append('ref_text',referenceText.trim()); form.append('language',options.language || 'Polish'); form.append('kind','clone');
  return json<Profile>('/profiles',{method:'POST',body:form,signal:options.signal});
}
export async function transcribe(file:File, mode:string, language='pl', signal?:AbortSignal, options: { refine?: boolean } = {}) {
  const form = new FormData(); form.append('audio',file); form.append('mode',mode); form.append('refine',String(options.refine === true)); if(language!=='auto')form.append('language',language);
  return json<{text:string;language?:string;segments?:{start:number;end:number;text:string}[];refined_text?:string;refinement_unavailable?:boolean|string}>('/transcribe',{method:'POST',body:form,signal});
}
export const engines = () => json<{active:string;active_model?:string;backends:Record<string,unknown> | unknown[]}>('/engines/tts');
export const modelStatus = () => json<Record<string,unknown>>('/model/status');
