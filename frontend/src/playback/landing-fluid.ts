/**
 * The landing orb's audio-driven fluid pass, ported without its OGL renderer.
 * Inputs are the raw normalized [low, mid, high, all] FFT channels. The sound
 * scale, smoothing, fixed advection step and pressure iterations follow the
 * archived reference; they are not UI sensitivity controls.
 */
type AudioChannels = readonly [number, number, number, number];
type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; size: number };
type Pair = { read: Target; write: Target };
type Pass = { program: WebGLProgram; position: number; uniforms: Record<string, WebGLUniformLocation | null> };

const simSize = 128;
const dyeSize = 512;

const vertex = `precision highp float;
attribute vec2 position;
uniform vec2 texelSize;
varying vec2 vUv, vL, vR, vT, vB;
void main() {
  vUv = position * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const clear = `precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
uniform sampler2D uTexture;
uniform float value;
void main() { gl_FragColor = value * texture2D(uTexture, vUv); }`;

const splat = `precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uTarget;
uniform vec3 color;
uniform float radius, time;
uniform vec4 cumulativeAudio, audioAverage;
void main() {
  vec2 p = (vUv - vec2(0.5)) * radius;
  float dist = length(p);
  float pTime = time * 0.25 + cumulativeAudio.a * 0.15;
  float pDist = mod(dist * 2.0 - pTime, 1.0);
  float pulse = smoothstep(0.0, 0.15, pDist) - smoothstep(0.15, 0.30, pDist);
  vec3 added = pulse * (audioAverage.x * 30.0) * clamp(dist, 0.0, 1.0) * color;
  gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + added, 1.0);
}`;

const advection = (linear: boolean) => `precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uVelocity, uSource;
uniform vec2 texelSize, dyeTexelSize;
uniform float dt, dissipation;
${linear ? '' : `vec4 bilerp(sampler2D image, vec2 coord, vec2 pixel) {
  vec2 st = coord / pixel - 0.5;
  vec2 cell = floor(st), f = fract(st);
  vec4 a = texture2D(image, (cell + vec2(0.5, 0.5)) * pixel);
  vec4 b = texture2D(image, (cell + vec2(1.5, 0.5)) * pixel);
  vec4 c = texture2D(image, (cell + vec2(0.5, 1.5)) * pixel);
  vec4 d = texture2D(image, (cell + vec2(1.5, 1.5)) * pixel);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`}
