// Verifies a published updater feed: downloads (or reads) latest.json, fetches the installer it points to and checks the
// minisign signature against the public key embedded in desktop/tauri.conf.json. Node only, no network but the two downloads.
// Usage: node tools/release/verify-feed.mjs <feed.json | https://.../latest.json> [--installer <local installer>] [--expect-version <x.y.z>] [--pubkey <base64 key>]
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); // DER header of an Ed25519 public key

const decodeBase64Text = value => Buffer.from(value.trim(), 'base64').toString('utf8');

/** Parses minisign text: returns the decoded blob of the first base64 line after the untrusted comment, plus the trailer lines. */
function minisignLines(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  return { blob: Buffer.from(lines[1] ?? '', 'base64'), trusted: lines[2], global: lines[3] ? Buffer.from(lines[3], 'base64') : undefined };
}

/** Verifies `data` against a minisign signature. `publicKeyBase64` and `signatureBase64` are the base64-wrapped minisign
 *  files exactly as Tauri stores them (tauri.conf.json `pubkey`, the `.sig` file and the feed `signature`). */
export function verifyMinisign(publicKeyBase64, signatureBase64, data) {
  const key = minisignLines(decodeBase64Text(publicKeyBase64)).blob;
  const signature = minisignLines(decodeBase64Text(signatureBase64));
  const blob = signature.blob;
  if (key.length !== 42 || key.subarray(0, 2).toString() !== 'Ed') return { ok: false, reason: 'unsupported public key' };
  if (blob.length !== 74) return { ok: false, reason: 'malformed signature' };
  const algorithm = blob.subarray(0, 2).toString();
  if (!['Ed', 'ED'].includes(algorithm)) return { ok: false, reason: `unknown signature algorithm ${algorithm}` };
  if (!key.subarray(2, 10).equals(blob.subarray(2, 10))) return { ok: false, reason: 'the signature was made with a different key' };
  const publicKey = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, key.subarray(10)]), format: 'der', type: 'spki' });
  const message = algorithm === 'ED' ? createHash('blake2b512').update(data).digest() : data;
  if (!verify(null, message, publicKey, blob.subarray(10))) return { ok: false, reason: 'the signature does not match the installer' };
  if (!signature.trusted?.startsWith('trusted comment: ') || signature.global?.length !== 64) return { ok: false, reason: 'the trusted comment or its signature is missing' };
  const trusted = Buffer.from(signature.trusted.slice('trusted comment: '.length), 'utf8');
  if (!verify(null, Buffer.concat([blob.subarray(10), trusted]), publicKey, signature.global)) return { ok: false, reason: 'the trusted comment was altered' };
  return { ok: true };
}

async function bytes(source) {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source, { redirect: 'follow' });
    if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  return readFileSync(source);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const feedSource = args.find((arg, index) => !arg.startsWith('--') && !['--installer', '--expect-version', '--pubkey'].includes(args[index - 1]));
  if (!feedSource) { console.error('Usage: node tools/release/verify-feed.mjs <feed.json | url> [--installer <file>]'); process.exit(2); }
  const root = resolve(import.meta.dirname, '../..');
  const publicKey = args.includes('--pubkey') ? args[args.indexOf('--pubkey') + 1] : JSON.parse(readFileSync(join(root, 'desktop/tauri.conf.json'), 'utf8')).plugins.updater.pubkey;
  const feed = JSON.parse((await bytes(feedSource)).toString('utf8'));
  // Tauri's updater prefers the installer-specific key when a feed has one.
  const entry = feed.platforms?.['windows-x86_64-nsis'] ?? feed.platforms?.['windows-x86_64'];
  if (!feed.version || !entry?.url || !entry.signature) throw new Error('The feed has no version, url or signature for windows-x86_64.');
  const expected = args.includes('--expect-version') ? args[args.indexOf('--expect-version') + 1] : undefined;
  if (expected && feed.version !== expected) throw new Error(`The feed offers ${feed.version}, expected ${expected}.`);
  const installerPath = args[args.indexOf('--installer') + 1];
  const installer = await bytes(args.includes('--installer') ? installerPath : entry.url);
  const result = verifyMinisign(publicKey, entry.signature, installer);
  console.log(`${feed.version}: ${entry.url}\nsha256 ${createHash('sha256').update(installer).digest('hex')} (${installer.length} bytes)\n${result.ok ? `SIGNATURE VALID for the ${args.includes('--pubkey') ? 'given' : 'committed'} key` : `SIGNATURE INVALID: ${result.reason}`}`);
  process.exit(result.ok ? 0 : 1);
}
