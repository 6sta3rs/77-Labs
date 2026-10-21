// Stable production preview for feature acceptance while other sessions edit Vite.
// Run npm run build first. Tests require feature-smoke.py --hold on 4312.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const types = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.svg': 'image/svg+xml', '.wav': 'audio/wav' };
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.startsWith('/backend/')) {
    const upstream = http.request({ hostname: '127.0.0.1', port: 4312, path: req.url.slice('/backend'.length), method: req.method, headers: { ...req.headers, host: '127.0.0.1:4312' } }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    upstream.on('error', () => { res.writeHead(502); res.end('Backend unavailable'); }); req.pipe(upstream); return;
  }
  const extra = new Set(['/scripts/feature-ui-check.js', '/scripts/navigation-ui-check.js', '/scripts/dashboard-shell-check.js', '/scripts/inspector-ui-check.js', '/demo/interface-tone.wav']);
  const file = path === '/demo/interface-tone.wav' ? resolve(root, 'public/demo/interface-tone.wav') : extra.has(path) ? resolve(root, `.${path}`) : resolve(dist, path === '/' ? 'index.html' : `.${path}`);
  if (!extra.has(path) && !file.startsWith(dist + sep)) { res.writeHead(403); res.end(); return; }
  try { const data = await readFile(file); res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data); }
  catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(4315, '127.0.0.1', () => console.log('Feature acceptance preview http://127.0.0.1:4315'));
