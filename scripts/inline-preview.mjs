import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'vite';

// Osobne wejście App daje jeden samodzielny dokument także wtedy, gdy
// produkcyjna aplikacja wczytuje katalog UI w osobnym chunku.
const directory = mkdtempSync(resolve(tmpdir(), 'voicestudio-app-preview-'));
const entry = resolve(`.app-preview-${process.pid}.html`);
const outputFlag = process.argv.indexOf('--output-dir');
const outputDir = outputFlag < 0 ? resolve('docs') : resolve(process.argv[outputFlag + 1]);
writeFileSync(entry, `<!doctype html><html lang="pl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seventy Seven Labs</title></head><body><div id="app"></div><script type="module">
import { mount } from 'svelte';import App from '/src/App.svelte';
import '/src/styles.css';import '/src/lib/ui.css';import '/src/lib/ui/product-controls.css';import '/src/lib/ui/overlays.css';
import '/src/lib/ui/focus-intent.css';
import {installFocusIntent} from '/src/lib/focus-intent';installFocusIntent(document);
mount(App,{target:document.getElementById('app')});
</script></body></html>`, 'utf8');
try {
await build({ build: { outDir: directory, emptyOutDir: true, assetsInlineLimit: Infinity, rollupOptions: { input: entry } } });
const html = readFileSync(resolve(directory, entry.split(/[\\/]/).at(-1)), 'utf8');
const jsPath = html.match(/<script\b[^>]*src="([^"]+)"/)[1];
const cssPaths = [...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"/g)].map(match => match[1]);
const asset = path => readFileSync(resolve(directory, path.replace(/^\//, '')), 'utf8');
const js = asset(jsPath);
const css = cssPaths.map(asset).join('\n');
const base = `<!doctype html><html lang="pl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seventy Seven Labs — prototyp UI</title><style>${css}</style><style>html,body{background:transparent}body{padding:0}.app-shell{height:800px;min-height:0;border:1px solid #34343c;border-radius:12px;overflow:hidden}.sidebar{height:800px}@media(max-width:700px){.app-shell:not(.sidebar-hidden) .sidebar{top:51px;bottom:auto;height:749px}}</style></head><body><div id="app"></div><script type="module">${js.replaceAll('</script', '<\\/script')}</script>`;
writeFileSync(resolve(outputDir, 'prototyp-ui.html'), `${base}</body></html>`, 'utf8');
const checks = readFileSync('scripts/ui-check.js', 'utf8');
const isolate = html => html.replaceAll('voicestudio.projects.v2','voicestudio.qa.projects.v2').replaceAll('voicestudio.activeProject.v2','voicestudio.qa.activeProject.v2').replaceAll('voicestudio.appearance.v2','voicestudio.qa.appearance.v2').replaceAll('voicestudio.themes.v1','voicestudio.qa.themes.v1').replaceAll('voicestudio-next-library','voicestudio-next-library-qa');
writeFileSync(resolve(outputDir, 'prototyp-ui-qa.html'), isolate(`${base}<script type="module">${checks}</script></body></html>`), 'utf8');
console.log('Created standalone UI preview and QA page.');
} finally {
  rmSync(entry, { force: true });
  const tempRoot = resolve(tmpdir()) + sep;
  if (!directory.startsWith(tempRoot) || !directory.split(/[\\/]/).at(-1).startsWith('voicestudio-app-preview-')) throw Error('Nieprawidłowy katalog tymczasowy');
  rmSync(directory, { recursive: true, force: true });
}
