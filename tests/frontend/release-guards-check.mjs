// Release guards: version parity of the five manifests, clean tree, HEAD at the release tag (also detached).
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifestVersions, releaseGuardErrors, versionMismatches } from '../../tools/release/release-guards.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const sandbox = mkdtempSync(join(tmpdir(), 'release-guards-'));
const git = (...args) => { const result = spawnSync('git', args, { cwd: sandbox, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout; };
try {
  // A copy of the five manifests inside a throw-away repository.
  for (const file of ['package.json', 'package-lock.json', 'desktop/tauri.conf.json', 'desktop/Cargo.toml', 'desktop/Cargo.lock']) {
    mkdirSync(join(sandbox, file, '..'), { recursive: true });
    cpSync(join(repo, file), join(sandbox, file));
  }
  const version = manifestVersions(sandbox)['package.json'];
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(versionMismatches(sandbox), [], 'the real manifests agree');
  console.log('PASS the five manifests agree');

  git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test');
  git('add', '-A'); git('commit', '-q', '-m', 'release');
  let errors = releaseGuardErrors(sandbox, version);
  assert.equal(errors.length, 1); assert.match(errors[0], /not tagged v/);
  console.log('PASS an untagged HEAD is refused');

  git('tag', `v${version}`);
  assert.deepEqual(releaseGuardErrors(sandbox, version), []);
  console.log('PASS a clean tagged HEAD passes');

  git('commit', '-q', '--allow-empty', '-m', 'later');
  const later = git('rev-parse', 'HEAD').trim();
  git('checkout', '-q', '--detach', `v${version}`);
  assert.deepEqual(releaseGuardErrors(sandbox, version), [], 'a detached checkout at the tag passes');
  console.log('PASS a detached checkout at the tag passes');

  git('checkout', '-q', '--detach', later);
  errors = releaseGuardErrors(sandbox, version);
  assert.ok(errors.some(error => /not tagged v/.test(error)), 'a detached HEAD after the tag is refused');
  git('checkout', '-q', '--detach', `v${version}`);
  console.log('PASS a detached HEAD that is not the tag is refused');

  writeFileSync(join(sandbox, 'note.txt'), 'x');
  assert.ok(releaseGuardErrors(sandbox, version).some(error => /not clean/.test(error)), 'an untracked file makes the tree dirty');
  rmSync(join(sandbox, 'note.txt'));
  console.log('PASS a dirty tree is refused');

  for (const [file, edit, label] of [
    ['desktop/Cargo.toml', text => text.replace(`version = "${version}"`, 'version = "9.9.9"'), 'Cargo.toml'],
    ['desktop/Cargo.lock', text => text.replace(new RegExp(`(name = "seventy-seven-labs"\\nversion = ")${version}`), '$19.9.9'), 'Cargo.lock'],
    ['package-lock.json', text => text.replace(new RegExp(`"version": "${version}"`, 'g'), '"version": "9.9.9"'), 'package-lock.json'],
    ['desktop/tauri.conf.json', text => text.replace(`"version": "${version}"`, '"version": "9.9.9"'), 'tauri.conf.json'],
  ]) {
    const path = join(sandbox, file), original = readFileSync(path, 'utf8');
    writeFileSync(path, edit(original));
    assert.ok(versionMismatches(sandbox).some(message => message.startsWith(file)), `${label} drift is reported`);
    writeFileSync(path, original);
  }
  console.log('PASS version drift in each manifest is reported');
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
