import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { proxy, snapshot } from 'svelte/internal/client';
const source = await readFile(new URL('../../frontend/src/projects/library.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const {retentionRemovals} = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const rows = [
 {id:'old',source:'generation',created:'2026-10-18'},
 {id:'star',source:'generation',starred:true,created:'2026-10-17'},
 {id:'import',source:'import',created:'2026-10-16'},
 {id:'legacy',created:'2026-10-15'},
 {id:'new',source:'generation',created:'2026-10-20'},
];
assert.deepEqual(retentionRemovals(rows,1),['old']);
assert.deepEqual(retentionRemovals(rows,0),[]);
assert.deepEqual(retentionRemovals(rows),[]);
assert.deepEqual(retentionRemovals(rows,200),[]);
assert.throws(()=>retentionRemovals(rows,-1));
assert.throws(()=>retentionRemovals(rows,1.5));
assert.throws(()=>retentionRemovals(rows,100001));
assert.equal(rows[0].id,'old');
// Exercise the real write transaction: put, getAll, delete, completion and close.
let saved,deleted=[],closed=false;
globalThis.indexedDB={open(){const request={};queueMicrotask(()=>{const transaction={objectStore(){return{put(value){saved=value},getAll(){const request={};setTimeout(()=>{request.result=[...rows,saved];request.onsuccess();transaction.oncomplete()},0);return request},delete(id){deleted.push(id)}}}};request.result={transaction(){return transaction},close(){closed=true}};request.onsuccess()});return request}};
const {saveRecording}=await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
assert.deepEqual(await saveRecording({id:'newer',source:'generation',created:'2026-10-21',url:'blob:ephemeral'},1),['new','old']);
assert.deepEqual(deleted,['new','old']);
assert.equal(saved.url,undefined);
assert.equal(closed,true);
console.log('Recording retention: 12 assertions passed, including real save transaction path.');
const app=(await readFile(new URL('../../frontend/src/App.svelte',import.meta.url),'utf8')).match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
const ast=ts.createSourceFile('App.ts',app,ts.ScriptTarget.Latest,true);
const callback=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='toggleRecordingStar').getText(ast);
let persisted,notices=0;
const reactive=proxy({id:'reactive-take',title:'QA',created:'2026-10-20',kind:'audio',source:'generation',peaks:[.1,.6],blocks:[{id:'block',voiceId:'voice',text:'QA'}]});
const fixture=ts.transpileModule('let history=[row],recording=row,demoMode=false;'+callback+'\nreturn toggleRecordingStar;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const toggle=new Function('row','saveRecording','notify','$state',fixture)(reactive,async value=>{persisted=structuredClone(value)},()=>notices++,{snapshot});
await toggle(reactive);
assert.equal(notices,0,'A star must save a real Svelte-proxied row without DataCloneError');
assert.equal(persisted?.starred,true);
assert.deepEqual(persisted?.peaks,[.1,.6]);
assert.equal(persisted?.blocks[0].text,'QA');
console.log('Recording star: 4 additional assertions passed with real Svelte proxies and structured clone.');
