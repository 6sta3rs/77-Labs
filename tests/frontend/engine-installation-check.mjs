import { i18nDeps, i18nRequire } from '../helpers/i18n.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { compile } from 'svelte/compiler';
let checks=0;
const source=await readFile(new URL('../../src/lib/models/engine-installation.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const calls=[];
const exports={};
new Function('exports','require',code)(exports,name=>/\/i18n$/.test(name)?i18nRequire(name):({
  postJson:(body,signal)=>({method:'POST',body:JSON.stringify(body),signal}),
  productionJson:async(path,options)=>{calls.push({path,options});return {};},
}));
const recipe={engine_id:'fixture',supported:true,disclosure_id:'a'.repeat(64),license_required:false,license_accepted:false};
assert.deepEqual(exports.validateRuntimeConsent(recipe,recipe.disclosure_id,true),{engine_id:'fixture',disclosure_id:recipe.disclosure_id,accepted:true});checks++;
for(const [value,id,accepted] of [[recipe,'old',true],[recipe,recipe.disclosure_id,false],[{...recipe,supported:false,host_note:'Windows niedostępny'},recipe.disclosure_id,true],[{...recipe,license_required:true},recipe.disclosure_id,true]]){
  assert.throws(()=>exports.validateRuntimeConsent(value,id,accepted));checks++;
}
for(const state of ['starting','installing','verifying','cancelling']){assert.equal(exports.runtimeInstallActive({state}),true);checks++;}
for(const state of ['complete','failed','cancelled','interrupted']){assert.equal(exports.runtimeInstallActive({state}),false);checks++;}
assert.equal(exports.runtimeInstallActive(undefined),false);checks++;
assert.equal(exports.runtimeSize(undefined),'nie podano');checks++;
assert.equal(exports.runtimeSize(Number.NaN),'nie podano');checks++;
assert.equal(exports.runtimeSize(1024),'1 KiB');checks++;
assert.equal(exports.runtimeTransfer({}), '');checks++;
assert.match(exports.runtimeTransfer({downloaded_bytes:1024}),/1 KiB.*nieznany/);checks++;
assert.equal(exports.runtimeTransfer({downloaded_bytes:1,total_bytes:10,weights_progress:{downloaded:2048,total:4096}}),'2 KiB / 4 KiB');checks++;
await exports.engineInstallation.catalog();await exports.engineInstallation.jobs();
assert.deepEqual(calls.map(call=>call.path),['/next/engine-runtimes/catalog','/next/engine-runtimes/jobs']);checks++;
assert.equal(calls.some(call=>call.options?.method==='POST'),false);checks++;
await exports.engineInstallation.install(recipe,recipe.disclosure_id,true);
assert.equal(calls.at(-1).path,'/next/engine-runtimes/install');checks++;
assert.equal(JSON.parse(calls.at(-1).options.body).accepted,true);checks++;
await exports.engineInstallation.cancel('fixture');assert.equal(calls.at(-1).path,'/next/engine-runtimes/cancel');checks++;
await exports.engineInstallation.activate(recipe);assert.deepEqual(JSON.parse(calls.at(-1).options.body),{engine_id:'fixture',disclosure_id:recipe.disclosure_id});checks++;
const component=await readFile(new URL('../../src/lib/models/EngineRuntimeInstaller.svelte',import.meta.url),'utf8');
const result=compile(component,{filename:'EngineRuntimeInstaller.svelte',generate:'client'});
assert.deepEqual(result.warnings,[]);checks++;
assert.match(component,/if\(!ready\|\|!opened\)return/);checks++;
assert.match(component,/if\(!ready\|\|!opened\|\|!active\)return/);checks++;
assert.match(component,/current\.abort\(\);if\(timer\)clearTimeout\(timer\)/);checks++;
assert.match(component,/Potwierdź instalację/);checks++;
assert.match(component,/job\.state==='cancelling'/);checks++;
console.log(`Engine installation UI: ${checks} checks passed.`);
