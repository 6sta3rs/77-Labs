import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { versionMismatches } from '../release/release-guards.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = path => readFileSync(resolve(root, path), 'utf8');
const failures = [];
const trackedAll = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
function check(condition, message) { if (!condition) failures.push(message); }
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const directlyIn = folder => trackedAll.filter(file => dirname(file) === folder).map(file => file.split('/').pop()).sort();
check(JSON.stringify(directlyIn('frontend/src')) === JSON.stringify(['App.svelte', 'OrbMusicDemo.svelte', 'data.ts', 'gallery.ts', 'main.ts', 'orb-music-demo.ts', 'styles.css']), 'frontend/src powinien zawierać tylko pliki wejściowe, wspólny data.ts oraz foldery obszarów.');
for (const directory of ['scripts', 'scripts/runtime']) {
  check(directlyIn(directory).length === 0, `${directory}: pliki powinny należeć do odpowiedniego podfolderu.`);
}
let embedded = 0;
for (const file of files(resolve(root, 'desktop/src')).filter(path => path.endsWith('.rs'))) {
  for (const [, path] of readFileSync(file, 'utf8').matchAll(/include_(?:str|bytes)!\("([^"]+)"\)/g)) {
    check(existsSync(resolve(dirname(file), path)), `${file}: brak osadzanego zasobu ${path}`);
    embedded++;
  }
}
const provenance = JSON.parse(read('scripts/runtime/vendor/engine-provenance.json'));
const sha = createHash('sha256').update(readFileSync(resolve(root, 'scripts/runtime/vendor/engine.zip'))).digest('hex');
check(sha === provenance.archiveSha256, 'Przypięte archiwum silnika nie zgadza się z pochodzeniem.');
const catalogueProof = read('scripts/runtime/app/engine_catalogue_metadata.py').match(/"extra_catalogue_lf_sha256": "([a-f0-9]{64})"/)?.[1];
const catalogueSha = createHash('sha256').update(read('scripts/runtime/app/tts_catalog.py').replaceAll('\r\n', '\n')).digest('hex');
check(catalogueSha === catalogueProof, 'Katalog TTS nie zgadza się z przypiętym kontraktem szybkiego katalogu.');
for (const command of Object.values(JSON.parse(read('package.json')).scripts)) {
  for (const [, file] of command.matchAll(/\bnode\s+([^\s&]+)/g)) check(existsSync(resolve(root, file)), `package.json: brak skryptu ${file}`);
}
let links = 0;
for (const file of trackedAll.filter(path => path.endsWith('.md') && path !== 'docs/progress.md')) {
  for (const [, destination] of read(file).matchAll(/\]\(([^\s)]+)\)/g)) {
    if (/^(?:https?:|mailto:|#)/.test(destination)) continue;
    const path = decodeURIComponent(destination.split('#')[0]);
    if (!path) continue;
    check(existsSync(resolve(root, dirname(file), path)), `${file}: brak celu odnośnika ${destination}`);
    links++;
  }
}
for (const [name, command] of Object.entries(JSON.parse(read('package.json')).scripts)) {
  for (const [, file] of command.matchAll(/--(?:config|tsconfig)\s+(\S+)/g)) check(existsSync(resolve(root, file)), `package.json (${name}): brak pliku ${file}`);
}
// Ścieżki w znakach `...` w dokumentacji muszą istnieć. Jedna lista katalogów głównych; historia (progress.md) opisuje stan z przeszłości; plik, którego jeszcze nie ma lub już nie ma, oznacz „(planned)” albo „(removed)” tuż po znaku.
const pathRoots = ['scripts', 'tools', 'tests', 'frontend', 'desktop', 'docs', 'tasks', 'assets', 'public', '.github'];
const historical = new Set(['docs/progress.md']);
const trackedPaths = new Set(trackedAll);
for (const file of trackedAll) for (let dir = dirname(file); dir !== '.'; dir = dirname(dir)) trackedPaths.add(dir);
// Build output and local folders that docs may mention but a fresh clone does not contain.
const generatedRoots = ['desktop/target', 'desktop/gen', 'dist', 'node_modules'];
const documents = trackedAll.filter(file => /\.md$/.test(file) && !historical.has(file));
// Pięć plików z wersją (package.json, package-lock.json, tauri.conf.json, Cargo.toml, Cargo.lock) musi się zgadzać.
for (const mismatch of versionMismatches(root)) failures.push(`Wersje: ${mismatch}`);
// Katalogi, które przestały istnieć, nie mogą wracać do bieżących dokumentów (historia je opisuje: patrz `historyFiles`).
const retiredRoots = ['src/', 'src-tauri/', 'scripts/dev/', 'scripts/preview/', 'scripts/release/', 'scripts/build/'];
const historyFiles = new Set(['docs/progress.md', 'tasks/BOARD.md', 'tasks/specs/ROADMAP-to-8.md', 'tasks/specs/T-0011-rename-src-folders.md', 'tasks/audits/app-audit-2026-10-22.md']);
for (const file of trackedAll.filter(path => path.endsWith('.md') && !historyFiles.has(path))) {
  for (const [, token] of read(file).matchAll(/`([^`\s]+)`/g)) check(!retiredRoots.some(old => token.startsWith(old)), `${file}: \`${token}\` należy do układu sprzed przeniesienia.`);
}
for (const file of trackedAll.filter(path => /^docs\/.+\.md$/.test(path))) {
  const name = file.split('/').pop();
  if (!['README.md', 'PRD.md'].includes(name)) check(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[0-9]+)*\.md$/.test(name), `${file}: nazwa dokumentu powinna być angielska, w kebab-case.`);
}
let quoted = 0;
for (const file of documents) {
  const text = read(file);
  const spans = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(match => match[1])
    .concat([...text.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`\n]+)`(?! \((?:planned|removed)\))/g)].map(match => match[1]));
  for (const raw of spans.flatMap(span => span.split(/\s+/))) {
    const token = raw.replace(/^(?:--[\w-]+=)?["'(\[=]*/, '').replace(/["')\]]+$/, '').replaceAll(String.fromCharCode(92), '/');
    if (!pathRoots.some(base => token.startsWith(base + '/')) || /[*{}<>$|]|\.\.\./.test(token)) continue;
    const path = token.replace(/:\d+(?:-\d+)?$/, '').replace(/[.,;:]+$/, '').replace(/\/$/, '');
    if (generatedRoots.some(base => path === base || path.startsWith(base + '/'))) continue;
    check(trackedPaths.has(path), `${file}: ścieżka w znakach \`${path}\` nie jest śledzona w repozytorium.`);
    quoted++;
  }
}
// Nazwy plików: .mjs/.ts/.js/.svelte/.html/.css w kebab-case, .py w snake_case (tools/, tests/, scripts/runtime/).
const kebab = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+)*\.(?:mjs|ts|js|svelte|html|css)$/;
const snake = /^[a-z0-9]+(?:_[a-z0-9]+)*\.py$/;
let named = 0;
for (const file of trackedAll.filter(path => /^(?:tools|tests|scripts\/runtime)\//.test(path))) {
  const name = file.split('/').pop();
  if (/\.(?:mjs|ts|js|svelte|html|css)$/.test(name)) { check(kebab.test(name), `${file}: nazwa pliku powinna być w kebab-case.`); named++; }
  else if (name.endsWith('.py') && name !== '__init__.py') { check(snake.test(name), `${file}: nazwa pliku .py powinna być w snake_case.`); named++; }
}
// Każdy plik w tools/ ma wiersz w tools/README.md, a w tests/acceptance/ w tests/acceptance/README.md (folder wpisany z ukośnikiem obejmuje całą zawartość).
let indexed = 0;
for (const [folder, readme] of [['tools', 'tools/README.md'], ['tests/acceptance', 'tests/acceptance/README.md']]) {
  const listed = [...read(readme).matchAll(/`((?:tools|tests)\/[^`\s]+)`/g)].map(match => match[1]);
  for (const file of trackedAll.filter(path => path.startsWith(folder + '/') && path !== readme)) {
    check(listed.some(entry => entry === file || (entry.endsWith('/') && file.startsWith(entry))), `${file}: brak wiersza w ${readme}.`);
    indexed++;
  }
}
// Limit długości plików kodu: nowe pliki ponad limit nie przechodzą, a istniejące wyjątki (z powodem) nie mogą rosnąć.
const lineLimit = Number(process.env.LINE_LIMIT) || 600;
const exceptions = JSON.parse(read('tools/dev/line-limit-exceptions.json'));
let oversized = 0;
const sourceFiles = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(file => /\.(svelte|ts|mjs|js|py|rs|css)$/.test(file) && existsSync(resolve(root, file)));
for (const file of sourceFiles) {
  const lines = read(file).split('\n').length - 1;
  const exception = exceptions[file];
  if (lines > lineLimit && !exception) failures.push(`${file}: ${lines} linii (limit ${lineLimit}); podziel plik albo dopisz wyjątek z powodem w tools/dev/line-limit-exceptions.json.`);
  else if (exception && lines > exception.max) failures.push(`${file}: ${lines} linii przekracza wyjątek (${exception.max}); wyjątki nie mogą rosnąć.`);
  else if (exception && lines <= lineLimit) failures.push(`${file}: ${lines} linii mieści się w limicie ${lineLimit}; usuń wyjątek.`);
  if (exception) oversized++;
}
for (const file of Object.keys(exceptions)) check(sourceFiles.includes(file), `line-limit-exceptions.json: brak śledzonego pliku ${file}`);
for (const failure of failures) console.error(failure);
assert.equal(failures.length, 0, `Struktura projektu: ${failures.length} błędów`);
console.log(`Struktura PASS: ${embedded} zasobów osadzanych, SHA silnika, skrypty npm, ${links} odnośników dokumentacji, ${quoted} ścieżek w dokumentach, ${named} nazw plików, ${indexed} narzędzi w indeksach i limit ${lineLimit} linii (${oversized} wyjątków).`);
