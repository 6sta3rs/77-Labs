import { VoiceOrbRenderer, type OrbVariant } from './voice-orb';
import type { AudioFeatures } from './audio-features';
import type { OrbAudioBands } from './playback-meter';

export type OrbPresentation = Pick<VoiceOrbRenderer,
  'running' | 'setVoice' | 'setVariant' | 'setSensitivity' | 'setLevel' | 'setFeatures' | 'setAudioBands' | 'resize' | 'draw' | 'start' | 'stop' | 'dispose'>;
type Input = {
  voice: string; variant: OrbVariant; sensitivity: number; level: number;
  features?: AudioFeatures; audio?: OrbAudioBands;
};
const groups = new Map<string, SharedSource>();

/** One procedural material and one clock shared by all visible presentations. */
class SharedSource {
  readonly canvas = document.createElement('canvas');
  readonly views = new Set<SharedVoiceOrb>();
  renderer!: VoiceOrbRenderer;
  ready = false;
  failed = false;
  contextLost = false;
  private frame = 0;
  private edge = 128;
  private lost = (event: Event) => {
    event.preventDefault();
    if (this.failed || this.contextLost) return;
    this.contextLost = true; this.ready = false; this.renderer.dispose();
    for (const view of [...this.views]) view.lost();
  };
  private restored = () => {
    if (this.failed || !this.contextLost) return;
    try {
      this.createRenderer(); this.contextLost = false;
      this.apply([...this.views][0]);
      if ([...this.views].some(view => view.running)) {
        this.renderer.resize(this.edge); this.renderer.start();
      }
      if (this.ready) for (const view of this.views) view.loaded();
    } catch { this.fail(); }
  };

  constructor(readonly key: string) {
    this.createRenderer();
    this.canvas.addEventListener('webglcontextlost', this.lost);
    this.canvas.addEventListener('webglcontextrestored', this.restored);
  }
  private createRenderer() {
    this.ready = true;
    this.renderer = new VoiceOrbRenderer(this.canvas);
    this.renderer.onDraw = () => {
      ++this.frame;
      // A second RAF here can receive an already-cleared WebGL buffer.
      for (const view of this.views) if (view.running) this.copy(view);
    };
  }
  apply(fallback?: SharedVoiceOrb) {
    if (this.failed || this.contextLost) return;
    // Visibility belongs to the presentation. A hidden/reduced subscriber must
    // never silence a visible one by submitting its own zeroed inputs.
    const input = ([...this.views].find(view => view.running) ?? fallback)?.input;
    if (!input) return;
    const current = this.renderer;
    current.setVoice(input.voice); current.setVariant(input.variant); current.setSensitivity(input.sensitivity);
    current.setLevel(input.level); current.setFeatures(input.features); current.setAudioBands(input.audio);
  }
  refresh(view: SharedVoiceOrb) {
    if (this.failed || this.contextLost) return;
    this.apply(view);
    if ([...this.views].some(entry => entry.running)) this.renderer.start(); else this.renderer.stop();
  }
  resize(view: SharedVoiceOrb) {
    const rect = view.canvas.getBoundingClientRect();
    const edge = Math.max(1, Math.min(rect.width, rect.height));
    const pixels = Math.round(edge * Math.min(devicePixelRatio || 1, 1.5));
    if (view.canvas.width !== pixels || view.canvas.height !== pixels) view.canvas.width = view.canvas.height = pixels;
    // Keep a stable common resolution when the large view closes and reopens.
    this.edge = Math.max(this.edge, Math.min(256, edge));
    if (!this.failed && !this.contextLost) {
      this.apply(view); this.renderer.resize(this.edge);
      for (const entry of this.views) this.copy(entry);
    }
  }
  draw(view: SharedVoiceOrb) {
    if (this.failed || this.contextLost) return;
    this.apply(view); this.renderer.draw(0);
    // Explicit still redraws also synchronize subscribers stopped by reduced
    // motion. The continuous loop only copies to running presentations.
    for (const entry of this.views) this.copy(entry);
  }
  private copy(view: SharedVoiceOrb) {
    view.context.clearRect(0, 0, view.canvas.width, view.canvas.height);
    view.context.drawImage(this.canvas, 0, 0, view.canvas.width, view.canvas.height);
    view.canvas.dataset.sharedFrame = String(this.frame);
    view.canvas.dataset.frames = String(Number(view.canvas.dataset.frames || 0) + 1);
  }
  private fail() {
    if (this.failed) return;
    this.failed = true;
    if (!this.contextLost) this.renderer.dispose();
    for (const view of [...this.views]) view.failed();
  }
  release(view: SharedVoiceOrb) {
    this.views.delete(view);
    if (this.views.size) this.refresh([...this.views][0]);
    else {
      if (!this.failed && !this.contextLost) this.renderer.dispose();
      this.canvas.removeEventListener('webglcontextlost', this.lost);
      this.canvas.removeEventListener('webglcontextrestored', this.restored);
      groups.delete(this.key);
    }
  }
}

/** A small 2D presentation of the shared source; it owns no WebGL context. */
export class SharedVoiceOrb implements OrbPresentation {
  readonly context: CanvasRenderingContext2D;
  readonly input: Input = { voice: 'voicestudio', variant: 'original', sensitivity: 1, level: 0 };
  private source: SharedSource;
  private disposed = false;
  running = false;
  constructor(group: string, readonly canvas: HTMLCanvasElement, private callbacks: { onload: () => void; onerror: () => void; onlost?: () => void }) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D unavailable');
    this.context = context;
    const key = `${group}:procedural`;
    this.source = groups.get(key) ?? new SharedSource(key);
    groups.set(key, this.source); this.source.views.add(this);
    if (this.source.ready) this.loaded();
  }
  loaded() { if (!this.disposed) this.callbacks.onload(); }
  failed() { if (!this.disposed) this.callbacks.onerror(); }
  lost() { if (!this.disposed) (this.callbacks.onlost ?? this.callbacks.onerror)(); }
  get unavailable() { return this.source.failed || this.source.contextLost; }
  setVoice(value: string) { this.input.voice = value; this.source.apply(this); }
  setVariant(value: OrbVariant) { this.input.variant = value; this.source.apply(this); }
  setSensitivity(value: number) { this.input.sensitivity = value; this.source.apply(this); }
  setLevel(value: number) { this.input.level = value; this.source.apply(this); }
  setFeatures(value?: AudioFeatures) { this.input.features = value; this.source.apply(this); }
  setAudioBands(value?: OrbAudioBands) { this.input.audio = value; this.source.apply(this); }
  resize() { if (!this.disposed) this.source.resize(this); }
  draw() { if (!this.disposed) this.source.draw(this); }
  start() {
    if (this.disposed || this.running || this.source.failed) return;
    this.running = true; this.source.refresh(this); this.source.draw(this);
  }
  stop() { this.running = false; if (!this.disposed) this.source.refresh(this); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.running = false; this.source.release(this);
  }
}
