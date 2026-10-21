import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/dictation.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { dictationSocketUrl, emptyDictation, reduceDictationMessage, floatToPcm16, LiveDictation, DICTATION_END } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
assert.equal(DICTATION_END, 'EOF');
assert.equal(dictationSocketUrl(true, 'https://irrelevant.invalid', 'whisper-tiny'), 'ws://127.0.0.1:4312/ws/transcribe?pcm=1&sr=16000&model=whisper-tiny');
assert.equal(dictationSocketUrl(false, 'http://127.0.0.1:4310', 'whisper-tiny', 48000), 'ws://127.0.0.1:4310/backend/ws/transcribe?pcm=1&sr=48000&model=whisper-tiny');
assert.ok(dictationSocketUrl(false, 'https://localhost:4310', 'test').startsWith('wss://localhost:4310/'));
for (const origin of ['https://example.com', 'http://127.0.0.1.example.com', 'http://localhost@evil.example', 'file:///tmp/test']) assert.throws(() => dictationSocketUrl(false, origin, 'test'));
for (const model of ['', 'a/b', '../x', 'secret?token=example']) assert.throws(() => dictationSocketUrl(true, '', model));
for (const rate of [0, 7999, 96001, NaN, 16000.5]) assert.throws(() => dictationSocketUrl(true, '', 'test', rate));
const pcm = floatToPcm16(new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2, NaN, Infinity]));
assert.deepEqual([...new Int16Array(pcm)], [-32768, -32768, -16384, 0, 16384, 32767, 32767, 0, 0]);
assert.equal(new DataView(pcm).getUint8(0), 0); assert.equal(new DataView(pcm).getUint8(1), 128, 'PCM must be little endian.');
let state = reduceDictationMessage(emptyDictation(), { type: 'partial', text: 'Niepotwierdzony fragment' });
assert.equal(state.text, ''); assert.equal(state.partial, 'Niepotwierdzony fragment');
state = reduceDictationMessage(state, { type: 'final', text: 'Tak.', final_kind: 'utterance' });
state = reduceDictationMessage(state, { type: 'final', text: 'Tak.', final_kind: 'utterance' });
assert.equal(state.text, 'Tak. Tak.', 'Real repeated utterances must not be deduplicated by text.');
assert.equal(state.complete, false);
state = reduceDictationMessage(state, { type: 'final', text: 'Tak. Tak.', final_kind: 'summary', engine: 'sherpa', refined_text: 'Tak, tak.' });
assert.equal(state.text, 'Tak. Tak.', 'A summary replaces rather than appends all utterances.');
assert.equal(state.complete, true); assert.equal(state.partial, ''); assert.equal(state.refinedText, 'Tak, tak.');
assert.equal(reduceDictationMessage(state, { type: 'partial', text: 'late' }).partial, '');
assert.equal(reduceDictationMessage(emptyDictation(), { type: 'final', text: 'Legacy final.' }).complete, true);
assert.equal(reduceDictationMessage(state, { type: 'error', kind: 'asr_model_missing', message: 'Brak modelu', hint: 'Pobierz model.' }).error, 'Brak modelu Pobierz model.');
assert.throws(() => reduceDictationMessage(state, { type: 'final', text: null }));
assert.throws(() => reduceDictationMessage(state, null));

let Processor;
const messages = [];
const worklet = await readFile(new URL('../src/lib/dictation-worklet.js', import.meta.url), 'utf8');
vm.runInNewContext(worklet, { sampleRate: 16000, Float32Array, ArrayBuffer, DataView, Number, Math, AudioWorkletProcessor: class { constructor() { this.port = { postMessage: value => messages.push(value) }; } }, registerProcessor(name, constructor) { assert.equal(name, 'seventy-seven-dictation-pcm'); Processor = constructor; } });
const processor = new Processor();
const input = new Float32Array(1600); input.set([-1, -0.5, 0, 0.5, 1, NaN]);
const output = new Float32Array(1600).fill(1);
processor.process([[input]], [[output]]);
assert.equal(messages.length, 1); assert.equal(messages[0].buffer.byteLength, 3200);
assert.deepEqual(new Uint8Array(messages[0].buffer), new Uint8Array(floatToPcm16(input)));
assert.ok(output.every(value => value === 0), 'The microphone must never feed audible playback.');
assert.ok(messages[0].rms > 0);
messages.length = 0;
processor.process([[new Float32Array([0.5, 1]), new Float32Array([-0.5, -1])]], [[new Float32Array(2)]]);
processor.port.onmessage({ data: { type: 'flush' } });
assert.deepEqual(messages.map(message => message.type), ['pcm', 'flushed']);
assert.deepEqual([...new Int16Array(messages[0].buffer)], [0, 0], 'Stereo channels must be averaged to mono.');
assert.equal(messages[0].buffer.byteLength, 4, 'Flushing must not add an unrecorded zero tail.');

