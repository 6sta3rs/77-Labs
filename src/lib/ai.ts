import { request, prepareRequest } from './api';

export type AISettings = { enabled: boolean; model: string; intensity: 'subtle' | 'natural' | 'expressive'; reactions: boolean };
export type AIStatus = { installed: boolean; connected: boolean; authMode?: string; plan?: string; message: string; models: { id: string; name: string; isDefault: boolean }[]; defaultModel: string };
export type EnhanceResult = { enhanced_blocks: string[]; model: string; provider: string; seconds: number };

async function call<T>(path: string, options: RequestInit = {}): Promise<T> {
  await prepareRequest(`/ai${path}`, options.signal ?? undefined);
  const timeout = AbortSignal.timeout(path === '/settings' || path === '/status' ? 20_000 : 155_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  signal.throwIfAborted();
  const response = await request(`/ai${path}`, {
    ...options, headers: { 'Content-Type': 'application/json', 'X-VoiceStudio-AI': '1', ...options.headers },
    signal,
  });
  signal.throwIfAborted();
  let body: unknown;
  try { body = await response.json(); } catch { signal.throwIfAborted(); throw new Error('Usługa AI jest niedostępna. Uruchom aktualny silnik Seventy Seven Labs.'); }
  signal.throwIfAborted();
  if (!response.ok) {
    const detail = (body as { detail?: unknown })?.detail;
    throw new Error(typeof detail === 'string' ? detail : response.status === 404 ? 'Uruchom ponownie zaktualizowany silnik, aby włączyć ustawienia AI.' : `Błąd usługi AI (${response.status}).`);
  }
  return body as T;
}

export const getAISettings = (signal?: AbortSignal) => call<AISettings>('/settings', { signal });
export const saveAISettings = (settings: AISettings, signal?: AbortSignal) => call<AISettings>('/settings', { method: 'PUT', body: JSON.stringify(settings), signal });
export const getAIStatus = (signal?: AbortSignal) => call<AIStatus>('/status', { signal });
export const testAI = (signal?: AbortSignal) => call<EnhanceResult & { input: string[] }>('/test', { method: 'POST', signal });
export const enhanceDialogue = (texts: string[], signal?: AbortSignal) => call<EnhanceResult>('/enhance-dialogue', {
  method: 'POST', body: JSON.stringify({ dialogue_blocks: texts }), signal,
});
