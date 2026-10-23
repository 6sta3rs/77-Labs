import { translateUi } from '../i18n';
import { productionJson, postJson } from '../tools/production/production'
import { redactDiagnosticText } from '../platform/runtime-diagnostics'
import { userMessage } from '../platform/user-message'

export type SystemSection = 'network' | 'sharing' | 'credentials' | 'compute' | 'usage' | 'remote-workers' | 'privacy' | 'permissions' | 'preflight' | 'audio-tools' | 'logs'
export type CredentialState = { hf: { set: boolean; masked?: string; source: string; verified?: boolean | null; user?: string }; fields: Array<{ key: string; label: string; secret: boolean; set: boolean; masked?: string; value: string }> }
export type ProxyState = { set: boolean; address: string; has_credentials: boolean }
export type HfMirrorState = {
  configured: string; effective: string; presets: Array<{ label: string; url: string }>; mode: 'auto' | 'manual'; auto_opt_out: boolean; restart_required?: boolean
  auto: { endpoint: string; reachable: boolean; latency_ms?: number | null; checked_at: number; results: Array<{ endpoint: string; reachable: boolean; latency_ms?: number | null; error?: string }> } | null
}
export const preflightCheckLabels: Record<string, string> = {
  os: 'System operacyjny', python: 'Środowisko Python', ram: 'Pamięć RAM', disk: 'Miejsce na dysku', hf_cache_writable: 'Zapis w pamięci modeli Hugging Face', platform: 'Obsługa platformy', arch: 'Architektura systemu', gpu: 'Akceleracja GPU', gpu_routing: 'Przydział urządzeń dla aktywnych silników', network: 'Połączenie z repozytorium modeli',
}
export type NetworkState = { enabled: boolean; share_port?: number | null; pin?: string | null; lan_addresses: string[] }
export type TailscaleState = { installed: boolean; running: boolean }
export type SystemInfo = { platform: string; arch: string; python: string; backend_port: number; ui_port: number | null; share_port_base: number; generate_timeout_s: number; cpu_generate_timeout_s: number; generate_timeout_shadowed?: boolean; cpu_generate_timeout_shadowed?: boolean; translate_provider?: string }
export type CudaState = { value: string; applied: string; env_pinned: boolean; restart_required: boolean; devices: Array<{ index: number; value: string; name: string }> }
export type UsageState = { takes: number; audio_seconds: number; voices: number; active_days: number; dubs: number; starred: number; first_at?: number | null; by_mode: Array<{ name: string; count: number }>; by_language: Array<{ name: string; count: number }> }
export type PreflightReport = { checks: Array<{ id: string; status: string; label: string; detail: string; fix?: string }>; ok?: boolean }
export type MediaState = { ready: boolean; tools: Record<string, { ok: boolean; version?: string; path?: string; origin?: string; overlay_version?: string }>; ops: Record<string, { state?: string; progress?: number; error?: string }> }
export type AnalyticsState = { enabled: boolean; opted_in: boolean; available: boolean; prompted: boolean }
export type GpuReport = { platform: string; gpus: Array<{ vendor: string; name: string; vram_gb: number }>; torch: { kind: string; version: string | null }; state: string; options: string[]; engines: Array<{ id: string; name: string; kind: string; code: string; available: boolean; params?: Record<string, string | number | null> }> }
export const gpuStateLabels: Record<string, string> = {
  accelerated: 'Akceleracja GPU dostępna', accelerated_caveat: 'Akceleracja dostępna z ograniczeniami', pinned_cpu: 'W konfiguracji wybrano CPU', no_gpu: 'Nie wykryto obsługiwanej karty GPU', probe_failed: 'Nie udało się sprawdzić GPU',
  amd_cuda_build: 'Karta AMD z biblioteką przeznaczoną dla CUDA', amd_cpu_build: 'Karta AMD z biblioteką CPU', amd_rocm_no_device: 'ROCm nie wykrywa urządzenia AMD', nvidia_cpu_build: 'Karta NVIDIA z biblioteką CPU', nvidia_cuda_unavailable: 'CUDA nie udostępnia karty NVIDIA', nvidia_rocm_build: 'Karta NVIDIA z biblioteką ROCm', intel_unsupported: 'Brak obsługiwanej ścieżki GPU dla tej karty Intel',
}
export const gpuEngineLabels: Record<string, string> = { gpu: 'GPU', gpu_caveat: 'GPU z ograniczeniami', cpu_by_design: 'Silnik przeznaczony dla CPU', host_gpu_unusable: 'GPU nieużyteczne w bieżącym środowisku', host_gpu_unusable_rocm: 'GPU wymaga zgodnej instalacji ROCm', host_gpu_unusable_no_amd_path: 'Brak obsługiwanej ścieżki AMD', pinned_cpu: 'Przypięto CPU', no_family_path: 'Brak obsługi tej rodziny GPU', no_gpu: 'Brak GPU', needs_accelerator: 'Wymaga akceleratora', not_installed: 'Nie zainstalowano' }
export const gpuOptionLabels: Record<string, string> = { vulkan_engines: 'Można użyć silników obsługujących Vulkan.', rocm_windows_manual: 'ROCm na Windows wymaga zgodnej ręcznej konfiguracji runtime.', rocm_variant_linux: 'Można przygotować zgodny wariant ROCm dla Linux.', rocm_device_access: 'Sprawdź uprawnienia dostępu do urządzenia ROCm.', reinstall_cuda_torch: 'Wybierz oddzielny runtime CUDA w instalatorze aplikacji.', update_nvidia_driver: 'Sprawdź sterownik karty NVIDIA.' }

