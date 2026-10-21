import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../../src/lib/models/license-sources.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const result={}, calls=[];let desktop=true,failure;
new Function('exports','require',code)(result,()=>({isTauri:()=>desktop,invoke:async(command,args)=>{calls.push({command,args});if(failure)throw failure;}}));
let checks=0;
for(const url of ['https://github.com/owner/repo/blob/revision/LICENSE?raw=1#terms','https://huggingface.co/owner/model/blob/main/LICENSE.md','https://modelscope.cn/models/owner/model/file/view/master/LICENSE']){
  assert.equal(result.validateLicenseSource(url),url);checks++;
}
assert.equal(result.validateLicenseSource('HTTPS://GITHUB.COM:443/owner/repo'),'https://github.com/owner/repo');checks++;
for(const url of ['',undefined,'http://github.com/owner/repo','file:///C:/Windows/System32/cmd.exe','javascript:alert(1)','ms-settings:appsdefaults',
  'https://github.com.evil.example/license','https://sub.github.com/license','https://github.com./license','https://example.com/?next=https://github.com','https://127.0.0.1/license',
  'https://user:pass@github.com/license','https://user@github.com/license','https://@github.com/license','https://github.com:444/license','https://github.com\\@evil.example/license',
  'https://github.com/\nlicense',' https://github.com/license','https://github.com/license\0','https://github.com/\u0085',`https://github.com/${'x'.repeat(4096)}`]){
  assert.throws(()=>result.validateLicenseSource(url));checks++;
}
await result.openLicenseSource('HTTPS://GITHUB.COM:443/owner/repo?raw=1#terms');
assert.deepEqual(calls,[{command:'open_license_source',args:{url:'https://github.com/owner/repo?raw=1#terms'}}]);checks++;
await assert.rejects(result.openLicenseSource('https://foreign.example/license'));assert.equal(calls.length,1);checks+=2;
failure='Windows controlled failure';await assert.rejects(result.openLicenseSource('https://github.com/owner/repo'),/Windows controlled failure/);checks++;
failure={unknown:true};await assert.rejects(result.openLicenseSource('https://github.com/owner/repo'),/Skopiuj odnośnik/);checks++;
desktop=false;failure=undefined;
globalThis.window={open:(...args)=>{calls.push(args);return null;}};
await result.openLicenseSource('https://huggingface.co/owner/model#license');
assert.deepEqual(calls.at(-1),['https://huggingface.co/owner/model#license','_blank','noopener,noreferrer']);checks++;
delete globalThis.window;
console.log(`License sources: ${checks} checks passed; no external page opened.`);
