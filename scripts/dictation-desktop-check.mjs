import { mkdir as ensureQaDirectory } from 'node:fs/promises';
await ensureQaDirectory(new URL('../.tmp/qa/', import.meta.url), { recursive: true });
import strict from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import {compile} from 'svelte/compiler';
let checks=0;const assert=new Proxy(strict,{get:(target,key)=>typeof target[key]==='function'?(...args)=>{checks++;return target[key](...args);}:target[key]});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
for(const filename of ['DictationDesktopSettings.svelte','DictationWidget.svelte']){const source=await readFile(new URL(`../src/lib/${filename}`,import.meta.url),'utf8');assert.doesNotThrow(()=>compile(source,{filename,generate:'client'}),`${filename} must compile as a complete component, including its event expressions.`);}
async function load(filename,deps={},exposure=''){let source=await readFile(new URL(`../src/lib/${filename}`,import.meta.url),'utf8');if(filename.endsWith('.svelte'))source=source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];const parsed=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);for(const node of [...parsed.statements].reverse())if(ts.isImportDeclaration(node))source=source.slice(0,node.pos)+source.slice(node.end);if(exposure)source+=`\nreturn {${exposure}};`;const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;const result={};return new Function('exports',...Object.keys(deps),code)(result,...Object.values(deps))??result;}
const calls=[];let native=true,status={supported:true,registered:false,preferences:{enabled:false,shortcut:'Ctrl+Alt+Shift+D',paste_enabled:false}};
const helper=await load('dictation-desktop.ts',{isTauri:()=>native,invoke:async(name,args)=>{calls.push({name,args});if(name==='dictation_desktop_status')return status;if(name==='dictation_widget_runtime_acquire')return{lease:5,status:{state:'ready'}};return status;}});
assert.deepEqual(helper.defaultDictationDesktopPreferences(),{enabled:false,shortcut:'Ctrl+Alt+Shift+D',paste_enabled:false});
for(const value of ['Ctrl+Alt+Shift+D','Ctrl+Shift+Space','Alt+Shift+F11'])assert.equal(helper.shortcutError(value),'');
for(const value of ['D','Ctrl+D','Shift+Super+D','Ctrl+Ctrl+D','Ctrl+Alt+F12','Ctrl+Alt+Delete','Ctrl++D'])assert.notEqual(helper.shortcutError(value),'');
assert.equal(calls.length,0,'Importing the settings helper must never register a hotkey.');
native=false;assert.equal((await helper.desktopDictationStatus()).supported,false);await assert.rejects(helper.configureDesktopDictation(helper.defaultDictationDesktopPreferences()),/desktopowej/);assert.equal(calls.length,0);native=true;
await helper.configureDesktopDictation({...helper.defaultDictationDesktopPreferences(),enabled:true});assert.equal(calls.at(-1).name,'dictation_desktop_configure');assert.equal(calls.at(-1).args.preferences.paste_enabled,false);
const occupied=await load('dictation-desktop.ts',{isTauri:()=>true,invoke:async()=>{throw 'Kombinacja jest zajęta przez inną aplikację.';}});await assert.rejects(occupied.configureDesktopDictation({...helper.defaultDictationDesktopPreferences(),enabled:true}),/zajęta przez inną aplikację/);
const invalidCalls=calls.length;await assert.rejects(helper.configureDesktopDictation({enabled:true,shortcut:'D',paste_enabled:false}),/modyfikator/);assert.equal(calls.length,invalidCalls);
await assert.rejects(helper.copyDesktopDictation(' '),/Brak tekstu/);await assert.rejects(helper.copyDesktopDictation('a\0b'),/niedozwolony/);await assert.rejects(helper.copyDesktopDictation('x'.repeat(100001)),/długi/);assert.equal(calls.length,invalidCalls);
await helper.copyDesktopDictation('Zażółć gęślą jaźń.');assert.equal(calls.at(-1).name,'dictation_desktop_copy');assert.equal(calls.some(row=>row.name==='dictation_desktop_paste'),false);
const release=await helper.acquireWidgetRuntime(new AbortController().signal);await release();await release();assert.equal(calls.filter(row=>row.name==='dictation_widget_runtime_release').length,1);
const cancelled=new AbortController(),leased=deferred();const pendingHelper=await load('dictation-desktop.ts',{isTauri:()=>true,invoke:async(name,args)=>{calls.push({name,args});if(name==='dictation_widget_runtime_acquire')return leased.promise;},getRuntimeStatus:async()=>({state:'ready'})});const pending=pendingHelper.acquireWidgetRuntime(cancelled.signal);cancelled.abort();leased.resolve({lease:7,status:{state:'ready'}});await assert.rejects(pending,error=>error.name==='AbortError');assert.ok(calls.some(row=>row.name==='dictation_widget_runtime_release'&&row.args.lease===7));
const listeners=[],listenerWaits=[];let removed=0;const eventsHelper=await load('dictation-desktop.ts',{isTauri:()=>true,listen:async(name,callback)=>{listeners.push({name,callback});const wait=deferred();listenerWaits.push(wait);await wait.promise;return()=>removed++;}});const listenerAbort=new AbortController();let events=0;const watched=eventsHelper.watchDesktopDictation({status:()=>events++,shown:()=>events++,hidden:()=>events++},listenerAbort.signal);listenerAbort.abort();listenerWaits.forEach(wait=>wait.resolve());const stopWatch=await watched;listeners.forEach(row=>row.callback({payload:{}}));stopWatch();assert.equal(removed,3);assert.equal(events,0);

