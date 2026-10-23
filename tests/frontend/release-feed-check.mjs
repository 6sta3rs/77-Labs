// Feed verification (minisign over Ed25519, Tauri's format) and release notes from CHANGELOG.md. Synthetic keys only.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { changelogNotes } from '../../tools/release/changelog-notes.mjs';
import { verifyMinisign } from '../../tools/release/verify-feed.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const rawPublic = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const keyId = randomBytes(8);
const b64 = value => Buffer.from(value).toString('base64');
const publicFile = id => `untrusted comment: minisign public key: TEST\n${b64(Buffer.concat([Buffer.from('Ed'), id, rawPublic]))}\n`;
function signatureFile(data, { algorithm = 'ED', id = keyId, trusted = 'timestamp:1', key = privateKey } = {}) {
  const message = algorithm === 'ED' ? createHash('blake2b512').update(data).digest() : data;
  const signature = sign(null, message, key);
  const global = sign(null, Buffer.concat([signature, Buffer.from(trusted)]), key);
  return `untrusted comment: signature\n${b64(Buffer.concat([Buffer.from(algorithm), id, signature]))}\ntrusted comment: ${trusted}\n${b64(global)}\n`;
}
const wrap = text => b64(text);
const installer = randomBytes(4096);

assert.deepEqual(verifyMinisign(wrap(publicFile(keyId)), wrap(signatureFile(installer)), installer), { ok: true });
console.log('PASS a prehashed (ED) signature verifies');
assert.deepEqual(verifyMinisign(wrap(publicFile(keyId)), wrap(signatureFile(installer, { algorithm: 'Ed' })), installer), { ok: true });
console.log('PASS a legacy (Ed) signature verifies');

const tampered = Buffer.from(installer); tampered[7] ^= 1;
assert.match(verifyMinisign(wrap(publicFile(keyId)), wrap(signatureFile(installer)), tampered).reason, /does not match/);
console.log('PASS a modified installer is rejected');

const other = generateKeyPairSync('ed25519');
assert.match(verifyMinisign(wrap(publicFile(keyId)), wrap(signatureFile(installer, { key: other.privateKey })), installer).reason, /does not match/);
assert.match(verifyMinisign(wrap(publicFile(keyId)), wrap(signatureFile(installer, { id: randomBytes(8) })), installer).reason, /different key/);
console.log('PASS a signature by another key is rejected');

const altered = signatureFile(installer).replace('trusted comment: timestamp:1', 'trusted comment: timestamp:2');
assert.match(verifyMinisign(wrap(publicFile(keyId)), wrap(altered), installer).reason, /trusted comment/);
console.log('PASS an altered trusted comment is rejected');

assert.match(verifyMinisign(wrap(publicFile(keyId)), wrap('untrusted comment: x\nAAAA\n'), installer).reason, /malformed/);
console.log('PASS a malformed signature is rejected');

// Release notes.
const sample = '# Changelog\n\n## Unreleased\n\n- next\n\n## 1.2.3 - 2026-01-01\n\nUpdate notes (Polish): Polskie notatki.\n\n- English detail\n\n## 1.2.30 - 2025-12-01\n\n- older\n';
assert.equal(changelogNotes(sample, '1.2.3'), 'Polskie notatki.');
assert.equal(changelogNotes(sample, '1.2.30'), '- older');
assert.equal(changelogNotes(sample, '9.9.9'), undefined);
console.log('PASS release notes come from the matching section only');
const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
assert.ok(changelogNotes(readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8'), version), `CHANGELOG.md has a section for the current version ${version}`);
console.log('PASS CHANGELOG.md has a section for the current version');
