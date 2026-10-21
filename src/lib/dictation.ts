export type DictationModel = { id: string; repo_id: string; label: string; tag: string; installed: boolean; languages: string | string[]; size_gb?: number }
export type DictationCatalog = { models: DictationModel[]; engine_available: boolean; engine_reason?: string; default_model_id: string }
export type DictationTranscript = { text: string; partial: string; utterances: string[]; refinedText: string; complete: boolean; stage: string; engine: string; language: string; error: string; warning: string }
export type DictationPhase = 'idle' | 'connecting' | 'loading' | 'microphone' | 'listening' | 'finishing' | 'complete' | 'error'
export const DICTATION_END = 'EOF'
export const DICTATION_MAX_BUFFER = 1024 * 1024
export const DICTATION_MAX_DURATION_MS = 10 * 60 * 1000

export function emptyDictation(): DictationTranscript { return { text: '', partial: '', utterances: [], refinedText: '', complete: false, stage: '', engine: '', language: '', error: '', warning: '' } }
export function dictationSocketUrl(desktop: boolean, origin: string, model: string, sampleRate = 16000, remote = false) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(model)) throw new Error('Wybierz prawidłowy model dyktowania.')
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new Error('Mikrofon zwrócił nieobsługiwaną częstotliwość próbkowania.')
  let base = 'ws://127.0.0.1:4312/ws/transcribe'
  if (!desktop) {
    const page = new URL(origin)
    if (!['http:', 'https:'].includes(page.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(page.hostname) || page.username || page.password) throw new Error('Dyktowanie jest dostępne wyłącznie przez lokalną aplikację lub localhost.')
    base = `${page.protocol === 'https:' ? 'wss:' : 'ws:'}//${page.host}/backend/ws/transcribe`
  }
  const query = new URLSearchParams({ pcm: '1', sr: String(sampleRate), model });
  if (remote) { base = base.replace(/\/ws\/transcribe$/, '/next/remote/ws'); query.set('path', '/ws/transcribe'); }
  return `${base}?${query}`
}

export function reduceDictationMessage(state: DictationTranscript, raw: unknown): DictationTranscript {
  if (!raw || typeof raw !== 'object' || typeof (raw as { type?: unknown }).type !== 'string') throw new Error('Silnik wysłał nieprawidłową wiadomość dyktowania.')
  const message = raw as Record<string, unknown>, next = { ...state, utterances: [...state.utterances] }
  const text = typeof message.text === 'string' ? message.text : ''
  if (message.type === 'partial') { if (!state.complete) next.partial = text; return next }
  if (message.type === 'status') { next.stage = typeof message.stage === 'string' ? message.stage : ''; return next }
  if (message.type === 'session.started') return next
  if (message.type === 'error') { next.error = [message.message || message.detail || 'Błąd dyktowania.', message.hint].filter(value => typeof value === 'string').join(' ').slice(0, 1000); return next }
  if (message.type !== 'final') return state
  if (typeof message.text !== 'string') throw new Error('Silnik nie zwrócił tekstu końcowego.')
  if (message.final_kind === 'utterance') {
    if (text.trim()) next.utterances.push(text.trim())
    next.text = next.utterances.join(' '); next.partial = ''
  } else {
    // The summary is authoritative. Appending it duplicates every utterance.
    next.text = text.trim(); next.partial = ''; next.complete = true
    next.refinedText = typeof message.refined_text === 'string' ? message.refined_text : ''
  }
  if (typeof message.engine === 'string') next.engine = message.engine
  if (typeof message.language === 'string') next.language = message.language
  if (typeof message.warning === 'string') next.warning = message.warning
  return next
}

export function floatToPcm16(samples: Float32Array) {
  const buffer = new ArrayBuffer(samples.length * 2), view = new DataView(buffer)
  samples.forEach((value, index) => { const sample = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0; view.setInt16(index * 2, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true) })
  return buffer
}

