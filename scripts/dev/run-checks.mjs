// Runs every tests/frontend/*-check.mjs plus ui-rules.mjs, prints all failures and fails if any check fails.
// A new check file needs no registration; a check that cannot run in CI must be listed in SKIPPED with a reason.
import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = resolve(root, 'tests/frontend');
const ARGUMENTS = { 'orb-reactivity-check.mjs': ['--summary'] };
const SKIPPED = {}; // file name -> reason
const only = process.argv.slice(2);

const files = readdirSync(directory).filter(name => /-check\.mjs$/.test(name) || name === 'ui-rules.mjs').sort().filter(name => !SKIPPED[name]);
const queue = only.length ? files.filter(name => only.some(part => name.includes(part))) : files;

function run(name) {
  return new Promise(done => {
    const child = spawn(process.execPath, [resolve(directory, name), ...(ARGUMENTS[name] || [])], { cwd: root });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('close', code => done({ name, code, output }));
  });
}

if (!queue.length) { console.error('No check matches.'); process.exit(1); }
const results = [];
const workers = Array.from({ length: Math.min(4, availableParallelism(), queue.length) }, async () => {
  while (queue.length) results.push(await run(queue.shift()));
});
await Promise.all(workers);

const failed = results.filter(result => result.code !== 0).sort((a, b) => a.name.localeCompare(b.name));
for (const result of failed) console.error(`\nFAIL ${result.name} (exit ${result.code})\n${result.output.trim().split('\n').slice(-12).join('\n')}`);
console.log(`\nChecks: ${results.length - failed.length}/${results.length} passed${Object.keys(SKIPPED).length ? `, ${Object.keys(SKIPPED).length} skipped` : ''}.`);
if (failed.length) {
  console.error(`Failed: ${failed.map(result => result.name).join(', ')}`);
  process.exit(1);
}
