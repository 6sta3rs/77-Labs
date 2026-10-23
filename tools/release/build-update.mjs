// Builds a signed NSIS installer and the updater feed `latest.json` for GitHub Releases.
// Usage: npm run desktop:release -- [--notes "Co nowego"] [--feed latest.json] [--skip-guards]
// Without --notes the notes come from the CHANGELOG.md section of this version. --feed names the feed file the build polls
// (default latest.json; another name is for the two-feed key rotation scheme in tasks/specs/T-0033-updater-key-rotation.md).
// Signing key: TAURI_SIGNING_PRIVATE_KEY (path or content), default %USERPROFILE%\.tauri\seventy-seven-labs-updater.key (never in the repo).
// Output: .tmp/release/v<version>/ with the installer, its .sig and latest.json. Publishing is a separate, explicit step (printed at the end).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { changelogNotes } from './changelog-notes.mjs';
import { releaseGuardErrors } from './release-guards.mjs';

const root = resolve(import.meta.dirname, '../..');
// Owner/name of the GitHub repository from `git remote get-url origin` (kept out of the source tree).
const origin = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const REPO = origin.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/)?.[1];
if (!REPO) throw new Error(`origin is not a GitHub repository: ${origin}`);
const feedAt = process.argv.indexOf('--feed');
const feedName = feedAt > -1 ? process.argv[feedAt + 1] ?? '' : 'latest.json';
if (!/^[\w.-]+\.json$/.test(feedName)) throw new Error(`--feed needs a file name such as latest.json, got "${feedName}"`);
const ENDPOINT = `https://github.com/${REPO}/releases/latest/download/${feedName}`;
const { version } = JSON.parse(readFileSync(join(root, 'desktop/tauri.conf.json'), 'utf8'));
// A release is built from a tagged, clean commit with all five version manifests in agreement.
// --skip-guards is for a local trial build only and must never produce a published release.
if (process.argv.includes('--skip-guards')) console.warn('WARNING: release guards skipped; do not publish this build.');
else {
  const errors = releaseGuardErrors(root, version);
  if (errors.length) throw new Error(['Release guards failed:', ...errors.map(error => `- ${error}`)].join('\n'));
}
const at = process.argv.indexOf('--notes');
const notes = at > -1 ? process.argv[at + 1] || '' : changelogNotes(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version) ?? '';
const key = process.env.TAURI_SIGNING_PRIVATE_KEY || join(homedir(), '.tauri', 'seventy-seven-labs-updater.key');
if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !existsSync(key)) throw new Error(`Missing signing key: ${key}`);

const env = { ...process.env, TAURI_SIGNING_PRIVATE_KEY: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '' };
// The update endpoint is injected at build time; tauri.conf.json ships with an empty list.
const config = JSON.stringify({ plugins: { updater: { endpoints: [ENDPOINT] } } }).replaceAll('"', '\\"');
const built = spawnSync('npx', ['tauri', 'build', '--bundles', 'nsis', '--config', `"${config}"`], { cwd: root, env, stdio: 'inherit', shell: true });
if (built.status !== 0) process.exit(built.status ?? 1);

const nsis = join(root, 'desktop/target/release/bundle/nsis');
const setup = readdirSync(nsis).find(name => name.endsWith(`_${version}_x64-setup.exe`));
if (!setup || !existsSync(join(nsis, `${setup}.sig`))) throw new Error(`No signed installer for ${version} in ${nsis}`);
// GitHub turns spaces in asset names into dots, so publish under a name without spaces.
const asset = `Seventy-Seven-Labs_${version}_x64-setup.exe`;
const out = join(root, '.tmp/release', `v${version}`);
mkdirSync(out, { recursive: true });
copyFileSync(join(nsis, setup), join(out, asset));
copyFileSync(join(nsis, `${setup}.sig`), join(out, `${asset}.sig`));
// A checksum next to the installer lets anyone verify a manual download (`certutil -hashfile <file> SHA256`).
const sha256 = createHash('sha256').update(readFileSync(join(out, asset))).digest('hex');
writeFileSync(join(out, `${asset}.sha256`), `${sha256}  ${asset}\n`);
const feed = {
  version, notes, pub_date: new Date().toISOString(),
  platforms: { 'windows-x86_64': { signature: readFileSync(join(nsis, `${setup}.sig`), 'utf8').trim(), url: `https://github.com/${REPO}/releases/download/v${version}/${asset}` } },
};
writeFileSync(join(out, feedName), JSON.stringify(feed, null, 2) + '\n');
console.log(`\nReady in ${out}\nPublish (after review):\n  gh release create v${version} "${join(out, asset)}" "${join(out, `${asset}.sig`)}" "${join(out, feedName)}" --repo ${REPO} --title "v${version}" --notes "${notes.replaceAll('"', "'")}"`);
