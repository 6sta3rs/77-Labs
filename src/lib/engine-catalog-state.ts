import { writable } from 'svelte/store'
import type { EngineCatalog } from './studio-tools'

/** Last confirmed catalog; subscribing or opening a voice picker never starts Python. */
export const engineCatalogSnapshot = writable<{ catalog: EngineCatalog; checkedAt: number } | undefined>()
let revision = 0
export const beginCatalogRead = () => ++revision
export const invalidateCatalogReads = () => { revision++ }
export function publishEngineCatalog(catalog: EngineCatalog, requestRevision: number) {
  if (requestRevision !== revision) return false
  engineCatalogSnapshot.set({ catalog, checkedAt: Date.now() })
  return true
}
