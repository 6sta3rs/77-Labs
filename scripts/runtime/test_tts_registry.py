"""Integration with the real bundled registry and API, without loading weights."""
from pathlib import Path
import os
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch

class RegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='seventy-seven-tts-')
        cls.root=Path(cls.temp.name)
        source=Path(__file__).resolve().parent
        engine=cls.root/'engine'
        with zipfile.ZipFile(source/'engine.zip') as archive:
            archive.extractall(engine)
        os.environ.update(OMNIVOICE_DATA_DIR=str(cls.root/'data'),OMNIVOICE_ENV_FILE=str(cls.root/'data/environment'),OMNIVOICE_CACHE_DIR=str(cls.root/'cache'),HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1')
        sys.path[:0]=[str(engine),str(engine/'backend')]
        from core.db import init_db
        init_db()
        from tts_extensions import register
        register(cls.root)
        from services.tts_backend import get_backend_class
        cls.engine=staticmethod(get_backend_class)
    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()
    def test_real_base_class_accepts_english_for_all_adapters(self):
        from tts_catalog import ENGINES
        for engine in ENGINES:
            with self.subTest(engine=engine):
                self.engine(engine)()._check_language('English')
    def test_registered_weights_have_complete_catalog_schema(self):
        from tts_catalog import MODELS
        from api.routers.setup.models import get_model_catalog
        catalog=get_model_catalog()
        for model in MODELS:
            with self.subTest(model=model['repo_id']):
                spec=catalog.get(model['repo_id'])
                self.assertEqual(spec['role'],'TTS')
                self.assertGreater(spec['size_gb'],0)
                self.assertEqual(spec['revision'],model['revision'])
    def test_polish_boundary_uses_real_upstream_normalizer(self):
        from tts_catalog import ENGINES
        for engine in ENGINES:
            with self.subTest(engine=engine):
                instance=self.engine(engine)()
                if engine in {'chatterbox-multilingual','fish-s2-pro'}:
                    instance._check_language('Polish')
                else:
                    with self.assertRaises(ValueError):instance._check_language('Polish')
    def test_weights_license_is_enforced_before_generation(self):
        for engine in ['kittentts2','fish-s2-pro']:
            with self.subTest(engine=engine),self.assertRaisesRegex(RuntimeError,'warunki'):
                self.engine(engine)()._validate_generate_authorization()
    def test_generation_forwards_canonical_language_to_worker(self):
        from services.subprocess_backend import SubprocessBackend
        with patch.object(SubprocessBackend,'generate',lambda self,text,**kw:kw):
            for engine in ['kokoro','chatterbox-multilingual','qwen3-tts']:
                with self.subTest(engine=engine):
                    self.assertEqual(self.engine(engine)().generate('Test',language='English')['language'],'en')
    def test_real_router_reads_eight_states_and_rejects_invalid_setup(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.dependencies import require_admin
        from tts_extensions import create_router
        app=FastAPI();app.include_router(create_router(self.root));app.dependency_overrides[require_admin]=lambda:None
        with TestClient(app) as client:
            response=client.get('/next/tts/status');self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(len(response.json()['engines']),8)
            self.assertEqual(client.post('/next/tts/prepare',json={'engine_id':'missing'}).status_code,400)
            self.assertEqual(client.post('/next/tts/prepare',json={'engine_id':'kokoro','device':'bad'}).status_code,400)
            self.assertEqual(client.put('/next/tts/fish-service',json={'url':'http://example.com','confirmed_model':True}).status_code,400)

if __name__=='__main__':unittest.main(verbosity=2)
