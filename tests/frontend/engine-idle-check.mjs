import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const [client, settings, rust, main] = await Promise.all([
  read('src/lib/platform/runtime.ts'),
  read('src/lib/settings/pages/EnginePage.svelte'), // Settings → Silnik → Stan owns the control since the redesign.
  read('src-tauri/src/runtime.rs'),
  read('src-tauri/src/main.rs'),
]);

assert.match(client, /engineIdleKey = 'voicestudio\.engineIdleMinutes'/, 'The localStorage key must stay stable.');
assert.match(client, /engineIdleOptions = \[5, 15, 30, 60\] as const/, 'Frontend choices must match Rust.');
assert.match(client, /return engineIdleOptions\.find\(option => option === saved\) \?\? 15/, 'Missing or invalid values fall back to 15 minutes.');
assert.match(client, /invoke<number>\('runtime_set_idle_minutes', \{ minutes \}\)/, 'Frontend must invoke the registered Rust command.');
assert.match(client, /isDesktop\(\) \? invoke<number>/, 'Browser and dev mode must not call Tauri.');
assert.match(main, /runtime::runtime_set_idle_minutes,/, 'Command must be registered in main.rs.');
assert.match(rust, /pub fn runtime_set_idle_minutes\(/, 'Rust command must exist.');
assert.match(rust, /Duration::from_secs\(900\)/, 'Rust default must be 15 minutes.');
assert.match(settings, /<h3>\{tr\('Utrzymuj silnik po bezczynności'\)\}<\/h3>/, 'The Engine settings control must be labelled in Polish.');
// The redesign replaced the hint "Dłużej = szybsze kolejne generowanie, ale silnik dłużej zajmuje pamięć RAM/VRAM."
assert.match(settings, /\{tr\('Po tym czasie bez generowania silnik zwalnia pamięć\.'\)\}/, 'The hint must be shown.');
assert.match(settings, /let idle = \$state<EngineIdleMinutes>\(readEngineIdleMinutes\(\)\)/, 'The control starts from the stored choice.');
assert.match(settings, /engineIdleOptions\.map\(/, 'The control offers exactly the shared choices.');
assert.match(settings, /await saveEngineIdleMinutes\(minutes\)/, 'A change goes through the shared save helper (storage + Rust command).');
assert.match(settings, /catch \(cause\) \{ idle = previous;/, 'A failed save restores the previous choice.');
console.log('Engine idle wiring: 14 assertions passed (storage key, choices, default, command name and registration, browser guard, UI control, label, hint, save and rollback wiring).');
