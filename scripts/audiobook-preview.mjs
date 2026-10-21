// Isolated built-product acceptance. Every backend response is an explicit
// fixture; no private runtime, user recordings, models or licences are used.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, '.tmp/audiobook-dist')
const catalog = Object.fromEntries(['tts','asr','llm'].map(family => [family, { active: `${family}-qa`, backends: [{ id: `${family}-qa`, display_name: 'Jawny model QA', available: true, installed: true, supports_cloning: true, supported_language_names: ['Auto','Polish'] }] }]))
const requests = []
let active, sequence = 0
const wav = Buffer.alloc(44 + 16000)
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40)
for (let i = 0; i < 8000; i++) wav.writeInt16LE(Math.round(1500 * Math.sin(i * 2 * Math.PI * 220 / 16000)), 44 + i * 2)
const emit = event => active?.write(`data: ${JSON.stringify(event)}\n\n`)
const portion = () => emit({ type: 'audio_chunk', job_id: 'qa-stream', sequence: sequence++, chapter_index: 0, part: sequence, parts: 4, output: `qa/part-${sequence}.wav`, duration_s: 0.5, title: 'Rozdział QA' })
const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, 'http://127.0.0.1'), path = url.pathname
  const json = (body, status = 200) => { res.writeHead(status, { 'Content-Type':'application/json' }); res.end(JSON.stringify(body)) }
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString(); let body; try { body = JSON.parse(raw) } catch { body = raw }
    if (path === '/__qa') return json({ requests, sequence, streaming: !!active })
    if (path === '/__qa/next') { portion(); return json({ ok:true }) }
    if (path === '/__qa/done') { emit({ type:'chapter', title:'Rozdział QA', index:0, total:1 }); emit({ type:'done', output:'qa-book.mp3', chapters:1, failed_chapters:[] }); active?.end(); active = undefined; return json({ ok:true }) }
    if (path.startsWith('/backend/')) {
      const p = path.slice(8); requests.push({ path:p, method:req.method, body, streamingHeader:req.headers['x-next-audiobook-stream'] })
      if (p === '/health') return json({ status:'ok', phase:'ready', fixture:true })
      if (p === '/next/remote/state') return json({ active:false })
      if (p === '/profiles') return json([{ id:'qa-voice', name:'Lektor QA', language:'Polish', kind:'clone' }])
      if (p === '/engines') return json(catalog)
      if (p === '/engines/tts') return json(catalog.tts)
      if (p === '/projects') return json([])
      if (p.startsWith('/longform/jobs') || p === '/audiobook/jobs') return json({ jobs:[] })
      if (p === '/history') return json([])
      if (p === '/model/status') return json({ loaded:false })
      if (p === '/audiobook/plan') return json({ chapter_count:1, char_count:body.text.length, chapters:[{ title:'Rozdział QA', char_count:body.text.length, spans:[{ text:body.text }] }] })
      if (p === '/audiobook') {
        res.writeHead(200, { 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache' }); res.flushHeaders()
        active = res; sequence = 0; emit({ type:'started', job_id:'qa-stream', chapters:1, incremental_audio:true }); portion()
        res.on('close', () => { if (active === res) active = undefined }); return
      }
      if (p.startsWith('/audio/')) { res.writeHead(200, { 'Content-Type':'audio/wav' }); return res.end(wav) }
      return json({ detail:'Jawna fixture nie obsługuje: ' + p }, 404)
    }
    const target = resolve(dist, path === '/' ? 'index.html' : '.' + path)
    if (!target.startsWith(dist + sep)) return json({error:'Forbidden'},403)
    const data = await readFile(target)
    res.writeHead(200, { 'Content-Type': ({'.html':'text/html;charset=utf-8','.js':'text/javascript','.css':'text/css','.wav':'audio/wav'})[extname(target)] || 'application/octet-stream', 'Cache-Control':'no-store' }); res.end(data)
  } catch (cause) { json({ error:String(cause) },500) }
})
server.listen(0,'127.0.0.1', () => console.log(`AUDIOBOOK_FIXTURE http://127.0.0.1:${server.address().port}/`))
