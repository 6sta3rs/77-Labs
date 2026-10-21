import { productionJson } from './production';

export type RuntimeMemory = { cpu: number; cpu_model?: string; ram: number; total_ram: number; gpu_name?: string; vram: number; total_vram: number; gpu_utilization?: number | null };
export type LoadedModel = { id: string; name: string; checkpoint?: string; device?: string; vram_mb?: number; unloadable: boolean; note?: string };
export type LoadedModels = { models: LoadedModel[]; count: number; degraded_sources?: string[] };
export type WatermarkState = { invisible_enabled: boolean; visible_audio_enabled: boolean; visible_video_enabled: boolean; audioseal_available: boolean };
export type MediaToolsState = { ready: boolean; tools: Record<string, { ok: boolean; version?: string | null; origin?: string | null; path?: string | null }> };
export type ComputeState = { value: string; applied: string; restart_required: boolean; override_ignored: boolean; effective_family: string; auto_family: string; available_families: string[]; env_pinned: boolean; choices: string[] };
export type PerformanceState = { global: string; overrides: Record<string,string>; effective: Record<string,string>; tiers: string[]; families: string[]; applicable_families: string[]; targets?: Record<string,unknown>; selections?: Record<string,{engine?:string;model?:string}>; downloads_started: boolean };
export type DiagnosticReport = { app_version: string; platform: string; checks: Array<{id:string;label:string;status:string;detail:string;hint?:string}>; summary: { ok: boolean; passed: number; warnings: number; failures: number }; engine_execution?: unknown[] };
export type RecentError = { timestamp?:string; first_seen?:string; last_seen?:string; error_class?:string; message?:string; route?:string; count?:number; [key:string]:unknown };
export type DiagnosticPart<T> = { data?: T; error?: string };
export type RuntimeSnapshot = { capturedAt: string; memory: DiagnosticPart<RuntimeMemory>; models: DiagnosticPart<LoadedModels>; watermark: DiagnosticPart<WatermarkState>; media: DiagnosticPart<MediaToolsState>; compute: DiagnosticPart<ComputeState>; performance: DiagnosticPart<PerformanceState>; compile: DiagnosticPart<{enabled:boolean;platform:string}> };
const redacted = '[UKRYTO]';
export function redactDiagnosticText(value: unknown): string {
  return String(value ?? '')
    .replace(/(?:hf_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,})/g,redacted)
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+\/-]{8,}=*/gi,redacted)
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,`$1${redacted}@`)
    .replace(/((?:access[_-]?token|auth[_-]?token|api[_-]?key|apikey|token|secret|password|passwd|pwd)=)[^&\s"'#]+/gi,`$1${redacted}`)
    .replace(/\b([A-Z0-9_]*(?:TOKEN|API_KEY|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*|authorization)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^,;\s]+)/gi,`$1=${redacted}`)
    .replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+/gi,'~')
    .replace(/\/(?:Users|home)\/[^/\s"']+/gi,'~');
}
/** Drop named secret fields as well as shaped values before any UI/export. */
export function redactDiagnosticValue<T>(value: T): T {
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string') return redactDiagnosticText(item);
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).filter(([key]) => !/(?:token|api.?key|secret|password|credential|authorization)/i.test(key)).map(([key,part]) => [key,visit(part)]));
    return item;
  };
  return visit(value) as T;
}
async function safeRead<T>(path: string, signal?: AbortSignal): Promise<T> {
  try { return redactDiagnosticValue(await productionJson<T>(path,{signal})); }
  catch (cause) { signal?.throwIfAborted(); throw new Error(redactDiagnosticText((cause as Error).message)); }
}
export async function runtimeSnapshot(signal?: AbortSignal): Promise<RuntimeSnapshot> {
  const results = await Promise.allSettled([
    safeRead<RuntimeMemory>('/sysinfo',signal), safeRead<LoadedModels>('/model/loaded',signal),
    safeRead<WatermarkState>('/watermark/status',signal), safeRead<MediaToolsState>('/media-tools/status',signal),
    safeRead<ComputeState>('/api/settings/compute-device',signal), safeRead<PerformanceState>('/api/settings/performance-profile',signal),
    safeRead<{enabled:boolean;platform:string}>('/api/settings/perf/torch-compile-disabled',signal),
  ]);
  signal?.throwIfAborted();
  const part = <T>(index:number):DiagnosticPart<T> => { const result = results[index]; return result.status === 'fulfilled' ? { data: result.value as T } : { error: redactDiagnosticText(result.reason?.message || result.reason) }; };
  return { capturedAt:new Date().toISOString(), memory:part(0),models:part(1),watermark:part(2),media:part(3),compute:part(4),performance:part(5),compile:part(6) };
}
export const runOfflineDiagnostics = (signal?:AbortSignal) => safeRead<DiagnosticReport>('/system/diagnose?network=false&deep=false',signal);
export const recentRuntimeErrors = (signal?:AbortSignal) => safeRead<{errors:RecentError[];count:number}>('/system/errors/recent?limit=20',signal);
export async function runtimeLogs(signal?:AbortSignal) {
  const result = await safeRead<{lines:string[];exists:boolean}>('/system/logs?tail=100',signal);
  return { exists:result.exists, lines:Array.isArray(result.lines) ? result.lines.slice(-100).map(line => redactDiagnosticText(line).slice(0,2000)) : [] };
}
const jsonPut = (value:unknown,signal?:AbortSignal):RequestInit => ({method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),signal});
export function computeChoices(state:ComputeState):string[] { return state.choices.filter(value => value==='auto'||value==='cpu'||state.available_families.includes(value)); }
export async function saveComputeDevice(value:string,state:ComputeState,signal?:AbortSignal) {
  if (state.env_pinned) throw new Error('Urządzenie jest przypięte przez konfigurację uruchomienia silnika.');
  if (!computeChoices(state).includes(value)) throw new Error('Wybrane urządzenie nie jest dostępne na tym komputerze.');
  return redactDiagnosticValue(await productionJson<ComputeState>('/api/settings/compute-device',jsonPut({value},signal)));
}
export async function savePerformance(tier:string,family:string,state:PerformanceState,signal?:AbortSignal) {
  if (!state.tiers.includes(tier)||!state.applicable_families.includes(family)) throw new Error('Ten preset nie jest dostępny dla wybranej rodziny silników.');
  return redactDiagnosticValue(await productionJson<PerformanceState>('/api/settings/performance-profile',jsonPut({tier,family},signal)));
}
export const saveCompileDisabled = (enabled:boolean,signal?:AbortSignal) => productionJson<{enabled:boolean;platform:string}>('/api/settings/perf/torch-compile-disabled',jsonPut({enabled},signal));
export async function unloadRuntimeModel(model:LoadedModel,signal?:AbortSignal) {
  if (!model.unloadable || !/^(?:tts|asr|diarization|capture-asr|translation:nllb|(?:sidecar|engine|active-engine):[a-zA-Z0-9_-]+)$/.test(model.id)) throw new Error('Ten model nie udostępnia bezpiecznej operacji zwolnienia pamięci.');
  const current = await safeRead<LoadedModels>('/model/loaded',signal); signal?.throwIfAborted();
  if (!current.models.some(item => item.id===model.id&&item.unloadable)) throw new Error('Model nie jest już załadowany. Odśwież listę.');
  const result = await productionJson<{success:boolean;reason?:string}>(`/model/unload/${encodeURIComponent(model.id)}`,{method:'POST',signal});
  if (!result.success) throw new Error(`Nie zwolniono modelu. ${redactDiagnosticText(result.reason || 'Model może być zajęty.')}`);
  return result;
}
export const diagnosticCheckLabels:Record<string,string> = {python:'Python',device:'Urządzenie obliczeń',ffmpeg:'Narzędzia multimedialne',hf_token:'Dostęp do modeli',disk:'Miejsce na dysku',data_dir:'Katalog danych',ram:'Pamięć RAM',engines:'Silniki TTS',gpu_routing:'Przydział GPU'};
