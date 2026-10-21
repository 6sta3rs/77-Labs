import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from './runtime'
import { postJson, productionJson } from './production'
import type { ModelStorage } from './model-management'

export type DataRelocation = { id: string; source: string; destination: string; requested_at: number }
export type StorageState = {
  data_dir: string; pending?: DataRelocation | null; last_error?: string | null
  last_relocation?: { source: string; destination: string; completed_at: number; files: number; source_retained: boolean } | null
  model_default: string; model_configured: string; frontend_storage: string
}
export type StorageCategory = { id: string; label: string; path: string; bytes: number; complete: boolean; errors: string[] }
export type StorageReport = {
  generated_at: number; cached: boolean; logical_bytes: boolean; categories: StorageCategory[]
  volumes: { path: string; total_bytes: number; used_bytes: number; free_bytes: number; low_space: boolean }[]
}
export type StorageBackup = { path: string; bytes: number; created_at: number; kind: string }
export type HistoryRetention = { cap: number; default: number }
const endpoint = '/next/storage'
export const storageSettings = {
  state: (signal?: AbortSignal) => productionJson<StorageState>(`${endpoint}/state`, { signal }),
  report: (refresh = false, signal?: AbortSignal) => productionJson<StorageReport>(`${endpoint}/report?refresh=${refresh ? '1' : '0'}`, { signal }),
  relocate: (path: string, signal?: AbortSignal) => productionJson<StorageState>(`${endpoint}/relocation`, postJson({ path }, signal)),
  cancelRelocation: (signal?: AbortSignal) => productionJson<StorageState>(`${endpoint}/relocation`, { method: 'DELETE', signal }),
  backups: (signal?: AbortSignal) => productionJson<{ backups: StorageBackup[] }>(`${endpoint}/backups`, { signal }),
  backup: (signal?: AbortSignal) => productionJson<{ backups: StorageBackup[] }>(`${endpoint}/backup`, postJson({}, signal)),
  resetModels: (signal?: AbortSignal) => productionJson<ModelStorage>(`${endpoint}/models/reset`, { method: 'PUT', signal }),
  retention: (signal?: AbortSignal) => productionJson<HistoryRetention>('/api/settings/history-retention', { signal }),
  saveRetention: (cap: number, signal?: AbortSignal) => productionJson<HistoryRetention>('/api/settings/history-retention', { ...postJson({ cap }, signal), method: 'PUT' }),
}

export async function pickStorageFolder(): Promise<string | undefined> {
  if (!isDesktop()) throw new Error('Systemowy wybór folderu jest dostępny w aplikacji Windows. W podglądzie wpisz pełną ścieżkę.')
  return (await invoke<string | null>('watch_folder_pick')) || undefined
}

export function dataFolderPath(path: string) {
  const trimmed = path.replace(/[\\/]+$/, '')
  if (trimmed.split(/[\\/]/).at(-1)?.toLowerCase() === 'data') return trimmed
  return `${trimmed}${trimmed.includes('\\') ? '\\' : '/'}data`
}

export function validRetentionCap(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100000
}
