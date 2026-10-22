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
// The engine environment installer moved from models/EngineRuntimeInstaller.svelte into Settings → Silnik → Środowiska (EnginePage.svelte).
const component=await readFile(new URL('../../src/lib/settings/pages/EnginePage.svelte',import.meta.url),'utf8');
const result=compile(component,{filename:'EnginePage.svelte',generate:'client'});
assert.deepEqual(result.warnings,[]);checks++;
assert.match(component,/if \(!ready \|\| tab !== 'srodowiska'\) return;/,'Recipes are read only while the engine is ready and the environments tab is open.');checks++;
assert.match(component,/if \(!ready \|\| tab !== 'srodowiska' \|\| !\(jobsActive \|\| ttsInstalling \|\| mediaRunning\)\) return;/,'Polling runs only while something installs.');checks++;
assert.match(component,/return \(\) => \{ clearTimeout\(timer\); controller\.abort\(\); \};/,'Leaving the tab stops the poll and aborts its request.');checks++;
assert.match(component,/Potwierdź instalację/);checks++;
assert.match(component,/job\.state === 'cancelling'/);checks++;
assert.match(component,/disabled=\{!accepted \|\| working\.recipe \|\| jobsActive \|\| \(r\.license_required && !r\.license_accepted\)\}/,'Install needs explicit consent, no other running job and an accepted licence.');checks++;

// Behaviour: run the real page script with live runes and manual timers; progress must keep refreshing while a job stays active.
const { runesComponent, flush } = await import('../helpers/runes-component.mjs');
const queue=[];let timerId=0;const realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout;
globalThis.setTimeout=(fn,ms)=>{const id=++timerId;queue.push({id,fn,ms});return id;};
globalThis.clearTimeout=id=>{const index=queue.findIndex(item=>item.id===id);if(index>=0)queue.splice(index,1);};
const settle=async()=>{for(let i=0;i<20;i++){await Promise.resolve();flush();}};
const runTimers=async ms=>{for(const item of queue.filter(item=>item.ms===ms)){queue.splice(queue.indexOf(item),1);item.fn();}await settle();};
let jobReads=0,catalogReads=0;const running={engine_id:'fixture',state:'installing'};
try{
  const quiet={ok(){},bad(){},warn(){},info(){}};
  const page=await runesComponent('EnginePage.svelte',{props:{runtime:{state:'ready',message:'',port:1,managed:true},intent:'srodowiska',onstart(){},onstop(){},onrefresh(){}},deps:{
    invoke:async()=>null,toast:quiet,productionJson:async path=>path==='/next/tts/status'?{engines:[]}:path==='/media-tools/status'?{ops:{}}:path==='/history'?[]:path==='/sysinfo'?{cpu:1,ram:1,total_ram:16,gpu_utilization:null,vram:0,total_vram:0}:path.startsWith('/system/logs')?{lines:[],exists:true}:{},
    postJson:body=>({body}),computeChoices:()=>[],diagnosticCheckLabels:{},recentRuntimeErrors:async()=>({errors:[]}),redactDiagnosticText:String,redactDiagnosticValue:value=>value,
    runOfflineDiagnostics:async()=>({checks:[]}),runtimeSnapshot:async()=>({memory:{data:{ram:1,total_ram:16,vram:0,total_vram:0}},models:{},compute:{},performance:{},compile:{},media:{}}),saveCompileDisabled:async()=>({}),saveComputeDevice:async()=>({}),
    savePerformance:async()=>({}),unloadRuntimeModel:async()=>{},gpuEngineLabels:{},gpuOptionLabels:{},gpuStateLabels:{},preflightCheckLabels:{},putSettings:async()=>({}),
    settingsError:String,settingsTimeout:Number,readEngineIdleMinutes:()=>15,saveEngineIdleMinutes:async()=>{},engineIdleOptions:[5,15,30,60],
    runtimeInstaller:{status:async()=>({state:'idle'})},installingRuntime:()=>false,
    engineInstallation:{catalog:async()=>{catalogReads++;return{root:'',engines:[]};},jobs:async()=>{jobReads++;return{jobs:[running]};}},
    runtimeInstallActive:exports.runtimeInstallActive,runtimeInstallLabels:{},runtimePhaseLabels:{},runtimeSize:exports.runtimeSize,runtimeTransfer:exports.runtimeTransfer,
    openLicenseSource:async()=>{},validateLicenseSource(){},byteLabel:String,
  }});
  await settle();
  assert.equal(catalogReads,1,'Opening the tab reads the recipes once.');checks++;
  const afterOpen=jobReads;
  await runTimers(1500);await runTimers(1500);await runTimers(1500);
  assert.equal(jobReads-afterOpen,3,'An installation that stays active must keep refreshing its progress.');checks++;
  assert.equal(catalogReads,1,'Polling refreshes jobs only, never the catalogue.');checks++;
  running.state='complete';await runTimers(1500);const finished=jobReads;await runTimers(1500);
  assert.equal(jobReads,finished,'Polling stops once no job is active.');checks++;
  page.destroy();
}finally{globalThis.setTimeout=realSet;globalThis.clearTimeout=realClear;}
console.log(`Engine installation UI: ${checks} checks passed.`);