void main() {
  vec2 velocity = ${linear ? 'texture2D(uVelocity, vUv)' : 'bilerp(uVelocity, vUv, texelSize)'}.xy;
  vec2 coord = vUv - dt * velocity * texelSize;
  gl_FragColor = dissipation * ${linear ? 'texture2D(uSource, coord)' : 'bilerp(uSource, coord, dyeTexelSize)'};
  gl_FragColor.a = 1.0;
}`;

const divergence = `precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv, vL, vR, vT, vB;
uniform sampler2D uVelocity;
void main() {
  float L = texture2D(uVelocity, vL).x, R = texture2D(uVelocity, vR).x;
  float T = texture2D(uVelocity, vT).y, B = texture2D(uVelocity, vB).y;
  vec2 C = texture2D(uVelocity, vUv).xy;
  if (vL.x < 0.0) L = -C.x;
  if (vR.x > 1.0) R = -C.x;
  if (vT.y > 1.0) T = -C.y;
  if (vB.y < 0.0) B = -C.y;
  gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`;

const curl = `precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv, vL, vR, vT, vB;
uniform sampler2D uVelocity;
void main() {
  float L = texture2D(uVelocity, vL).y, R = texture2D(uVelocity, vR).y;
  float T = texture2D(uVelocity, vT).x, B = texture2D(uVelocity, vB).x;
  gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`;

const vorticity = `precision highp float;
precision highp sampler2D;
varying vec2 vUv, vL, vR, vT, vB;
uniform sampler2D uVelocity, uCurl;
uniform float curl, dt;
void main() {
  float L = texture2D(uCurl, vL).x, R = texture2D(uCurl, vR).x;
  float T = texture2D(uCurl, vT).x, B = texture2D(uCurl, vB).x;
  float C = texture2D(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;
  gl_FragColor = vec4(texture2D(uVelocity, vUv).xy + force * dt, 0.0, 1.0);
}`;

const pressure = `precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv, vL, vR, vT, vB;
uniform sampler2D uPressure, uDivergence;
void main() {
  float L = texture2D(uPressure, vL).x, R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x, B = texture2D(uPressure, vB).x;
  float div = texture2D(uDivergence, vUv).x;
  gl_FragColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
}`;

const subtractGradient = `precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv, vL, vR, vT, vB;
uniform sampler2D uPressure, uVelocity;
void main() {
  float L = texture2D(uPressure, vL).x, R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x, B = texture2D(uPressure, vB).x;
  vec2 velocity = texture2D(uVelocity, vUv).xy - vec2(R - L, T - B);
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}`;

const blur = `precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
uniform sampler2D uTexture;
uniform vec2 direction, simRes;
void main() {
  vec2 off1 = vec2(1.3846153846) * direction;
  vec2 off2 = vec2(3.2307692308) * direction;
  vec4 color = texture2D(uTexture, vUv) * 0.2270270270;
  color += texture2D(uTexture, vUv + off1 / simRes) * 0.3162162162;
  color += texture2D(uTexture, vUv - off1 / simRes) * 0.3162162162;
  color += texture2D(uTexture, vUv + off2 / simRes) * 0.0702702703;
  color += texture2D(uTexture, vUv - off2 / simRes) * 0.0702702703;
  gl_FragColor = color;
}`;

export class LandingFluid {
  /** The final orb binds this texture on unit 1; its gradient occupies unit 0. */
  readonly textureUnit = 1;
  state: 'ready' | 'fallback' = 'fallback';
  reason = '';
  linearFiltering = false;
  steps = 0;
  splats = 0;
  private readonly textures: WebGLTexture[] = [];
  private readonly framebuffers: WebGLFramebuffer[] = [];
  private readonly programs: WebGLProgram[] = [];
  private readonly zeroTexture: WebGLTexture;
  private buffer?: WebGLBuffer;
  private density?: Pair;
  private velocity?: Pair;
  private pressure?: Pair;
  private divergence?: Target;
  private curl?: Target;
  private passes: Record<string, Pass> = {};
  private time = 0;
  private audioAverage = new Float32Array(4);
  private cumulativeAudio = new Float32Array(4);
  private lastAudioAverage = new Float32Array(4);
  private disposed = false;

  constructor(private readonly gl: WebGLRenderingContext) {
    const zero = gl.createTexture();
    if (!zero) throw new Error('Nie udało się utworzyć zastępczej tekstury płynu.');
    this.zeroTexture = zero;
    gl.activeTexture(gl.TEXTURE0 + this.textureUnit);
    gl.bindTexture(gl.TEXTURE_2D, zero);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    try {
      const half = gl.getExtension('OES_texture_half_float');
      if (!half) throw new Error('Brak OES_texture_half_float; płyn został pominięty.');
      gl.getExtension('EXT_color_buffer_half_float');
      this.linearFiltering = Boolean(gl.getExtension('OES_texture_half_float_linear'));
      const filter = this.linearFiltering ? gl.LINEAR : gl.NEAREST;
      const pair = (size: number, minFilter: number): Pair => ({ read: this.target(size, half.HALF_FLOAT_OES, minFilter), write: this.target(size, half.HALF_FLOAT_OES, minFilter) });
      this.density = pair(dyeSize, filter);
      this.velocity = pair(simSize, filter);
      this.pressure = pair(simSize, gl.NEAREST);
      this.divergence = this.target(simSize, half.HALF_FLOAT_OES, gl.NEAREST);
      this.curl = this.target(simSize, half.HALF_FLOAT_OES, gl.NEAREST);
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error('Nie udało się utworzyć geometrii płynu.');
      this.buffer = buffer;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      for (const [name, fragment] of Object.entries({ clear, splat, advection: advection(this.linearFiltering), divergence, curl, vorticity, pressure, subtractGradient, blur })) this.passes[name] = this.compile(fragment);
      this.state = 'ready';
    } catch (cause) {
      this.reason = cause instanceof Error ? cause.message : 'Płyn nie jest dostępny na tym układzie graficznym.';
      this.releaseSimulation();
    } finally { gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
  }

  get texture(): WebGLTexture { return this.state === 'ready' && this.density ? this.density.read.texture : this.zeroTexture; }

  /** One call is one reference simulation step. Its advection dt stays .016. */
  update(dtSeconds: number, audio: AudioChannels): void {
    if (this.disposed || this.state !== 'ready' || !Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
    const gl = this.gl;
    if (gl.isContextLost()) { this.state = 'fallback'; this.reason = 'Utracono kontekst WebGL płynu.'; return; }
    this.time += dtSeconds;
    let allDelta = 0;
    for (let index = 0; index < 4; index++) {
      const input = Number.isFinite(audio[index]) ? audio[index] : 0;
      const scaled = Math.fround(input * 2);
      const increment = Math.fround(scaled * (dtSeconds * 60));
      const target = Math.fround(this.cumulativeAudio[index] + increment);
      this.cumulativeAudio[index] += (target - this.cumulativeAudio[index]) * .25;
      this.audioAverage[index] += (scaled - this.audioAverage[index]) * .35;
      if (index === 3) allDelta = Math.fround(this.audioAverage[index] - this.lastAudioAverage[index]);
      this.lastAudioAverage[index] = this.audioAverage[index];
    }
    const density = this.density!, velocity = this.velocity!, pressurePair = this.pressure!;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
    if (allDelta > 1e-4) {
      const x = -.2 * Math.sin(.5 * this.cumulativeAudio[1]) + .5;
      const y = .15 * Math.cos(.38 * this.cumulativeAudio[0]) + .5;
      for (const pair of [velocity, density]) {
        const pass = this.begin('splat', pair.write);
        this.sampler(pass, 'uTarget', pair.read.texture, 0);
        gl.uniform3f(pass.uniforms.color, (x - .5) * 12, (y - .5) * 12, 1);
        gl.uniform1f(pass.uniforms.radius, 1.5); gl.uniform1f(pass.uniforms.time, this.time);
        gl.uniform4fv(pass.uniforms.cumulativeAudio, this.cumulativeAudio); gl.uniform4fv(pass.uniforms.audioAverage, this.audioAverage);
        this.draw(); this.swap(pair);
      }
      this.splats++;
    }
    let pass = this.begin('curl', this.curl!);
    this.sampler(pass, 'uVelocity', velocity.read.texture, 0); this.draw();
    pass = this.begin('vorticity', velocity.write);
    gl.uniform1f(pass.uniforms.curl, 0); gl.uniform1f(pass.uniforms.dt, .016);
    this.sampler(pass, 'uVelocity', velocity.read.texture, 0); this.sampler(pass, 'uCurl', this.curl!.texture, 1); this.draw(); this.swap(velocity);
    pass = this.begin('divergence', this.divergence!);
    this.sampler(pass, 'uVelocity', velocity.read.texture, 0); this.draw();
    pass = this.begin('clear', pressurePair.write);
    this.sampler(pass, 'uTexture', pressurePair.read.texture, 0); gl.uniform1f(pass.uniforms.value, .97); this.draw(); this.swap(pressurePair);
    for (let iteration = 0; iteration < 3; iteration++) {
      pass = this.begin('pressure', pressurePair.write);
      this.sampler(pass, 'uPressure', pressurePair.read.texture, 0); this.sampler(pass, 'uDivergence', this.divergence!.texture, 1); this.draw(); this.swap(pressurePair);
    }
    pass = this.begin('subtractGradient', velocity.write);
    this.sampler(pass, 'uPressure', pressurePair.read.texture, 0); this.sampler(pass, 'uVelocity', velocity.read.texture, 1); this.draw(); this.swap(velocity);
    for (const pair of [velocity, density]) {
      pass = this.begin('advection', pair.write);
      this.sampler(pass, 'uVelocity', velocity.read.texture, 0); this.sampler(pass, 'uSource', pair.read.texture, 1);
      gl.uniform2f(pass.uniforms.dyeTexelSize, 1 / pair.read.size, 1 / pair.read.size);
      gl.uniform1f(pass.uniforms.dt, .016);
      gl.uniform1f(pass.uniforms.dissipation, .98); this.draw(); this.swap(pair);
    }
    for (const [x, y] of [[1.2, 0], [0, 1.2]]) {
      pass = this.begin('blur', density.write);
      gl.uniform2f(pass.uniforms.simRes, simSize, simSize);
      this.sampler(pass, 'uTexture', density.read.texture, 0); gl.uniform2f(pass.uniforms.direction, x, y); this.draw(); this.swap(density);
    }
    this.steps++;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseSimulation();
    this.gl.deleteTexture(this.zeroTexture);
  }

  private target(size: number, type: number, filter: number): Target {
    const gl = this.gl, texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
    if (texture) this.textures.push(texture);
    if (framebuffer) this.framebuffers.push(framebuffer);
    if (!texture || !framebuffer) throw new Error('Nie udało się przydzielić bufora płynu.');
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, type, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Tekstury half-float nie mogą być celem renderowania; płyn został pominięty.');
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    return { texture, framebuffer, size };
  }

  private compile(fragment: string): Pass {
    const gl = this.gl, shaders: WebGLShader[] = [];
    let program: WebGLProgram | null = null;
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('Nie udało się utworzyć shadera płynu.');
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Błąd kompilacji shadera płynu.');
      }
      program = gl.createProgram();
      if (!program) throw new Error('Nie udało się utworzyć programu płynu.');
      for (const shader of shaders) gl.attachShader(program, shader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Błąd łączenia shadera płynu.');
      this.programs.push(program);
      const uniforms: Pass['uniforms'] = {};
      for (const name of ['texelSize', 'uTexture', 'value', 'uTarget', 'color', 'radius', 'time', 'cumulativeAudio', 'audioAverage', 'uVelocity', 'uSource', 'dyeTexelSize', 'dt', 'dissipation', 'uCurl', 'curl', 'uPressure', 'uDivergence', 'direction', 'simRes']) uniforms[name] = gl.getUniformLocation(program, name);
      return { program, position: gl.getAttribLocation(program, 'position'), uniforms };
    } catch (cause) {
      if (program) gl.deleteProgram(program);
      throw cause;
    } finally { for (const shader of shaders) gl.deleteShader(shader); }
  }

  private begin(name: string, target: Target): Pass {
    const gl = this.gl, pass = this.passes[name];
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer); gl.viewport(0, 0, target.size, target.size); gl.useProgram(pass.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer!); gl.enableVertexAttribArray(pass.position); gl.vertexAttribPointer(pass.position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(pass.uniforms.texelSize, 1 / simSize, 1 / simSize);
    return pass;
  }
  private sampler(pass: Pass, name: string, texture: WebGLTexture, unit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(pass.uniforms[name], unit);
  }
  private draw(): void { this.gl.drawArrays(this.gl.TRIANGLES, 0, 3); }
  private swap(pair: Pair): void { const old = pair.read; pair.read = pair.write; pair.write = old; }
  private releaseSimulation(): void {
    for (const program of this.programs.splice(0)) this.gl.deleteProgram(program);
    for (const framebuffer of this.framebuffers.splice(0)) this.gl.deleteFramebuffer(framebuffer);
    for (const texture of this.textures.splice(0)) this.gl.deleteTexture(texture);
    if (this.buffer) { this.gl.deleteBuffer(this.buffer); this.buffer = undefined; }
    this.density = this.velocity = this.pressure = undefined;
    this.divergence = this.curl = undefined;
    this.passes = {};
    this.state = 'fallback';
  }
}
