import { sourceUrl } from '../helpers/source-url.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
async function helpers(name){const source=await readFile(sourceUrl(name),'utf8');const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const result={};new Function('exports',code)(result);return result;}
const speech=await helpers('speech-settings.ts'),audio=await helpers('audio.ts');
const app=(await readFile(new URL('../../src/App.svelte',import.meta.url),'utf8')).match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
const parsed=ts.createSourceFile('app.ts',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const functions=new Set(['generate','restore','persistProject','openProject','changeBlocks','changeSpeechSettings']);
const actual=parsed.statements.filter(node=>ts.isFunctionDeclaration(node)&&functions.has(node.name?.text)).map(node=>node.getText(parsed)).join('\n');
const recipe={description:'Public fixture recipe',picks:{Gender:'female',Pitch:'low pitch'}};
const part={sampleRate:48000,channels:1,frames:80,bits:32,float:true,samples:Float32Array.from({length:80},(_,i)=>Math.sin(i/9)*0.4)};
for(const preset of [false,true]){
 const requests=[],saved=[],storage=new Map();
 const initial={...speech.defaultSpeechSettings(),wav_bits:'24',...(preset?{preset_voice:'built-in-2'}:{design_recipe:recipe})};
 const fixture=`let speechSettings=cloneSpeechSettings(initial),projects=[],projectId='current',projectName='QA narration',loaded=true;
 let blocks=[{id:'one',voiceId:'qa-voice',text:'First fixture block.'},{id:'two',voiceId:'qa-voice',text:'Second fixture block.'}];
 let running=false,generationStage='',controller,generatingPreview,projectSaveTimer,projectSaveDeadline;
 let language='English',speed=1,steps=8,seed='42',effect='raw';
 const canGenerate=true,demoMode=false,isDesktop=false,runtime={state:'ready'},generationEngine=preset?'kittentts':'omnivoice';
 const generationBackend=preset?{id:generationEngine,supports_cloning:false,preset_voices:['built-in-2']}:{id:generationEngine,supports_cloning:true,supports_voice_design:true};
 const generationContext={hasReference:false,supportsWavBits:true,supportsPresetVoice:true,supportsDesignRecipe:true};
 const generationUsesPreset=preset,ttsFamily={backends:[{id:generationEngine,display_name:'QA fixture engine'}]};
 const voices=[{id:'qa-voice',name:'QA voice',kind:'Projektowany',demo:false}],primaryVoice=voices[0];
 function scheduleProjectSave(){};function goToPage(){};function notify(){};function userMessage(error){return error.message};function markEngineConfirmed(){};function unmarkEngineConfirmed(){};`;
 const exposure=`return {generate,restore,persistProject,openProject,changeSpeechSettings,get result(){return {speechSettings,projects,blocks}},set settings(value){speechSettings=value}};`;
 const code=ts.transpileModule(fixture+actual+exposure,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const dependencies={...speech,...audio,initial,preset,localStorage:{setItem:(key,value)=>storage.set(key,value)},api:{generate:async(input)=>{
   requests.push(input);const bits=input.parameters.wav_bits;return {blob:audio.encodeSpeechWave([part],bits),duration:part.frames/part.sampleRate};
 }},audioPeaks:async()=>[],storeAudio:async row=>saved.push(row)};
 const subject=new Function(...Object.keys(dependencies),code)(...Object.values(dependencies));
 await subject.generate();assert.equal(requests.length,2);assert.equal(saved.length,1);
 for(const input of requests){assert.equal(input.parameters.wav_bits,'24');assert.equal(input.profileId,preset?'':'qa-voice');assert.equal(input.parameters.preset_voice,preset?'built-in-2':undefined);if(!preset)assert.deepEqual(JSON.parse(input.parameters.design_recipe),recipe);}
 const take=saved[0],decoded=audio.decodeWave(await take.blob.arrayBuffer());assert.equal(decoded.bits,24);assert.equal(decoded.sampleRate,48000);assert.equal(decoded.frames,80*2+48000*0.2);assert.equal(take.duration,decoded.frames/48000);assert.equal(take.wavBits,'24');assert.equal(take.presetVoice,preset?'built-in-2':undefined);
 subject.settings=speech.defaultSpeechSettings();subject.restore(take);assert.equal(subject.result.speechSettings.wav_bits,'24');if(!preset)assert.deepEqual(subject.result.speechSettings.design_recipe,recipe);
 subject.persistProject();const projects=JSON.parse(storage.get('voicestudio.projects.v2'));assert.equal(projects[0].speechSettings.wav_bits,'24');assert.equal(projects[0].generationEngine,preset?'kittentts':'omnivoice');if(!preset)assert.deepEqual(projects[0].speechSettings.design_recipe,recipe);
 const other={...projects[0],id:'saved-project'};subject.settings=speech.defaultSpeechSettings();subject.openProject(other);assert.equal(subject.result.speechSettings.wav_bits,'24');if(!preset)assert.deepEqual(subject.result.speechSettings.design_recipe,recipe);
}
console.log('Speech App contracts PASS: actual two-block generation flow, real WAV24 artifact, preset vs profile payloads, recipe JSON, duration with gaps, recording restore and project roundtrip. No server or ML.');