// The desktop transport reports an expired status-read timer as "Request cancelled" (AbortError), not as a TimeoutError.
// Callers drop errors from their own abort before they get here, so a remaining abort means the engine did not answer in time.
const timedOut = (cause: unknown) => cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError' || /request cancell?ed/i.test(cause.message))
export function settingsError(cause: unknown) {
  return timedOut(cause) ? translateUi("Silnik nie odpowiedział w wymaganym czasie. Odśwież stan i spróbuj ponownie.") : translateUi(userMessage(cause instanceof Error ? new Error(redactDiagnosticText(cause.message)) : redactDiagnosticText(cause), 'Nie udało się wykonać operacji. Sprawdź stan silnika i spróbuj ponownie.')).slice(0, 900)
}
export function putSettings<T>(path: string, body: unknown, signal?: AbortSignal) { return productionJson<T>(path, { ...postJson(body, signal), method: 'PUT' }) }
export function hfMirrorAddress(value: string): string {
  const address = value.trim().replace(/\/+$/, '')
  if (!address) return ''
  let parsed: URL
  try { parsed = new URL(address) } catch { throw new Error(translateUi("Podaj prawidłowy adres źródła modeli, zaczynający się od https://.")) }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (/[\s\\\u0000-\u001f\u007f]/.test(address) || !host || !['https:', 'http:'].includes(parsed.protocol)) throw new Error(translateUi("Podaj prawidłowy adres HTTPS bez spacji i znaków sterujących."))
  if (parsed.username || parsed.password || address.includes('?') || address.includes('#')) throw new Error(translateUi("Adres źródła nie może zawierać loginu, hasła, parametrów ani fragmentu."))
  if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error(translateUi("Połączenie HTTP jest dozwolone wyłącznie dla lokalnego serwera localhost."))
  return address
}
export function settingsPort(value: string | number): number {
  if (String(value).trim() === '') throw new Error(translateUi('Podaj port od 1024 do 65535.'))
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(translateUi('Podaj port od 1024 do 65535.'))
  return port
}
export function settingsTimeout(value: string | number): number {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 21600) throw new Error(translateUi("Limit musi być większy od 0 i wynosić najwyżej 21600 sekund."))
  return seconds
}
export function durationLabel(value: number): string {
  const seconds = Math.max(0, Math.round(Number(value) || 0))
  return seconds < 60 ? `${seconds} s` : seconds < 3600 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${Math.floor(seconds / 3600)} godz. ${Math.floor(seconds % 3600 / 60)} min`
}
