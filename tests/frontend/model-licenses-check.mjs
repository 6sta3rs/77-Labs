import { i18nDeps, i18nRequire } from '../helpers/i18n.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { compile } from 'svelte/compiler';
import * as reactivity from 'svelte/internal/client';

const source = await readFile(new URL('../../src/lib/models/model-licenses.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const helpers = {}; new Function('exports','require',code)(helpers,i18nRequire);
const repo = 'qa-public/fixture-model', fingerprint = 'v2:' + 'a'.repeat(64), nextFingerprint = 'v2:' + 'b'.repeat(64);
const detail = { repo_id: repo, info: { license: 'NOASSERTION', license_category: 'unknown', notes: 'Public fixture; no rights assertion.', variants: [], source_url: 'https://example.org/model', evidence_url: 'https://example.org/terms' }, acceptance: { repo_id: repo, license: 'NOASSERTION', category: 'unknown', required: true, accepted: false, state: 'not_accepted', fingerprint }, history: [] };
assert.equal(helpers.validModelRepo(repo), true);
for (const invalid of ['../escape', 'https://example.org/model', 'a/..', 'a/b?key=secret', 'a/b\nc', 'a/b/c']) assert.equal(helpers.validModelRepo(invalid), false);
assert.equal(helpers.licenseLink('javascript:alert(1)'), ''); assert.equal(helpers.licenseLink('https://user:secret@example.org/model'), '');
assert.equal(helpers.licenseLink('https://example.org/license'), 'https://example.org/license');
assert.deepEqual(helpers.requiredLicenseRepos([{repo_id:repo},{repo_id:'eustlb/higgs-audio-v2-tokenizer'},{repo_id:repo},{repo_id:'https://invalid'}]),[repo,'eustlb/higgs-audio-v2-tokenizer']);
assert.match(helpers.licenseCategoryLabel('unknown'), /Nieustalona/); assert.equal(helpers.licenseText('NOASSERTION'), 'NOASSERTION');
assert.throws(() => helpers.parseModelLicenseDetails({ ...detail, acceptance: { ...detail.acceptance, fingerprint: 'old-hash' } }, repo));
assert.throws(() => helpers.parseModelLicenseDetails({ ...detail, repo_id: 'other/model' }, repo));
assert.throws(() => helpers.parseModelLicenseDetails({ ...detail, info: { variants: [null] } }, repo));
assert.throws(() => helpers.parseModelLicenseDetails({ ...detail, history: [null] }, repo));
const blocked = helpers.modelLicenseFailure({ detail: { code: 'model_licence_required', models: [{ repo_id: repo, license: 'NOASSERTION', category: 'unknown', fingerprint }] } }, 403);
assert.equal(blocked.code, 'model_licence_required'); assert.match(blocked.message, /NOASSERTION/); assert.match(blocked.message, /Ustawienia → Modele → Warunki modelu/);
assert.equal(helpers.modelLicenseFailure({ detail: { code: 'other' } }, 403), undefined);
assert.equal(helpers.modelLicenseFailure({ detail: { code: 'model_licence_required' } }, 500), undefined);
assert.equal(helpers.modelLicenseFailure({ code: 'model_licence_required', models: [{ repo_id: 'https://secret.invalid', license: 'other' }] }, 403).models.length, 0);

const calls = [];
const service = new helpers.ModelLicenseService(async (path, options) => {
  calls.push({ path, options });
  return Response.json(path.includes('/details/') ? detail : detail.acceptance);
});
assert.equal(calls.length, 0, 'Construction has no network or acceptance side effects.');
await service.details(repo);
assert.equal(calls.length, 1); assert.equal(calls[0].path, '/models/licenses/details/qa-public%2Ffixture-model');
await assert.rejects(service.accept(detail, false), /Potwierdź/);
assert.equal(calls.length, 1, 'No POST without explicit confirmation.');
await service.accept(detail, true);
assert.deepEqual(JSON.parse(calls[1].options.body), { repo_id: repo, fingerprint, accepted: true });
assert.equal(calls[1].path, '/models/licenses/accept');
await service.revoke(repo);
assert.deepEqual(JSON.parse(calls[2].options.body), { repo_id: repo });
const changed = new helpers.ModelLicenseService(async () => Response.json({ detail: { code: 'terms_changed' } }, { status: 409 }));
await assert.rejects(changed.accept(detail, true), error => error instanceof helpers.ModelLicenseTermsChangedError);
const unsupported = new helpers.ModelLicenseService(async () => new Response('', { status: 404 }));
await assert.rejects(unsupported.details(repo), /0\.5\.7/);

let componentSource = (await readFile(new URL('../../src/lib/models/ModelLicenseReview.svelte', import.meta.url), 'utf8')).match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
const parsed = ts.createSourceFile('review.ts', componentSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
for (const node of [...parsed.statements].reverse()) if (ts.isImportDeclaration(node)) componentSource = componentSource.slice(0, node.pos) + componentSource.slice(node.end);
componentSource += `\nreturn {load,decide,agree(value){agreed=value},withdraw(value){withdrawing=value},get result(){return {details,agreed,withdrawing,error,message,busy,loading}}};`;
const componentCode = ts.transpileModule(componentSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(termsChange = false, hooks = {}) {
  const requests = [], changedDetails = [], reviewedDetails = [], busyChanges = []; let current = structuredClone(detail), changedNotifications = 0, destroy;
  const props = Object.assign(() => ({ ready: hooks.ready ?? true, repoId: repo, onchanged(value) { changedNotifications++; changedDetails.push(structuredClone(value)); return hooks.onchanged?.(value); }, onreviewed(value) { reviewedDetails.push(structuredClone(value)); }, onbusychange(value) { busyChanges.push(value); } }), { id: () => 'qa-review' });
  const dependencies = { ...helpers, $state: value => value, $derived: value => value, $props: props, $effect() {}, onDestroy(callback) { destroy = callback; }, untrack: callback => callback(), prepareRequest: async () => { hooks.onprepare?.(); }, request: async (path, options) => {
    requests.push({ path, method: options?.method || 'GET', signal: options?.signal });
    if (path.includes('/details/')) { await hooks.onread?.(current); return Response.json(current); }
    if (path === '/models/licenses/accept') {
      await hooks.onwrite?.();
      if (termsChange) { current = { ...current, acceptance: { ...current.acceptance, fingerprint: nextFingerprint, state: 'terms_updated' } }; return Response.json({ detail: { code: 'terms_changed' } }, { status: 409 }); }
      current = { ...current, acceptance: { ...current.acceptance, accepted: true, state: 'accepted' }, history: [{ action: 'accepted', fingerprint }] };
      return Response.json(current.acceptance);
    }
    if (path === '/models/licenses/revoke') { current = { ...current, acceptance: { ...current.acceptance, accepted: false, state: 'withdrawn' } }; return Response.json(current.acceptance); }
    throw new Error('Unexpected fixture request');
  } };
  const component = new Function(...Object.keys({...i18nDeps,...dependencies}), componentCode)(...Object.values({...i18nDeps,...dependencies}));
  return { component, requests, changedDetails, reviewedDetails, busyChanges, destroy: () => destroy(), get changedNotifications() { return changedNotifications; } };
}
const review = fixture(); await review.component.load();
assert.equal(review.requests.filter(row => row.method === 'POST').length, 0);
assert.equal(review.reviewedDetails.length, 1); assert.deepEqual(review.reviewedDetails[0], detail);
await review.component.decide('accept'); assert.equal(review.requests.length, 1, 'UI checkbox starts unchecked and cannot accept on load.');
review.component.agree(true); await review.component.decide('accept');
assert.equal(review.component.result.details.acceptance.state, 'accepted'); assert.equal(review.component.result.agreed, false); assert.equal(review.changedNotifications, 1);
assert.equal(review.changedDetails[0].acceptance.state, 'accepted');
assert.equal(review.reviewedDetails.at(-1).acceptance.state, 'accepted');
assert.deepEqual(review.busyChanges, [true, false]);
await review.component.decide('revoke'); assert.equal(review.requests.filter(row => row.method === 'POST').length, 1, 'Revocation also requires an explicit second action.');
review.component.withdraw(true); await review.component.decide('revoke');
assert.equal(review.component.result.details.acceptance.state, 'withdrawn');
assert.equal(review.reviewedDetails.at(-1).acceptance.state, 'withdrawn');
const updated = fixture(true); await updated.component.load(); updated.component.agree(true); await updated.component.decide('accept');
assert.equal(updated.requests.filter(row => row.method === 'POST').length, 1, 'Changed terms never trigger an automatic retry.');
assert.equal(updated.component.result.agreed, false); assert.equal(updated.component.result.details.acceptance.fingerprint, nextFingerprint); assert.match(updated.component.result.error, /zmieniły/);
assert.equal(updated.reviewedDetails.at(-1).acceptance.fingerprint, nextFingerprint); assert.equal(updated.reviewedDetails.at(-1).acceptance.state, 'terms_updated');
assert.match(updated.component.result.error, /Wczytano aktualne informacje/);
assert.deepEqual(updated.busyChanges, [true, false]); assert.equal(updated.changedNotifications, 0);
const updatedUnread = fixture(true, { onread(current) { if (current.acceptance.state === 'terms_updated') throw new Error('Fixture updated details unavailable'); } });
await updatedUnread.component.load(); updatedUnread.component.agree(true); await updatedUnread.component.decide('accept');
assert.equal(updatedUnread.reviewedDetails.length, 1, 'A failed 409 refresh must not publish an invented new state to the parent.');
assert.equal(updatedUnread.component.result.details, undefined); assert.match(updatedUnread.component.result.error, /Odśwież informacje/);
assert.doesNotMatch(updatedUnread.component.result.error, /Wczytano aktualne informacje/); assert.equal(updatedUnread.changedNotifications, 0);
console.log('Model licences PASS: exact fingerprints, explicit per-model decisions, unchecked UI, 409 reset without retry, two-action revocation, source links, unknown/NOASSERTION and readable 403. All mutations use fixtures only.');

function deferred() { let resolve, reject; const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; }); return { promise, resolve, reject }; }
let preparations = 0;
const offline = fixture(false, { ready: false, onprepare() { preparations++; } });
await offline.component.load(); await offline.component.decide('accept');
assert.equal(preparations, 0); assert.equal(offline.requests.length, 0, 'An unopened runtime must not be started by the first-entry review.');
assert.equal(offline.reviewedDetails.length, 0);

const writing = deferred(), written = deferred(), notified = deferred(), reconciled = deferred();
const pendingReview = fixture(false, { onwrite() { writing.resolve(); return written.promise; }, onchanged() { notified.resolve(); return reconciled.promise; } });
await pendingReview.component.load(); pendingReview.component.agree(true);
const save = pendingReview.component.decide('accept'); await writing.promise;
assert.deepEqual(pendingReview.busyChanges, [true]); assert.equal(pendingReview.changedNotifications, 0);
const savingSignal = pendingReview.requests.at(-1).signal;
await pendingReview.component.load();
assert.equal(pendingReview.requests.length, 2, 'A concurrent refresh must not abort or replace the in-flight decision.');
assert.equal(savingSignal.aborted, false); assert.equal(pendingReview.component.result.busy, true);
written.resolve(); await notified.promise;
assert.equal(pendingReview.changedDetails[0].acceptance.state, 'accepted', 'The parent receives the authoritative follow-up GET, never a successful POST assumption.');
assert.equal(pendingReview.component.result.busy, true, 'Parent reconciliation remains inside the modal write lock.');
reconciled.resolve(); await save; assert.deepEqual(pendingReview.busyChanges, [true, false]);

const unverified = fixture(false, { onread(current) { if (current.acceptance.accepted) throw new Error('Fixture authoritative read failed'); } });
await unverified.component.load(); unverified.component.agree(true); await unverified.component.decide('accept');
assert.equal(unverified.changedNotifications, 0); assert.equal(unverified.component.result.message, '');
assert.equal(unverified.reviewedDetails.length, 1, 'A successful POST followed by a failed GET must not publish an accepted row.');
assert.match(unverified.component.result.error, /authoritative read failed/); assert.deepEqual(unverified.busyChanges, [true, false]);

const closing = deferred(), finishWrite = deferred();
const destroyedReview = fixture(false, { onwrite() { closing.resolve(); return finishWrite.promise; } });
await destroyedReview.component.load(); destroyedReview.component.agree(true);
const discardedSave = destroyedReview.component.decide('accept'); await closing.promise;
destroyedReview.destroy(); assert.deepEqual(destroyedReview.busyChanges, [true, false]);
finishWrite.resolve(); await discardedSave;
assert.equal(destroyedReview.changedNotifications, 0, 'Aborting a request after dispatch must not be reported as a saved or rolled-back decision.');
assert.equal(destroyedReview.reviewedDetails.length, 1, 'A disposed review must not publish a late authoritative read.');
assert.equal(destroyedReview.component.result.message, ''); assert.equal(destroyedReview.component.result.error, '');
assert.deepEqual(destroyedReview.busyChanges, [true, false], 'Teardown clears the parent lock exactly once; late completion stays silent.');

const callbackStarted = deferred(), callbackDone = deferred();
const lateCallback = fixture(false, { onchanged() { callbackStarted.resolve(); return callbackDone.promise; } });
await lateCallback.component.load(); lateCallback.component.agree(true);
const notifyingSave = lateCallback.component.decide('accept'); await callbackStarted.promise;
lateCallback.destroy(); const beforeLateFailure = lateCallback.component.result.message;
callbackDone.reject(new Error('Fixture disposed parent')); await notifyingSave;
assert.equal(lateCallback.component.result.message, beforeLateFailure, 'Late parent reconciliation errors cannot update a disposed review.');
assert.deepEqual(lateCallback.busyChanges, [true, false]);
console.log('Onboarding review PASS: no cold-runtime calls, authoritative callback payload, busy through reconciliation, refresh/write exclusion, failed read without success and abort/teardown without late notifications. Fixtures only; no real backend POST.');

// Execute the compiler's real script/effects with Svelte's scheduler. Omit only
// DOM rendering: this catches a missing busy dependency, unlike the plain-script
// service fixtures above. No browser, backend or consent store is involved.
const compiledReview = compile(await readFile(new URL('../../src/lib/models/ModelLicenseReview.svelte', import.meta.url), 'utf8'), { filename: 'ModelLicenseReview.svelte', generate: 'client' }).js.code;
const compiledTree = ts.createSourceFile('compiled-review.js', compiledReview, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const compiledFactory = compiledTree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ModelLicenseReview');
assert.ok(compiledFactory?.body);
const renderingStart = compiledFactory.body.statements.findIndex(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(compiledTree) === 'section'));
assert.ok(renderingStart > 0, 'The compiler output separates its script/effects from the first rendered section.');
const compiledScript = compiledFactory.body.statements.slice(0, renderingStart).filter(node => !ts.isVariableStatement(node) || !node.declarationList.declarations.some(declaration => declaration.name.getText(compiledTree) === 'uid')).map(node => node.getText(compiledTree)).join('\n');
const otherRepo = 'qa-public/fixture-tokenizer';
const otherDetail = { ...structuredClone(detail), repo_id: otherRepo, acceptance: { ...detail.acceptance, repo_id: otherRepo, fingerprint: nextFingerprint } };
const transitionCalls = [], firstRead = deferred(), nextRead = deferred(), parentChanged = deferred(), parentFinished = deferred();
let transitionCurrent = structuredClone(detail), transitionReview, transitionDestroy;
const transitionProps = reactivity.proxy({ ready: true, repoId: repo, onreviewed(value) { if (value.repo_id === otherRepo) nextRead.resolve(value); else firstRead.resolve(value); }, onchanged() { transitionProps.repoId = otherRepo; reactivity.flush(); parentChanged.resolve(); return parentFinished.promise; } });
const { $uiLanguage: _unusedStoreValue, ...i18nStoreDeps } = i18nDeps; // compiled Svelte declares $uiLanguage itself
const compiledDependencies = { ...i18nStoreDeps, ...helpers, $: reactivity, $$props: transitionProps, untrack: reactivity.untrack, onDestroy(callback) { transitionDestroy = callback; }, prepareRequest: async () => {}, request: async (path, options) => {
  transitionCalls.push({ path, method: options?.method || 'GET' });
  if (path === `/models/licenses/details/${encodeURIComponent(repo)}`) return Response.json(transitionCurrent);
  if (path === `/models/licenses/details/${encodeURIComponent(otherRepo)}`) return Response.json(otherDetail);
  if (path === '/models/licenses/accept') { assert.equal(JSON.parse(options.body).repo_id, repo); transitionCurrent = { ...transitionCurrent, acceptance: { ...transitionCurrent.acceptance, accepted: true, state: 'accepted' } }; return Response.json(transitionCurrent.acceptance); }
  throw Error('Unexpected reactive fixture request');
} };
const instantiateReview = new Function(...Object.keys(compiledDependencies), `${compiledScript}\n$.pop();return {decide,agree(value){$.set(agreed,value)},get result(){return {details:$.get(details),agreed:$.get(agreed),busy:$.get(busy),loading:$.get(loading)}}};`);
const releaseTransition = reactivity.effect_root(() => { transitionReview = instantiateReview(...Object.values(compiledDependencies)); });
let transitionTimer;
try {
  reactivity.flush(); await firstRead.promise;
  transitionReview.agree(true); const transitionSave = transitionReview.decide('accept'); await parentChanged.promise;
  assert.equal(transitionReview.result.busy, true);
  assert.equal(transitionCalls.filter(call => call.path.endsWith(encodeURIComponent(otherRepo))).length, 0, 'Changing the repo during parent reconciliation must wait for the existing write.');
  parentFinished.resolve(); await transitionSave; reactivity.flush();
  const read = await Promise.race([nextRead.promise, new Promise((_, reject) => { transitionTimer = setTimeout(() => reject(Error('The next repo was never loaded after the write lock cleared.')), 300); })]);
  assert.equal(read.repo_id, otherRepo); assert.equal(read.acceptance.accepted, false);
  assert.equal(transitionReview.result.details.repo_id, otherRepo); assert.equal(transitionReview.result.agreed, false);
  assert.equal(transitionReview.result.busy, false); assert.equal(transitionReview.result.loading, false);
  assert.equal(transitionCalls.filter(call => call.method === 'POST').length, 1, 'Advancing to a dependency never accepts it automatically.');
} finally { clearTimeout(transitionTimer); transitionDestroy?.(); releaseTransition(); reactivity.flush(); }
console.log('Reactive repo transition PASS: the compiled Svelte effect resumes the pending dependency GET after busy=false, with an unchecked independent decision.');

const apiSource=await readFile(new URL('../../src/lib/platform/api.ts',import.meta.url),'utf8');
const apiTree=ts.createSourceFile('api.ts',apiSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const generateNode=apiTree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='generate');
const generateCode=ts.transpileModule(generateNode.getText(apiTree),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const dispatched=[],apiExports={};let abortDuringRead;
new Function('exports','request','modelLicenseFailure','announceModelLicenseRequired',generateCode)(apiExports,async()=>({ok:false,status:403,text:async()=>{abortDuringRead?.();return JSON.stringify({detail:{code:'model_licence_required',models:[{repo_id:repo,license:'NOASSERTION',category:'unknown',fingerprint}]}})}}),helpers.modelLicenseFailure,error=>dispatched.push({type:'studio:model-license-required',detail:{models:error.models}}));
const generationInput={text:'Public fixture',profileId:'fixture',language:'English',speed:1,steps:8,seed:'42',effect:'raw'};
await assert.rejects(apiExports.generate(generationInput,new AbortController().signal),error=>error.code==='model_licence_required');
assert.equal(dispatched.length,1);assert.equal(dispatched[0].type,'studio:model-license-required');assert.equal(dispatched[0].detail.models[0].repo_id,repo);
const cancelledGeneration=new AbortController();abortDuringRead=()=>cancelledGeneration.abort();
await assert.rejects(apiExports.generate(generationInput,cancelledGeneration.signal),error=>error.name==='AbortError');
assert.equal(dispatched.length,1,'A late 403 after cancellation must not open a new settings view.');
console.log('Generate 403 event and post-cancellation suppression PASS (actual api.generate with fixture response).');

let productionSource=await readFile(new URL('../../src/lib/tools/production/production.ts',import.meta.url),'utf8');
const productionTree=ts.createSourceFile('production.ts',productionSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
for(const node of [...productionTree.statements].reverse())if(ts.isImportDeclaration(node))productionSource=productionSource.slice(0,node.pos)+productionSource.slice(node.end);
const productionCode=ts.transpileModule(productionSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const requiredBody={detail:{code:'model_licence_required',models:[{repo_id:repo,license:'NOASSERTION',category:'unknown',fingerprint}]}};
const previousWindow=globalThis.window,previousEvent=globalThis.CustomEvent,navigation=[];
globalThis.window={dispatchEvent:event=>navigation.push(event)};globalThis.CustomEvent=class{constructor(type,options){this.type=type;this.detail=options.detail}};
try{
 const production={};let responseFactory=()=>Response.json(requiredBody,{status:403});
 new Function('exports','request','prepareRequest','assertModelLicenseResponse',productionCode)(production,async()=>responseFactory(),async()=>{},helpers.assertModelLicenseResponse);
 for(const path of ['/audiobook','/longform/render','/dub/generate']){
  await assert.rejects(production.productionJson(path,{method:'POST'}),error=>error.code==='model_licence_required');
  await assert.rejects(production.productionStream(path,{method:'POST'},()=>assert.fail('403 must not emit SSE frames')),error=>error.code==='model_licence_required');
 }
 assert.equal(navigation.length,6,'JSON and HTTP-before-SSE share one licence review contract.');
 const ordinary=[];responseFactory=()=>new Response('data: {"type":"error","error":"render failed (see backend log)"}\n\n');
 await production.productionStream('/audiobook',{},event=>ordinary.push(event));assert.deepEqual(ordinary,[{type:'error',error:'render failed (see backend log)'}]);assert.equal(navigation.length,6,'A generic stock SSE error must not be guessed to be a licence error.');
 const response=Response.json({detail:'unrelated forbidden'},{status:403});await helpers.assertModelLicenseResponse(response);assert.deepEqual(await response.json(),{detail:'unrelated forbidden'});assert.equal(navigation.length,6,'Unrelated 403 is preserved.');
}finally{if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;if(previousEvent===undefined)delete globalThis.CustomEvent;else globalThis.CustomEvent=previousEvent;}
console.log('Shared JSON/HTTP-SSE 403 review and unchanged ordinary SSE errors PASS (fixtures only).');
