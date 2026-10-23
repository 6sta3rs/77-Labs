import { writable } from 'svelte/store'
import type { EngineCatalog } from '../tools/studio-tools'

/** Last confirmed catalog; subscribing or opening a voice picker never starts Python. */
export const engineCatalogSnapshot = writable<{ catalog: EngineCatalog; checkedAt: number } | undefined>()
let revision = 0
export const beginCatalogRead = () => ++revision
export const invalidateCatalogReads = () => { revision++ }

// Engines that already produced audio in this app (the catalogue only ever reports metadata, never inference).
// Persisted so a restart does not show "Sprawdź i użyj" again for an engine that is known to work.
const CONFIRMED_KEY = 'studio.confirmedEngines'
const confirmed = new Set<string>()
try { for (const id of JSON.parse(globalThis.localStorage?.getItem(CONFIRMED_KEY) || '[]')) if (typeof id === 'string') confirmed.add(id) } catch { /* no storage or bad value: start empty */ }

export const withConfirmed = (catalog: EngineCatalog): EngineCatalog => {
  if (!confirmed.size) return catalog
  const next = { ...catalog }
  for (const family of ['tts', 'asr', 'llm'] as const) {
    const current = catalog[family]
    if (current) next[family] = { ...current, backends: current.backends.map(engine => confirmed.has(`${family}:${engine.id}`) && engine.installed !== false && engine.availability_check !== 'missing_dependencies' ? { ...engine, inference_verified: true } : engine) }
  }
  return next
}

export function markEngineConfirmed(id: string, family: 'tts' | 'asr' | 'llm' = 'tts') {
  const key = `${family}:${id}`
  if (!id || confirmed.has(key)) return
  confirmed.add(key)
  try { globalThis.localStorage?.setItem(CONFIRMED_KEY, JSON.stringify([...confirmed])) } catch { /* storage unavailable: confirmation lasts for this session */ }
  engineCatalogSnapshot.update(snapshot => snapshot && { ...snapshot, catalog: withConfirmed(snapshot.catalog) })
}

/** A failed generation withdraws the local confirmation; the next catalogue read shows the server's own verdict again. */
export function unmarkEngineConfirmed(id: string, family: 'tts' | 'asr' | 'llm' = 'tts') {
  if (!confirmed.delete(`${family}:${id}`)) return
  try { globalThis.localStorage?.setItem(CONFIRMED_KEY, JSON.stringify([...confirmed])) } catch { /* storage unavailable */ }
}

export function publishEngineCatalog(catalog: EngineCatalog, requestRevision: number) {
  if (requestRevision !== revision) return false
  engineCatalogSnapshot.set({ catalog: withConfirmed(catalog), checkedAt: Date.now() })
  return true
}
