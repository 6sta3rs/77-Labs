import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = path => readFileSync(resolve(root, path), 'utf8');
const failures = [];
function check(condition, message) { if (!condition) failures.push(message); }
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const flat = readdirSync(resolve(root, 'src/lib'), { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name);
check(flat.length === 1 && flat[0] === 'data.ts', 'src/lib powinien zawierać tylko wspólny data.ts oraz foldery obszarów.');
for (const directory of ['scripts', 'scripts/runtime']) {
  check(readdirSync(resolve(root, directory), { withFileTypes: true }).every(entry => entry.isDirectory()), `${directory}: pliki powinny należeć do odpowiedniego podfolderu.`);
}
let embedded = 0;
for (const file of files(resolve(root, 'src-tauri/src')).filter(path => path.endsWith('.rs'))) {
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
for (const file of [...files(resolve(root, 'docs')).filter(path => path.endsWith('.md')), resolve(root, 'README.md'), resolve(root, 'AGENTS.md')]) {
  for (const [, destination] of readFileSync(file, 'utf8').matchAll(/\]\(([^\s)]+)\)/g)) {
    if (/^(?:https?:|mailto:|#)/.test(destination)) continue;
    const path = decodeURIComponent(destination.split('#')[0]);
    if (!path) continue;
    check(existsSync(resolve(dirname(file), path)), `${file}: brak celu odnośnika ${destination}`);
    links++;
  }
}
// Ścieżki w znakach `...` w dokumentacji muszą istnieć. Jedna lista katalogów głównych; historia (postep.md) opisuje stan z przeszłości; plik, którego jeszcze nie ma lub już nie ma, oznacz „(planned)” albo „(removed)” tuż po znaku.
const pathRoots = ['scripts', 'tests', 'src', 'src-tauri', 'docs', 'tasks', 'assets', 'public', '.github'];
const historical = new Set(['docs/postep.md']);
const trackedAll = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const trackedPaths = new Set(trackedAll);
for (const file of trackedAll) for (let dir = dirname(file); dir !== '.'; dir = dirname(dir)) trackedPaths.add(dir);
// Build output and local folders that docs may mention but a fresh clone does not contain.
const generatedRoots = ['src-tauri/target', 'src-tauri/gen', 'dist', 'node_modules'];
const documents = trackedAll.filter(file => /\.md$/.test(file) && !historical.has(file));
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
// Limit długości plików kodu: nowe pliki ponad limit nie przechodzą, a istniejące wyjątki (z powodem) nie mogą rosnąć.
const lineLimit = Number(process.env.LINE_LIMIT) || 600;
const exceptions = JSON.parse(read('scripts/dev/line-limit-exceptions.json'));
let oversized = 0;
const sourceFiles = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(file => /\.(svelte|ts|mjs|js|py|rs|css)$/.test(file) && existsSync(resolve(root, file)));
for (const file of sourceFiles) {
  const lines = read(file).split('\n').length - 1;
  const exception = exceptions[file];
  if (lines > lineLimit && !exception) failures.push(`${file}: ${lines} linii (limit ${lineLimit}); podziel plik albo dopisz wyjątek z powodem w scripts/dev/line-limit-exceptions.json.`);
  else if (exception && lines > exception.max) failures.push(`${file}: ${lines} linii przekracza wyjątek (${exception.max}); wyjątki nie mogą rosnąć.`);
  else if (exception && lines <= lineLimit) failures.push(`${file}: ${lines} linii mieści się w limicie ${lineLimit}; usuń wyjątek.`);
  if (exception) oversized++;
}
for (const file of Object.keys(exceptions)) check(sourceFiles.includes(file), `line-limit-exceptions.json: brak śledzonego pliku ${file}`);
for (const failure of failures) console.error(failure);
assert.equal(failures.length, 0, `Struktura projektu: ${failures.length} błędów`);
console.log(`Struktura PASS: ${embedded} zasobów osadzanych, SHA silnika, skrypty npm, ${links} odnośników dokumentacji, ${quoted} ścieżek w dokumentach i limit ${lineLimit} linii (${oversized} wyjątków).`);
