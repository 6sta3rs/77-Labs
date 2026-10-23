import { translateUi } from '../../i18n';
import { request, prepareRequest } from '../../platform/api'
import { assertModelLicenseResponse } from '../../models/model-licenses'

export type ProductionEvent = { type: string; [key: string]: unknown }
export type DubSegment = { id?: string | number; start: number; end: number; text: string; text_original?: string; profile_id?: string; direction?: string; speed?: number; gain?: number }
export type BookPlan = { chapters: Array<{ title: string; char_count: number; spans: Array<{ text: string; voice_id?: string }> }>; chapter_count: number; char_count: number }
export type FinishedBook = { job_id: string; title?: string; output: string; chapters: number; duration_s: number; type: string }
export type FinishedDub = { id: string; filename: string; tracks: string; language_code?: string; duration: number }
export type ResumableBook = { job_id: string; type: string; title: string; status: string; total_chapters: number; chapters_done: number }
export type BookRenderSettings = { bookFormat: string; bitrate: string; loudness: string; author: string; narrator: string; lineGap: number; paragraphGap: number; trimEdges: boolean; customSteps: boolean; steps: number; guidance: number }
export type ProductionProject = { id: string; name: string; state?: { kind?: string; text?: string; voice?: string; language?: string; plan?: BookPlan; render?: BookRenderSettings } }
/** `timeoutMs` overrides the 15 s limit of status reads (slow engine probes such as the GPU report). */
export async function productionJson<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs, ...options } = init ?? {}
  await prepareRequest(path, options?.signal ?? undefined, options?.method || 'GET')
  // Library/status reads must release the UI when the engine stops responding.
  // Rendering and other mutations retain their explicit cancellation lifetime.
  const timeout = !options?.method || options.method.toUpperCase() === 'GET' ? AbortSignal.timeout(timeoutMs ?? 15_000) : undefined
  const signal = timeout ? options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout : options?.signal
  signal?.throwIfAborted()
  const response = await request(path, { ...options, signal })
  signal?.throwIfAborted()
  if (!response.ok) {
    await assertModelLicenseResponse(response, signal ?? undefined)
    const raw = await response.text()
    signal?.throwIfAborted()
    let message = raw
    try { const body = JSON.parse(raw); message = typeof body.detail === 'string' ? body.detail : body.detail?.message || body.error || raw } catch { /* Plain message. */ }
    throw new Error(message.slice(0, 350) || translateUi("Błąd {arg0}", { arg0: String(response.status) }))
  }
  const body = await response.json()
  signal?.throwIfAborted()
  return body as T
}
export const postJson = (body: unknown, signal?: AbortSignal): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })

/** Consume POST/GET SSE using the same desktop transport as the rest of Studio. */
export async function productionStream(path: string, options: RequestInit, onEvent: (event: ProductionEvent) => void) {
  options.signal?.throwIfAborted()
  const response = await request(path, options)
  options.signal?.throwIfAborted()
  if (!response.ok) {
    await assertModelLicenseResponse(response, options.signal ?? undefined)
    const raw = await response.text()
    options.signal?.throwIfAborted()
    try { const body = JSON.parse(raw); throw new Error(typeof body.detail === 'string' ? body.detail : body.detail?.message || raw.slice(0, 350)) } catch (error) { if (error instanceof SyntaxError) throw new Error(raw.slice(0, 350)); throw error }
  }
  if (!response.body) throw new Error(translateUi("Silnik nie udostępnił strumienia postępu."))
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false, cancelled = false
  const cancel = () => {
    if (cancelled || finished) return
    cancelled = true
    void reader.cancel(options.signal?.reason).catch(() => { /* Transport may already be closed. */ })
  }
  options.signal?.addEventListener('abort', cancel, { once: true })
  const emit = (frame: string) => {
    options.signal?.throwIfAborted()
    const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
    if (data) onEvent(JSON.parse(data) as ProductionEvent)
  }
  try {
    while (true) {
      options.signal?.throwIfAborted()
      const { done, value } = await reader.read()
      options.signal?.throwIfAborted()
      buffer += decoder.decode(value, { stream: !done })
      buffer = buffer.replace(/\r\n/g, '\n')
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) >= 0) { emit(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2) }
      if (done) { if (buffer.trim()) emit(buffer); finished = true; break }
    }
  } finally {
    options.signal?.removeEventListener('abort', cancel)
    cancel()
    reader.releaseLock()
  }
}

export async function downloadProduction(path: string, filename: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const response = await request(path, { signal })
  if (!response.ok) throw new Error(translateUi("Nie można pobrać pliku ({arg0}).", { arg0: String(response.status) }))
  const blob = await response.blob()
  signal?.throwIfAborted()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export const productionLanguages = [
  { value: 'pl', label: 'Polski', tts: 'Polish' }, { value: 'en', label: 'Angielski', tts: 'English' },
  { value: 'de', label: 'Niemiecki', tts: 'German' }, { value: 'fr', label: 'Francuski', tts: 'French' },
  { value: 'es', label: 'Hiszpański', tts: 'Spanish' }, { value: 'it', label: 'Włoski', tts: 'Italian' },
]
