import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'vite';

// Build the dedicated gallery entry: the offline catalog does not need the App runtime.
const directory = mkdtempSync(resolve(tmpdir(), 'voicestudio-controls-'));
const audioOnly = process.argv.includes('--audio');
const entry = audioOnly ? `.audio-preview-${process.pid}.html` : 'inputy.html';
if (audioOnly) writeFileSync(entry, `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Audio i kula głosu — Seventy Seven Labs</title></head><body><main id="app" style="max-width:1064px;margin:24px auto;padding:0 16px"></main><script type="module">
import { mount } from 'svelte';
import AudioExamples from '/src/lib/AudioExamples.svelte';
import { applyAppearance, defaultAppearance } from '/src/lib/appearance';
import '/src/styles.css'; import '/src/lib/ui.css'; import '/src/lib/ui/product-controls.css';
applyAppearance(defaultAppearance); mount(AudioExamples, { target: document.getElementById('app') });
</script></body></html>`, 'utf8');
try {
// Inline lazy orb textures as well: the exported HTML must work without chunk files.
await build({ build: { outDir: directory, emptyOutDir: true, rollupOptions: { input: resolve(entry), output: { codeSplitting: false } } } });
const asset = path => readFileSync(resolve(directory, path.replace(/^\//, '')), 'utf8');
// Preserve the bundler's whitespace-table literal without trailing spaces in HTML.
const inlineScript = code => code.replaceAll('` \t\n', '`\\x20\\t\n').replaceAll('</script', '<\\/script');
let html = readFileSync(resolve(directory, entry), 'utf8')
  .replace('<html', '<html data-page="controls"')
  .replace(/<link[^>]+rel="icon"[^>]*>/g, '')
  .replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, path) => `<script type="module">${inlineScript(asset(path))}</script>`)
  .replace(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g, (_, path) => `<style>${asset(path)}</style>`);
// This generator only embeds the public procedural tone, never a user recording.
const toneUrl = 'data:audio/wav;base64,' + readFileSync(resolve('public/demo/interface-tone.wav')).toString('base64');
html = html.replaceAll('/demo/interface-tone.wav', toneUrl);
mkdirSync('.tmp/qa', { recursive: true });
const output = audioOnly ? '.tmp/qa/audio.html' : '.tmp/qa/inputy.html';
// Windows readers can keep the old HTML open without permitting truncation.
// Publish a complete sibling file atomically, retaining the old preview on error.
const temporaryOutput = `${output}.${process.pid}.tmp`;
try {
  writeFileSync(temporaryOutput, html, 'utf8');
  renameSync(temporaryOutput, output);
} finally {
  if (existsSync(temporaryOutput)) unlinkSync(temporaryOutput);
}
console.log(`Created ${output} — offline preview of the actual Svelte controls.`);
} finally { rmSync(directory, { recursive: true, force: true }); if (audioOnly) rmSync(entry, { force: true }); }
