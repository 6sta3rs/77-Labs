import { mkdir as ensureQaDirectory } from 'node:fs/promises';
await ensureQaDirectory(new URL('../.tmp/qa/', import.meta.url), { recursive: true });
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';
const origin='http://127.0.0.1:4312',token=process.env.VOICE_QA_TOKEN;
assert.ok(token,'Set VOICE_QA_TOKEN for the owned disposable backend.');
const checks=[];function check(name,value){assert.ok(value,name);checks.push({name,passed:true});}
const health=await fetch(`${origin}/health`);check('Owned disposable backend',health.ok&&health.headers.get('x-voicestudio-next')===token);
async function json(path,options){const response=await fetch(`${origin}${path}`,options);if(!response.ok)throw new Error(`${path}: ${response.status} ${(await response.text()).slice(0,250)}`);return response.json();}
async function load(filename,deps){let source=await readFile(new URL(`../src/lib/${filename}`,import.meta.url),'utf8');const parsed=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);for(const node of [...parsed.statements].reverse())if(ts.isImportDeclaration(node))source=source.slice(0,node.pos)+source.slice(node.end);const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;const exported={};new Function('exports',...Object.keys(deps),code)(exported,...Object.values(deps));return exported;}
const diag=await load('runtime-diagnostics.ts',{productionJson:json});
const audio=await load('audio-lab.ts',{productionJson:json});
const snapshot=await diag.runtimeSnapshot();
check('Read actual RAM and CPU metrics',snapshot.memory.data&&Number.isFinite(snapshot.memory.data.ram)&&snapshot.memory.data.total_ram>0);
check('Enumerate loaded models without loading any',Array.isArray(snapshot.models.data?.models));
check('Read available media tools',snapshot.media.data&&typeof snapshot.media.data.ready==='boolean');
check('Read watermark availability',typeof snapshot.watermark.data?.audioseal_available==='boolean');
check('Read current compute device',snapshot.compute.data&&diag.computeChoices(snapshot.compute.data).includes(snapshot.compute.data.value));
check('Read current performance profiles',Array.isArray(snapshot.performance.data?.applicable_families)&&Array.isArray(snapshot.performance.data?.tiers));
const loadedBefore=snapshot.models.data.models.map(model=>model.id).sort();
const report=await diag.runOfflineDiagnostics();
check('Run offline diagnostics without synthesis',Array.isArray(report.checks)&&report.checks.length>=8&&!report.checks.some(row=>/network|deep_synthesis/.test(row.id)));
const errors=await diag.recentRuntimeErrors();check('Read structured recent error journal',Array.isArray(errors.errors)&&typeof errors.count==='number');
const logs=await diag.runtimeLogs();check('Read bounded runtime log tail',Array.isArray(logs.lines)&&logs.lines.length<=100);
const catalog=await audio.audioCatalog();check('Read effect preset catalog',catalog.effects.length>0&&catalog.effects.every(item=>item.id&&item.label));check('Read plugin availability catalog',Array.isArray(catalog.plugins));
let computeSaved=false,performanceSaved=false;
if(snapshot.compute.data&&!snapshot.compute.data.env_pinned){const after=await diag.saveComputeDevice(snapshot.compute.data.value,snapshot.compute.data);computeSaved=true;check('Explicit compute save preserves the current value and applied device',after.value===snapshot.compute.data.value&&after.applied===snapshot.compute.data.applied);}
if(snapshot.performance.data?.applicable_families.includes('tts')){
 const before=snapshot.performance.data;
 try{const after=await diag.savePerformance(before.effective.tts,'tts',before);performanceSaved=true;check('Explicit TTS preset save starts no model download',after.effective.tts===before.effective.tts&&after.downloads_started===false);}
 finally{if(performanceSaved){await json('/api/settings/performance-profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({tier:before.global})});for(const [family,tier] of Object.entries(before.overrides))await json('/api/settings/performance-profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({family,tier})});}}
 const restored=await json('/api/settings/performance-profile');check('Performance API state restored after the test',JSON.stringify(restored.overrides)===JSON.stringify(before.overrides)&&JSON.stringify(restored.effective)===JSON.stringify(before.effective)&&restored.global===before.global);
}
const loadedAfter=await json('/model/loaded');check('Diagnostics and same-value saves loaded no additional models',JSON.stringify(loadedAfter.models.map(model=>model.id).sort())===JSON.stringify(loadedBefore));
const evidence={date:new Date().toISOString(),backend:'disposable QA only',inference:false,cleanAudioExecuted:false,computeSaved,performanceSaved,modelsBefore:loadedBefore,diagnosticSummary:report.summary,mediaReady:snapshot.media.data.ready,effectPresetIds:catalog.effects.map(item=>item.id),pluginCount:catalog.plugins.length,recentErrorCount:errors.count,logLinesRead:logs.lines.length,checks};
await writeFile(new URL('../.tmp/qa/audio-diagnostics-runtime.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({passed:checks.length,diagnosticSummary:report.summary,computeSaved,performanceSaved,report:'.tmp/qa/audio-diagnostics-runtime.json'},null,2));
