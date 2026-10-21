"""Serve the built UI with a proxy exclusively to the marked disposable QA API.

Avoids Vite/HMR during reproducible product acceptance. No WebSocket proxy;
live dictation has its separate dev/native acceptance workflow.
"""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import urllib.error
import urllib.request

repo=Path(__file__).resolve().parents[2]
backend_port=4312
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(repo/'dist'),**kwargs)
    def log_message(self,*args): pass
    def proxy(self):
        if not self.path.startswith('/backend/'):
            self.send_error(404);return
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{backend_port}/health',timeout=10) as health:
                if health.headers.get('x-voicestudio-next')!='seventy-seven-qa-owned': raise RuntimeError('Foreign backend')
            size=int(self.headers.get('Content-Length','0'))
            body=self.rfile.read(size) if size else None
            headers={key:value for key,value in self.headers.items() if key.lower() not in {'host','connection','accept-encoding','origin','referer','content-length'}}
            # This test proxy is itself bound only to loopback and never forwards
            # to another host. Use the app's declared development origin.
            headers['Origin']='http://127.0.0.1:4310'
            request=urllib.request.Request(f'http://127.0.0.1:{backend_port}'+self.path[len('/backend'):],body,headers,method=self.command)
            try: response=urllib.request.urlopen(request,timeout=600)
            except urllib.error.HTTPError as error: response=error
            with response:
                payload=response.read()
                self.send_response(response.status)
                for key,value in response.headers.items():
                    if key.lower() not in {'transfer-encoding','content-length','connection','content-security-policy'}: self.send_header(key,value)
                self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
        except Exception as error:
            self.send_error(503,'Disposable QA backend unavailable')
    def do_GET(self):
        if self.path.startswith('/backend/'): return self.proxy()
        super().do_GET()
    do_POST=proxy
    do_PUT=proxy
    do_DELETE=proxy
    def end_headers(self):
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' ws://127.0.0.1:4312")
        super().end_headers()

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=4316)
    parser.add_argument('--backend-port',type=int,default=4312)
    args=parser.parse_args()
    if args.port != 0 and not 1024 <= args.port <= 65535 or not 1024 <= args.backend_port <= 65535:
        parser.error('Port musi mieścić się w zakresie1024–65535; port0 wybiera wolny port interfejsu.')
    backend_port=args.backend_port
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    print(f'Built UI QA http://127.0.0.1:{server.server_address[1]}',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
