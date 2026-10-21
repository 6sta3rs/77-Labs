import { mkdir as ensureQaDirectory } from 'node:fs/promises';
await ensureQaDirectory(new URL('../../.tmp/qa/', import.meta.url), { recursive: true });
/** Explicit local QA: streams a supplied speech file; never opens a microphone. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import ts from 'typescript';

const source = await readFile(new URL('../../src/lib/tools/dictation/dictation.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { dictationSocketUrl, emptyDictation, reduceDictationMessage, DICTATION_END } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const speechIndex = process.argv.indexOf('--speech-reference');
assert.ok(speechIndex >= 0 && process.argv[speechIndex + 1], 'Podaj --speech-reference do wlasnej probki mowy. Proceduralny ton UI nie zawiera slow.');
const speechFile = resolve(process.argv[speechIndex + 1]);
const report = { date: new Date().toISOString(), source: 'explicit local speech fixture; not bundled', physicalMicrophone: false, origin: 'Native Node WebSocket client without an Origin header; exact browser Origin is a separate UI check.', frames: [], checks: {} };
let socket;
try {
  const health = await fetch('http://127.0.0.1:4312/health', { signal: AbortSignal.timeout(10000) });
  assert.equal(health.headers.get('x-voicestudio-next'), 'seventy-seven-qa-owned', 'Only the isolated, owned QA backend is allowed.');
  report.checks.ownedBackend = true;
  const model = 'sherpa-whisper-tiny';
  const readiness = await fetch(`http://127.0.0.1:4312/dictation/readiness?model_id=${model}&purpose=dictation`).then(response => response.json());
  assert.equal(readiness.ready, true, 'Install state must be ready before the explicit test.');
  report.checks.modelReady = true;
  const ffmpeg = spawnSync('ffmpeg', ['-v', 'error', '-i', speechFile, '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-'], { maxBuffer: 16 * 1024 * 1024 });
  assert.equal(ffmpeg.status, 0, String(ffmpeg.stderr));
  const pcm = ffmpeg.stdout;
  assert.ok(pcm.length > 4000 && pcm.length % 2 === 0);
  report.pcm = { encoding: 's16le', channels: 1, sampleRate: 16000, bytes: pcm.length, durationSeconds: pcm.length / 32000, sha256: createHash('sha256').update(pcm).digest('hex') };
  report.url = dictationSocketUrl(!process.argv.includes('--proxy'), 'http://127.0.0.1:4310', model, 16000);
  socket = new WebSocket(report.url);
  let state = emptyDictation();
  const waiters = new Set();
  socket.addEventListener('close', event => { if (!state.complete) for (const check of [...waiters]) check(new Error(`WebSocket closed without summary (${event.code}).`)); });
  socket.addEventListener('error', () => { for (const check of [...waiters]) check(new Error('WebSocket connection error.')); });
  socket.addEventListener('message', event => {
    try {
      const frame = JSON.parse(String(event.data)); report.frames.push(frame); state = reduceDictationMessage(state, frame);
      console.log(JSON.stringify(frame));
      for (const check of [...waiters]) check();
    } catch (cause) { for (const check of [...waiters]) check(cause); }
  });
  const waitFrame = (predicate, timeout = 60000) => new Promise((resolve, reject) => {
    const finish = (cause) => {
      const found = report.frames.find(predicate);
      if (cause || state.error || found) { clearTimeout(timer); waiters.delete(finish); if (cause || state.error) reject(cause || new Error(state.error)); else resolve(found); }
    };
    const timer = setTimeout(() => { waiters.delete(finish); reject(new Error('Timed out waiting for a protocol frame.')); }, timeout);
    waiters.add(finish); finish();
  });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('WebSocket handshake timed out.')), 15000); socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true }); socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket connection failed.')); }, { once: true }); });
  await waitFrame(frame => frame.type === 'status' && frame.stage === 'ready', 120000);
  report.checks.statusReady = true;
  for (let offset = 0; offset < pcm.length; offset += 3200) { socket.send(pcm.subarray(offset, offset + 3200)); await new Promise(resolve => setTimeout(resolve, 100)); }
  await waitFrame(frame => frame.type === 'partial' && frame.text || frame.type === 'final' && frame.final_kind === 'utterance' && frame.text, 60000);
  report.checks.realPartialOrUtterance = true;
  const finished = waitFrame(frame => frame.type === 'final' && frame.final_kind === 'summary', 90000);
  socket.send(DICTATION_END);
  await finished;
  assert.equal(state.complete, true); assert.ok(state.text.trim()); assert.equal(state.partial, '');
  report.checks.authoritativeSummary = true;
  report.checks.noDuplicateSummary = state.text === report.frames.findLast(frame => frame.type === 'final' && frame.final_kind === 'summary').text.trim();
  report.final = state;
  report.status = 'PASS';
} catch (cause) { report.status = 'FAIL'; report.error = cause instanceof Error ? cause.message : String(cause); process.exitCode = 1; }
finally { if (socket && socket.readyState < 2) socket.close(); await writeFile(new URL('../../.tmp/qa/dictation-runtime.json', import.meta.url), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ status: report.status, checks: report.checks, error: report.error })); }
