import { i18nDeps, i18nRequire } from '../helpers/i18n.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { transformAppReadiness } from './engine-readiness-app-transform.mjs';
import { compile as compileSvelte } from 'svelte/compiler';

const root = new URL('../../src/', import.meta.url);
const source = file => readFile(new URL(file, root), 'utf8');
function compile(text, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', code)(exports, name => {
    if (/\/i18n$/.test(name)) return i18nRequire(name);
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  });
  return exports;
}
const ready = compile(await source('lib/models/engine-readiness.ts'));
const picker = compile(await source('lib/models/model-picker.ts'), { './engine-readiness': ready });
let count = 0;
const test = async (name, run) => { await run(); count++; process.stdout.write(`PASS ${name}\n`); };
const detected = { id: 'qa', display_name: 'QA', available: false, availability_check: 'dependencies_detected', can_verify: true,
  inference_verified: false, routing_status: 'unavailable', hardware_check: 'not_checked', reason: 'Wykryto wymagane zależności.' };
const family = (engine = detected, fields = {}) => ({ active: 'qa', backends: [engine], ...fields });

await test('Metadata allows explicit verification without claiming backend or inference availability', () => {
  assert.equal(ready.canSelectEngine(detected), true);
  assert.equal(ready.engineReadinessLabel(detected), 'Biblioteki wykryte · wymaga sprawdzenia');
  assert.equal(ready.engineSelectionLabel(detected), 'Sprawdź i wybierz');
  const item = picker.normalizeTtsModels(family())[0];
  assert.equal(item.available, false); assert.equal(item.installed, false); assert.equal(item.canVerify, true);
  assert.equal(picker.canSelectModel(item), true);
  assert.equal(picker.modelStatus(item), 'Biblioteki wykryte · wymaga sprawdzenia');
  assert.equal(picker.modelSelectionLabel(item), 'Sprawdź i wybierz');
  assert.ok(!item.reason.includes('nie obsługuje'), 'Unknown hardware must not become an invented incompatibility.');
  assert.equal(detected.inference_verified, false);
  assert.equal(picker.normalizeTtsModels(family({ ...detected, installed: false, weights_check: 'not_checked' }))[0].installationKnown, false);
});
await test('Missing dependencies, unsupported platforms and unconfigured runtimes remain disabled', () => {
  for (const availability_check of ['missing_dependencies', 'platform_unsupported', 'runtime_unconfigured']) {
    const engine = { ...detected, availability_check, can_verify: false };
    assert.equal(ready.canSelectEngine(engine), false);
    assert.equal(picker.canSelectModel(picker.normalizeTtsModels(family(engine))[0]), false);
  }
  assert.equal(ready.needsEngineVerification({ available: false, can_verify: true }), false);
  assert.equal(ready.canSelectEngine({ dependencies_ready: true, configured: true }), false, 'Unrelated status endpoints must not accidentally enable engine selection.');
});
await test('Legacy availability retains normal selection and real routing constraints', () => {
  const engine = { id: 'legacy', available: true };
  assert.equal(ready.engineSelectionLabel(engine), 'Wybierz');
  assert.equal(ready.canSelectEngine(engine), true);
  assert.equal(ready.canSelectEngine({ ...engine, routing_status: 'unavailable' }), false);
  const model = picker.normalizeTtsModels(family(engine))[0];
  assert.equal(model.available, true); assert.equal(model.installed, true); assert.equal(model.canVerify, false);
});
await test('Readiness never substitutes for engine licence consent or environment ownership', () => {
  const blocked = picker.normalizeTtsModels(family({ ...detected, license_required: true, license_accepted: false }))[0];
  assert.equal(blocked.canVerify, false); assert.equal(picker.canSelectModel(blocked), false);
  assert.match(blocked.reason, /licencji/);
  assert.equal(picker.normalizeTtsModels(family(detected, { env_override: true }))[0].canVerify, false);
  assert.equal(picker.normalizeTtsModels(family({ ...detected, license_required: true, license_accepted: true }))[0].canVerify, true);
});

