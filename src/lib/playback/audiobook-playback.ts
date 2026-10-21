import { translateUi } from '../i18n';
/** One logical recording backed by completed WAV portions, with bounded blobs. */
export type BookAudioChunk = { sequence: number; output: string; duration_s: number; title: string; chapter_index: number; text?: string }
export type BookPlaybackState = { count: number; current: number; duration: number; time: number; playing: boolean; waiting: boolean; loading: boolean; finished: boolean; error: string }
export const emptyBookPlayback = (): BookPlaybackState => ({ count: 0, current: 0, duration: 0, time: 0, playing: false, waiting: false, loading: false, finished: false, error: '' })

export class AudiobookPlayback {
  private chunks: BookAudioChunk[] = []
  private index = 0
  private offset = 0
  private wantsPlayback = false
  private atBoundary = false
  private finished = false
  private error = ''
  private generation = 0
  private operation = 0
  private abort = new AbortController()
  private urls = new Map<number, string>()
  private pending = new Map<number, Promise<string>>()
  private active = false

  constructor(private audio: HTMLAudioElement, private load: (path: string, signal: AbortSignal) => Promise<Blob>, private changed: (state: BookPlaybackState) => void) {
    audio.addEventListener('ended', this.ended)
    audio.addEventListener('timeupdate', this.publish)
    audio.addEventListener('playing', this.publish)
    audio.addEventListener('pause', this.publish)
    audio.addEventListener('error', this.failed)
  }

  private publish = () => {
    this.changed({ count: this.chunks.length, current: this.chunks.length ? this.index + 1 : 0,
      duration: this.chunks.reduce((sum, item) => sum + item.duration_s, 0),
      time: this.offset + (this.atBoundary ? this.chunks[this.index]?.duration_s || 0 : this.active ? this.audio.currentTime || 0 : 0),
      playing: this.wantsPlayback, waiting: this.wantsPlayback && this.atBoundary,
      loading: this.wantsPlayback && !this.atBoundary && (!this.active || this.audio.paused), finished: this.finished, error: this.error })
  }

  append(chunk: BookAudioChunk) {
    if (!Number.isInteger(chunk.sequence) || chunk.sequence < 0 || !Number.isFinite(chunk.duration_s) || chunk.duration_s <= 0 || !chunk.output || chunk.output.includes('..') || chunk.output.startsWith('/') || chunk.output.includes('\\')) return
    if (chunk.sequence < this.chunks.length) return // SSE duplicate
    if (chunk.sequence !== this.chunks.length) { this.error = translateUi("Brakuje fragmentu nagrania. Zatrzymaj odsłuch i pobierz pełny audiobook po zakończeniu."); this.pause(); return }
    this.chunks.push(chunk)
    if (this.atBoundary && this.wantsPlayback) void this.advance()
    else if (this.chunks.length === 1 && this.wantsPlayback) void this.select(0, 0)
    else this.prefetch()
    this.publish()
  }

  finish() { this.finished = true; if (this.atBoundary && this.index + 1 >= this.chunks.length) this.wantsPlayback = false; this.publish() }

  async play() {
    if (this.error) this.error = ''
    this.wantsPlayback = true
    if (this.atBoundary) {
      if (this.index + 1 < this.chunks.length) await this.advance()
      else if (this.finished) await this.select(0, 0)
    } else if (this.active) await this.start(this.operation)
    else if (this.chunks.length) await this.select(this.index, 0)
    this.publish()
  }

  pause() { ++this.operation; this.wantsPlayback = false; this.audio.pause(); this.publish() }

  seek(seconds: number) {
    if (!this.chunks.length || !Number.isFinite(seconds)) return
    let time = Math.max(0, seconds), index = 0
    while (index < this.chunks.length - 1 && time >= this.chunks[index].duration_s) { time -= this.chunks[index].duration_s; index++ }
    void this.select(index, Math.min(time, Math.max(0, this.chunks[index].duration_s - 0.01)))
  }

