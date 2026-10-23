// Odizolowany podgląd UI: wszystkie żądania /backend obsługuje jawna fixture.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
const root = resolve(import.meta.dirname, '../..'), dist = resolve(root, '.tmp/tools-workspace-dist')
const types = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.wav': 'audio/wav', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' }
const profiles = [{ id: 'qa-alfa', name: 'Lektor Alfa', language: 'Polish', kind: 'clone' }, { id: 'qa-beta', name: 'Lektorka Beta', language: 'Polish', kind: 'clone' }]
const projects = [{ id: 'qa-book', name: 'Książka testowa', state: { kind: 'audiobooks', text: '# Pierwszy rozdział\n\nJawny tekst do kontroli układu.', voice: 'qa-alfa', language: 'pl' } }, { id: 'qa-other', name: 'Inny rodzaj projektu', state: { kind: 'studio', text: 'Nie jest audiobookiem.' } }]
const plan = { chapters: [{ title: 'Pierwszy rozdział', char_count: 54, spans: [{ text: 'Jawny tekst do kontroli układu.' }] }], chapter_count: 1, char_count: 54 }
const catalog = Object.fromEntries(['tts', 'asr', 'llm'].map(family => [family, { active: `${family}-alfa`, backends: ['alfa', 'beta'].map(suffix => ({ id: `${family}-${suffix}`, display_name: `${family.toUpperCase()} ${suffix}`, available: true, installed: true, supports_cloning: family === 'tts', supported_language_names: ['Auto', 'Polish', 'English'] })) }]))
let requests = [], translateError = false, partialBook = false, jobs = []
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1'), path = url.pathname
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    let body; try { body = JSON.parse(raw) } catch { body = raw }
    if (req.headers['content-type']?.startsWith('multipart/form-data')) {
      const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': req.headers['content-type'] } }).formData()
      body = Object.fromEntries([...form].map(([name, value]) => [name, typeof value === 'string' ? value : { name: value.name, size: value.size, type: value.type }]))
    }
    const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json;charset=utf-8' }); res.end(JSON.stringify(data)) }
    const sse = events => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')) }
    if (path === '/__qa' && req.method === 'GET') return json({ requests, translateError, partialBook })
    if (path === '/__qa' && req.method === 'POST') { translateError = body.translateError ?? translateError; partialBook = body.partialBook ?? partialBook; if (body.reset) requests = []; return json({ ok: true }) }
    if (path === '/__qa/export' && req.method === 'POST') { requests.push({ method: 'EXPORT', path: body.name, body: body.text }); return json({ ok: true }) }
    if (path.startsWith('/backend/')) {
      requests.push({ method: req.method, path: path.slice(8), query: url.search, body: typeof body === 'string' ? body.slice(0, 1000) : body })
      const p = path.slice(8)
      if (p === '/health') return json({ status: 'ok', fixture: true })
      if (p === '/profiles') return json(profiles)
      if (p === '/engines') return json(catalog)
      if (p === '/engines/select') { catalog[body.family].active = body.backend_id; return json({ active: body.backend_id, env_override: false }) }
      if (p === '/projects' && req.method === 'GET') return json(projects.map(({ id, name }) => ({ id, name })))
      if (p === '/projects' && req.method === 'POST') { projects.push({ id: 'qa-created', ...body }); return json({ id: 'qa-created' }) }
      if (p.startsWith('/projects/')) { const id = p.split('/').at(-1), project = projects.find(project => project.id === id); if (req.method === 'PUT') { Object.assign(project, body); return json({ id }) } return json(project || {}, project ? 200 : 404) }
      if (p === '/longform/jobs') return json({ jobs: [{ job_id: 'qa-finished', title: 'Ukończona książka', output: 'qa-book.m4b', chapters: 3, duration_s: 180, type: 'audiobook' }] })
      if (p === '/audiobook/import') return json({ text: '# Pierwszy rozdział\n\nImportowana treść.', chapters: 1 })
      if (p === '/audiobook/plan') return json(plan)
      if (p === '/audiobook') return sse([{ type: 'started', chapters: 1 }, { type: 'chapter', title: 'Pierwszy rozdział' }, { type: 'done', output: 'qa-book.m4b', failed_chapters: partialBook ? 1 : 0 }])
      if (p === '/dub/history') return json([{ id: 'qa-dub', filename: 'Przykładowy materiał.mp4', tracks: '["pl","en"]', duration: 18 }])
      if (p === '/dub/upload') return json({ job_id: 'qa-source', task_id: 'qa-prepare' })
      if (p === '/tasks/stream/qa-prepare') return sse([{ type: 'extract' }, { type: 'ready' }])
      if (p === '/dub/transcribe/qa-source') return json({ segments: [{ id: 1, start: 0, end: 3, text: 'Hello world.' }, { id: 2, start: 3, end: 6, text: 'This is a test.' }] })
      if (p === '/dub/translate') return json({ translated: body.segments.map(row => ({ id: row.id, text: translateError ? row.text : `Tłumaczenie ${row.id}.`, ...(translateError ? { error: 'Brak dostawcy tłumaczenia' } : {}) })), quality_used: body.quality })
      if (p === '/dub/generate/qa-source') return json({ task_id: 'qa-render' })
      if (p === '/tasks/stream/qa-render') return sse([{ type: 'progress', current: 1, total: 2 }, { type: 'done' }])
      if (p === '/transcribe') return json({ text: 'To jest jawny wynik testowy transkrypcji.', language: 'pl', segments: [{ start: 0, end: 3.43, text: 'To jest jawny wynik testowy transkrypcji.' }] })
      if (p === '/convert') return json({ id: 'qa-convert', audio_url: '/audio/qa-convert.wav', text: 'To jest jawny wynik testowy konwersji.', duration_s: 3.43 })
      if (p === '/batch/jobs') return json(jobs)
      if (p === '/batch/enqueue') { jobs.push({ id: 'qa-batch', filename: 'Próbka QA.wav', status: 'queued', langs: ['pl'], progress: 0 }); return json({ job_id: 'qa-batch' }) }
      if (p === '/tools/direction') return json({ instruct_prompt: 'Spokojnie, z naturalnymi pauzami.' })
      if (p === '/tools/rate-fit') return json({ adjusted_text: 'Dopasowany tekst.' })
      if (p === '/history' || p === '/pronunciation') return json([])
      if (!p.startsWith('/audio/') && !/^\/profiles\/[^/]+\/audio$/.test(p) && !p.startsWith('/dub/download-audio/')) return json({ detail: `Fixture UI nie obsługuje ${req.method} ${p}` }, 503)
    }
    const audio = path === '/fixture.wav' || path.startsWith('/backend/audio/') || /^\/backend\/profiles\/[^/]+\/audio$/.test(path) || path.startsWith('/backend/dub/download-audio/')
    const file = audio ? resolve(root, 'public/demo/interface-tone.wav') : path === '/tools-workspace-check.js' ? resolve(root, 'scripts/tools-workspace-check.js') : resolve(dist, path === '/' ? 'index.html' : `.${path}`)
    if (!audio && path !== '/tools-workspace-check.js' && !file.startsWith(dist + sep)) return json({ error: 'Forbidden' }, 403)
    let data = await readFile(file)
    if (path === '/') data = Buffer.from(data.toString().replace('<head>', '<head><script>window.__qaErrors=[];addEventListener("error",e=>__qaErrors.push(e.message));addEventListener("unhandledrejection",e=>__qaErrors.push(String(e.reason)));localStorage.setItem("voicestudio.navigation.pins.v1",JSON.stringify(["studio","voices","transcription","dubbing","audiobooks","conversion","batch","tools"]));</script>'))
    if (path === '/') data = Buffer.from(data.toString().replace('</body>', `<script>
      const sample=document.createElement('button');sample.textContent='Wstaw jawną próbkę WAV (QA)';sample.style='position:fixed;top:8px;right:12px;z-index:5000;background:#222;color:white;font:12px sans-serif;padding:8px;border-radius:6px';
      const nativeClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download&&this.href.startsWith('blob:')&&/\\.(txt|srt|vtt)$/.test(this.download)){fetch(this.href).then(r=>r.text()).then(text=>fetch('/__qa/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:this.download,text})}));return}return nativeClick.call(this)};
      sample.onclick=async()=>{const input=document.querySelector('input[type=file][aria-label="Materiał do dubbingu"],input[type=file][aria-label="Materiał źródłowy"],input[type=file][aria-label="Nagranie do transkrypcji"]');if(!input){sample.textContent='Otwórz narzędzie z plikiem źródłowym';return}const blob=await(await fetch('/fixture.wav')).blob();const transfer=new DataTransfer();transfer.items.add(new File([blob],'jawna-probka.wav',{type:'audio/wav'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));sample.remove()};document.body.append(sample);
    </script></body>`))
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data)
  } catch (cause) { res.writeHead(500); res.end(String(cause)) }
})
server.listen(4328, '127.0.0.1', () => console.log('Izolowany podgląd narzędzi: http://127.0.0.1:4328/ (fixture, bez prywatnego silnika)'))
