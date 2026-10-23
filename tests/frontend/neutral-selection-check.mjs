import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const source=await readFile(new URL('../../frontend/src/styles/neutral-selection.ts',import.meta.url),'utf8')
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {neutralSelectionForRgb,neutralSelectionForColor}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))
const checks=[]
const test=(name,fn)=>{try{fn();checks.push({name,passed:true})}catch(error){checks.push({name,passed:false,error:error.message})}}
test('Approved dark canvases select the exact A+ background, hover and border',()=>{
  for(const [channel,background,hover,border]of [[10,'#343434','#242424','#565656'],[17,'#3b3b3b','#292929','#606060'],[24,'#444444','#303030','#6a6a6a']])assert.deepEqual(neutralSelectionForRgb([channel,channel,channel],true),{background,foreground:'#f5f5f5',hover,border})
})
test('Tone thresholds use the canvas brightness, including tinted backgrounds',()=>{
  assert.equal(neutralSelectionForRgb([10,10,11],true).background,'#3b3b3b')
  assert.equal(neutralSelectionForRgb([17,17,18],true).background,'#444444')
  assert.equal(neutralSelectionForRgb([0,17,34],true).background,'#3b3b3b')
})
test('Invalid probe values have a stable fallback',()=>{for(const rgb of [[],[NaN,0,0],[Infinity,0,0]])assert.equal(neutralSelectionForRgb(rgb,true).background,'#343434');assert.equal(neutralSelectionForColor('#181818',true).background,'#343434')})
test('Light mode keeps its approved readable counterpart',()=>{for(const rgb of [[10,10,10],[24,24,24],[255,255,255]])assert.deepEqual(neutralSelectionForRgb(rgb,false),{background:'#e5e5e5',foreground:'#171717',border:'#c4c4c4',hover:'#dcdcdc'})})
test('The selected tone gets lighter across the three sample backgrounds',()=>{const levels=[10,17,24].map(n=>parseInt(neutralSelectionForRgb([n,n,n],true).background.slice(1,3),16));assert.ok(levels[0]<levels[1]&&levels[1]<levels[2])})
for(const row of checks)console.log((row.passed?'PASS ':'FAIL ')+row.name+(row.error?': '+row.error:''))
console.log(`Neutral A+: ${checks.filter(row=>row.passed).length}/${checks.length}`)
if(checks.some(row=>!row.passed))process.exitCode=1
