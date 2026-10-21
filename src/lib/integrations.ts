export const LOCAL_API_BASE = 'http://127.0.0.1:4312/v1'
export const LOCAL_MCP_URL = 'http://127.0.0.1:4312/mcp'
export const MCP_PROTOCOL_VERSION = '2025-11-25'
export type IntegrationConfig = { mcp_enabled: boolean; mcp_output_mode: 'files' | 'resources' | 'both' }
export type IntegrationState = {
  settings: IntegrationConfig
  effective: IntegrationConfig & { mounted: boolean; session_task_active: boolean }
  restart_required: boolean; configuration_error: string; base_url: string; scope: string; local_api_key_required: boolean; network_sharing_enabled?: boolean | null
  source: { version?: string | null; sourceVersion?: string | null; installedDistributionVersion?: string | null; generateCapabilities?: { wav_bits: string[]; preset_voice: boolean; design_recipe: boolean }; commit?: string | null; archive_sha256?: string | null; upstream: string; notices: string[] }
}
export type SpeechCapabilities = { service?: string; service_version?: string; protocol?: string; protocol_version?: string; features?: Record<string, boolean>; endpoints?: Record<string, { path: string; transport: string; method?: string }> }
export type ApiModel = { id: string; object?: string; voicestudio?: { kind?: string; alias_for_active_engine?: boolean } }
export type McpBinding = { client_id: string; label: string; profile_id?: string | null; default_engine?: string | null; last_seen_at?: number | null }
export type WatermarkSettings = { invisible_enabled: boolean; visible_audio_enabled: boolean; visible_video_enabled: boolean; audioseal_available: boolean }
export type WatermarkResult = { is_watermarked: boolean; confidence: number; message_bits: string; is_omnivoice: boolean; source?: string }
export type LoopbackTransport = (path: string, options?: RequestInit) => Promise<Response>

export function integrationError(cause: unknown) {
  if (cause instanceof Error && cause.name === 'TimeoutError') return 'Serwer nie odpowiedział w wymaganym czasie. Odśwież stan i spróbuj ponownie.'
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [ukryto]').replace(/\bhf_[A-Za-z0-9_-]{8,}/g, '[ukryty token HF]').replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[ukryty klucz]').replace(/\b(api[_-]?key|token|authorization)\s*[=:]\s*[^\s,;"']+/gi, '$1=[ukryto]').slice(0, 700)
}

export function watermarkFileError(file: Pick<File, 'name' | 'size'>) {
  if (!file.size) return 'Wybierz niepusty plik audio.'
  if (file.size > 64 * 1024 * 1024) return 'Nagranie do detekcji nie może przekraczać 64 MB.'
  if (!/\.(wav|mp3|flac|ogg|m4a|aac|opus)$/i.test(file.name)) return 'Wybierz WAV, MP3, FLAC, OGG, M4A, AAC lub OPUS.'
  return ''
}

export function parseWatermarkResult(raw: unknown): WatermarkResult {
  if (!raw || typeof raw !== 'object') throw new Error('Detektor nie zwrócił prawidłowego wyniku.')
  const data = raw as Record<string, unknown>
  // Upstream can return HTTP 200 with error. It is never a negative detection.
  if (data.error) throw new Error(`Nie udało się sprawdzić znaku wodnego. ${integrationError(data.error)}`)
  if (typeof data.is_watermarked !== 'boolean' || typeof data.is_omnivoice !== 'boolean' || typeof data.confidence !== 'number' || !Number.isFinite(data.confidence) || data.confidence < 0 || data.confidence > 1 || typeof data.message_bits !== 'string') throw new Error('Detektor zwrócił nieprawidłowy wynik. Sprawdź konfigurację i ponów próbę.')
  return { is_watermarked: data.is_watermarked, confidence: data.confidence, is_omnivoice: data.is_omnivoice, message_bits: /^[01]{0,64}$/.test(data.message_bits) ? data.message_bits : '', ...(typeof data.source === 'string' ? { source: data.source.slice(0, 80) } : {}) }
}

export function watermarkTitle(result: WatermarkResult) {
  if (!result.is_watermarked) return 'Nie wykryto znaku wodnego AudioSeal'
  return result.is_omnivoice ? 'Wykryto znak i zgodną sygnaturę VoiceStudio' : 'Wykryto znak AudioSeal; źródło niepotwierdzone'
}

export function watermarkSettingsPath(settings: WatermarkSettings) {
  return '/watermark/settings?' + new URLSearchParams({ invisible: String(settings.invisible_enabled), visible_audio: String(settings.visible_audio_enabled), visible_video: String(settings.visible_video_enabled) })
}

export function bindingPayload(clientId: string, label: string, profileId: string, engineId: string) {
  const id = clientId.trim()
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id)) throw new Error('Id klienta: wpisz 1–128 liter, cyfr, kropek, podkreśleń, dwukropków lub myślników.')
  return { client_id: id, label: label.trim().slice(0, 160), profile_id: profileId, default_engine: engineId }
}

