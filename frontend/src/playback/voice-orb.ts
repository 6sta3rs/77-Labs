import type { AudioFeatures } from './audio-features';
import type { OrbAudioBands } from './playback-meter';
export type OrbVariant = 'original' | 'calm' | 'storm' | 'intonation' | 'landing';
export const orbVariants: OrbVariant[] = ['original', 'calm', 'storm', 'intonation', 'landing'];
/** The earlier saved name 'elevenlabs' is the same variant as 'landing' (Płyn). */
export function normalizeOrbVariant(value: unknown, fallback: OrbVariant = 'original'): OrbVariant {
  if (value === 'elevenlabs') return 'landing';
  return orbVariants.includes(value as OrbVariant) ? value as OrbVariant : fallback;
}
/** Visual demonstration only. It never reads or creates an audio source. */
export function orbPreviewFrame(seconds: number): { level: number; bands: OrbAudioBands; features: AudioFeatures } {
  const t = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const pulse = Math.pow((1 + Math.sin(t * 5.2)) * .5, 2);
  const level = .22 + pulse * .44;
  const low = .22 + .42 * (1 + Math.sin(t * 1.7)) * .5;
  const mid = .2 + .5 * (1 + Math.sin(t * 2.3 + 1.4)) * .5;
  const high = .08 + .42 * Math.pow((1 + Math.sin(t * 6.2 + .6)) * .5, 3);
  return { level, bands: [level * low, level * mid, level * high, level * .65], features: {
    rms: level * .25, spectralFlux: .05 + high * .25, spectralFlatness: .2,
    spectralCentroidHz: 1200 + high * 5200, envelopeModulation: .08 + pulse * .22,
    pitchHz: 140 + 110 * (1 + Math.sin(t * .84)) * .5 + 45 * Math.sin(t * .27),
    pitchConfidence: .98, pitchChange: Math.abs(Math.cos(t * .84)) * .1,
    turbulence: .18 + pulse * .4 + high * .15,
  } };
}
const ease = (from: number, to: number, x: number) => { const k = Math.max(0, Math.min(1, (x - from) / (to - from))); return k * k * (3 - 2 * k); };
/** Płyn demonstration: a 12 s loop of breathing, phrased speech, a pause and an emphatic burst, so the fluid splats, drifting gradient and grain all show. */
export function orbShowcaseFrame(seconds: number): { level: number; bands: OrbAudioBands; features: AudioFeatures } {
  const k = (Number.isFinite(seconds) ? Math.max(0, seconds) : 0) % 12;
  const speech = ease(1.6, 2.6, k) * (1 - ease(6.2, 6.7, k)), emphatic = ease(7.4, 7.9, k) * (1 - ease(10.2, 10.9, k));
  const syllable = Math.pow(Math.abs(Math.sin(Math.PI * (4.5 + 1.8 * emphatic) * k)), 1.6);
  const loud = speech * .72 + emphatic * .95;
  const level = Math.min(1, .1 + .04 * Math.sin(k * 1.3) + loud * (.3 + .7 * syllable));
  const low = .35 + .25 * Math.sin(k * 1.1), mid = .45 + .4 * syllable, high = .1 + .5 * speech * Math.pow(syllable, 3) + .8 * emphatic * syllable;
  return { level, bands: [level * low, level * mid, level * high, level * .9], features: {
    rms: level * .25, spectralFlux: .05 + high * .3 + emphatic * .2, spectralFlatness: .2,
    spectralCentroidHz: 1000 + high * 6000, envelopeModulation: .08 + loud * syllable * .3,
    pitchHz: 130 + 90 * (1 + Math.sin(k * 1.9)) * .5 + 25 * Math.sin(k * .6),
    pitchConfidence: loud > .2 ? .95 : .3, pitchChange: Math.abs(Math.cos(k * 1.9)) * .12,
    turbulence: .15 + loud * syllable * .5,
  } };
}
/** Named orb palettes. „Z głosu” picks one of the first six from the voice id; the user may pin any of them. */
export const orbPalettes: { id: string; label: string; colors: [string, string, string] }[] = [
  { id: 'granat', label: 'Granat', colors: ['#07182f', '#205c9e', '#8bcefa'] },
  { id: 'indygo', label: 'Indygo', colors: ['#171c45', '#596bd1', '#c0ccff'] },
  { id: 'morski', label: 'Morski', colors: ['#102e31', '#378d88', '#b0f3db'] },
  { id: 'fiolet', label: 'Fiolet', colors: ['#301b42', '#8860b6', '#eac5f0'] },
  { id: 'roz', label: 'Róż', colors: ['#30203a', '#ad6f92', '#f1c9c3'] },
  { id: 'blekit', label: 'Błękit', colors: ['#11283b', '#378fa9', '#bbecff'] },
  { id: 'ogien', label: 'Ogień', colors: ['#3a1206', '#e2552a', '#ffd2a6'] },
];
const palettes = orbPalettes.slice(0, 6).map(palette => palette.colors);
const rgbOf = (colors: readonly string[]) => colors.map(color => [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255));
// ponytail: one app-wide choice set from the appearance settings, like the theme; listeners repaint live orbs.
let paletteChoice = 'voice';
export function setOrbPalette(id: string) {
  const next = orbPalettes.some(palette => palette.id === id) ? id : 'voice';
  if (next === paletteChoice) return;
  paletteChoice = next;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('orb-palette'));
}
const pinnedColors = () => orbPalettes.find(palette => palette.id === paletteChoice)?.colors;
/** Stable visual identity, independent of emotion, audio content and application theme. */
export function voiceIdentity(voiceId: string) {
  let seed = 2166136261;
  for (const char of voiceId || 'voicestudio') seed = Math.imul(seed ^ char.codePointAt(0)!, 16777619) >>> 0;
  const colors = pinnedColors() ?? palettes[seed % palettes.length];
  return { seed, colors, rgb: rgbOf(colors) };
}

