import { translateUi } from '../../i18n';
/** Text-only history, isolated from studio drafts, voices and audio recordings. */
export const TRANSCRIPTION_HISTORY_KEY = 'seventy-seven-labs.transcriptions.v1'
export const TRANSCRIPTION_HISTORY_LIMIT = 20
export const TRANSCRIPTION_HISTORY_BYTES = 1024 * 1024
export const TRANSCRIPTION_FILE_BYTES = 64 * 1024 * 1024
export const MICROPHONE_LIMIT_MS = 10 * 60 * 1000

export type TranscriptionSegment = { start: number; end: number; text: string }
export type TranscriptionRefinement = {
  originalText: string; refinedText: string; applied: boolean
  status: 'suggested' | 'not_returned' | 'unavailable'
}
export type TranscriptionResult = {
  id: string; name: string; text: string; segments: TranscriptionSegment[]
  language: string; mode: string; created: string; updated: string
  refinement?: TranscriptionRefinement
}
export type HistoryStorage = Pick<Storage, 'getItem' | 'setItem'>

export function transcriptText(segments: TranscriptionSegment[], fallback = '') {
  return segments.length ? segments.map(segment => segment.text.trim()).filter(Boolean).join('\n') : fallback
}

/** LLM prose has no alignment: it can replace TXT/editor output, never timed cues. */
export function transcriptionOutputText(text: string, segments: TranscriptionSegment[], refinement?: TranscriptionRefinement) {
  return refinement?.applied && refinement.status === 'suggested' && refinement.refinedText.trim() ? refinement.refinedText : transcriptText(segments, text)
}

export function refinementNotice(refinement?: TranscriptionRefinement) {
  if (refinement?.status === 'unavailable') return translateUi("Redakcja LLM jest niedostępna. Zachowano oryginalne rozpoznanie; możesz poprawić tekst ręcznie.")
  // Stock capture.py intentionally conflates unchanged text, disabled refinement,
  // missing configuration and provider errors. Do not claim which one occurred.
  if (refinement?.status === 'not_returned') return translateUi("Silnik nie zwrócił osobnego tekstu po redakcji. Może to oznaczać brak zmian albo niedostępną redakcję LLM. Zachowano oryginał.")
  return ''
}

export function segmentError(segments: TranscriptionSegment[]) {
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end <= segment.start) return translateUi("Segment {arg0}: koniec musi być późniejszy od początku, a czasy nie mogą być ujemne.", { arg0: String(index + 1) })
    const startMs = Math.round(segment.start * 1000), endMs = Math.round(segment.end * 1000)
    if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || endMs <= startMs) return translateUi("Segment {arg0}: podaj poprawne czasy z dokładnością do milisekundy i co najmniej 1 ms długości.", { arg0: String(index + 1) })
    if (!segment.text.trim()) return translateUi("Segment {arg0}: wpisz tekst albo usuń pusty segment.", { arg0: String(index + 1) })
    if (index > 0 && segment.start < segments[index - 1].start) return translateUi("Segment {arg0}: początek nie może być wcześniejszy niż początek poprzedniego segmentu.", { arg0: String(index + 1) })
  }
  return ''
}