export function dictationMicrophoneError(cause: unknown) {
  if (cause instanceof Error && ['NotAllowedError', 'SecurityError'].includes(cause.name)) return 'Brak zgody na mikrofon. Zezwól na dostęp i rozpocznij nową sesję.'
  if (cause instanceof Error && cause.name === 'NotFoundError') return 'Nie znaleziono mikrofonu. Podłącz urządzenie i spróbuj ponownie.'
  if (cause instanceof Error && cause.name === 'NotReadableError') return 'Mikrofon jest niedostępny lub zajęty przez inną aplikację.'
  return cause instanceof Error ? cause.message : 'Nie udało się uruchomić dyktowania.'
}

/** One session, no automatic reconnect/replay. PCM is never queued without a bound. */
export class LiveDictation {
  transcript = emptyDictation()
  private socket?: WebSocket
  private context?: AudioContext
  private stream?: MediaStream
  private source?: MediaStreamAudioSourceNode
  private processor?: AudioWorkletNode
  private gain?: GainNode
  private phase: DictationPhase = 'idle'
  private epoch = 0
  private timer?: ReturnType<typeof setTimeout>
  private readyTimer?: ReturnType<typeof setTimeout>
  private flushed?: () => void
  private connectionReject?: (cause: Error) => void
  private bytes = 0
  private eof = false
  constructor(private callbacks: { transcript: (value: DictationTranscript) => void; phase: (value: DictationPhase) => void; activity?: (rms: number, bytes: number) => void }) {}
  private setPhase(phase: DictationPhase) { this.phase = phase; this.callbacks.phase(phase) }
  private publish() { this.callbacks.transcript({ ...this.transcript, utterances: [...this.transcript.utterances] }) }
  private cleanCapture() {
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined
    this.source?.disconnect(); this.source = undefined; this.processor?.disconnect(); this.processor?.port.close(); this.processor = undefined; this.gain?.disconnect(); this.gain = undefined
    const context = this.context; this.context = undefined; if (context && context.state !== 'closed') void context.close().catch(() => {})
    clearTimeout(this.timer); this.timer = undefined
  }
  private fail(message: string) { this.transcript = { ...this.transcript, error: message }; this.publish(); this.cancel('error') }
  cancel(phase: 'idle' | 'error' = 'idle') {
    this.epoch++; this.eof = true; clearTimeout(this.readyTimer); this.readyTimer = undefined
    this.connectionReject?.(new DOMException('Anulowano połączenie.', 'AbortError')); this.connectionReject = undefined
    this.flushed?.(); this.flushed = undefined; this.cleanCapture()
    const socket = this.socket; this.socket = undefined
    if (socket) { socket.onmessage = null; socket.onclose = null; socket.onerror = null; socket.onopen = null; if (socket.readyState < 2) socket.close(1000, 'session ended') }
    this.setPhase(phase)
  }
  async start(options: { model: string; desktop: boolean; origin: string; workletUrl: string; remote?: boolean }) {
    this.cancel(); const epoch = ++this.epoch; this.transcript = emptyDictation(); this.bytes = 0; this.eof = false; this.publish(); this.setPhase('connecting')
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined' || typeof AudioWorkletNode === 'undefined') throw new Error('Ten widok nie obsługuje mikrofonu i AudioWorklet. Otwórz aplikację desktopową lub aktualną przeglądarkę na localhost.')
      const context = new AudioContext({ sampleRate: 16000 }); this.context = context
      await context.resume(); await context.audioWorklet.addModule(options.workletUrl)
      if (epoch !== this.epoch) return
      const socket = new WebSocket(dictationSocketUrl(options.desktop, options.origin, options.model, context.sampleRate, options.remote)); this.socket = socket
      await new Promise<void>((resolve, reject) => {
        this.connectionReject = reject
        const rejectConnection = (message: string) => { clearTimeout(this.readyTimer); reject(new Error(message)) }
        this.readyTimer = setTimeout(() => rejectConnection('Nie udało się połączyć z lokalnym kanałem dyktowania. Sprawdź silnik i spróbuj ponownie.'), 15000)
        // Legacy fallback engines do not send a ready frame. Send PCM after
        // the accepted handshake; TCP backpressure remains strictly bounded.
        socket.onopen = () => { if (epoch !== this.epoch) return; clearTimeout(this.readyTimer); this.connectionReject = undefined; this.setPhase('loading'); resolve() }
        socket.onmessage = event => {
          if (epoch !== this.epoch) return
          try {
            this.transcript = reduceDictationMessage(this.transcript, JSON.parse(String(event.data))); this.publish()
            if (this.transcript.error) { rejectConnection(this.transcript.error); this.cancel('error'); return }
            if (this.transcript.complete) { clearTimeout(this.readyTimer); this.cleanCapture(); this.setPhase('complete') }
          } catch (cause) { const message = cause instanceof Error ? cause.message : 'Nieprawidłowa wiadomość silnika.'; rejectConnection(message); this.fail(message) }
        }
        socket.onerror = () => { const message = 'Utracono połączenie z lokalnym kanałem dyktowania. Zachowano odebrany tekst. Nowa sesja nie odtworzy pominiętego audio.'; rejectConnection(message); this.fail(message) }
        socket.onclose = event => {
          if (epoch !== this.epoch) return
          clearTimeout(this.readyTimer)
          if (this.transcript.complete) { this.cleanCapture(); this.socket = undefined; this.setPhase('complete') }
          else { const message = event.code === 1008 ? 'Silnik odrzucił połączenie. Sprawdź lokalny adres i dozwolony Origin aplikacji.' : 'Połączenie zamknięto bez końcowego podsumowania. Odebrany tekst może być niepełny; rozpocznij nową sesję.'; rejectConnection(message); this.fail(message) }
        }
      })
      if (epoch !== this.epoch) return
      this.setPhase('microphone')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      if (epoch !== this.epoch) { stream.getTracks().forEach(track => track.stop()); return }
      this.stream = stream
      const processor = new AudioWorkletNode(context, 'seventy-seven-dictation-pcm', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] }); this.processor = processor
      processor.port.onmessage = event => {
        if (epoch !== this.epoch) return
        if (event.data?.type === 'flushed') { this.flushed?.(); this.flushed = undefined; return }
        if (event.data?.type !== 'pcm' || !(event.data.buffer instanceof ArrayBuffer) || this.eof) return
        if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > DICTATION_MAX_BUFFER) { this.fail('Połączenie nie nadąża za mikrofonem. Zatrzymano sesję bez ukrytego pomijania audio. Odebrany tekst może być niepełny.'); return }
        socket.send(event.data.buffer); this.bytes += event.data.buffer.byteLength; this.callbacks.activity?.(Number(event.data.rms) || 0, this.bytes)
      }
      processor.onprocessorerror = () => this.fail('Przerwano przetwarzanie mikrofonu. Zachowano odebrany tekst; rozpocznij nową sesję.')
      this.source = context.createMediaStreamSource(stream); this.gain = context.createGain(); this.gain.gain.value = 0
      this.setPhase('listening'); this.source.connect(processor); processor.connect(this.gain); this.gain.connect(context.destination)
      this.timer = setTimeout(() => { this.transcript.warning = 'Osiągnięto limit 10 minut. Zatrzymano mikrofon i kończymy rozpoznawanie.'; this.publish(); void this.stop() }, DICTATION_MAX_DURATION_MS)
    } catch (cause) { if (epoch === this.epoch) this.fail(dictationMicrophoneError(cause)) }
  }
  async stop() {
    if (this.phase !== 'listening' || !this.socket || this.eof) return
    const epoch = this.epoch; this.setPhase('finishing')
    if (this.processor) {
      let timeout: ReturnType<typeof setTimeout> | undefined
      const flushed = await new Promise<boolean>(resolve => { this.flushed = () => { clearTimeout(timeout); resolve(true) }; timeout = setTimeout(() => { this.flushed = undefined; resolve(false) }, 1000); this.processor?.port.postMessage({ type: 'flush' }) })
      if (epoch !== this.epoch) return
      if (!flushed) { this.fail('Nie udało się opróżnić bufora mikrofonu. Sesja może być niepełna; zachowano odebrany tekst.'); return }
    }
    this.eof = true; this.cleanCapture()
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(DICTATION_END)
      this.readyTimer = setTimeout(() => this.fail('Silnik nie odesłał podsumowania w ciągu 90 sekund. Odebrany tekst może być niepełny.'), 90000)
    } else this.fail('Utracono połączenie przed końcem nagrania. Odebrany tekst może być niepełny.')
  }
}
