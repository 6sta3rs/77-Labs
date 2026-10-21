import { i18nDeps, i18nRequire } from '../helpers/i18n.mjs';
import { sourceUrl } from '../helpers/source-url.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function load(filename, dependencies = {}, exposure = '') {
  let source = await readFile(sourceUrl(`${filename}`), 'utf8');
  if (filename.endsWith('.svelte')) source = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const node of [...parsed.statements].reverse()) if (ts.isImportDeclaration(node)) source = source.slice(0, node.pos) + source.slice(node.end);
  if (exposure) source += `\nreturn { ${exposure} };`;
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exported = {};
  return new Function('exports', ...Object.keys({...i18nDeps,...dependencies}), code)(exported, ...Object.values({...i18nDeps,...dependencies})) ?? exported;
}

const calls = [];
const storage = new Map();
const licenceContract = await load('model-licenses.ts');
const client = await load('voice-library-tools.ts', {
  assertModelLicenseResponse: licenceContract.assertModelLicenseResponse,
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  request: async (path, options) => { calls.push({ path, options }); return new Response(new Blob(['PK voice bundle'], { type: path.includes('/preview?') ? 'audio/wav' : 'application/zip' }), { headers: { 'Content-Disposition': "attachment; filename*=UTF-8''G%C5%82os.ovsvoice" } }); },
  postJson: (body, signal) => ({ method: 'POST', body: JSON.stringify(body), signal }),
  productionJson: async (path, options) => { calls.push({ path, options }); return path === '/design/describe' ? { attrs: { Gender: 'Auto', Age: 'middle-aged', Pitch: 'low pitch', Style: 'Auto', EnglishAccent: 'Auto', ChineseDialect: 'Auto' } } : path.endsWith('/use?name=QA+archetyp') ? { profile_id: 'qa-archetype' } : { id: 'qa-profile' }; },
});
const filters = { ...client.emptyArchetypeFilters(), query: 'voice & calm', category: 'narration', language: 'English', whisper: 'false', featured: 'false' };
const query = new URL(client.archetypeQuery(filters, -2), 'http://localhost');
assert.equal(query.searchParams.get('q'), 'voice & calm');
assert.equal(query.searchParams.get('offset'), '0');
assert.equal(query.searchParams.get('whisper'), 'false');
assert.equal(query.searchParams.get('featured'), 'false');
assert.equal(query.searchParams.get('use_case'), 'narration');
assert.match(client.personaFileError(new File(['x'], 'bad.zip')), /ovsvoice/);
assert.match(client.personaFileError(new File([], 'empty.ovsvoice')), /pust/);
assert.match(client.personaFileError({ name: 'large.ovsvoice', size: 100 * 1024 * 1024 + 1 }), /100 MB/);
assert.equal(client.personaFileError(new File(['valid'], 'QA.OVSVOICE')), '');
const abort = new AbortController();
const exported = await client.exportPersona('qa', { license: 'CC-BY-4.0', tags: 'QA,a&b', includeReference: false }, abort.signal);
assert.equal(exported.filename, 'Głos.ovsvoice');
assert.ok(exported.blob.size);
assert.equal(new URL(calls.at(-1).path, 'http://localhost').searchParams.get('include_reference'), 'false');
assert.equal(new URL(calls.at(-1).path, 'http://localhost').searchParams.get('tags'), 'QA,a&b');
assert.equal(calls.at(-1).options.signal, abort.signal);
await client.previewArchetype('a/1', abort.signal);
assert.equal(calls.at(-1).path, '/archetypes/a%2F1/preview?local=true', 'Local preview must bypass gallery fetches.');
await client.createPersonalityProfile({ id: 'narrator', name: 'Narrator', instruct: 'middle-aged, low pitch', script: 'English original.' }, ' QA preset ', 'Polish', abort.signal, 'Polska próbka.');
assert.equal(calls.at(-2).path, '/design/describe');
const created = calls.at(-1).options.body;
assert.equal(created.get('personality'), 'narrator');
assert.equal(created.get('name'), 'QA preset');
assert.equal(created.get('kind'), 'design');
assert.equal(created.get('ref_text'), 'Polska próbka.', 'The saved reference text must match the sample in the chosen language.');
assert.equal(JSON.parse(created.get('vd_states')).Pitch, 'low pitch');
await client.useArchetype('qa', 'QA archetyp', abort.signal);
assert.equal(calls.at(-2).path, '/archetypes/qa/use?name=QA+archetyp');
assert.equal(calls.at(-1).path, '/profiles/qa-archetype');
const metadata = { license_spdx: 'CC-BY-4.0', tags: ['QA', 'retained'], preview_only: false };
assert.equal(client.rememberPersonaMetadata('qa-metadata', metadata, 'QA.ovsvoice'), true);
assert.equal(client.importedPersonaMetadata('qa-metadata').license, 'CC-BY-4.0');
assert.deepEqual(client.importedPersonaMetadata('qa-metadata').tags, ['QA', 'retained']);

let imports = 0, inspections = 0, refreshes = 0;
const props = Object.assign(() => ({ ready: true, onchange: async () => { if (++refreshes === 1) throw new Error('QA refresh failed'); } }), { id: () => 'qa-library' });
const component = await load('VoiceLibraryTools.svelte', {
  $props: props, $state: value => value, $derived: value => value, $effect() {}, onDestroy() {}, untrack: fn => fn(),
  emptyArchetypeFilters: client.emptyArchetypeFilters, personaLicenses: client.personaLicenses,
  importedPersonaMetadata: client.importedPersonaMetadata, rememberPersonaMetadata: client.rememberPersonaMetadata,
  inspectPersona: async () => { inspections++; return { name: 'QA', tags: [], license_spdx: 'CC-BY-4.0' }; },
  importPersona: async () => { imports++; return { success: true, profile_id: 'qa-imported', name: 'QA', kind: 'clone', license_spdx: 'CC-BY-4.0' }; },
  loadLibraryProfiles: async () => [{ id: 'qa-imported', name: 'QA' }],
}, 'inspect, importBundle, finishCreated, setFile(file) { importFile = file }, get pendingProfile() { return pendingProfile }');
const bundle = new File(['bundle'], 'QA.ovsvoice'); component.setFile(bundle);
await component.importBundle();
assert.equal(imports, 0, 'Import must remain unavailable until inspect succeeds.');
await component.inspect(); assert.equal(inspections, 1);
component.setFile(new File(['different bundle'], 'QA-other.ovsvoice')); await component.importBundle();
assert.equal(imports, 0, 'An inspected file cannot authorize a different upload.');
component.setFile(bundle); await component.importBundle();
assert.equal(imports, 1); assert.equal(component.pendingProfile.id, 'qa-imported');
await component.importBundle(); assert.equal(imports, 1, 'A failed library refresh must not repeat the import.');
await component.finishCreated(new AbortController().signal); assert.equal(component.pendingProfile, undefined);
console.log('Voice library contracts: 33 checks passed.');
