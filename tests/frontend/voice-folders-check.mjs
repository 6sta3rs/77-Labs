import { sourceUrl } from '../helpers/source-url.mjs';
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {get,writable} from 'svelte/store'
import ts from 'typescript'
async function execute(file,dependencies={}){
 let source=await readFile(sourceUrl(file),'utf8')
 const parsed=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true)
 for(const node of [...parsed.statements].reverse())if(ts.isImportDeclaration(node))source=source.slice(0,node.pos)+source.slice(node.end)
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,output={}
 new Function('exports',...Object.keys(dependencies),code)(output,...Object.values(dependencies));return output
}
let raw=null,fail=false,writes=0
const storage={getItem:()=>raw,setItem:(_,value)=>{if(fail)throw Error('quota');raw=value;writes++}}
const folders=await execute('voice-folders.ts',{get,writable,localStorage:storage,crypto}),metadata=await execute('voice-metadata.ts')
const tests=[];function test(name,fn){tests.push({name,fn})}
test('Corrupt and duplicate folder records are normalized without losing valid IDs',()=>{const rows=folders.parseVoiceFolders(JSON.stringify([{id:'a',name:' A ',voiceIds:['v','v',2]},{id:'a',name:'duplicate',voiceIds:[]},{id:'b',name:'',voiceIds:[]}]));assert.deepEqual(rows,[{id:'saved',name:'Zapisane głosy',voiceIds:[]},{id:'a',name:'A',voiceIds:['v']}]);assert.deepEqual(folders.parseVoiceFolders('{'),folders.defaultVoiceFolder())})
test('Saving is idempotent and only stores references to the voice',()=>{folders.saveVoiceToFolder('saved','v1');folders.saveVoiceToFolder('saved','v1');assert.deepEqual(get(folders.voiceFolders)[0].voiceIds,['v1']);assert.equal(JSON.parse(raw)[0].voiceIds[0],'v1')})
test('A named folder can be created and round-tripped across sessions',()=>{const id=folders.addVoiceFolder('Narracja');folders.saveVoiceToFolder(id,'v2');assert.equal(folders.addVoiceFolder(' narracja '),id);assert.deepEqual(folders.parseVoiceFolders(raw),get(folders.voiceFolders))})
test('Storage failure does not publish a false success or erase saved folders',()=>{const before=get(folders.voiceFolders);fail=true;assert.throws(()=>folders.saveVoiceToFolder('saved','v3'),/quota/);assert.equal(get(folders.voiceFolders),before);fail=false})
test('Invalid folder and empty names do not change storage',()=>{const count=writes;assert.throws(()=>folders.saveVoiceToFolder('missing','v'));assert.throws(()=>folders.addVoiceFolder(' '));assert.equal(writes,count)})
test('Timestamp accepts backend seconds, milliseconds and ISO without inventing dates',()=>{for(const value of [1705320000,1705320000000,'1705320000','2024-01-15T12:00:00Z'])assert.equal(metadata.profileCreatedAt(value),'2024-01-15T12:00:00.000Z');for(const value of [null,undefined,'',NaN,'bad date',0])assert.equal(metadata.profileCreatedAt(value),undefined)})
test('Accent comes only from a declaration or actual design metadata',()=>{assert.equal(metadata.profileAccent({vd_states:'{"EnglishAccent":"british accent"}'}),'Brytyjski');assert.equal(metadata.profileAccent({language:'Polish',kind:'clone'}),undefined);assert.equal(metadata.profileAccent({vd_states:'bad'}),undefined);assert.equal(metadata.profileAccent({accent:'Standardowy'}),'Standardowy')})
test('Polish age label distinguishes creation from unknown metadata',()=>{const now=Date.parse('2026-10-20T12:00:00Z');assert.equal(metadata.voiceAge('2024-10-19T12:00:00Z',now),'2 lata');assert.equal(metadata.voiceAge(undefined,now),'Brak daty');assert.equal(metadata.voiceAge('2026-10-20T01:00:00Z',now),'Dzisiaj');assert.equal(metadata.voiceAge('2027-01-01',now),'Brak daty')})
let errors=0;for(const {name,fn}of tests){try{fn();console.log('PASS '+name)}catch(cause){errors++;console.error('FAIL '+name+': '+cause.message)}}console.log(`Voice folders/metadata: ${tests.length-errors}/${tests.length}`);if(errors)process.exitCode=1
