import { build } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
await mkdir('.tmp',{recursive:true})
await writeFile('.tmp/voice-audit.html','<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Odbiór wyboru głosu</title></head><body><div id="app"></div><script type="module">import {mount} from "svelte";import Fixture from "/scripts/fixtures/voice-picker-audit.svelte";import "/src/styles.css";import "/src/lib/ui.css";import "/src/lib/ui/product-controls.css";import "/src/lib/ui/overlays.css";mount(Fixture,{target:document.getElementById("app")});</script></body></html>')
const input=process.argv.includes('--fixture-only')?{fixture:resolve('.tmp/voice-audit.html')}:{app:resolve('index.html'),fixture:resolve('.tmp/voice-audit.html')}
await build({configFile:false,plugins:[svelte()],build:{outDir:'.tmp/voice-audit-dist',emptyOutDir:true,rollupOptions:{input}}})
await copyFile('scripts/select-language-ui-check.js','.tmp/voice-audit-dist/select-language-ui-check.js')
if(!process.argv.includes('--fixture-only')){
  const index=await readFile('.tmp/voice-audit-dist/index.html','utf8')
  await writeFile('.tmp/voice-audit-dist/inputy.html',index.replace(/<html(?=[\s>])/,'<html data-page="controls"'))
}
