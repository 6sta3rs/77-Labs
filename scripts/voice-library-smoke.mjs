import { mkdir as ensureQaDirectory } from 'node:fs/promises';
await ensureQaDirectory(new URL('../.tmp/qa/', import.meta.url), { recursive: true });
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Disposable backend only. The optional archetype render must be scheduled
// exclusively with the parent so GPU jobs never overlap.
const origin = 'http://127.0.0.1:4312', token = process.env.VOICE_QA_TOKEN;
assert.ok(token, 'Set VOICE_QA_TOKEN to the owned disposable backend token.');
const checks = [], created = [];
function check(name, condition) { assert.ok(condition, name); checks.push({ name, passed: true }); }
const health = await fetch(`${origin}/health`);
check('Owned disposable backend', health.ok && health.headers.get('x-voicestudio-next') === token);
async function response(path, options) { const result = await fetch(`${origin}${path}`, options); assert.ok(result.ok, `${path}: ${result.status} ${result.ok ? '' : (await result.text()).slice(0, 350)}`); return result; }
async function json(path, options) { return (await response(path, options)).json(); }
const sourceId = process.env.VOICE_QA_PROFILE || '3d7a9e9c';
const source = await json(`/profiles/${sourceId}`);
assert.ok(source.name.startsWith('QA'), 'Only an explicitly named QA voice may be exported.');
const initial = await json('/profiles');
const catalog = await json('/archetypes?limit=24&offset=0');
check('Local archetype catalog has pagination and complete recipes', catalog.total >= catalog.items.length && catalog.items.length === 24 && catalog.items.every(item => item.id && item.attrs && item.sample_script));
const categories = await json('/archetypes/categories');
check('Local archetype use-case categories', Array.isArray(categories) && categories.length === 7);
const filtered = await json('/archetypes?limit=24&lang=English&featured=true');
check('Archetype language and featured filters', filtered.items.length > 0 && filtered.items.every(item => item.language === 'English' && item.is_featured));
const personalities = await json('/personalities');
check('Local personality recipes', personalities.some(item => item.id === 'narrator') && personalities.every(item => typeof item.instruct === 'string'));
const described = await json('/design/describe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: personalities.find(item => item.id === 'narrator').instruct }) });
check('Personality recipe resolves to editable categories', described.attrs.Age === 'middle-aged' && described.attrs.Pitch === 'low pitch');

async function exported(includeReference) {
  const result = await response(`/personas/export/${sourceId}?license_spdx=CC-BY-4.0&tags=QA,roundtrip&include_reference=${includeReference}`, { method: 'POST' });
  const bytes = Buffer.from(await result.arrayBuffer());
  check(`Real ${includeReference ? 'full' : 'preview-only'} persona archive`, result.headers.get('content-type').includes('zip') && bytes.readUInt16LE(0) === 0x4b50 && bytes.length > 1000);
  return new File([bytes], `QA-${includeReference ? 'full' : 'preview'}.ovsvoice`, { type: 'application/zip' });
}
function form(file) { const body = new FormData(); body.append('file', file); return body; }
console.log('Exporting QA full-reference bundle…');
const full = await exported(true);
const inspect = await json('/personas/inspect', { method: 'POST', body: form(full) });
check('Inspect exposes license, source tags, language and full reference', inspect.license_spdx === 'CC-BY-4.0' && inspect.tags.includes('roundtrip') && inspect.language === source.language && !inspect.preview_only);
check('Inspect is read-only', (await json('/profiles')).length === initial.length);
for (let index = 0; index < 2; index++) {
  const imported = await json('/personas/import', { method: 'POST', body: form(full) }); created.push(imported.profile_id);
  check(`Import ${index + 1} creates a new profile identity`, imported.success && imported.profile_id !== sourceId && new Set(created).size === created.length && imported.name === source.name && imported.license_spdx === inspect.license_spdx);
  const saved = await json(`/profiles/${imported.profile_id}`);
  check(`Import ${index + 1} preserves the clone recipe`, saved.kind === source.kind && saved.ref_text === source.ref_text && saved.language === source.language && !saved.verified_own_voice);
}
console.log('Exporting QA preview-only bundle…');
const preview = await exported(false);
const previewInspect = await json('/personas/inspect', { method: 'POST', body: form(preview) });
check('Preview-only inspect is explicit', previewInspect.preview_only && previewInspect.license_spdx === 'CC-BY-4.0');
const previewImported = await json('/personas/import', { method: 'POST', body: form(preview) }); created.push(previewImported.profile_id);
check('Preview-only bundle imports with a playable fallback reference', previewImported.success && previewImported.preview_only && (await response(`/profiles/${previewImported.profile_id}/audio`)).headers.get('content-type').startsWith('audio/'));
const malformed = await fetch(`${origin}/personas/inspect`, { method: 'POST', body: form(new File(['not a zip'], 'QA-invalid.ovsvoice')) });
check('Malformed bundle is rejected before import', malformed.status === 400);
let archetypeId;
if (process.argv.includes('--render-archetype')) {
  const selected = filtered.items[0];
  console.log(`Rendering one QA archetype ${selected.id}…`);
  const first = await json(`/archetypes/${selected.id}/use?name=${encodeURIComponent('QA archetyp angielski')}`, { method: 'POST' }); archetypeId = first.profile_id; created.push(archetypeId);
  const second = await json(`/archetypes/${selected.id}/use`, { method: 'POST' });
  const saved = await json(`/profiles/${archetypeId}`);
  check('Archetype use renders a reusable designed voice', saved.kind === 'design' && saved.language === selected.language && saved.instruct === selected.instruct && saved.ref_text === selected.sample_script);
  check('Using the same archetype reuses its existing profile', first.profile_id === second.profile_id);
  check('Archetype reference is actual audio', (await response(`/profiles/${archetypeId}/audio`)).headers.get('content-type').startsWith('audio/'));
}
const final = await json('/profiles');
check('Original library entries remain untouched', initial.every(before => final.some(after => after.id === before.id && after.name === before.name && after.ref_audio_path === before.ref_audio_path)));
const report = { date: new Date().toISOString(), backend: 'disposable QA only', sourceProfileId: sourceId, importedProfileIds: created.filter(id => id !== archetypeId), archetypeProfileId: archetypeId, generatedArchetype: Boolean(archetypeId), license: inspect.license_spdx, previewWatermarked: previewInspect.watermarked_preview, checks };
await mkdir(new URL('../.tmp/voice-library-qa/', import.meta.url), { recursive: true });
await writeFile(new URL('../.tmp/voice-library-qa/QA-full.ovsvoice', import.meta.url), Buffer.from(await full.arrayBuffer()));
await writeFile(new URL('../.tmp/voice-library-qa/QA-preview.ovsvoice', import.meta.url), Buffer.from(await preview.arrayBuffer()));
await writeFile(new URL('../.tmp/qa/voice-library-runtime.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: checks.length, created, archetypeId, report: '.tmp/qa/voice-library-runtime.json' }, null, 2));
