// Product analytics stay off: the launcher sets the engine's kill switch and the Privacy page never offers a working consent switch.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const settings = read('frontend/src/settings/system-settings.ts');
const page = read('frontend/src/settings/pages/PrivacyPage.svelte');
const launcher = read('scripts/runtime/app/launcher.py');

assert.match(settings, /export const ANALYTICS_OFFERED = false\b/, 'analytics are not offered');
assert.match(launcher, /"OMNIVOICE_ANALYTICS_DISABLED": "1"/, 'the launcher sets the engine kill switch');
assert.match(page, /disabled=\{locked \|\| !analytics\.available \|\| !ANALYTICS_OFFERED\}/, 'the consent switch is disabled while analytics are not offered');
assert.match(page, /analytics\.available && ANALYTICS_OFFERED \?/, 'the description follows the same flag');
assert.match(page, /analyticsOn = !!analytics\?\.opted_in && ANALYTICS_OFFERED/, 'a stored opt-in is not shown as active');
assert.doesNotMatch(page, /włączysz analitykę/, 'the notice does not suggest that analytics can be turned on');
console.log('PASS analytics stay off: kill switch, disabled consent switch, truthful notice');