export function normalizeTranscription(value: unknown, refinementRequested = false): { text: string; segments: TranscriptionSegment[]; language: string; warning: string; refinement?: TranscriptionRefinement } {
  if (!value || typeof value !== 'object' || typeof (value as Record<string, unknown>).text !== 'string') throw new Error(translateUi("Silnik zwrócił nieprawidłową transkrypcję."))
  const raw = value as Record<string, unknown>
  const rows = Array.isArray(raw.segments) ? raw.segments : []
  const segments = rows.filter((row): row is TranscriptionSegment => Boolean(row && typeof row === 'object' && typeof row.text === 'string' && Number.isFinite(row.start) && Number.isFinite(row.end) && row.start >= 0 && row.end > row.start && row.text.trim())).map(row => ({ start: row.start, end: row.end, text: row.text }))
  const invalidOrder = segmentError(segments)
  // Keep readable raw text when an engine returns unusable timing. Never invent times.
  const valid = invalidOrder || segments.length !== rows.length ? [] : segments
  const refinedText = typeof raw.refined_text === 'string' && raw.refined_text.trim() && raw.refined_text !== raw.text ? raw.refined_text : ''
  const unavailable = raw.refinement_unavailable === true || typeof raw.refinement_unavailable === 'string' && !!raw.refinement_unavailable.trim()
  const refinement: TranscriptionRefinement | undefined = refinedText || refinementRequested || unavailable
    ? { originalText: raw.text as string, refinedText, applied: false, status: unavailable ? 'unavailable' : refinedText ? 'suggested' : 'not_returned' } : undefined
  return { text: transcriptText(valid, raw.text as string), segments: valid, language: typeof raw.language === 'string' ? raw.language : 'auto', warning: valid.length !== rows.length ? translateUi("Otrzymane czasy segmentów były nieprawidłowe. Zachowano pełny tekst; eksport napisów wymaga ponownego rozpoznania w trybie dokładnym.") : '', ...(refinement ? { refinement } : {}) }
}

export function exportTranscription(text: string, segments: TranscriptionSegment[], format: 'txt' | 'srt' | 'vtt', refinement?: TranscriptionRefinement) {
  if (format === 'txt') return transcriptionOutputText(text, segments, refinement)
  if (!segments.length) throw new Error(translateUi("Brak segmentów z czasami. Wybierz tryb dokładny i rozpoznaj nagranie ponownie."))
  const invalid = segmentError(segments)
  if (invalid) throw new Error(invalid)
  const time = (value: number) => {
    const ms = Math.round(value * 1000)
    return `${String(Math.floor(ms / 3_600_000)).padStart(2, '0')}:${String(Math.floor(ms / 60_000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${format === 'srt' ? ',' : '.'}${String(ms % 1000).padStart(3, '0')}`
  }
  return (format === 'vtt' ? 'WEBVTT\n\n' : '') + segments.map((segment, index) => `${format === 'srt' ? `${index + 1}\n` : ''}${time(segment.start)} --> ${time(segment.end)}\n${segment.text.trim()}\n`).join('\n')
}

export function audioFileError(file: Pick<File, 'name' | 'type' | 'size'>) {
  if (!file.size) return translateUi("Wybrany plik jest pusty.")
  if (file.size > TRANSCRIPTION_FILE_BYTES) return translateUi("Wybierz nagranie nie większe niż 64 MB.")
  if (!file.type.startsWith('audio/') && !/\.(wav|mp3|m4a|ogg|flac|aac|opus|webm)$/i.test(file.name)) return translateUi("Wybierz plik audio: WAV, MP3, M4A, OGG lub FLAC.")
  return ''
}

function validResult(value: unknown): value is TranscriptionResult {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return ['id', 'name', 'text', 'language', 'mode', 'created', 'updated'].every(key => typeof row[key] === 'string') && Number.isFinite(Date.parse(row.created as string)) && Number.isFinite(Date.parse(row.updated as string)) && Array.isArray(row.segments) && row.segments.length <= 20_000 && row.segments.every(segment => segment && typeof segment === 'object' && typeof segment.text === 'string' && Number.isFinite(segment.start) && Number.isFinite(segment.end)) && !segmentError(row.segments as TranscriptionSegment[]) && validRefinement(row.refinement)
}

function validRefinement(value: unknown) {
  if (value === undefined) return true // Existing version-1 histories stay readable.
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return typeof row.originalText === 'string' && typeof row.refinedText === 'string' && typeof row.applied === 'boolean' && ['suggested', 'not_returned', 'unavailable'].includes(String(row.status)) && (!row.applied || row.status === 'suggested' && !!row.refinedText.trim()) && (row.status !== 'suggested' || !!row.refinedText.trim())
}

