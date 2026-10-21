"""Contracts: pinned offline files, language boundaries, Fish transport and setup API."""
import base64
import io
import json
import os
from pathlib import Path
import struct
import tempfile
import threading
import unittest
from unittest.mock import patch
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import tts_catalog as catalog
import tts_extensions as extensions
import tts_worker as worker

class TtsExtensionsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
    def tearDown(self):
        self.temp.cleanup()
    def materialize(self, spec):
        path = catalog.snapshot_path(spec, self.root)
        for name in spec["required_files"]:
            file = path / name; file.parent.mkdir(parents=True, exist_ok=True); file.write_bytes(b"fixture")
        return path
    def test_missing_dependency_does_not_count_as_installed(self):
        spec = catalog.model_spec("kittentts2")
        self.materialize(spec)
        with self.assertRaisesRegex(RuntimeError, "chatterbox-turbo"):
            catalog.require_snapshot(spec, self.root)
        self.materialize(spec["dependencies"][0])
        self.assertEqual(catalog.require_snapshot(spec, self.root).name, spec["revision"])
    def test_wrong_revision_is_not_silently_reused(self):
        spec = catalog.model_spec("kokoro")
        wrong = dict(spec, revision="0"*40); self.materialize(wrong)
        with self.assertRaises(RuntimeError): catalog.require_snapshot(spec, self.root)
    def test_zero_byte_required_file_is_incomplete(self):
        spec = catalog.model_spec("kokoro"); path=self.materialize(spec)
        (path/spec["required_files"][0]).write_bytes(b"")
        with self.assertRaises(RuntimeError): catalog.require_snapshot(spec,self.root)
    def test_polish_is_rejected_before_loading_non_polish_model(self):
        for engine in ["kokoro","kittentts","kittentts2","qwen3-tts","qwen3-tts-1.7b","qwen3-voice-design"]:
            with self.subTest(engine=engine), patch.object(worker,"_load",side_effect=AssertionError("must not load")):
                with self.assertRaisesRegex(ValueError,"nie obsługuje"):
                    worker.synthesize(engine,{"text":"Test","language":"pl"},self.root)
        self.assertEqual(worker.normalize_language("chatterbox-multilingual","pl-PL"),"Polish")
        self.assertEqual(worker.normalize_language("fish-s2-pro","Polish"),"Polish")
    def test_clone_transcript_cannot_trigger_hidden_asr_download(self):
        audio=self.root/'reference.wav';audio.write_bytes(b'fixture')
        with self.assertRaisesRegex(ValueError,"tekstu nagrania"):
            worker._reference({"ref_audio":str(audio)},transcript=True)
    def test_short_protocol_reads_and_oversized_frame(self):
        class Short(io.BytesIO):
            def read(self,n=-1):return super().read(min(n,2))
        data=json.dumps({"op":"ping"}).encode()
        self.assertEqual(worker._receive(Short(struct.pack('!I',len(data))+data)),{"op":"ping"})
        with self.assertRaises(ValueError):worker._receive(io.BytesIO(struct.pack('!I',worker.MAX_FRAME+1)))
        with self.assertRaises(EOFError):worker._receive(io.BytesIO(struct.pack('!I',10)+b'{}'))
    def test_service_url_cannot_upload_private_reference_to_remote_host(self):
        spec=catalog.model_spec('fish-s2-pro')
        for url in ['https://example.com','http://127.0.0.1.evil.test','http://user@127.0.0.1','http://127.0.0.1/path','http://127.0.0.1?token=x']:
            with self.subTest(url=url),self.assertRaises(ValueError):
                extensions.validate_fish_configuration(dict(url=url,repo_id=spec['repo_id'],revision=spec['revision']))
    def test_health_of_arbitrary_model_cannot_replace_model_configuration(self):
        with self.assertRaises(ValueError):
            extensions.validate_fish_configuration({'url':'http://127.0.0.1:8080','repo_id':'fishaudio/drama3','revision':'0'*40})
    def test_fish_transport_is_json_reference_and_binary_wav(self):
        received={};output=io.BytesIO()
        with wave.open(output,'wb') as wav:
            wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(44100);wav.writeframes(b'\x01\x00'*441)
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                received.update(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                self.send_response(200);self.send_header('Content-Type','audio/wav');self.end_headers();self.wfile.write(output.getvalue())
            def log_message(self,*args):pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        audio=self.root/'ref.wav';audio.write_bytes(b'private-reference-fixture')
        try:
            with patch.object(extensions,'fish_configuration',return_value={'url':f'http://127.0.0.1:{server.server_port}'}):
                samples,rate=worker.fish_synthesize({'text':'Hello','ref_audio':str(audio),'ref_text':'Reference'})
            self.assertEqual(rate,44100);self.assertEqual(len(samples),441)
            self.assertEqual(base64.b64decode(received['references'][0]['audio']),audio.read_bytes())
            self.assertFalse(received['streaming']);self.assertEqual(received['format'],'wav')
            self.assertNotIn('model',received);self.assertNotIn('language',received)
        finally:server.shutdown();server.server_close();thread.join()
    def test_interpreter_without_successful_probe_is_not_ready(self):
        python=extensions.environment_python('kokoro',self.root);python.parent.mkdir(parents=True);python.write_bytes(b'fixture')
        state=extensions.engine_state('kokoro',self.root)
        self.assertFalse(state['dependencies_ready']);self.assertFalse(state['available'])
    def test_foreign_environment_cannot_be_modified(self):
        import prepare_tts
        folder=extensions.environment_dir('kokoro',self.root);folder.mkdir(parents=True)
        valuable=folder/'keep.txt';valuable.write_text('untouched')
        with self.assertRaisesRegex(ValueError,'nie został utworzony'):
            prepare_tts.prepare('kokoro',self.root)
        self.assertEqual(valuable.read_text(),'untouched')
    def test_missing_chatterbox_tokenizer_prevents_false_ready_environment(self):
        python=extensions.environment_python('chatterbox-multilingual',self.root)
        python.parent.mkdir(parents=True);python.write_bytes(b'fixture')
        folder=extensions.environment_dir('chatterbox-multilingual',self.root)
        (folder/'environment.json').write_text(json.dumps({'schema':extensions.ENV_VERSION,'family':'chatterbox','probe':'passed','device':'cpu'}))
        self.assertFalse(extensions.engine_state('chatterbox-multilingual',self.root)['dependencies_ready'])
    def test_concurrent_installers_are_rejected(self):
        from prepare_tts import environment_lock
        folder=self.root/'envs'/'kokoro'
        with environment_lock(folder):
            with self.assertRaises(OSError):
                with environment_lock(folder):pass

if __name__=='__main__':unittest.main(verbosity=2)
