import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
const catalogueProof = JSON.parse(read('scripts/runtime/app/engine_catalogue_data.json')).extra_catalogue_lf_sha256;
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
// Akcje GitHub muszą być przypięte do pełnego SHA commitu (wersja w komentarzu), nie do ruchomego taga.
for (const file of trackedAll.filter(path => /^\.github\/workflows\/.+\.ya?ml$/.test(path))) {
  for (const [, action] of read(file).matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) check(action.startsWith('./') || /@[0-9a-f]{40}$/.test(action), `${file}: akcja ${action} nie jest przypięta do SHA.`);
}
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
// Ciche błędy: pusty blok catch (bez instrukcji) musi mieć komentarz z powodem.
const silentCatch = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
let silent = 0;
for (const file of trackedAll.filter(path => /\.(svelte|ts|mjs|js)$/.test(path) && existsSync(resolve(root, path)))) {
  const matches = read(file).match(silentCatch);
  if (matches) { silent += matches.length; failures.push(`${file}: ${matches.length} pusty(ch) catch bez komentarza z powodem (np. catch { /* powód */ }).`); }
}
// Limit długości plików kodu (ratchet): plik ponad limit wymaga wpisu z powodem; wpis ma dokładnie bieżący rozmiar
// (tabele danych, "data": true, mogą rosnąć; rośnie → błąd, maleje → trzeba obniżyć wpis: `node tools/dev/check-structure.mjs --write-baselines`); plik niebędący danymi
// nie przekracza 1000 linii; to samo dla najdłuższej linii (linie ponad 200 i 400 znaków oraz najdłuższa) w każdym pliku.
const lineLimit = Number(process.env.LINE_LIMIT) || 600;
const hardLimit = 1000;
const exceptionsPath = 'tools/dev/line-limit-exceptions.json';
const baselinePath = 'tools/dev/line-length-baseline.json';
const exceptions = JSON.parse(read(exceptionsPath));
const lengthBaseline = JSON.parse(read(baselinePath));
let oversized = 0;
const sourceFiles = trackedAll.filter(file => /\.(svelte|ts|mjs|js|py|rs|css)$/.test(file) && existsSync(resolve(root, file)));
const measured = {};
for (const file of sourceFiles) {
  const rows = read(file).split('\n');
  const lengths = rows.map(row => row.replace(/\r$/, '').length);
  const lines = rows.length - 1;
  const metrics = { over200: lengths.filter(length => length > 200).length, over400: lengths.filter(length => length > 400).length, longest: Math.max(0, ...lengths) };
  if (metrics.over200 > 0) measured[file] = metrics;
  const exception = exceptions[file];
  if (lines > lineLimit && !exception) failures.push(`${file}: ${lines} linii (limit ${lineLimit}); podziel plik albo dopisz wyjątek z powodem w ${exceptionsPath}.`);
  else if (exception && lines <= lineLimit) failures.push(`${file}: ${lines} linii mieści się w limicie ${lineLimit}; usuń wyjątek.`);
  else if (exception && !exception.data && lines > exception.max) failures.push(`${file}: ${lines} linii przekracza wyjątek (${exception.max}); wyjątki nie mogą rosnąć.`);
  else if (exception && !exception.data && lines < exception.max) failures.push(
    `${file}: ${lines} linii, wyjątek wynosi ${exception.max}; obniż go (node tools/dev/check-structure.mjs --write-baselines).`);
  if (lines > hardLimit && !(exception?.data)) failures.push(`${file}: ${lines} linii; plik niebędący danymi nie może mieć więcej niż ${hardLimit}.`);
  if (exception) oversized++;
}
if (process.argv.includes('--write-baselines')) {
  const sizes = Object.fromEntries(sourceFiles.map(file => [file, read(file).split('\n').length - 1]));
  const entries = Object.entries(exceptions).map(([file, value]) => `  ${JSON.stringify(file)}: { "max": ${sizes[file] ?? value.max}, "reason": ${JSON.stringify(value.reason)}${value.data ? ', "data": true' : ''} }`);
  writeFileSync(resolve(root, exceptionsPath), `{\n${entries.join(',\n')}\n}\n`);
  const rows = Object.entries(measured).sort(([a], [b]) => a.localeCompare(b)).map(([file, m]) => `  ${JSON.stringify(file)}: { "over200": ${m.over200}, "over400": ${m.over400}, "longest": ${m.longest} }`);
  writeFileSync(resolve(root, baselinePath), `{\n${rows.join(',\n')}\n}\n`);
  console.log(`Zapisano ${entries.length} wyjątków i ${rows.length} wpisów najdłuższych linii; sprawdź git diff.`);
  process.exit(0);
}
for (const file of Object.keys(exceptions)) check(sourceFiles.includes(file), `${exceptionsPath}: brak śledzonego pliku ${file}`);
for (const [file, current] of Object.entries(measured)) {
  const base = lengthBaseline[file];
  if (!base) { failures.push(`${file}: ma linię dłuższą niż 200 znaków (najdłuższa ${current.longest}); nowe pliki nie mogą ich mieć.`); continue; }
  const worse = ['over200', 'over400', 'longest'].filter(key => current[key] > base[key]);
  const better = ['over200', 'over400', 'longest'].filter(key => current[key] < base[key]);
  if (worse.length) failures.push(`${file}: długie linie urosły (${worse.map(key => `${key} ${base[key]} → ${current[key]}`).join(', ')}); podziel linię.`);
  else if (better.length) failures.push(`${file}: długich linii jest mniej (${better.map(key => `${key} ${base[key]} → ${current[key]}`).join(', ')}); obniż próg: node tools/dev/check-structure.mjs --write-baselines.`);
}
for (const file of Object.keys(lengthBaseline)) if (!measured[file]) failures.push(`${baselinePath}: ${file} nie ma już linii ponad 200 znaków albo nie istnieje; obniż próg (--write-baselines).`);
for (const failure of failures) console.error(failure);
assert.equal(failures.length, 0, `Struktura projektu: ${failures.length} błędów`);
console.log(`Struktura PASS: ${embedded} zasobów osadzanych, SHA silnika, skrypty npm, ${links} odnośników dokumentacji, ${quoted} ścieżek w dokumentach, ${named} nazw plików, ${indexed} narzędzi w indeksach i limit ${lineLimit} linii (${oversized} wyjątków).`);
