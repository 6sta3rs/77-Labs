"""Serve the built UI with read-only voice/audio fixtures on an isolated origin."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import io
import math
import struct
import wave

def playback_signal():
    output=io.BytesIO()
    with wave.open(output,'wb') as audio:
        audio.setparams((1,2,24000,0,'NONE','not compressed'))
        audio.writeframes(b''.join(struct.pack('<h',int(8000*math.sin(2*math.pi*440*i/24000))) for i in range(24000*12)))
    return output.getvalue()

signal=playback_signal()

repo=Path(__file__).resolve().parents[1]
profiles=[{"id":"orb-test-a","name":"Głos testowy Alfa","language":"Polish","kind":"clone"},
          {"id":"orb-test-b","name":"Głos testowy Beta","language":"Polish","kind":"clone"}]
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(repo/'dist'),**kwargs)
    def do_GET(self):
        path=self.path.split('?')[0]
        data=None
        if path=='/fixture-playback.wav':
            self.send_response(200);self.send_header('Content-Type','audio/wav');self.end_headers();self.wfile.write(signal);return
        if path=='/playback-ui-check.js':
            body=(repo/'scripts/playback-ui-check.js').read_bytes();self.send_response(200);self.send_header('Content-Type','text/javascript');self.end_headers();self.wfile.write(body);return
        if path=='/' and 'playback-check' in self.path:
            html=(repo/'dist/index.html').read_text(encoding='utf-8')
            if 'offline' in self.path:
                html=html.replace('<head>', '<head><script>const fixtureFetch=window.fetch.bind(window);window.fetch=(input,options)=>String(input).endsWith("/health")?Promise.resolve(new Response("{}",{status:503})):fixtureFetch(input,options)</script>')
            body=html.replace('</body>','<script type="module" src="/playback-ui-check.js"></script></body>').encode();self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(body);return
        if path=='/backend/health':data={"status":"ok","fixture":True}
        elif path=='/backend/profiles':data=profiles
        elif path=='/backend/engines':data={"tts":{"active":"omnivoice","backends":[{"id":"omnivoice","display_name":"OmniVoice","available":True,"supported_language_names":["Auto","Polish","English"]}]},"asr":{"active":"","backends":[]},"llm":{"active":"","backends":[]}}
        elif path in {f"/backend/profiles/{row['id']}/audio" for row in profiles}:
            body=(repo/'public/demo/interface-tone.wav').read_bytes();self.send_response(200);self.send_header('Content-Type','audio/wav');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
        if data is not None:
            body=json.dumps(data).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
        if path.startswith('/backend/'):
            self.send_error(404,'Read-only orb fixture');return
        return super().do_GET()

if __name__=='__main__':
    print(f'ORB_PRODUCT_PREVIEW pid={os.getpid()} http://localhost:4317 (read-only fixtures)',flush=True)
    ThreadingHTTPServer(('127.0.0.1',4317),Handler).serve_forever()
