// Odizolowany odbiór zbudowanego UI. Nie przekazuje żądań do prywatnego silnika.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const dist = resolve(root, 'dist');
const scripts = new Set(['ui-performance-check.js', 'playback-ui-check.js', 'dashboard-shell-check.js', 'inspector-ui-check.js', 'motion-ui-check.js', 'catalog-ui-check.js']);
const types = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.wav': 'audio/wav', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const profiles = [{ id: 'orb-test-a', name: 'Głos testowy Alfa', language: 'Polish', kind: 'clone' }, { id: 'orb-test-b', name: 'Głos testowy Beta', language: 'Polish', kind: 'clone' }];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const path = url.pathname;
  let data;
  if (req.method === 'GET' && path === '/backend/health') data = { status: 'ok', fixture: true };
  if (req.method === 'GET' && path === '/backend/profiles') data = profiles;
  if (req.method === 'GET' && path === '/backend/engines') data = { tts: { active: 'omnivoice', backends: [{ id: 'omnivoice', display_name: 'OmniVoice', available: true, supported_language_names: ['Auto', 'Polish', 'English'] }] }, asr: { active: '', backends: [] }, llm: { active: '', backends: [] } };
  if (data) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); return; }
  const audio = path === '/fixture-playback.wav' || path === '/demo/interface-tone.wav' || profiles.some(row => path === `/backend/profiles/${row.id}/audio`);
  if (path.startsWith('/backend/') && !audio) { res.writeHead(503); res.end('Odizolowana fixture UI; brak dostępu do silnika.'); return; }
  const name = path.split('/').at(-1);
  const appEntry = path === '/' || path === '/inputy';
  const file = audio ? resolve(root, 'public/demo/interface-tone.wav') : scripts.has(name) ? resolve(root, 'scripts', name) : resolve(dist, appEntry ? 'index.html' : `.${path}`);
  if (!audio && !scripts.has(name) && !file.startsWith(dist + sep)) { res.writeHead(403); res.end(); return; }
  try {
    let body = await readFile(file);
    if (appEntry) {
      // Profil QA na osobnym originie. Pełne seedy wyłącznie po jawnym ?seed.
      const setup = `<script>
        window.__qaErrors=[];addEventListener('error',e=>window.__qaErrors.push(e.message));addEventListener('unhandledrejection',e=>window.__qaErrors.push(String(e.reason)));
        if(new URLSearchParams(location.search).has('seed')){
          const projects=Array.from({length:120},(_,i)=>({id:'qa-project-'+i,name:'Projekt QA '+i,updated:new Date().toISOString(),blocks:[{id:'qa-block-'+i,voiceId:'orb-test-a',text:'Próba płynności. '.repeat(550)}]}));
          localStorage.setItem('voicestudio.projects.v2',JSON.stringify(projects));localStorage.setItem('voicestudio.activeProject.v2',projects[0].id);
        }
        window.__qaWrites=[];const originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='voicestudio.projects.v2')window.__qaWrites.push({time:performance.now(),size:String(value).length});return originalSetItem.call(this,key,value)};
      </script>`;
      body = Buffer.from(body.toString().replace('<head>', '<head>' + setup));
    }
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(4320, '127.0.0.1', () => console.log('UI performance QA: http://127.0.0.1:4320/?seed (read-only backend fixtures)'));