const mounts=[],destroys=[],state=value=>value;state.raw=value=>value;let visibility,starts=0,cancels=0,releases=0,leases=0,apiCalls=0,pastes=0,copies=0,acks=0;const firstModels=deferred();let slow=false;
const widget=await load('DictationWidget.svelte',{
  remoteBackend:{state:async()=>({active:false})},
  $props:Object.assign(()=>({}),{id:()=> 'qa-widget'}),$state:state,$derived:value=>value,onMount:fn=>mounts.push(fn),onDestroy:fn=>destroys.push(fn),
  isDesktop:()=>true,applyAppearance(){},loadAppearance:()=>({}),desktopDictationStatus:async()=>status,
  watchDesktopDictation:async handlers=>{visibility=handlers;return()=>{};},
  acquireWidgetRuntime:async()=>{leases++;return async()=>releases++;},
  productionJson:async path=>{apiCalls++;if(path==='/dictation/models'){if(slow){slow=false;await firstModels.promise;}return{engine_available:true,default_model_id:'qa',models:[{id:'qa',installed:true,label:'QA'}]};}if(path==='/dictation/prefs')return{model_id:'qa'};return{ready:true};},
  LiveDictation:class{constructor(callbacks){this.callbacks=callbacks;}async start(){starts++;this.callbacks.phase('listening');}cancel(){cancels++;this.callbacks.phase('idle');}async stop(){this.callbacks.phase('complete');}},
  emptyDictation:()=>({text:'',partial:'',utterances:[],complete:false,warning:''}),
  acknowledgeDictationStopped:async()=>acks++,copyDesktopDictation:async()=>copies++,pasteDesktopDictation:async()=>pastes++,
  hideDictationWidget:async()=>{},workletUrl:'/dictation-worklet.js',location:{origin:'http://tauri.localhost'},
},'start,cancel,loadModels,get text(){return text}');
mounts.forEach(fn=>fn());await Promise.resolve();assert.equal(starts,0);assert.equal(leases,0);assert.equal(apiCalls,0,'Showing the utility must not start Python, ASR or microphone.');
visibility.shown();await Promise.resolve();assert.equal(starts,0);assert.equal(pastes,0);assert.equal(copies,0);
slow=true;const old=widget.start();await Promise.resolve();await Promise.resolve();widget.cancel();const newer=widget.start();await newer;assert.equal(starts,1);assert.equal(leases,2);assert.equal(releases,1);firstModels.resolve();await old;assert.equal(releases,1,'An old cancelled preparation cannot release the new session lease.');
visibility.hidden(3);await Promise.resolve();assert.equal(releases,2);assert.equal(acks,1);assert.equal(pastes,0);assert.equal(copies,0);assert.ok(cancels>=1);destroys.forEach(fn=>fn());
await writeFile(new URL('../.tmp/qa/dictation-desktop-checks.json',import.meta.url),JSON.stringify({date:new Date().toISOString(),checksPassed:checks,transport:'controlled IPC and LiveDictation fixtures',physicalMicrophone:false,clipboardAccess:false,inputInjection:false,verified:['default opt-in','shortcut validation','readable native collision error','no runtime/microphone on open','no automatic copy/paste','late listener cleanup','cancelled lease release','old preparation cannot release new session lease','hide cancels and acknowledges'],tauriHandlerOrWidgetVerified:false},null,2)+'\n');
console.log(`Desktop dictation: ${checks} checks passed; no physical microphone, clipboard write or system key injection.`);