  private async getUrl(index: number): Promise<string> {
    const existing = this.urls.get(index)
    if (existing) return existing
    const pending = this.pending.get(index)
    if (pending) return pending
    const generation = this.generation, signal = this.abort.signal
    const promise = this.load('/audio/' + this.chunks[index].output.split('/').map(encodeURIComponent).join('/'), signal).then(blob => {
      signal.throwIfAborted()
      if (generation !== this.generation) throw new DOMException('Zmieniono nagranie', 'AbortError')
      const url = URL.createObjectURL(blob); this.urls.set(index, url)
      return url
    }).finally(() => { if (generation === this.generation) this.pending.delete(index) })
    this.pending.set(index, promise)
    return promise
  }

  private async select(index: number, time: number) {
    const operation = ++this.operation
    this.audio.pause(); this.active = false; this.atBoundary = false; this.index = index
    this.offset = this.chunks.slice(0, index).reduce((sum, item) => sum + item.duration_s, 0)
    this.publish()
    try {
      const url = await this.getUrl(index)
      if (operation !== this.operation) { this.prune(); return }
      this.audio.src = url; this.audio.currentTime = time; this.active = true
      this.prune(); this.prefetch()
      if (this.wantsPlayback) await this.start(operation)
    } catch (cause) { if (operation === this.operation && (cause as Error).name !== 'AbortError') this.setError(translateUi("Nie można wczytać fragmentu. Kliknij odtwarzanie, aby ponowić.")) }
    this.publish()
  }

  private async start(operation: number) {
    try { await this.audio.play(); if (operation !== this.operation && !this.wantsPlayback) this.audio.pause() }
    catch (cause) { if (operation === this.operation) this.setError((cause as Error).name === 'NotAllowedError' ? translateUi("Kliknij odtwarzanie, aby rozpocząć odsłuch.") : translateUi("Nie można odtworzyć fragmentu. Kliknij odtwarzanie, aby ponowić.")) }
  }

  private prefetch() {
    if (this.index + 1 >= this.chunks.length) return
    void this.getUrl(this.index + 1).then(() => this.prune()).catch(() => { /* Retry visibly when this portion becomes active. */ })
  }
  private prune() {
    for (const [index, url] of this.urls) if (index !== this.index && index !== this.index + 1) { URL.revokeObjectURL(url); this.urls.delete(index) }
  }
  private setError(message: string) { this.error = message; this.wantsPlayback = false; this.audio.pause(); this.publish() }
  private failed = () => { if (this.active && this.audio.error) this.setError(translateUi("Nie można odtworzyć tego fragmentu. Spróbuj ponownie lub pobierz pełny audiobook.")) }
  private ended = () => {
    if (!this.active || !this.audio.ended) return
    this.atBoundary = true
    if (this.wantsPlayback && this.index + 1 < this.chunks.length) void this.advance()
    else if (this.finished) this.wantsPlayback = false
    this.publish()
  }
  private async advance() { if (this.atBoundary && this.index + 1 < this.chunks.length) await this.select(this.index + 1, 0) }

  reset() {
    ++this.generation; ++this.operation; this.abort.abort(); this.abort = new AbortController()
    this.wantsPlayback = false; this.active = false; this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load()
    for (const url of this.urls.values()) URL.revokeObjectURL(url)
    this.urls.clear(); this.pending.clear(); this.chunks = []; this.index = 0; this.offset = 0; this.atBoundary = false; this.finished = false; this.error = ''; this.publish()
  }
  dispose() {
    this.reset()
    this.audio.removeEventListener('ended', this.ended); this.audio.removeEventListener('timeupdate', this.publish)
    this.audio.removeEventListener('playing', this.publish); this.audio.removeEventListener('pause', this.publish); this.audio.removeEventListener('error', this.failed)
  }
}
