import { request, prepareRequest } from '../platform/api';

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
/** Deletion-only cleanup of PDF/EPUB text (page numbers, headers, hyphenation). The server rejects anything else. */
export const cleanBookText = (text: string, signal?: AbortSignal) => call<{ text: string; removed_chars: number; seconds: number }>('/clean-text', {
  method: 'POST', body: JSON.stringify({ text }), signal,
});
/** Split at paragraph boundaries so each AI call stays under the server limit. */
export function bookTextChunks(text: string, max = 10_000): string[] {
  const out: string[] = []; let current = '';
  for (const part of text.split(/(?<=\n\s*\n)/)) {
    if (current && current.length + part.length > max) { out.push(current); current = ''; }
    // ponytail: a single paragraph over the limit is cut at line breaks, then hard-cut; fine for PDF extracts.
    if (part.length > max) { for (const line of part.split(/(?<=\n)/)) { if (current.length + line.length > max && current) { out.push(current); current = ''; } for (let i = 0; i < line.length; i += max) { const piece = line.slice(i, i + max); if (current.length + piece.length > max && current) { out.push(current); current = ''; } current += piece; } } continue; }
    current += part;
  }
  if (current.trim()) out.push(current);
  return out;
}
export const enhanceDialogue =(texts: string[], signal?: AbortSignal) => call<EnhanceResult>('/enhance-dialogue', {
  method: 'POST', body: JSON.stringify({ dialogue_blocks: texts }), signal,
});