export function mcpClientConfig(clientId = '') {
  return JSON.stringify({ mcpServers: { 'seventy-seven-labs': { url: LOCAL_MCP_URL, ...(clientId.trim() ? { headers: { 'X-OmniVoice-Client-Id': bindingPayload(clientId, '', '', '').client_id } } : {}) } } }, null, 2)
}

/** Parse complete JSON or SSE data frames without exposing session headers. */
export function mcpMessages(text: string, complete = false): Array<Record<string, unknown>> {
  const trimmed = text.trim()
  if (!trimmed) return []
  const values: unknown[] = []
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { const parsed = JSON.parse(trimmed); values.push(...(Array.isArray(parsed) ? parsed : [parsed])) }
    catch { if (complete) throw new Error('Nieprawidłowa odpowiedź JSON serwera MCP.') }
  } else {
    const frames = text.replace(/\r\n/g, '\n').split('\n\n')
    if (!complete) frames.pop()
    for (const frame of frames) {
      const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
      if (!data) continue
      try { values.push(JSON.parse(data)) } catch { if (complete) throw new Error('Nieprawidłowa ramka odpowiedzi MCP.') }
    }
  }
  return values.filter((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value))
}

async function rpcResult(response: Response, id: number, signal: AbortSignal) {
  if (!response.ok) throw new Error(`Serwer MCP odrzucił żądanie (${response.status}). Sprawdź włączenie integracji i zrestartuj prywatny silnik.`)
  if (!response.body) throw new Error('Serwer MCP nie zwrócił odpowiedzi.')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  let buffer = '', bytes = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      signal.throwIfAborted()
      bytes += value?.byteLength || 0
      if (bytes > 1024 * 1024) throw new Error('Odpowiedź testu MCP przekracza limit 1 MB.')
      buffer += decoder.decode(value, { stream: !done })
      const message = mcpMessages(buffer, done).find(message => String(message.id) === String(id))
      if (message) {
        if (message.error) throw new Error(`Błąd MCP: ${integrationError((message.error as { message?: unknown }).message || 'nieznany błąd protokołu')}`)
        if (!message.result || typeof message.result !== 'object') throw new Error('MCP nie zwrócił wyniku żądania.')
        return message.result as Record<string, unknown>
      }
      if (done) throw new Error('MCP zakończył odpowiedź bez wyniku żądania.')
    }
  } finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock() }
}

/** Read-only initialize + tools/list. Never invokes a synthesis tool. */
export async function testMcpConnection(transport: LoopbackTransport, parentSignal?: AbortSignal) {
  const signal = parentSignal ? AbortSignal.any([parentSignal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
  let session = ''
  try {
    const initialized = await transport('/mcp', { method: 'POST', headers, signal, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'seventy-seven-labs-connection-test', version: '0.2.0' } } }) })
    session = initialized.headers.get('Mcp-Session-Id') || ''
    if (session) headers['Mcp-Session-Id'] = session
    const result = await rpcResult(initialized, 1, signal)
    const protocol = typeof result.protocolVersion === 'string' ? result.protocolVersion : MCP_PROTOCOL_VERSION
    headers['MCP-Protocol-Version'] = protocol
    const notification = await transport('/mcp', { method: 'POST', headers, signal, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
    if (!notification.ok) throw new Error(`MCP nie zaakceptował inicjalizacji klienta (${notification.status}).`)
    await notification.body?.cancel().catch(() => {})
    const list = await rpcResult(await transport('/mcp', { method: 'POST', headers, signal, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) }), 2, signal)
    if (!Array.isArray(list.tools)) throw new Error('MCP nie zwrócił listy narzędzi.')
    const tools = list.tools.flatMap(tool => tool && typeof tool === 'object' && typeof tool.name === 'string' ? [tool.name as string] : [])
    const server = result.serverInfo && typeof result.serverInfo === 'object' ? result.serverInfo as Record<string, unknown> : {}
    return { protocol, server: typeof server.name === 'string' ? server.name : 'MCP', version: typeof server.version === 'string' ? server.version : '', tools, checkedAt: new Date().toISOString() }
  } finally {
    // Session ids remain local to this call and never enter UI or reports.
    if (session) await transport('/mcp', { method: 'DELETE', headers, signal: AbortSignal.timeout(3000) }).then(response => response.body?.cancel()).catch(() => {})
  }
}
