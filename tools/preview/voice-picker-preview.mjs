// Wyłącznie build QA i jawne dane demo. Nigdy nie przekazuje żądań do silnika.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
const root=resolve(import.meta.dirname,'..'),dist=resolve(root,'.tmp/voice-picker-check/dist')
const types={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.wav':'audio/wav','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'}
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1'),path=url.pathname
  if(path.startsWith('/backend/')){res.writeHead(503);res.end('Odizolowany odbiór wyboru głosu; bez prywatnego silnika.');return}
  const script=['/voice-picker-ui-check.js','/tts-reference-check.js'].includes(path)
  const file=script?resolve(root,'scripts',path.slice(1)):resolve(dist,path==='/'?'index.html':'.'+path)
  if(!script&&!file.startsWith(dist+sep)){res.writeHead(403);res.end();return}
  try{res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(file))}catch{res.writeHead(404);res.end('Not found')}
}).listen(4347,'127.0.0.1',()=>console.log('Voice picker QA: http://127.0.0.1:4347/?demo=tts (bez silnika)'))
