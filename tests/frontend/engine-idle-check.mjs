import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const [client, settings, rust, main, activity, settingsApi] = await Promise.all([
  read('frontend/src/platform/runtime.ts'),
  read('frontend/src/settings/pages/EnginePage.svelte'), // Settings → Silnik → Uruchamianie i pamięć owns the control.
  read('desktop/src/runtime.rs'),
  read('desktop/src/main.rs'),
  read('scripts/runtime/app/activity.py'),
  read('scripts/runtime/app/system_settings.py'),
]);

assert.match(client, /engineIdleKey = 'voicestudio\.engineIdleMinutes'/, 'The localStorage key must stay stable.');
assert.match(client, /engineIdleOptions = \[5, 15, 30, 60, 0\] as const/, 'Frontend choices (0 = Zawsze) must match Rust.');
assert.match(client, /invoke<number>\('runtime_set_idle_minutes', \{ minutes \}\)/, 'Frontend must invoke the registered Rust command.');
assert.match(client, /isDesktop\(\) \? invoke<number>/, 'Browser and dev mode must not call Tauri.');
assert.match(main, /runtime::runtime_set_idle_minutes,/, 'Command must be registered in main.rs.');
assert.match(main, /runtime::runtime_set_preload,/, 'The preload command must be registered in main.rs.');
assert.match(rust, /pub fn runtime_set_idle_minutes\(/, 'Rust command must exist.');
assert.match(rust, /pub fn runtime_set_preload\(/, 'Rust preload command must exist.');
assert.match(rust, /VOICESTUDIO_NEXT_PRELOAD_TTS", if preload_tts \{ "1" \} else \{ "0" \}/, 'The engine preload flag follows the user setting.');
assert.match(rust, /matches!\(minutes, 0 \| 5 \| 15 \| 30 \| 60\)/, 'Rust accepts 0 (Zawsze) besides the fixed minutes.');
assert.match(rust, /"\/next\/settings\/model-idle"/, 'Rust keeps the engine idle clock equal to its own.');
assert.match(rust, /Duration::from_secs\(900\)/, 'Rust default must be 15 minutes.');
assert.match(settingsApi, /@router\.put\("\/model-idle"\)/, 'The engine route that stores the idle timeout must exist.');
assert.match(settingsApi, /@router\.post\("\/model-preload"\)/, 'The route behind "Załaduj model teraz" must exist.');
assert.match(activity, /settings\.preload_busy\(\)/, 'A user-started model load must count as work for the idle monitor.');
assert.match(settings, /<h3>\{tr\('Utrzymuj silnik i model po bezczynności'\)\}<\/h3>/, 'The Engine settings control must be labelled in Polish.');
assert.match(settings, /„Zawsze” – nigdy się nie wyłączy \(zajmuje ok\. 1,9 GB pamięci karty\)/, 'The hint must state what Zawsze costs.');
assert.match(settings, /idle === 0 && offload\?\.enabled/, 'Zawsze together with the offload switch must warn.');
assert.match(settings, /tr\('Zawsze'\)/, 'The Zawsze choice must be offered.');
assert.match(settings, /let idle = \$state<EngineIdleMinutes>\(readEngineIdleMinutes\(\)\)/, 'The control starts from the stored choice.');
assert.match(settings, /engineIdleOptions\.map\(/, 'The control offers exactly the shared choices.');
assert.match(settings, /await saveEngineIdleMinutes\(minutes\)/, 'A change goes through the shared save helper (storage + Rust command).');
assert.match(settings, /catch \(cause\) \{ idle = previous;/, 'A failed save restores the previous choice.');

// Behaviour of the stored choice and the two launch switches.
let source = client;
for (const statement of [...ts.createSourceFile('runtime.ts', source, ts.ScriptTarget.Latest, true).statements].reverse()) if (ts.isImportDeclaration(statement)) source = source.slice(0, statement.pos) + source.slice(statement.end);
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/^export /gm, '');
const store = new Map(), calls = [];
const context = vm.createContext({
  localStorage: { getItem: key => store.has(key) ? store.get(key) : null, setItem: (key, value) => store.set(key, String(value)) },
  isTauri: () => true, invoke: async (command, args) => { calls.push([command, args]); return args?.minutes ?? args?.enabled; },
  translateUi: text => text, performance, window: { dispatchEvent() {} }, CustomEvent: class {},
});
vm.runInContext(js + '\nglobalThis.api={readEngineIdleMinutes,saveEngineIdleMinutes,engineIdleSeconds,readEngineAutostart,saveEngineAutostart,readEnginePreload,saveEnginePreload,engineIdleKey,startRuntime};', context);
const api = context.api, plain = value => JSON.parse(JSON.stringify(value));
assert.equal(api.readEngineIdleMinutes(), 15, 'No stored value means 15 minutes, not "Zawsze" (Number(null) is 0).');
store.set(api.engineIdleKey, ''); assert.equal(api.readEngineIdleMinutes(), 15, 'An empty value is not "Zawsze".');
store.set(api.engineIdleKey, '45'); assert.equal(api.readEngineIdleMinutes(), 15, 'A value outside the list falls back.');
await api.saveEngineIdleMinutes(0);
assert.equal(api.readEngineIdleMinutes(), 0, 'Zawsze round-trips.');
assert.deepEqual(plain(calls.at(-1)), ['runtime_set_idle_minutes', { minutes: 0 }]);
assert.ok(api.engineIdleSeconds(0) > 5 * 365 * 24 * 3600 && api.engineIdleSeconds(0) <= 10 * 365 * 24 * 3600, 'Zawsze is a very large timeout the engine route accepts.');
assert.equal(api.engineIdleSeconds(30), 1800);
assert.equal(api.readEngineAutostart(), true, 'Autostart defaults to on.');
assert.equal(api.readEnginePreload(), true, 'Preload defaults to on.');
api.saveEngineAutostart(false); assert.equal(api.readEngineAutostart(), false);
await api.saveEnginePreload(false); assert.equal(api.readEnginePreload(), false);
assert.deepEqual(plain(calls.at(-1)), ['runtime_set_preload', { enabled: false }]);
// Autostart off disables the preload switch, so an on-demand start must not warm the model even if the stored preload flag is on.
await api.saveEnginePreload(true); calls.length = 0;
await api.startRuntime();
assert.deepEqual(plain(calls.find(call => call[0] === 'runtime_set_preload')), ['runtime_set_preload', { enabled: false }], 'autostart off + stored preload on sends preload off');
console.log('Engine idle wiring: passed (storage key, choices incl. Zawsze, default fallback, Rust commands and registration, engine routes, busy accounting, UI labels, autostart and preload switches).');
