// No credentials or URLs are exposed to the renderer's request router.
// A successful explicit connection publishes this process-local mode.
export const remoteRouting = { active: false };
let revision = 0;
let freshRev = -1, freshAt = 0;
let pending: Promise<void> | undefined;

export function setRemoteRouting(active: boolean) { revision++; remoteRouting.active = active; }

/** A renderer reload must ask the still-running bridge before any operation. */
export async function synchronizeRemoteRouting<T extends { active: boolean }>(read: () => Promise<T>, publish: (value: T) => void) {
  // Every request syncs; a short TTL avoids one extra round trip per call. Any routing change bumps `revision` and invalidates it.
  if (revision === freshRev && Date.now() - freshAt < 3000) return;
  if (pending) return pending;
  const requested = revision;
  const operation = read().then(value => {
    if (!value || typeof value.active !== 'boolean') throw new Error('Nie odczytano wybranego połączenia silnika. Operacja nie została przełączona na inny serwer.');
    if (requested === revision) { publish(value); freshRev = revision; freshAt = Date.now(); }
  });
  pending = operation;
  try { await operation; } finally { if (pending === operation) pending = undefined; }
}

export function routeBackendPath(path: string) {
  if (!remoteRouting.active || path.split('?')[0] === '/health' || path.startsWith('/next/')) return path;
  return `/next/remote/proxy/${path.replace(/^\/+/, '')}`;
}