function componentScript(text, props, dependencies = {}, exposure = 'select') {
  text = text.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  const parsed = ts.createSourceFile('fixture.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const node of [...parsed.statements].reverse()) if (ts.isImportDeclaration(node)) text = text.slice(0, node.pos) + text.slice(node.end);
  text += `\nreturn {${exposure}};`;
  const code = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const values = { $props: Object.assign(() => props, { id: () => 'readiness' }), $state: value => value,
    $derived: Object.assign(value => value, { by: compute => compute() }),
    $bindable: value => value, $effect() {}, untrack: fn => fn(), onDestroy() {}, ...picker, ...dependencies };
  return new Function(...Object.keys({...i18nDeps,...values}), code)(...Object.values({...i18nDeps,...values}));
}
await test('Active metadata-only model performs stock POST selection, preserving caller signal', async () => {
  const requests = [], timeouts = [];
  const production = compile(await source('lib/tools/production/production.ts'), {
    '../../platform/api': { prepareRequest: async () => {}, request: async (path, options) => {
      requests.push({ path, ...options });
      return { ok: true, json: async () => path === '/engines/select' ? { active: 'qa', env_override: false } : { tts: family() } };
    } }, '../../models/model-licenses': { assertModelLicenseResponse: async () => {} },
  });
  const tools = compile(await source('lib/tools/studio-tools.ts'), { './production/production': production, '../platform/api': {},
    '../models/engine-catalog-state': { invalidateCatalogReads() {}, beginCatalogRead: () => 1, publishEngineCatalog: () => true } });
  const text = (await source('App.svelte')).match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  const parsed = ts.createSourceFile('App.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const node = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'chooseInstalledModel');
  assert.ok(node, 'Actual App selection function must be exercised');
  const item = picker.normalizeTtsModels(family())[0];
  const appFixture = `let modelRequestsDisposed=false,modelSelectionPending,engineCatalogController,engineCatalogEpoch=0,modelSelectionController;
    let ttsFamily=family,ttsModelItems=[item],language='Polish',speechSettings={};const demoMode=false,generationBackend={id:'qa'},generationCapabilities={preset_voice:false},generationLanguages=['Polish'];
    ${node.getText(parsed)};return {chooseInstalledModel};`;
  const appCode = ts.transpileModule(appFixture, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const deps = { family: family(), item, selectEngine: tools.selectEngine, engineCatalog: tools.engineCatalog,
    resetPresetForEngine: value => value, scheduleProjectSave() {}, preferredSpeechLanguage: () => 'Polish' };
  const app = new Function(...Object.keys({...i18nDeps,...deps}), appCode)(...Object.values({...i18nDeps,...deps}));
  let closes = 0;
  const subject = componentScript(await source('lib/models/ModelPicker.svelte'), { models: [item], selectedId: 'qa', onselect: app.chooseInstalledModel, onclose: () => closes++ });
  const original = AbortSignal.timeout;
  AbortSignal.timeout = ms => { timeouts.push(ms); return original(ms); };
  try { await subject.select(item); } finally { AbortSignal.timeout = original; }
  assert.equal(requests.filter(value => value.method === 'POST').length, 1);
  const mutation = requests.find(value => value.path === '/engines/select');
  assert.equal(mutation.method, 'POST');
  assert.deepEqual(JSON.parse(mutation.body), { family: 'tts', backend_id: 'qa' });
  assert.ok(mutation.signal instanceof AbortSignal);
  assert.equal(timeouts.length, 1, 'Only the following GET uses the generic catalogue deadline, never the mutation.');
  assert.equal(closes, 1);
  assert.equal(item.available, false, 'The UI must not promote successful preflight to inference evidence.');
});
await test('Already selected available model is inert without a redundant POST or close; blocked metadata does nothing', async () => {
  let selections = 0, closes = 0;
  const item = { id: 'qa', name: 'QA', description: '', languages: [], installed: true, available: true };
  const subject = componentScript(await source('lib/models/ModelPicker.svelte'), { models: [item], selectedId: 'qa', onselect: async () => selections++, onclose: () => closes++ });
  await subject.select(item); assert.equal(selections, 0);
  await subject.select({ ...item, available: false, canVerify: false }); assert.equal(selections, 0);
  assert.equal(closes, 0);
});
await test('Catalogue action preserves active verification and all existing licence guards', async () => {
  // The engine catalogue moved from models/EngineCatalog.svelte to settings/pages/ModelsPage.svelte (per-family `fam`, licence switch `agreed`).
  const text = await source('lib/settings/pages/ModelsPage.svelte');
  assert.ok(text.includes('fam.active !== engine.id || needsEngineVerification(engine)'));
  assert.ok(text.includes('!canSelectEngine(engine) || Boolean(fam.env_override) || Boolean(engine.license_required && !engine.license_accepted)'));
  assert.ok(text.includes('bind:checked={agreed}'));
  assert.ok(text.includes('disabled={!agreed || busy}'), 'Licence acceptance stays behind the explicit switch.');
  assert.ok(text.includes('<ModelLicenseReview'), 'The licence review stays hosted inside the catalogue.');
});
await test('Tool model settings support explicit ASR verification and LLM off without readiness promotion', async () => {
  for (const name of ['asr', 'llm']) {
    const engine = name === 'llm' ? { ...detected, id: 'off', display_name: 'Bez LLM' } : detected;
    const snapshot = { active: engine.id, backends: [engine] }, calls = [];
    const subject = componentScript(await source('lib/models/ToolModelSettings.svelte'), { ready: true, family: name }, {
      $engineCatalogSnapshot: { catalog: { [name]: snapshot } },
      selectEngine: async (...args) => { calls.push(args); return { active: engine.id, env_override: false }; },
      engineCatalog: async () => ({ [name]: snapshot }),
    }, 'choose');
    await subject.choose(engine.id);
    assert.equal(calls.length, 1); assert.equal(calls[0][0], name); assert.equal(calls[0][1], engine.id);
    assert.ok(calls[0][2] instanceof AbortSignal); assert.equal(engine.available, false); assert.equal(engine.inference_verified, false);
  }
  const snapshot = { active: 'mlx-audio', backends: [{ ...detected, id: 'mlx-audio', availability_check: 'platform_unsupported', can_verify: false }] };
  const subject = componentScript(await source('lib/models/ToolModelSettings.svelte'), { ready: true, family: 'asr' }, {
    $engineCatalogSnapshot: { catalog: { asr: snapshot } }, selectEngine: async () => assert.fail('Unsupported engine must not send a mutation'),
  }, 'choose');
  await assert.rejects(subject.choose('mlx-audio'));
});
await test('Both catalogues and reusable tool selector compile with actual Svelte markup', async () => {
  for (const file of ['lib/settings/pages/ModelsPage.svelte', 'lib/models/ModelPicker.svelte', 'lib/models/ToolModelSettings.svelte']) {
    compileSvelte(await source(file), { filename: file, generate: false });
  }
});
await test('App staging transform changes only the selection guard and supports the older active shortcut', () => {
  const current = `<script>async function chooseInstalledModel(id:string){const model=ttsModelItems.find(item=>item.id===id);if(!model?.available || !model.installed) throw new Error(model?.reason || 'Ten silnik nie jest dostępny do wyboru.');}</script><style>.untouched{color:red}</style>`;
  const changed = transformAppReadiness(current);
  assert.ok(changed.includes('&& !model.canVerify'));
  assert.ok(changed.endsWith('<style>.untouched{color:red}</style>'));
  assert.equal(transformAppReadiness(changed), changed);
  const old = `<script>async function selectGenerationEngine(id:string){if(id===generationEngine)return;const engine=ttsFamily.backends.find(row=>row.id===id);if(!engine?.available)throw Error('keep licence checks');await selectEngine('tts',id);}</script>`;
  const staged = transformAppReadiness(old);
  assert.ok(staged.includes('needsEngineVerification(ttsFamily?.backends.find'));
  assert.ok(staged.includes('!engine?.available && !needsEngineVerification(engine ?? {})'));
  assert.ok(staged.includes("throw Error('keep licence checks')"));
});
process.stdout.write(`${count}/${count} engine readiness contracts PASS; fixture transport only, no engine/model/HTTP run.\n`);