const previewPalettes: Record<OrbVariant, [string, string, string]> = {
  original: ['#071b47', '#2563eb', '#a7d8ff'],
  calm: ['#062c22', '#239c72', '#c3ffe1'],
  storm: ['#271044', '#8b3dd0', '#e8bfff'],
  intonation: ['#4a122f', '#d74b83', '#ffd0e3'],
  landing: ['#072f46', '#0ba5b6', '#c7fbff'],
};
/** Showcase colors identify the material; real playback keeps the voice palette. */
export function orbPreviewIdentity(voiceId: string, variant: OrbVariant) {
  // A pinned palette is what the user will see in the app, so previews show it too.
  const colors = pinnedColors() ?? previewPalettes[variant] ?? previewPalettes.original;
  return { seed: voiceIdentity(voiceId).seed, colors, rgb: rgbOf(colors) };
}

// Original GLSL: domain-warped noise on a projected sphere, without remote textures.
const vertex = `attribute vec2 position; varying vec2 uv;
void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
const fragment = `precision highp float;
varying vec2 uv;
uniform float time, level, energy, seed, variant, turbulence, centroid, pitch, pitchStrength;
uniform vec4 reactiveBands;
uniform float reactiveImpulse, reactiveDrive;
uniform vec2 resolution;
uniform vec3 darkColor, midColor, lightColor;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21)+seed);p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.7;for(int i=0;i<4;i++){v+=a*noise(p);p=mat2(1.6,-1.2,1.2,1.6)*p+7.3;a*=.3;}return v;}
void main(){
  vec2 p=uv*2.-1.; float radius=length(p);
  float alpha=1.-smoothstep(.975,1.,radius);
  if(alpha<=0.){gl_FragColor=vec4(0.);return;}
  vec3 normal=vec3(p,sqrt(max(0.,1.-dot(p,p))));
  float t=time*.12+energy*.2;
  vec2 sphere=p/(1.05+normal.z*.15);
  vec4 bands=clamp(reactiveBands,0.,1.);
  float body=clamp(reactiveDrive,0.,1.);
  float onset=clamp(reactiveImpulse,0.,1.);
  float voiced=clamp(pitchStrength,0.,1.);
  float drive=variant<.5?level:level*.12+turbulence*.22;
  float warp=variant>.5&&variant<1.5?.88:1.1;
  float reflection=1.;
  // Only the material moves. The sphere and its silhouette retain their size.
  if(variant<.5){
    vec2 breath=vec2(sin(sphere.y*3.2+t*.9),cos(sphere.x*3.-t*.7));
    vec2 speech=vec2(cos(sphere.y*5.1-t*1.3),sin(sphere.x*4.6+t));
    sphere+=breath*(body*.045+bands.x*.055)+speech*(bands.y*.045+onset*.025);
    sphere+=vec2(sin(sphere.y*11.+t*2.4),cos(sphere.x*10.-t*2.1))*bands.z*.016*normal.z;
    drive+=body*.6+bands.x*.22+bands.y*.18;
    warp+=bands.w*.12+onset*.08;
  }else if(variant<1.5){
    // Calm keeps broad, slow waves; responsiveness comes from amplitude,
    // rather than delaying the entire signal until a short syllable is over.
    sphere+=vec2(sin(sphere.y*2.2+t*.55),cos(sphere.x*2.4-t*.45))*(body*.022+bands.x*.035);
    sphere+=vec2(cos(sphere.y*3.7-t*.6),sin(sphere.x*3.4+t*.5))*(bands.y*.023+onset*.008);
    sphere+=vec2(sin(sphere.y*7.+t),cos(sphere.x*6.5-t*.8))*bands.z*.005*normal.z;
    drive+=body*.28+bands.x*.1+bands.y*.07;
    warp+=bands.w*.07+onset*.025;
    reflection=.42;
  }else if(variant<2.5){
    float tone=pitch*voiced;
    float twist=(body*.22+bands.x*.26+bands.y*.17+onset*.23)*sin(radius*4.2-t*1.8);
    sphere=mat2(cos(twist),-sin(twist),sin(twist),cos(twist))*sphere;
    sphere+=vec2(sin(sphere.y*(2.5+tone)+t*.8),cos(sphere.x*(2.5+tone)-t*.6))*(.035+turbulence*.12+body*.075+bands.y*.05);
    sphere+=vec2(sin(sphere.y*13.+t*3.8),cos(sphere.x*11.-t*3.1))*(bands.z*.033+onset*.022)*normal.z;
    drive+=body*.9+bands.y*.35+bands.z*.25;
    warp+=turbulence*.3+body*.3+bands.x*.2+onset*.22;
    reflection=1.18;
  }else{
    // F0 steers the wave only while voiced. Unvoiced speech retains the
    // energy/band-driven motion instead of acquiring a fabricated melody.
    float angle=(pitch-.5)*voiced*(.7+body*.18);
    sphere=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*sphere;
    float wave=voiced*(.012+turbulence*.018+body*.065)+bands.x*.025+bands.w*.018;
    sphere.y+=sin(sphere.x*(5.+pitch*voiced*2.5)+t*1.2)*wave;
    sphere.x+=cos(sphere.y*3.8+t*.8)*(bands.y*.035+onset*.018);
    sphere+=vec2(sin(sphere.y*10.+t*1.8),cos(sphere.x*9.-t*1.6))*bands.z*.012*normal.z;
    drive+=body*.4+bands.y*.18;
    warp+=bands.w*.1+onset*.07;
    reflection=.88;
  }
  vec2 flow=vec2(fbm(sphere*1.4+vec2(t,-t*.7)),fbm(sphere*1.4+vec2(4.7,-3.1)+t*.65));
  float clouds=fbm(sphere*(1.8+drive*.25)+flow*(warp+drive*.4)+vec2(t*.4,-t*.5));
  float detail=fbm(sphere*2.4+flow*.8-t*.25);
  vec3 color=mix(darkColor,midColor,smoothstep(.18,.65,clouds));
  color=mix(color,lightColor,pow(smoothstep(.36,.82,clouds+detail*.16),1.8));
  float lighting=.62+.38*max(0.,dot(normal,normalize(vec3(-.5,.65,1.))));
  color*=lighting*(.8+normal.z*.2);
  color+=lightColor*pow(1.-normal.z,3.)*.09;
  color+=lightColor*level*(variant<.5?.035:.018+centroid*.02);
  // Bright consonants and attacks light a moving patch, never the full disk.
  vec3 lamp=normalize(vec3(.48+sin(t*.7)*.15,.3,1.));
  float sheen=pow(max(0.,dot(normal,lamp)),14.);
  float cloudSheen=.4+.6*smoothstep(.28,.62,detail);
  color+=lightColor*sheen*cloudSheen*reflection*(body*.07+bands.z*.14+onset*.12);
  color+=lightColor*pow(1.-normal.z,4.)*bands.x*.035*reflection;
  if(variant>2.5)color=mix(color,color.gbr,pitch*voiced*.12);
  color+=(hash(gl_FragCoord.xy+floor(time*12.))-.5)*.025;
  gl_FragColor=vec4(color,alpha);
}`;

export class VoiceOrbRenderer {
  private gl: WebGLRenderingContext;
  private program!: WebGLProgram;
  private buffer!: WebGLBuffer;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private raf = 0;
  private last = 0;
  private nextFrame = 0;
  private time = 0;
  private energy = 0;
  private previewTime = 0;
  private voiceId = 'voicestudio';
  private target = 0;
  private level = 0;
  private variant: OrbVariant = 'original';
  private sensitivity = 1;
  private targetTurbulence = 0;
  private turbulence = 0;
  private targetPitch = 0;
  private pitch = 0;
  private targetConfidence = 0;
  private confidence = 0;
  private centroid = 0;
  private targetCentroid = 0;
  private disposed = false;
  private texture?: WebGLTexture;
  private image?: HTMLImageElement;
  private fluid?: { readonly texture: WebGLTexture; readonly state: string; update: (dt: number, audio: OrbAudioBands) => void; dispose: () => void };
  private emptyFluid?: WebGLTexture;
  private position = 0;
  private audioTarget?: OrbAudioBands;
  private rawAudio: [number, number, number, number] = [0, 0, 0, 0];
  private audioAverage = new Float32Array(4);
  private cumulativeAudio = new Float32Array(4);
  private reactiveBands = new Float32Array(4);
  private reactiveDrive = 0;
  private reactiveImpulse = 0;
  private targetTransient = 0;
  private previousEnvelope = 0;
  running = false;
  /** Without its textures (not loaded or failed) the Płyn style degrades to the original procedural material. */
  private get textured() { return this.variant === 'landing' && !!this.texture; }
  /** Copies shared presentations before WebGL clears its drawing buffer. */
  onDraw?: () => void;

  constructor(private canvas: HTMLCanvasElement, treatment?: {
    fragment: string; texture: string; onload: () => void; onerror: () => void;
    uniforms?: Record<string, number | number[]>;
    createFluid?: (gl: WebGLRenderingContext) => NonNullable<VoiceOrbRenderer['fluid']>;
  }, private preview = false) {
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    if (treatment) gl.getExtension('OES_standard_derivatives');
    const shaders: WebGLShader[] = [];
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, treatment?.fragment ?? fragment]] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('Shader allocation failed');
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Shader compilation failed');
      }
      const program = gl.createProgram();
      if (!program) throw new Error('Program allocation failed');
      this.program = program;
      shaders.forEach(shader => gl.attachShader(program, shader)); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader linking failed');
      gl.useProgram(program);
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error('Buffer allocation failed');
      this.buffer = buffer;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'position');
      this.position = position;
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      for (const name of ['time','level','energy','seed','resolution','darkColor','midColor','lightColor','variant','turbulence','centroid','pitch','pitchStrength','uAudioAverage','uCumulativeAudio','reactiveBands','reactiveDrive','reactiveImpulse','previewPalette']) this.uniforms[name] = gl.getUniformLocation(program, name);
      gl.uniform1f(this.uniforms.previewPalette, 1);
      gl.disable(gl.DEPTH_TEST);
      if (treatment) {
        for (const [name, value] of Object.entries(treatment.uniforms ?? {})) {
          const location = gl.getUniformLocation(program, name);
          if (typeof value === 'number') gl.uniform1f(location, value);
          else if (value.length === 2) gl.uniform2fv(location, value);
          else if (value.length === 3) gl.uniform3fv(location, value);
          else if (value.length === 4) gl.uniform4fv(location, value);
        }
        const emptyFluid = gl.createTexture();
        if (!emptyFluid) throw new Error('Fluid fallback allocation failed');
        this.emptyFluid = emptyFluid;
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, emptyFluid);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.uniform1i(gl.getUniformLocation(program, 'uFluidSimTexture'), 1);
        const texture = gl.createTexture();
        if (!texture) throw new Error('Texture allocation failed');
        this.texture = texture;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        const placeholder = this.preview ? [...orbPreviewIdentity('', 'landing').rgb[1].map(value => Math.round(value * 255)), 255] : [255, 118, 50, 255];
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(placeholder));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.uniform1i(gl.getUniformLocation(program, 'gradientTexture'), 0);
        const ready = gl.getUniformLocation(program, 'textureReady');
        const image = new Image();
        this.image = image;
        canvas.dataset.texture = 'loading';
        image.onload = () => {
          if (this.disposed || gl.isContextLost()) return;
          gl.useProgram(program); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
          gl.uniform1f(ready, 1);
          canvas.dataset.texture = 'ready';
          treatment.onload();
        };
        image.onerror = () => { if (!this.disposed) { canvas.dataset.texture = 'fallback'; treatment.onerror(); } };
        this.fluid = treatment.createFluid?.(gl);
        canvas.dataset.fluid = this.fluid?.state ?? 'disabled';
        image.src = treatment.texture;
      }
    } catch (error) {
      if (this.texture) gl.deleteTexture(this.texture);
      this.fluid?.dispose();
      if (this.emptyFluid) gl.deleteTexture(this.emptyFluid);
      if (this.buffer) gl.deleteBuffer(this.buffer);
      if (this.program) gl.deleteProgram(this.program);
      throw error;
    } finally { shaders.forEach(shader => gl.deleteShader(shader)); }
  }
  setVoice(voiceId: string) {
    this.voiceId = voiceId;
    const identity = this.preview ? orbPreviewIdentity(voiceId, this.variant) : voiceIdentity(voiceId), gl = this.gl;
    gl.useProgram(this.program); gl.uniform1f(this.uniforms.seed, (identity.seed % 10000) / 97);
    ['darkColor','midColor','lightColor'].forEach((name,index) => gl.uniform3fv(this.uniforms[name], identity.rgb[index]));
  }
  setLevel(value: number) { this.target = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; }
  // Keep the meter's live FFT view: it updates at the audio clock without
  // forcing the editor, YIN analysis and Svelte reporting above 30 Hz.
  setAudioBands(value?: OrbAudioBands) { this.audioTarget = value; }
  setVariant(value: OrbVariant | 'elevenlabs') {
    const next = normalizeOrbVariant(value);
    if (next === this.variant) return;
    this.variant = next;
    if (this.preview) this.setVoice(this.voiceId);
  }
  setSensitivity(value: number) { this.sensitivity = Number.isFinite(value) ? Math.max(0, Math.min(3, value)) : 1; }
  setFeatures(features?: AudioFeatures) {
    this.targetTurbulence = features && Number.isFinite(features.turbulence) ? Math.max(0, Math.min(1, features.turbulence)) : 0;
    this.targetCentroid = features && Number.isFinite(features.spectralCentroidHz) ? Math.max(0, Math.min(1, features.spectralCentroidHz / 8000)) : 0;
    const voiced = features?.pitchHz !== null && features?.pitchHz !== undefined && Number.isFinite(features.pitchHz)
      && features.pitchHz >= 65 && features.pitchHz <= 800 && Number.isFinite(features.pitchConfidence) && features.pitchConfidence >= .85;
    this.targetPitch = voiced ? Math.max(0, Math.min(1, Math.log2(features!.pitchHz! / 65) / Math.log2(800 / 65))) : this.pitch;
    this.targetConfidence = voiced ? Math.min(1, features!.pitchConfidence) : 0;
    const flux = Number.isFinite(features?.spectralFlux) ? Math.max(0, features!.spectralFlux) : 0;
    const envelope = Number.isFinite(features?.envelopeModulation) ? Math.max(0, features!.envelopeModulation) : 0;
    this.targetTransient = Math.min(1, flux * 1.5 + envelope * .65);
  }
  private updateReaction(dt: number) {
    if (dt <= 0) return;
    const calm = this.variant === 'calm', storm = this.variant === 'storm';
    const attack = calm ? .18 : storm ? .035 : this.variant === 'intonation' ? .065 : .055;
    const release = calm ? .55 : storm ? .22 : this.variant === 'intonation' ? .30 : .26;
    const smooth = (current: number, target: number, rise = attack, fall = release) =>
      current + (target - current) * (1 - Math.exp(-dt / (target > current ? rise : fall)));
    for (let channel = 0; channel < 4; channel++) {
      const value = this.audioTarget?.[channel] ?? 0;
      this.rawAudio[channel] = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    }
    const envelope = Math.max(this.target, this.rawAudio[3]);
    const strength = Math.min(1, envelope * this.sensitivity);
    // Correct unequal FFT band widths without amplifying quiet input to full
    // strength: frequency balance is always multiplied by real signal energy.
    const spectralPeak = Math.max(.01, this.rawAudio[0], this.rawAudio[1], this.rawAudio[2]);
    for (let channel = 0; channel < 3; channel++) {
      this.reactiveBands[channel] = smooth(this.reactiveBands[channel], this.rawAudio[channel] / spectralPeak * strength);
    }
    this.reactiveBands[3] = smooth(this.reactiveBands[3], strength);
    this.reactiveDrive = smooth(this.reactiveDrive, strength);
    const onset = Math.max(0, envelope - this.previousEnvelope) * 2.8;
    this.previousEnvelope = envelope;
    const transient = Math.min(1, (this.targetTransient + onset) * this.sensitivity);
    this.reactiveImpulse = smooth(this.reactiveImpulse, transient, calm ? .1 : storm ? .02 : .035, calm ? .35 : storm ? .16 : .2);
  }
  resize(logicalSize?: number) {
    const rect = this.canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 1.5);
    const size = Math.max(1, Math.round((logicalSize ?? Math.min(rect.width, rect.height)) * dpr));
    if (this.canvas.width !== size || this.canvas.height !== size) { this.canvas.width = size; this.canvas.height = size; }
    this.gl.useProgram(this.program); this.gl.viewport(0, 0, size, size);
    this.gl.uniform2f(this.uniforms.resolution, size, size);
    this.draw();
  }
  draw(dt = 0) {
    if (this.disposed || this.gl.isContextLost()) return;
    if (this.preview) {
      this.previewTime += Number.isFinite(dt) ? Math.max(0, dt) : 0;
      const sample = this.textured ? orbShowcaseFrame(this.previewTime) : orbPreviewFrame(this.previewTime);
      this.setLevel(sample.level); this.setFeatures(sample.features); this.setAudioBands(sample.bands);
    }
    if (this.textured) {
      const weight = 1 - Math.pow(.45, Math.max(0, dt) * 60);
      for (let channel = 0; channel < 4; channel++) {
        const value = this.audioTarget?.[channel] ?? 0;
        const raw = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
        this.rawAudio[channel] = raw;
        this.audioAverage[channel] += (raw - this.audioAverage[channel]) * weight;
        this.cumulativeAudio[channel] += raw * 21 * Math.max(0, dt);
      }
      if (dt > 0) this.fluid?.update(dt, this.rawAudio);
    } else this.updateReaction(Math.max(0, dt));
    // A sustained note still carries energy. Flux alone only describes its changes.
    const storm = this.variant === 'storm';
    const sustained = this.target * (.7 + this.targetConfidence * (.12 + this.targetPitch * .22) + this.targetCentroid * .14);
    const drive = storm ? sustained + this.targetTurbulence * .45 : this.targetTurbulence;
    const gain = Math.min(1, drive * this.sensitivity);
    // A zero-time redraw (resize, resume, prop change) must never snap to a new target.
    const blend = dt ? 1 - Math.exp(-dt / (gain > this.turbulence ? .55 : 1.1)) : 0;
    this.turbulence += (gain - this.turbulence) * blend;
    const landing = this.textured, intonation = this.variant === 'intonation';
    const confidenceTarget = landing ? this.targetConfidence : this.target > .001 ? this.targetConfidence * Math.min(1, this.sensitivity) : 0;
    const confidenceTime = landing ? .8 : confidenceTarget > this.confidence ? intonation ? .065 : .14 : intonation ? .18 : .35;
    this.pitch += (this.targetPitch - this.pitch) * (dt ? 1 - Math.exp(-dt / (landing ? .7 : intonation ? .14 : .3)) : 0);
    this.confidence += (confidenceTarget - this.confidence) * (dt ? 1 - Math.exp(-dt / confidenceTime) : 0);
    this.centroid += (this.targetCentroid - this.centroid) * (dt ? 1 - Math.exp(-dt / (landing ? .8 : this.variant === 'calm' ? .4 : .2)) : 0);
    const drift = this.variant === 'calm' ? .6 : this.variant === 'intonation' ? .82 : .9;
    const response = storm ? .9 + this.pitch * this.confidence * .6 : .24;
    this.time += dt * (this.variant === 'original' || this.variant === 'landing' ? 1 : drift + this.turbulence * response);
    const levelTarget = landing ? this.target : Math.min(1, this.target * this.sensitivity);
    this.level += (levelTarget - this.level) * (dt ? 1 - Math.exp(-dt / (landing ? levelTarget > this.level ? .25 : .65 : levelTarget > this.level ? .055 : .26)) : 0);
    this.energy += (landing ? this.level * .15 + this.turbulence * .22 : this.reactiveDrive * .35 + this.turbulence * .12) * dt;
    const gl = this.gl;
    // Fluid owns temporary framebuffers/programs. Restore the sphere's state.
    if (this.texture) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.enableVertexAttribArray(this.position); gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.fluid?.texture ?? this.emptyFluid!);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture);
    }
    gl.useProgram(this.program); gl.uniform1f(this.uniforms.time, this.time); gl.uniform1f(this.uniforms.level, this.level); gl.uniform1f(this.uniforms.energy, this.energy);
    if (this.textured) {
      gl.uniform4fv(this.uniforms.uAudioAverage, this.audioAverage);
      gl.uniform4fv(this.uniforms.uCumulativeAudio, this.cumulativeAudio);
    } else {
      gl.uniform4fv(this.uniforms.reactiveBands, this.reactiveBands);
      gl.uniform1f(this.uniforms.reactiveDrive, this.reactiveDrive);
      gl.uniform1f(this.uniforms.reactiveImpulse, this.reactiveImpulse);
    }
    gl.uniform1f(this.uniforms.variant, this.variant === 'landing' && !this.textured ? 0 : orbVariants.indexOf(this.variant)); gl.uniform1f(this.uniforms.turbulence, this.turbulence);
    gl.uniform1f(this.uniforms.centroid, this.centroid); gl.uniform1f(this.uniforms.pitch, this.pitch); gl.uniform1f(this.uniforms.pitchStrength, this.confidence);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.canvas.dataset.frames = String(Number(this.canvas.dataset.frames || 0) + 1);
    this.onDraw?.();
  }
  start() {
    if (this.running || this.disposed) return;
    this.running = true; this.last = 0; this.nextFrame = 0;
    const frame = (now: number) => {
      if (!this.running) return;
      // Keep the selected 30/60 FPS deadline across 60/75/120/144 Hz displays.
      // Small timestamp rounding must not skip an intended display frame.
      const interval = 1000 / (this.textured ? 60 : 30);
      if (now >= this.nextFrame - .5) {
        this.draw(this.last ? Math.min((now - this.last) / 1000, .1) : 0);
        this.last = now;
        this.nextFrame = this.nextFrame
          ? this.nextFrame + Math.max(1, Math.floor((now - this.nextFrame) / interval) + 1) * interval
          : now + interval;
      }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
  dispose() {
    this.stop(); this.disposed = true;
    if (this.image) { this.image.onload = null; this.image.onerror = null; this.image.src = ''; this.image = undefined; }
    if (this.texture) this.gl.deleteTexture(this.texture);
    this.fluid?.dispose();
    if (this.emptyFluid) this.gl.deleteTexture(this.emptyFluid);
    this.gl.deleteBuffer(this.buffer); this.gl.deleteProgram(this.program);
  }
}
