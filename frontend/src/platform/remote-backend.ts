import { postJson, productionJson } from '../tools/production/production'
import { publishRemoteState as publish, type RemoteBackendState } from './remote-state'
export { remoteBackendState, type RemoteBackendState } from './remote-state'

const endpoint = '/next/remote'
export const remoteBackend = {
  state: async (signal?: AbortSignal) => publish(await productionJson<RemoteBackendState>(`${endpoint}/state`, { signal })),
  test: (url: string, key: string, signal?: AbortSignal) => productionJson<{ ok: boolean; url: string; detail: string; active: boolean }>(`${endpoint}/test`, postJson({ url, key }, signal)),
  connect: async (url: string, key: string, signal?: AbortSignal) => publish(await productionJson<RemoteBackendState>(`${endpoint}/connect`, postJson({ url, key }, signal))),
  local: async (signal?: AbortSignal) => publish(await productionJson<RemoteBackendState>(`${endpoint}/local`, postJson({}, signal))),
}
