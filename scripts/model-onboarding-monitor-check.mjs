import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('api.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = new Set(['isRuntimeMonitor', 'prepareRequest', 'request']);
const statements = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)
  || ts.isVariableStatement(node) && node.declarationList.declarations.some(entry => entry.name.getText(ast) === 'runtimeMonitorPaths'));
const js = ts.transpileModule(statements.map(node => node.getText(ast)).join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let starts = 0, release = 0;
const acquisitions = [];
const api = {};
new Function('exports', 'isDesktop', 'isTauri', 'ensureRuntime', 'acquireRuntime', 'desktopFetch', 'routeBackendPath', js)(
  api, () => true, () => true, async () => { starts++; },
  async (_signal, allowStart) => { acquisitions.push(allowStart); return async () => { release++; }; },
  async () => new Response(JSON.stringify({ fixture: true }), { headers: { 'Content-Type': 'application/json' } }),
  path => path,
);
for (const path of ['/next/models/onboarding', '/next/models/onboarding?fixture=1']) {
  assert.equal(api.isRuntimeMonitor(path), true);
  await api.prepareRequest(path);
}
await api.request('/next/models/onboarding');
assert.equal(starts, 0, 'Reading the onboarding plan must never start Python.');
assert.deepEqual(acquisitions, [false]);
assert.equal(release, 1);
assert.equal(api.isRuntimeMonitor('/next/models/onboarding', 'POST'), false);
assert.equal(api.isRuntimeMonitor('/next/models/onboarding-other'), false);
console.log('Onboarding monitor: PASS (exact GET, no Python autostart, retained native owner released).');
