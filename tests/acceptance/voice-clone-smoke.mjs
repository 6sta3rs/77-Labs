import { mkdir as ensureQaDirectory } from 'node:fs/promises';
await ensureQaDirectory(new URL('../../.tmp/qa/', import.meta.url), { recursive: true });
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Must be an explicitly owned disposable backend. Never starts an engine,
// imports a user's library, downloads weights, or invokes inference.
const origin = 'http://127.0.0.1:4312';
const token = process.env.VOICE_QA_TOKEN;
assert.ok(token, 'Set VOICE_QA_TOKEN to the disposable backend ownership token.');
const checks = [];
function check(name, condition) { assert.ok(condition, name); checks.push({ name, passed: true }); }
const owned = await fetch(`${origin}/health`);
check('Disposable backend ownership', owned.ok && owned.headers.get('x-voicestudio-next') === token);
async function request(path, options) {
  const response = await fetch(`${origin}${path}`, options);
  assert.ok(response.ok, `${path}: ${response.status} ${(response.ok ? '' : await response.text()).slice(0, 300)}`);
  return response;
}
async function json(path, options) { return (await request(path, options)).json(); }
const fixture = await readFile(new URL('../../public/demo/interface-tone.wav', import.meta.url));
// This non-speech tone exercises storage/transport, not speaker identity or inference.
const text = 'Proceduralny ton testowy; brak mowy.';
const file = () => new File([fixture], 'interface-tone.wav', { type: 'audio/wav' });
function form(values) { const body = new FormData(); for (const [key, value] of Object.entries(values)) body.append(key, value); return body; }
const initial = await json('/profiles');
const profile = await json('/profiles', { method: 'POST', body: form({ name: 'QA klon produkcja 2026-10-20', kind: 'clone', language: 'Polish', ref_text: text, ref_audio: file() }) });
check('Create clone with transcript and language', profile.id && profile.kind === 'clone' && profile.language === 'Polish' && profile.ref_text === text);
check('Clone appears in the profile library', (await json('/profiles')).some(row => row.id === profile.id));
const sample = await request(profile.audio_url || `/profiles/${profile.id}/audio`);
const bytes = Buffer.from(await sample.arrayBuffer());
check('Reference sample is actual audio', sample.headers.get('content-type').startsWith('audio/') && bytes.equals(fixture));
const patch = await json(`/profiles/${profile.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'QA klon sprawdzony', language: 'English', ref_text: text }) });
check('Editing profile preserves the recording and selected language', patch.id === profile.id && patch.language === 'English' && patch.ref_audio_path === profile.ref_audio_path);
const usage = await json(`/profiles/${profile.id}/usage`);
check('Usage audit before deletion', usage.synth_total === 0 && usage.project_total_segments === 0 && usage.projects.length === 0);
await json(`/profiles/${profile.id}/consent`, { method: 'POST', body: form({ consent_audio: file(), consent_text: `QA fixture: ${text}` }) });
const consenting = await json(`/profiles/${profile.id}`);
check('Consent recording is persisted', Boolean(consenting.verified_own_voice) && Boolean(consenting.consent_recorded_at));
await json(`/profiles/${profile.id}/consent`, { method: 'DELETE' });
const revoked = await json(`/profiles/${profile.id}`);
check('Consent recording can be revoked', !revoked.verified_own_voice && !revoked.consent_audio_path);
await json(`/profiles/${profile.id}/consent`, { method: 'POST', body: form({ consent_audio: file(), consent_text: `QA fixture: ${text}` }) });
const replaced = await json(`/profiles/${profile.id}/audio`, { method: 'PUT', body: form({ ref_audio: file(), ref_text: text, language: 'Polish', name: 'QA klon gotowy do syntezy' }) });
check('Reference replacement keeps identity and updates versioned audio', replaced.id === profile.id && replaced.ref_audio_path !== profile.ref_audio_path && replaced.audio_url !== profile.audio_url && replaced.language === 'Polish');
check('Replacement clears previous consent and locked take', !replaced.verified_own_voice && !replaced.consent_audio_path && !replaced.is_locked);
const invalid = await fetch(`${origin}/profiles/${profile.id}/audio`, { method: 'PUT', body: form({ ref_audio: new File([fixture], 'invalid.py') }) });
check('Invalid replacement format is rejected', invalid.status === 415);
check('Rejected upload keeps the valid sample intact', Buffer.from(await (await request(replaced.audio_url)).arrayBuffer()).equals(fixture));
const removal = await json('/profiles', { method: 'POST', body: form({ name: 'QA clone deletion only', kind: 'clone', language: 'Polish', ref_audio: file(), ref_text: text }) });
const removalUsage = await json(`/profiles/${removal.id}/usage`);
assert.equal(removalUsage.synth_total, 0); assert.equal(removalUsage.projects.length, 0);
await json(`/profiles/${removal.id}`, { method: 'DELETE' });
const final = await json('/profiles');
check('Delete only the newly created disposable profile', !final.some(row => row.id === removal.id) && final.some(row => row.id === profile.id));
check('Existing library entries remain untouched', initial.every(before => final.some(after => after.id === before.id && after.name === before.name && after.ref_audio_path === before.ref_audio_path)));
const report = { date: new Date().toISOString(), backend: 'disposable QA only', inference: false, speechFixture: false, profileId: profile.id, referenceText: text, fixture: 'public/demo/interface-tone.wav', fixtureSha256: createHash('sha256').update(fixture).digest('hex'), checks };
await writeFile(new URL('../../.tmp/qa/voice-clone-runtime.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: checks.length, profileId: profile.id, referenceText: text, report: '.tmp/qa/voice-clone-runtime.json' }, null, 2));