const originals = new Map(['navigator', 'AudioContext', 'AudioWorkletNode', 'WebSocket'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
let closedContexts = 0, closedSockets = 0;
try {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => { throw new Error('Microphone must not open before a handshake.'); } } } });
  globalThis.AudioContext = class { sampleRate = 16000; state = 'running'; audioWorklet = { addModule: async () => {} }; async resume() {} async close() { this.state = 'closed'; closedContexts++; } };
  globalThis.AudioWorkletNode = class {};
  globalThis.WebSocket = class { static OPEN = 1; readyState = 0; close() { this.readyState = 3; closedSockets++; } };
  const client = new LiveDictation({ transcript() {}, phase() {} });
  const starting = client.start({ desktop: true, origin: '', model: 'test', workletUrl: '/test.js' });
  await new Promise(resolve => setTimeout(resolve, 0));
  client.cancel();
  await Promise.race([starting, new Promise((_, reject) => setTimeout(() => reject(new Error('Cancelled connection did not settle.')), 1000))]);
  assert.equal(closedContexts, 1); assert.equal(closedSockets, 1);
  let grantMicrophone, stoppedTracks = 0, connectedSocket;
  navigator.mediaDevices.getUserMedia = () => new Promise(resolve => grantMicrophone = resolve);
  globalThis.WebSocket = class {
    static OPEN = 1; readyState = 1;
    constructor() { connectedSocket = this; queueMicrotask(() => this.onopen?.()); }
    close() { this.readyState = 3; }
  };
  const phases = [];
  const disconnected = new LiveDictation({ transcript() {}, phase(value) { phases.push(value); } });
  const pendingPermission = disconnected.start({ desktop: true, origin: '', model: 'test', workletUrl: '/test.js' });
  await new Promise(resolve => setTimeout(resolve, 0));
  connectedSocket.onmessage({ data: JSON.stringify({ type: 'partial', text: 'Wcześniejszy podgląd' }) });
  connectedSocket.readyState = 3; connectedSocket.onclose({ code: 1006 });
  grantMicrophone({ getTracks: () => [{ stop() { stoppedTracks++; } }] });
  await pendingPermission;
  assert.equal(stoppedTracks, 1, 'A permission result arriving after disconnect must immediately release the device.');
  assert.equal(disconnected.transcript.partial, 'Wcześniejszy podgląd');
  assert.ok(disconnected.transcript.error); assert.ok(phases.includes('error'));
  let workletNode, liveSocket;
  const sentFrames = [];
  navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() { stoppedTracks++; } }] });
  globalThis.AudioContext = class {
    sampleRate = 16000; state = 'running'; destination = {}; audioWorklet = { addModule: async () => {} };
    async resume() {} async close() { this.state = 'closed'; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  };
  globalThis.AudioWorkletNode = class {
    constructor() { workletNode = this; this.port = { close() {}, postMessage: message => { if (message.type === 'flush') queueMicrotask(() => { this.port.onmessage({ data: { type: 'pcm', buffer: new ArrayBuffer(4), rms: 0 } }); this.port.onmessage({ data: { type: 'flushed' } }); }); } }; }
    connect() {} disconnect() {}
  };
  globalThis.WebSocket = class {
    static OPEN = 1; readyState = 1; bufferedAmount = 0;
    constructor() { liveSocket = this; queueMicrotask(() => this.onopen?.()); }
    close() { this.readyState = 3; }
    send(frame) { sentFrames.push(frame); if (frame === 'EOF') queueMicrotask(() => { this.onmessage?.({ data: JSON.stringify({ type: 'final', text: 'Tak.', final_kind: 'summary' }) }); this.readyState = 3; this.onclose?.({ code: 1000 }); }); }
  };
  let complete;
  const completed = new Promise(resolve => complete = resolve);
  const live = new LiveDictation({ transcript() {}, phase(value) { if (value === 'complete') complete(); } });
  await live.start({ desktop: true, origin: '', model: 'test', workletUrl: '/test.js' });
  liveSocket.onmessage({ data: JSON.stringify({ type: 'status', stage: 'ready' }) });
  liveSocket.onmessage({ data: JSON.stringify({ type: 'final', text: 'Tak.', final_kind: 'utterance' }) });
  workletNode.port.onmessage({ data: { type: 'pcm', buffer: new ArrayBuffer(4), rms: 0.2 } });
  await live.stop(); await completed;
  assert.equal(sentFrames.length, 3);
  assert.ok(sentFrames[0] instanceof ArrayBuffer && sentFrames[1] instanceof ArrayBuffer);
  assert.equal(sentFrames[2], 'EOF', 'The final PCM flush must precede EOF.');
  assert.equal(live.transcript.text, 'Tak.'); assert.equal(live.transcript.complete, true);
} finally { for (const [name, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
console.log('Dictation: PASS (strict loopback URLs, PCM16 LE, real worklet framing/flush/mono, authoritative summaries, partial/error handling and cancelled connection cleanup).');
