// A build without an update feed must say so instead of surfacing a raw plugin error.
// Static check: the Rust command reads plugins.updater.endpoints, the release script injects them at exactly that path,
// the committed config ships none, and the Updates page gates on the command.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = file => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
const main = read('src-tauri/src/main.rs'), release = read('scripts/release/build-update.mjs')
const conf = JSON.parse(read('src-tauri/tauri.conf.json')), page = read('src/lib/settings/pages/UpdatesPage.svelte')

assert.match(main, /get\("updater"\)[\s\S]*get\("endpoints"\)/, 'command must read plugins.updater.endpoints')
assert.match(main, /generate_handler!\[[^\]]*app_updates_supported/, 'command must be registered')
assert.match(release, /plugins:\s*\{\s*updater:\s*\{\s*endpoints:\s*\[ENDPOINT\]/, 'release build must inject plugins.updater.endpoints')
assert.deepEqual(conf.plugins.updater.endpoints, [], 'committed config must ship without an endpoint')
assert.match(read('src/lib/platform/app-update.ts'), /invoke<boolean>\('app_updates_supported'\)\.catch\(\(\) => true\)/, 'a failed command must not hide a working updater')
assert.match(page, /if \(!desktop \|\| supported === false/, 'checkApp must return early when updates are unsupported')
assert.match(page, /\/endpoints\/i\.test/, 'a raw endpoints error must map to the unsupported notice')
console.log('PASS app update support: command, release injection, config and page gate agree')
