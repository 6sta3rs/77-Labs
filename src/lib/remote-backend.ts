import { postJson, productionJson } from './production'
import { publishRemoteState as publish, type RemoteBackendState } from './remote-state'
export { remoteBackendState, type RemoteBackendState } from './remote-state'

const endpoint = '/next/remote'
export const remoteBackend = {
  state: async (signal?: AbortSignal) => publish(await productionJson<RemoteBackendState>(`${endpoint}/state`, { signal })),
  test: (url: string, key: string, signal?: AbortSignal) => productionJson<{ ok: boolean; url: string; detail: string; active: boolean }>(`${endpoint}/test`, postJson({ url, key }, signal)),
  connect: async (url: string, key: string, signal?: AbortSignal) => publish(await productionJson<RemoteBackendState>(`${endpoint}/connect`, postJson({ url, key }, signal))),
  local: async (signal?: AbortSignal) => publish(await productionJson<RemoteBackendState>(`${endpoint}/local`, postJson({}, signal))),
}

/** Operation paths only; /next/* and readiness always belong to this desktop. */
export function remoteProxyPath(path: string) { return `${endpoint}/proxy/${path.replace(/^\/+/, '')}` }

export function remoteSocketUrl(desktop: boolean, origin: string, localPath: string) {
  const source = new URL(localPath, 'ws://127.0.0.1:4312')
  if (!['/ws/transcribe', '/ws/events', '/ws/tts'].includes(source.pathname)) throw new Error('Nieobsługiwana trasa zdalnego dyktowania.')
  const target = desktop ? new URL('ws://127.0.0.1:4312/next/remote/ws') : new URL('/backend/next/remote/ws', origin)
  target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:'
  target.search = new URLSearchParams({ path: source.pathname, ...Object.fromEntries(source.searchParams) }).toString()
  return target.toString()
}
