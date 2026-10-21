import { i18nDeps, i18nRequire } from '../helpers/i18n.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Execute the actual module with isolated storage and controlled transports.
// No browser profile, backend, private data, network, GPU or model is opened.
async function load(dependencies = {}) {
  let source = await readFile(new URL('../../src/lib/tools/automation/automation.ts', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('automation.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const node of [...parsed.statements].reverse()) if (ts.isImportDeclaration(node)) source = source.slice(0, node.pos) + source.slice(node.end);
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const deps = { generate: async () => { throw Error('Unexpected synthesis'); }, request: async () => { throw Error('Unexpected HTTP'); }, prepareRequest: async () => {}, productionJson: async () => { throw Error('Unexpected backend'); }, postJson: body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), ...dependencies };
  const exported = {};
  new Function('exports', ...Object.keys({...i18nDeps,...deps}), code)(exported, ...Object.values({...i18nDeps,...deps}));
  return exported;
}
function memoryStore(initial = {}) {
  const recipes = new Map((initial.recipes || []).map(recipe => [recipe.id, structuredClone(recipe)]));
  const runs = new Map((initial.runs || []).map(run => [run.id, structuredClone(run)]));
  return { recipes: async () => structuredClone([...recipes.values()]), runs: async () => structuredClone([...runs.values()]), putRecipe: async recipe => { recipes.set(recipe.id, structuredClone(recipe)); }, removeRecipe: async id => { recipes.delete(id); }, putRun: async run => { runs.set(run.id, structuredClone(run)); }, removeRun: async id => { runs.delete(id); } };
}
const recipe = (steps = [{ id: 'asr', kind: 'transcribe' }], inputKind = 'audio') => ({ schema: 1, id: 'recipe-one', name: 'Próba lokalna', inputKind, steps, updatedAt: 1 });
function wav() { const bytes = new Uint8Array(48); bytes.set(new TextEncoder().encode('RIFF'), 0); bytes.set(new TextEncoder().encode('WAVE'), 8); return new Blob([bytes], { type: 'audio/wav' }); }
const audio = () => ({ kind: 'audio', blob: wav(), name: 'fixture.wav' });
const operations = (change = {}) => ({ transcribe: async () => ({ kind: 'text', text: 'Tekst z nagrania.', language: 'pl' }), speak: async () => ({ kind: 'audio', blob: wav(), name: 'result.wav' }), translate: async () => ({ kind: 'text', text: 'Hello.', language: 'en' }), convert: async () => audio(), ...change });
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
async function idle(service) { for (let i = 0; i < 200; i++) { if (!service.snapshot().runs.some(run => ['queued', 'running', 'stopping'].includes(run.status))) return; await new Promise(resolve => setImmediate(resolve)); } throw Error('Fixture queue did not become idle'); }
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('Recipe validation rejects type mismatches, executable steps and remote translation', async () => {
  const api = await load();
  assert.throws(() => api.validateRecipe(recipe([{ id: 'speech', kind: 'speak', voiceId: 'voice' }])));
  assert.throws(() => api.validateRecipe(recipe([{ id: 'shell', kind: 'shell', command: 'execute' }])));
  assert.throws(() => api.validateRecipe(recipe([{ id: 'translate', kind: 'translate', provider: 'google', language: 'en' }], 'text')));
  assert.throws(() => api.validateRecipe(recipe([{ id: 'translate', kind: 'translate', provider: 'argos', language: 'en', sourceLanguage: 'https://invalid' }], 'text')));
  assert.throws(() => api.validateAutomationInput({ kind: 'audio', blob: wav(), name: 'voice.wav.exe' }, recipe()));
  assert.throws(() => api.validateAutomationInput({ kind: 'text', text: 'a'.repeat(20001) }, recipe([{ id: 'tts', kind: 'speak', voiceId: 'voice' }], 'text')));
});

test('Sequential execution snapshots recipe and input, then stores the actual Blob result', async () => {
  const api = await load(); const store = memoryStore(); const seen = [];
  const service = api.createAutomationService({ store, operations: operations({ transcribe: async input => { seen.push(input.name); return { kind: 'text', text: 'Próba.' }; }, speak: async (_input, step) => { seen.push(step.voiceId); return { kind: 'audio', blob: wav(), name: 'result.wav' }; } }) });
  const config = recipe([{ id: 'asr', kind: 'transcribe' }, { id: 'tts', kind: 'speak', voiceId: 'original-voice', language: 'Polish' }]);
  const input = audio();
  const id = await service.enqueue(config, input);
  config.steps[1].voiceId = 'later-edit'; input.name = 'later-edit.wav';
  await idle(service);
  assert.deepEqual(seen, ['fixture.wav', 'original-voice']);
  const saved = (await store.runs()).find(run => run.id === id);
  assert.equal(saved.status, 'done'); assert.equal(saved.completedSteps, 2); assert(saved.result.blob instanceof Blob);
  assert.deepEqual(new Uint8Array(await saved.result.blob.arrayBuffer()), new Uint8Array(await wav().arrayBuffer()));
});

test('Stop waits for the active request, skips later steps and blocks duplicate retry while stopping', async () => {
  const api = await load(); const pending = deferred(); let syntheses = 0;
  const service = api.createAutomationService({ store: memoryStore(), operations: operations({ transcribe: async () => { await pending.promise; return { kind: 'text', text: 'Krok skończony.' }; }, speak: async () => { syntheses++; return audio(); } }) });
  const id = await service.enqueue(recipe([{ id: 'asr', kind: 'transcribe' }, { id: 'tts', kind: 'speak', voiceId: 'voice' }]), audio());
  await settle(); await service.cancel(id);
  assert.equal(service.snapshot().runs[0].status, 'stopping');
  await assert.rejects(service.retry(id));
  pending.resolve(); await idle(service);
  const run = service.snapshot().runs[0];
  assert.equal(run.status, 'cancelled'); assert.equal(run.completedSteps, 1); assert.equal(syntheses, 0); assert.equal(run.result.text, 'Krok skończony.');
});

test('Cancelling a queued item does not invoke its backend operation', async () => {
  const api = await load(); const pending = deferred(); let calls = 0;
  const service = api.createAutomationService({ store: memoryStore(), operations: operations({ transcribe: async () => { calls++; await pending.promise; return { kind: 'text', text: 'Wynik.' }; } }) });
  await service.enqueue(recipe(), audio()); await settle();
  const queued = await service.enqueue(recipe(), audio()); await service.cancel(queued);
  pending.resolve(); await idle(service);
  assert.equal(calls, 1); assert.equal(service.snapshot().runs.find(run => run.id === queued).status, 'cancelled');
});

test('Retry creates a new tracked attempt and preserves the failed evidence', async () => {
  const api = await load(); let calls = 0;
  const service = api.createAutomationService({ store: memoryStore(), operations: operations({ transcribe: async () => { if (++calls === 1) throw Error('Fixture error'); return { kind: 'text', text: 'Ponowiono.' }; } }) });
  const first = await service.enqueue(recipe(), audio()); await idle(service);
  assert.equal(service.snapshot().runs.find(run => run.id === first).status, 'failed');
  const second = await service.retry(first); await idle(service);
  assert.notEqual(first, second); assert.equal(service.snapshot().runs.find(run => run.id === second).attempt, 2);
  assert.equal(service.snapshot().runs.find(run => run.id === first).error, 'Fixture error');
});

test('A transport timeout pauses later inputs instead of duplicating uncertain backend work', async () => {
  const api = await load(); const pending = deferred(); let calls = 0;
  const service = api.createAutomationService({ store: memoryStore(), operations: operations({ transcribe: async () => { calls++; await pending.promise; throw new DOMException('Fixture timeout', 'TimeoutError'); } }) });
  await service.enqueue(recipe(), audio()); await settle();
  await service.enqueue(recipe(), audio()); pending.resolve(); await idle(service);
  assert.equal(calls, 1); assert(service.snapshot().runs.every(run => run.status === 'interrupted'));
});

test('Recovery preserves inputs and marks unfinished work interrupted without rerunning it', async () => {
  const api = await load(); let calls = 0;
  const interrupted = { id: 'interrupted', recipe: recipe(), input: audio(), status: 'running', stepIndex: 0, completedSteps: 0, error: '', createdAt: 1, updatedAt: 1, attempt: 1 };
  const store = memoryStore({ runs: [interrupted] });
  const service = api.createAutomationService({ store, operations: operations({ transcribe: async () => { calls++; return { kind: 'text', text: 'Wrong' }; } }) });
  await service.initialize(); await settle();
  assert.equal(calls, 0); assert.equal(service.snapshot().runs[0].status, 'interrupted'); assert((await store.runs())[0].input.blob instanceof Blob);
});

test('Storage failures never start untracked processing', async () => {
  const api = await load(); let calls = 0; const store = memoryStore(); store.putRun = async () => { throw Error('Fixture quota'); };
  const service = api.createAutomationService({ store, operations: operations({ transcribe: async () => { calls++; return { kind: 'text', text: 'Wrong' }; } }) });
  await assert.rejects(service.enqueue(recipe(), audio()), /quota/); assert.equal(calls, 0); assert.equal(service.snapshot().runs.length, 0);
});

test('Leaving the UI does not abort or lose the saved operation', async () => {
  const api = await load(); const pending = deferred(); const store = memoryStore();
  const service = api.createAutomationService({ store, operations: operations({ transcribe: async () => { await pending.promise; return { kind: 'text', text: 'Po zmianie widoku.' }; } }) });
  const unsubscribe = service.subscribe(() => {}); await service.enqueue(recipe(), audio()); await settle(); unsubscribe(); pending.resolve(); await idle(service);
  assert.equal((await store.runs())[0].result.text, 'Po zmianie widoku.');
});

test('Actual ASR adapter uses readiness, reference mode and explicitly disables refinement', async () => {
  const calls = []; const api = await load({ productionJson: async (path, options) => { calls.push([path, options]); return path.includes('readiness') ? { ready: true } : { text: 'Rzeczywisty kontrakt.', language: 'pl' }; } });
  const result = await api.automationOperations.transcribe(audio(), { id: 'asr', kind: 'transcribe' });
  assert.equal(result.text, 'Rzeczywisty kontrakt.'); assert.equal(calls[0][0], '/dictation/readiness?purpose=transcribe');
  assert.equal(calls[1][1].body.get('mode'), 'reference'); assert.equal(calls[1][1].body.get('refine'), 'false');
});

test('Actual TTS adapter uses the selected engine and validates its returned WAV', async () => {
  let generated; const api = await load({ productionJson: async () => ({ active: 'selected-local-engine' }), generate: async input => { generated = input; return { blob: wav() }; } });
  const result = await api.automationOperations.speak({ kind: 'text', text: 'Test.' }, { id: 'tts', kind: 'speak', voiceId: 'voice-one', language: 'Polish', speed: 1.1 });
  assert.equal(generated.engine, 'selected-local-engine'); assert.equal(generated.profileId, 'voice-one'); assert.equal(result.kind, 'audio');
  const bad = await load({ productionJson: async () => ({ active: 'fixture' }), generate: async () => ({ blob: new Blob([new Uint8Array(100)], { type: 'audio/wav' }) }) });
  await assert.rejects(bad.automationOperations.speak({ kind: 'text', text: 'Test.' }, { id: 'tts', kind: 'speak' }), /WAV/);
});

test('Actual conversion refuses foreign result URLs and translation forbids remote providers', async () => {
  let requests = 0; const api = await load({ productionJson: async () => ({ audio_url: 'https://external.invalid/file.wav' }), request: async () => { requests++; return new Response(wav()); } });
  await assert.rejects(api.automationOperations.convert(audio(), { id: 'convert', kind: 'convert', voiceId: 'voice' }), /ścieżkę/); assert.equal(requests, 0);
  await assert.rejects(api.automationOperations.translate({ kind: 'text', text: 'Test.' }, { id: 'translate', kind: 'translate', provider: 'google', language: 'en' }), /lokalny/);
});

test('Actual local translation fixes provider and disables glossary/reflection/condensing', async () => {
  let body; const api = await load({ productionJson: async (_path, options) => { body = JSON.parse(options.body); return { translated: [{ id: 'automation', text: 'Hello.' }] }; } });
  const result = await api.automationOperations.translate({ kind: 'text', text: 'Witaj.', language: 'pl' }, { id: 'translate', kind: 'translate', provider: 'argos', language: 'en', sourceLanguage: 'auto' });
  assert.equal(body.source_lang, 'pl'); assert.equal(body.provider, 'argos'); assert.equal(body.auto_glossary, false); assert.equal(body.reflect, false); assert.equal(body.condense, false); assert.equal(result.text, 'Hello.');
});

let failed = 0;
for (const { name, fn } of tests) {
  try { await fn(); process.stdout.write(`PASS ${name}\n`); }
  catch (error) { failed++; process.stderr.write(`FAIL ${name}\n${error.stack}\n`); }
}
process.stdout.write(`Automation: ${tests.length - failed}/${tests.length} PASS\n`);
if (failed) process.exitCode = 1;
