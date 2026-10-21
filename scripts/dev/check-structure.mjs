import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

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
for (const failure of failures) console.error(failure);
assert.equal(failures.length, 0, `Struktura projektu: ${failures.length} błędów`);
console.log(`Struktura PASS: ${embedded} zasobów osadzanych, SHA silnika, skrypty npm i ${links} odnośników dokumentacji.`);
