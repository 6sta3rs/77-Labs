import { writable } from 'svelte/store';
import { setRemoteRouting } from './remote-routing';

export type RemoteBackendState = { active: boolean; url: string; authenticated: boolean; session_available: boolean; session_expires_at: number | null; detail: string; error: string };
export const remoteBackendState = writable<RemoteBackendState>({ active: false, url: '', authenticated: false, session_available: false, session_expires_at: null, detail: '', error: '' });
export function publishRemoteState(state: RemoteBackendState) { setRemoteRouting(state.active); remoteBackendState.set(state); return state; }
