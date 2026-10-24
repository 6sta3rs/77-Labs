/** Startup checklist: stages only read from Rust, the model row follows /model/status, nothing else is invented. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = (await readFile(new URL('../../frontend/src/platform/engine-startup.ts', import.meta.url), 'utf8')).replace(/^import .*$/gm, '');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { awaitingWarmup, startupSteps, readModelWarmup, startupRows, startupFraction, warmupNote } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

const rust = await readFile(new URL('../../desktop/src/runtime.rs', import.meta.url), 'utf8');
const stages = rust.match(/const STAGES: \[&str; \d+\] = \[([^\]]+)\]/)[1].match(/"([^"]+)"/g).map(id => id.slice(1, -1));
assert.deepEqual(startupSteps.slice(0, -1).map(([id]) => id), stages, 'UI step order must mirror STAGES in runtime.rs');
assert.equal(startupSteps.at(-1)[0], 'model');

const states = rows => rows.map(row => row.state[0]).join('');
assert.equal(states(startupRows({ state: 'starting' }, null)), 'apppppppppp', 'no stage reported yet: first step is running');
assert.equal(states(startupRows({ state: 'starting', startup: { stage: 'ml_imports' } }, null)), 'dddddda' + 'pppp', 'steps before the reported one are done');
assert.equal(states(startupRows({ state: 'stopped' }, null)), 'ppppppppppp');
const loading = readModelWarmup({ status: 'loading', loading: true, sub_stage: 'loading_weights', progress: 40 });
const warming = startupRows({ state: 'ready' }, loading);
assert.equal(states(warming), 'dddddddddda');
assert.equal(warming.at(-1).detail, 'Ładowanie wag modelu · 40%');
assert.ok(Math.abs(startupFraction(warming, loading) - (10.4 / 11)) < 1e-9);
const awaiting = startupRows({ state: 'ready' }, awaitingWarmup);
assert.equal(states(awaiting), 'dddddddddda', 'between engine ready and the first warm-up status the model row stays active');
assert.equal(awaiting.at(-1).detail, 'Oczekiwanie na start modelu');
assert.equal(states(startupRows({ state: 'ready' }, readModelWarmup({ loaded: true, status: 'ready' }))), 'ddddddddddd');
assert.equal(startupFraction(startupRows({ state: 'ready' }, { status: 'ready' }), { status: 'ready' }), 1);
assert.equal(readModelWarmup({ status: 'idle', loaded: false }).status, 'idle');
assert.equal(readModelWarmup({ status: 'idle', error: 'boom', sub_stage: 'error' }).status, 'error');
assert.equal(readModelWarmup({ status: 'loading', progress: 500 }).progress, undefined, 'out-of-range progress is ignored');
// Why the model is not warming up (the engine only logs it): derived from the idle state and the catalogues.
const tts = (extra = {}) => ({ active: 'kitten', backends: [{ id: 'kitten', ...extra }] });
const weights = installed => [{ role: 'TTS', installed, engines: ['kitten'] }, { role: 'ASR', installed: true, engines: ['kitten'] }];
const idle = { status: 'idle' };
assert.equal(warmupNote(idle, tts({ license_required: true, license_accepted: false }), weights(true)).text, 'Pominięto: brak akceptacji warunków modelu', 'licence beats a missing download');
assert.equal(warmupNote(idle, tts(), weights(false)).text, 'Pominięto: model nie jest pobrany');
assert.equal(warmupNote(idle, tts(), weights(true)), undefined, 'installed and accepted: no invented reason');
assert.equal(warmupNote(idle, tts(), []), undefined, 'unknown weights: no invented reason');
assert.equal(warmupNote(idle, { active: 'gone', backends: [] }, weights(false)), undefined);
assert.equal(warmupNote({ status: 'loading' }, tts(), weights(false)), undefined, 'a loading model needs no note');
assert.deepEqual(warmupNote({ status: 'error', error: 'boom' }), { text: 'Nie udało się załadować modelu głosowego', detail: 'boom' });
console.log('PASS engine startup checklist');

// The success card must not outlive an engine that stops inside its 3 s window; the running clock stays out of the live region.
const card = await readFile(new URL('../../frontend/src/platform/EngineStartup.svelte', import.meta.url), 'utf8');
assert.match(card, /if \(hide\) \{ clearTimeout\(hide\); finished = false; seen = false; \}/, 'cleanup must reset the finished card');
assert.match(card, /<span class="time" aria-hidden="true">/, 'timer must not be announced every second');
