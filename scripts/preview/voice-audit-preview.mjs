import http from 'node:http'
import {readFile} from 'node:fs/promises'
import {resolve,extname,sep} from 'node:path'
const root=resolve(import.meta.dirname,'..'),dist=resolve(root,'.tmp/voice-audit-dist')
const types={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.wav':'audio/wav','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'}
let requests=[],failCatalog=false,delayedAudio=false
const catalog={tts:{active:'qa-tts',backends:[{id:'qa-tts',display_name:'Model kontrolny',available:true,installed:true,supported_language_names:['Auto','Polish','English','eng']}]},asr:{active:'',backends:[]},llm:{active:'',backends:[]}}
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1'),path=url.pathname
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json;charset=utf-8'});res.end(JSON.stringify(value))}
  if(path==='/__qa'){
    if(req.method==='POST'){const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));failCatalog=body.failCatalog??failCatalog;delayedAudio=body.delayedAudio??delayedAudio;if(body.reset)requests=[];return json({ok:true})}
    return json({requests,failCatalog,delayedAudio})
  }
  if(path.startsWith('/backend/')){
    const entry={path,completed:false,cancelled:false};requests.push(entry)
    res.on('close',()=>{entry.completed=res.writableEnded;entry.cancelled=!res.writableEnded})
    if(path==='/backend/engines')return json(failCatalog?{detail:'Kontrolowany błąd katalogu'}:catalog,failCatalog?503:200)
    if(/^\/backend\/profiles\/qa-(alpha|beta)\/audio$/.test(path)){
      if(delayedAudio&&path.includes('alpha'))await new Promise(resolve=>setTimeout(resolve,1800))
      if(res.destroyed)return
      res.writeHead(200,{'Content-Type':'audio/wav'});res.end(await readFile(resolve(root,'public/demo/interface-tone.wav')));return
    }
    return json({detail:'Odizolowana fixture; brak prywatnego backendu.'},503)
  }
  const scripts=new Set(['/voice-picker-ui-check.js','/voice-picker-audit-check.js','/tts-reference-check.js','/voice-ux-check.js'])
  const script=scripts.has(path)
  const file=script?resolve(root,'scripts',path.slice(1)):resolve(dist,path==='/'?'index.html':path==='/fixture.html'?'.tmp/voice-audit.html':'.'+path)
  if(!script&&!file.startsWith(dist+sep))return json({detail:'Forbidden'},403)
  try{const body=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body)}catch{json({detail:'Not found'},404)}
}).listen(4351,'127.0.0.1',()=>console.log('Izolowany odbiór głosów: http://127.0.0.1:4351/fixture.html'))
