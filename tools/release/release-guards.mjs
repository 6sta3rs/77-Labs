// Guards for building a release: the five version manifests agree, the tree is clean and HEAD is the release tag.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const PACKAGE = 'seventy-seven-labs';

/** Versions found in the five manifests, keyed by file. A missing entry shows as undefined. */
export function manifestVersions(root) {
  const read = file => readFileSync(join(root, file), 'utf8');
  const lock = JSON.parse(read('package-lock.json'));
  const cargoToml = read('desktop/Cargo.toml').match(/\[package\][^[]*?\nversion\s*=\s*"([^"]+)"/)?.[1];
  const cargoLock = read('desktop/Cargo.lock').match(new RegExp(`\\[\\[package\\]\\]\\nname = "${PACKAGE}"\\nversion = "([^"]+)"`))?.[1];
  return {
    'package.json': JSON.parse(read('package.json')).version,
    'package-lock.json': lock.version,
    'package-lock.json (root package)': lock.packages?.['']?.version,
    'desktop/tauri.conf.json': JSON.parse(read('desktop/tauri.conf.json')).version,
    'desktop/Cargo.toml': cargoToml,
    'desktop/Cargo.lock': cargoLock,
  };
}

/** Error messages for manifests that disagree with package.json (empty when they all match). */
export function versionMismatches(root) {
  const versions = manifestVersions(root);
  const expected = versions['package.json'];
  return Object.entries(versions).filter(([, value]) => value !== expected)
    .map(([file, value]) => `${file}: ${value ?? 'no version found'} (package.json has ${expected})`);
}

const git = (root, ...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

/** Release-only guards: clean working tree and HEAD exactly at tag v<version> (also on a detached checkout). */
export function releaseGuardErrors(root, version) {
  const errors = versionMismatches(root);
  const status = git(root, 'status', '--porcelain');
  if (status.status !== 0) return [...errors, `git status failed: ${status.stderr.trim()}`];
  if (status.stdout.trim()) errors.push('The working tree is not clean; commit or remove the changes before building a release.');
  const tags = git(root, 'tag', '--points-at', 'HEAD').stdout.split('\n').map(tag => tag.trim()).filter(Boolean);
  if (!tags.includes(`v${version}`)) errors.push(`HEAD is not tagged v${version} (tags at HEAD: ${tags.join(', ') || 'none'}); tag the release commit first.`);
  return errors;
}
