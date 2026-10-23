import { postJson, productionJson } from '../tools/production/production'

export type CacheAudit = { token: string; count: number; bytes: number }
export type PreviewCacheState = {
  gallery: { enabled: boolean; featured_cached: number; featured_total: number; checked_seconds_ago?: number | null; last_error?: string | null }
  cache: CacheAudit; temporary: CacheAudit
  local: { count: number; bytes: number }; downloaded: { count: number; bytes: number }; generating: boolean
  voices: { id: string; name: string; cached: boolean }[]
}
export type CacheClearResult = { removed: number; freed_bytes: number; errors: { file: string; error: string }[]; state: PreviewCacheState }
const base = '/next/preview-cache'
export const previewCache = {
  state: (signal?: AbortSignal) => productionJson<PreviewCacheState>(`${base}/state`, { signal }),
  gallery: (enabled: boolean, signal?: AbortSignal) => productionJson<PreviewCacheState>(`${base}/gallery`, { ...postJson({ enabled }, signal), method: 'PUT' }),
  check: (signal?: AbortSignal) => productionJson<PreviewCacheState>(`${base}/gallery/check`, postJson({}, signal)),
  generate: (id: string) => productionJson<{ id: string; state: PreviewCacheState }>(`${base}/generate/${encodeURIComponent(id)}`, postJson({})),
  clear: (audit: CacheAudit, temporary = false, signal?: AbortSignal) => productionJson<CacheClearResult>(`${base}/${temporary ? 'temporary/' : ''}clear`, postJson({ token: audit.token, count: audit.count }, signal)),
}

/** Stop requests affect queued voices; the current guarded render finishes. */
export async function generatePreviewSeries(ids: string[], handlers: { stop: () => boolean; progress: (completed: number, total: number, id: string, state: PreviewCacheState) => void }, generate = previewCache.generate) {
  const unique = [...new Set(ids)]
  let completed = 0
  for (const id of unique) {
    if (handlers.stop()) break
    const response = await generate(id)
    completed++
    handlers.progress(completed, unique.length, id, response.state)
  }
  return { completed, total: unique.length, stopped: completed < unique.length }
}
