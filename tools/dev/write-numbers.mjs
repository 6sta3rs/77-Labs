// Writes docs/verification/numbers.md: the bundle sizes of dist/ and the test counts, so documents quote one source.
// Run after `npm run build` (the bundle part is skipped with a note when dist/ is missing): node tools/dev/write-numbers.mjs
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const read = path => readFileSync(join(root, path), 'utf8');
const kib = bytes => `${(bytes / 1024).toFixed(0)} KiB`;

const frontendChecks = readdirSync(join(root, 'tests/frontend')).filter(name => /-check\.mjs$/.test(name)).length + 1; // + ui-rules.mjs
const rustTests = tracked.filter(file => file.startsWith('desktop/src/') && file.endsWith('.rs')).reduce((sum, file) => sum + (read(file).match(/#\[test\]/g)?.length ?? 0), 0);
const rustIgnored = tracked.filter(file => file.startsWith('desktop/src/') && file.endsWith('.rs')).reduce((sum, file) => sum + (read(file).match(/#\[ignore/g)?.length ?? 0), 0);
const python = JSON.parse(read('tests/manifest-python.json'));
const e2e = tracked.filter(file => /^tests\/e2e\/.*\.spec\.mjs$/.test(file)).reduce((sum, file) => {
  const text = read(file);
  return sum + (text.match(/^\s*\['[^']+', async/gm)?.length ?? 0) + (text.match(/^test\(/gm)?.length ?? 0);
}, 0);
const acceptance = tracked.filter(file => file.startsWith('tests/acceptance/') && /\.(py|mjs|ps1)$/.test(file)).length;

let bundle = '_dist/ is not built; run `npm run build` first._';
const assets = join(root, 'dist/assets');
if (existsSync(assets)) {
  const files = readdirSync(assets).map(name => ({ name, size: statSync(join(assets, name)).size }));
  const total = ext => files.filter(file => file.name.endsWith(ext)).reduce((sum, file) => sum + file.size, 0);
  const biggest = files.filter(file => file.name.endsWith('.js')).sort((a, b) => b.size - a.size).slice(0, 5);
  bundle = [`| Measure | Size |`, `| --- | --- |`,
    `| All JavaScript | ${total('.js')} bytes (${kib(total('.js'))}) in ${files.filter(file => file.name.endsWith('.js')).length} files |`,
    `| All CSS | ${total('.css')} bytes (${kib(total('.css'))}) |`,
    ...biggest.map(file => `| ${file.name.replace(/-[A-Za-z0-9_-]{8}\.js$/, '-<hash>.js')} | ${file.size} bytes (${kib(file.size)}) |`)].join('\n');
}

writeFileSync(join(root, 'docs/verification/numbers.md'), `# Generated numbers

Written by \`node tools/dev/write-numbers.mjs\`; do not edit by hand. Other documents quote these figures and should point here.

## Tests

| Group | Count |
| --- | --- |
| Frontend checks run by \`npm run test:ui\` (\`tests/frontend/*-check.mjs\` and \`ui-rules.mjs\`) | ${frontendChecks} files |
| Python checks in CI (\`tests/manifest-python.json\`, group \`ci\`) | ${python.ci.length} files (${Object.keys(python.skipped).length} listed as skipped with a reason) |
| Rust unit tests (\`#[test]\` in \`desktop/src\`) | ${rustTests} (${rustIgnored} marked \`#[ignore]\`) |
| Browser tests (\`npm run test:e2e\`) | ${e2e} |
| Acceptance scripts (\`tests/acceptance\`, run by hand or by the weekly job) | ${acceptance} files |

## Built interface (\`dist/assets\`)

${bundle}

The budgets that fail the build are in \`tools/dev/bundle-budget.json\` (\`npm run test:bundle\`).
`);
console.log('docs/verification/numbers.md written');
