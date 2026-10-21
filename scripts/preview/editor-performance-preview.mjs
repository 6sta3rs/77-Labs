// Stable, memory-only build of the isolated editor harness; no HMR or user data.
// Start with `node scripts/preview/editor-performance-preview.mjs`.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
const baselineIndex = process.argv.indexOf('--baseline');
const baseline = baselineIndex < 0 ? undefined : process.argv[baselineIndex + 1];
if (baselineIndex >= 0 && !/^[a-f0-9]{7,40}$/i.test(baseline || '')) throw Error('Pass a commit hash after --baseline.');
const originals = new Map(baseline ? ['SpeechEditor.svelte', 'tags.ts'].map(name => [name, execFileSync('git', ['show', `${baseline}:src/lib/${name}`], { encoding: 'utf8' })]) : []);
const baselinePlugin = { name: 'editor-original-baseline', enforce: 'pre', transform(source, id) { for (const [name, original] of originals) if (id.replaceAll('\\', '/').endsWith('/src/lib/' + name)) return original; } };
const result = await build({ configFile: false, plugins: [baselinePlugin, svelte()], logLevel: 'warn', build: { write: false, rollupOptions: { input: 'scripts/preview/editor-performance.html' } } });
const files = new Map(result.output.map(file => ['/' + file.fileName, file.type === 'chunk' ? file.code : file.source]));
const check = await readFile(new URL('../../tests/frontend/editor-performance-check.js', import.meta.url));
const types = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8' };
http.createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  const content = path === '/tests/frontend/editor-performance-check.js' ? check : files.get(path === '/' ? '/scripts/preview/editor-performance.html' : path);
  if (content === undefined) { response.writeHead(404); response.end('Not found'); return; }
  response.writeHead(200, { 'Content-Type': types[path.slice(path.lastIndexOf('.'))] || (path === '/' ? types['.html'] : 'application/octet-stream'), 'Cache-Control': 'no-store' });
  response.end(content);
}).listen(baseline ? 4323 : 4322, '127.0.0.1', () => console.log(`Isolated editor acceptance http://127.0.0.1:${baseline ? 4323 : 4322}${baseline ? ' (baseline ' + baseline + ')' : ''}`));