export function readTranscriptionHistory(storage: HistoryStorage): { results: TranscriptionResult[]; warning: string } {
  const source = storage.getItem(TRANSCRIPTION_HISTORY_KEY)
  if (!source) return { results: [], warning: '' }
  if (new TextEncoder().encode(source).length > TRANSCRIPTION_HISTORY_BYTES) throw new Error(translateUi("Historia transkrypcji przekracza limit 1 MB. Zapis wstrzymany, aby zachować istniejące dane."))
  let data: unknown
  try { data = JSON.parse(source) } catch { throw new Error(translateUi("Nie można odczytać zapisanej historii transkrypcji. Istniejący zapis pozostał bez zmian.")) }
  if (!data || typeof data !== 'object' || (data as { version?: unknown }).version !== 1 || !Array.isArray((data as { results?: unknown }).results)) throw new Error(translateUi("Nieobsługiwany format historii transkrypcji. Istniejący zapis pozostał bez zmian."))
  const rows = (data as { results: unknown[] }).results
  const valid = rows.filter(validResult)
  // Do not silently overwrite a corrupt record while saving a different result.
  if (valid.length !== rows.length || valid.some(row => !row.id) || new Set(valid.map(row => row.id)).size !== valid.length) throw new Error(translateUi("Historia zawiera nieprawidłowy wynik. Zapis wstrzymany; istniejące dane pozostały bez zmian."))
  return { results: valid.slice(0, TRANSCRIPTION_HISTORY_LIMIT).map(row => ({ ...row, text: transcriptText(row.segments, row.text), segments: row.segments.map(segment => ({ ...segment })), ...(row.refinement ? { refinement: { ...row.refinement } } : {}) })), warning: rows.length > TRANSCRIPTION_HISTORY_LIMIT ? translateUi("Wyświetlono 20 najnowszych zapisów.") : '' }
}

export function saveTranscriptionHistory(storage: HistoryStorage, results: TranscriptionResult[]) {
  if (!results.every(validResult)) throw new Error(translateUi("Popraw tekst i czasy segmentów przed zapisaniem historii."))
  const stored = results.slice(0, TRANSCRIPTION_HISTORY_LIMIT).map(row => ({ ...row, text: transcriptText(row.segments, row.text), segments: row.segments.map(segment => ({ ...segment })), ...(row.refinement ? { refinement: { ...row.refinement } } : {}) }))
  let content = JSON.stringify({ version: 1, results: stored })
  while (new TextEncoder().encode(content).length > TRANSCRIPTION_HISTORY_BYTES && stored.length > 1) {
    stored.pop(); content = JSON.stringify({ version: 1, results: stored })
  }
  if (new TextEncoder().encode(content).length > TRANSCRIPTION_HISTORY_BYTES) throw new Error(translateUi("Ten wynik przekracza limit historii 1 MB. Pobierz TXT lub napisy, aby go zachować."))
  storage.setItem(TRANSCRIPTION_HISTORY_KEY, content)
  return { results: stored, removed: results.length - stored.length }
}

export function microphoneError(cause: unknown) {
  const name = cause instanceof Error || cause instanceof DOMException ? cause.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return translateUi("Brak zgody na mikrofon. Zezwól na nagrywanie w ustawieniach aplikacji lub przeglądarki i spróbuj ponownie.")
  if (name === 'NotFoundError') return translateUi("Nie znaleziono mikrofonu. Podłącz urządzenie i spróbuj ponownie.")
  if (name === 'NotReadableError') return translateUi("Nie można otworzyć mikrofonu. Sprawdź, czy inne urządzenie lub aplikacja go nie blokuje.")
  return cause instanceof Error ? cause.message : translateUi("Nagrywanie nie powiodło się. Możesz wczytać gotowy plik audio.")
}
