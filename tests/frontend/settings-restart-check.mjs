import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=(await readFile(new URL('../../frontend/src/App.svelte',import.meta.url),'utf8')).match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
const ast=ts.createSourceFile('App.ts',source,ts.ScriptTarget.Latest,true);
const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='restartRuntime').getText(ast);
function fixture(stop, ensure=async()=>{}){
 let starts=0,reads=0;
 const dependencies={stopRuntime:async()=>stop,ensureRuntime:async()=>{starts++;await ensure()},getRuntimeStatus:async()=>({state:'ready'}),refreshVoices:async()=>reads++,refreshEngine:async()=>reads++};
 const js=ts.transpileModule('let running=false,runtimeBusy=false,runtime={};'+fn+'\nreturn {restartRuntime,get busy(){return runtimeBusy}}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return{...new Function(...Object.keys(dependencies),js)(...Object.values(dependencies)),starts:()=>starts,reads:()=>reads};
}
const busy=fixture({state:'ready',message:'Backend nadal wykonuje zadanie'});
await assert.rejects(busy.restartRuntime(),/Backend nadal wykonuje zadanie/);
assert.equal(busy.starts(),0);assert.equal(busy.reads(),0);assert.equal(busy.busy,false);
const good=fixture({state:'stopped'});await good.restartRuntime();assert.equal(good.starts(),1);assert.equal(good.reads(),2);assert.equal(good.busy,false);
const failed=fixture({state:'stopped'},async()=>{throw Error('startup fixture')});await assert.rejects(failed.restartRuntime(),/startup fixture/);assert.equal(failed.reads(),0);assert.equal(failed.busy,false);
console.log('Settings restart: 10 assertions passed (real App callback, refusal, success and failure cleanup).');
