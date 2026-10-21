import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const helpersSource = await readFile(new URL('../../src/lib/tools/production/production-segments.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(helpersSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const helpers = {}; new Function('exports', code)(helpers);
const segment = { id: 'qa', start: 0, end: 3.4, text: 'Cześć.', direction: 'calm', speed: 0.8, gain: 0.7 };
assert.doesNotThrow(() => helpers.validateDubSegments([segment], 'voice'));
for (const change of [{ start: -1 }, { end: 0 }, { end: NaN }, { text: ' ' }, { speed: 0 }]) assert.throws(() => helpers.validateDubSegments([{ ...segment, ...change }], 'voice'));
assert.throws(() => helpers.validateDubSegments([segment], ''));
assert.throws(() => helpers.validateDubSegments([segment, { ...segment, start: 2, end: 4 }], 'voice'));
const payload = helpers.dubRequestSegments([segment], 'voice', 'pl', 1);
assert.equal(payload[0].speed, 0.8); assert.equal(payload[0].direction, 'calm'); assert.equal(payload[0].gain, 0.7); assert.equal(payload[0].profile_id, 'voice');
const video = new URL(helpers.dubExportPath('qa/id', 'pl', 'video', true, true, true, false), 'http://localhost');
assert.equal(video.pathname, '/dub/download/qa%2Fid'); assert.equal(video.searchParams.get('include_tracks'), 'pl'); assert.equal(video.searchParams.get('burn_subs'), 'true'); assert.equal(video.searchParams.get('preserve_bg'), 'true');
assert.match(helpers.dubExportPath('qa', 'pl', 'mp3', false, false, false, false), /^\/dub\/download-mp3\/qa\?/);
const bookJob = { job_id: 'qa-book', type: 'audiobook', status: 'cancelled', title: 'QA', total_chapters: 2, chapters_done: 1 };
const idleActivity = { busy: false, longform_draining: 0, reason: null, physical: { gpu_running: 0, gpu_queued: 0, model_loading: false } };
for (const status of ['queued', 'pending', 'running', 'processing', 'cancelling', 'done', 'unknown']) assert.equal(helpers.bookCanResume({ ...bookJob, status }), false);
for (const status of ['cancelled', 'failed', 'interrupted']) assert.equal(helpers.bookCanResume({ ...bookJob, status }), true);
assert.equal(helpers.bookCanResume({ ...bookJob, type: 'story' }), false);
assert.equal(helpers.bookJobsBusy([{ ...bookJob, status: 'running' }]), true);
assert.equal(helpers.bookDrainState([bookJob], undefined, bookJob.job_id), 'unavailable', 'A terminal job without physical evidence does not clear a local cancellation barrier.');
assert.equal(helpers.bookDrainState([{ ...bookJob, status: 'running' }], idleActivity, bookJob.job_id), 'draining');
assert.equal(helpers.bookDrainState([bookJob], { ...idleActivity, physical: { ...idleActivity.physical, gpu_running: 1 } }, bookJob.job_id), 'draining');
assert.equal(helpers.bookDrainState([bookJob], { ...idleActivity, longform_draining: 1 }, bookJob.job_id), 'draining');
assert.equal(helpers.bookDrainState([bookJob], idleActivity, bookJob.job_id), 'confirmed');
const ownershipFixture = 'qa-ephemeral-owner-fixture';
const ownershipCalls = [];
const activity = await helpers.readLongformActivity(async (path, options) => {
  ownershipCalls.push(path);
  if (path === '/health') return new Response('{}', { headers: { 'X-VoiceStudio-Next': ownershipFixture } });
  assert.equal(options.headers['X-VoiceStudio-Next'], ownershipFixture);
  return Response.json({ ...idleActivity, token: ownershipFixture });
}, new AbortController().signal);
assert.deepEqual(ownershipCalls, ['/health', '/next/activity']); assert.deepEqual(activity, idleActivity);
assert.ok(!JSON.stringify(activity).includes(ownershipFixture), 'The ownership marker is absent from returned state.');
assert.equal(await helpers.readLongformActivity(async () => new Response('{}'), new AbortController().signal), undefined);

let source = (await readFile(new URL('../../src/lib/tools/production/ProductionWorkspace.svelte', import.meta.url), 'utf8')).match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
const parsed = ts.createSourceFile('production.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
for (const node of [...parsed.statements].reverse()) if (ts.isImportDeclaration(node)) source = source.slice(0, node.pos) + source.slice(node.end);
source += `\nreturn { generateDub, renderBook, resumeBook, stopProduction, event, setFixture(){ jobId='qa-job'; voice='qa-voice'; text='QA chapter'; plan={chapter_count:2,char_count:10,chapters:[]}; segments=[{start:0,end:3,text:'Cześć'}] }, get result(){return {error,message,busy,done,cancelled,completed,total,bookDrain,drainMessage,drainChecking,resumable}} };`;
const componentCode = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let emit, resolveStream; const stream = new Promise(resolve => resolveStream = resolve); const calls = [];
const props = Object.assign(() => ({ kind: 'dubbing', ready: true, onnotify() {} }), { id: () => 'qa' });
const dependencies = { $state: value => value, $derived: value => value, $props: props, $effect() {}, onDestroy() {}, ...helpers,
  currentGeneralPreferences: () => ({ reviewMode: true, translationQuality: 'fast' }),
  productionJson: async (path, options) => { calls.push({ path, options }); if (path.startsWith('/tasks/cancel/')) { emit({ type: 'cancelled' }); resolveStream(); return {cancelled:true} } return { task_id: 'qa-task' }; },
  postJson: (body, signal) => ({ body: JSON.stringify(body), signal }),
  productionLanguages: [{ value: 'pl', tts: 'Polish' }],
  productionStream: async (_path, _options, listener) => { emit = listener; await stream; },
};
const component = new Function(...Object.keys(dependencies), componentCode)(...Object.values(dependencies));
component.setFixture(); const render = component.generateDub();
for (let i = 0; i < 8; i++) await Promise.resolve();
await component.stopProduction(); await render;
assert.ok(calls.some(row => row.path === '/tasks/cancel/qa-task'), 'Cancel reaches the actual backend task.');
assert.equal(component.result.error, ''); assert.equal(component.result.done, false); assert.equal(component.result.cancelled, true); assert.equal(component.result.busy, false);
component.event({ type: 'progress', current: 1, total: 2 }); component.event({ type: 'done' });
assert.equal(component.result.completed, 2, 'Completed progress reaches its real total.');

let physicalBusy = true, jobStatus = 'running', bookStreamCount = 0;
const bookCalls = [];
const bookProps = Object.assign(() => ({ kind: 'audiobooks', ready: true, onnotify() {} }), { id: () => 'qa-book-component' });
const bookDependencies = { ...dependencies, $props: bookProps, profiles: async () => [],
  productionJson: async (path, options) => {
    bookCalls.push({ path, method: options?.method || 'GET' });
    if (path === '/audiobook/jobs') return { jobs: [{ ...bookJob, status: jobStatus }] };
    if (path === '/projects') return [];
    if (path.startsWith('/longform/jobs')) return { jobs: [] };
    throw new Error('Unexpected fixture request: ' + path);
  },
  request: async path => path === '/health' ? new Response('{}', { headers: { 'X-VoiceStudio-Next': ownershipFixture } }) : Response.json({ ...idleActivity, busy: physicalBusy, reason: physicalBusy ? 'longform-draining' : null, longform_draining: physicalBusy ? 1 : 0, physical: { ...idleActivity.physical, gpu_running: physicalBusy ? 1 : 0 } }),
  productionStream: async (path, options, listener) => {
    bookCalls.push({ path, method: options.method }); bookStreamCount++;
    listener({ type: 'started', job_id: 'qa-book', chapters: 2 });
    if (bookStreamCount > 1) { listener({ type: 'done', output: 'qa-book.mp3' }); return; }
    await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  },
};
const book = new Function(...Object.keys(bookDependencies), componentCode)(...Object.values(bookDependencies));
book.setFixture(); const bookRendering = book.renderBook();
for (let i = 0; i < 8; i++) await Promise.resolve();
await book.stopProduction(); await bookRendering;
assert.equal(book.result.busy, false); assert.equal(book.result.bookDrain, true);
assert.doesNotMatch(book.result.message, /Zatrzymano render/, 'Closing SSE does not declare the physical render stopped.');
await book.resumeBook(bookJob.job_id);
assert.equal(bookStreamCount, 1, 'Resume is blocked throughout the actual drain.');
assert.ok(bookCalls.some(row => row.path === '/audiobook/jobs'), 'Cancelled render refreshes the durable checkpoint list.');
physicalBusy = false; jobStatus = 'cancelled';
const deadline = Date.now() + 2500;
while (book.result.bookDrain && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(book.result.bookDrain, false, 'Only idle physical evidence and the terminal job clear the barrier.');
jobStatus = 'running'; await book.resumeBook(bookJob.job_id);
assert.equal(bookStreamCount, 1, 'Fresh preflight rejects a running job even when a stale card was clickable.');
jobStatus = 'cancelled'; await book.resumeBook(bookJob.job_id);
assert.equal(bookStreamCount, 2, 'Confirmed cancelled checkpoint can resume with a new SSE request.');
assert.equal(book.result.done, true);
console.log('Production contracts PASS: segments, exports, task cancellation, ephemeral ownership probe, physical audiobook drain, checkpoint refresh and running-job resume rejection.');
