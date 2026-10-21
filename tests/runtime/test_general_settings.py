"""Settings contracts against bundled upstream and an isolated, disposable DB.

No model, synthesis, existing user DB, external API, or old installation is used.
Run with the private runtime interpreter from the repository root.
"""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import io
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import zipfile

import general_settings


class ReleaseTests(unittest.TestCase):
    def opener(self, value):
        class Opener:
            def open(inner, request, timeout):
                self.assertEqual(request.full_url, general_settings.RELEASES_URL)
                self.assertEqual(timeout, 12)
                return io.BytesIO(json.dumps(value).encode())
        return Opener()

    def test_channels_filter_drafts_and_untrusted_links(self):
        stable = {"tag_name": "v1.0.0", "html_url": general_settings.RELEASE_PAGE + "/tag/v1.0.0", "body": "release"}
        preview = {**stable, "tag_name": "v1.1.0-rc1", "prerelease": True}
        data = [preview, {**stable, "draft": True}, {**stable, "html_url": "https://evil.invalid/update.exe"}, stable]
        result = general_settings.check_releases("stable", opener=self.opener(data))
        self.assertEqual([item["tag"] for item in result["releases"]], ["v1.0.0"])
        self.assertFalse(result["install_supported"])
        self.assertEqual(len(general_settings.check_releases("preview", opener=self.opener(data))["releases"]), 2)

    def test_bad_channel_and_remote_shape_fail_closed(self):
        with self.assertRaises(ValueError): general_settings.check_releases("other", opener=self.opener([]))
        with self.assertRaises(ValueError): general_settings.check_releases("stable", opener=self.opener({"message": "limit"}))

    def test_redirect_is_rejected(self):
        with self.assertRaises(ValueError): general_settings._NoRedirect().redirect_request(None, None, 302, "redirect", {}, "https://evil.invalid")


class BundledSettingsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="seventy-seven-settings-contract-")
        cls.root = Path(cls.temporary.name)
        cls.engine = cls.root / "engine"
        cls.data = cls.root / "data"
        cls.data.mkdir()
        archive = _runtime_paths.runtime_source("engine.zip")
        with zipfile.ZipFile(archive) as bundle: bundle.extractall(cls.engine)
        cls.environment = patch.dict(os.environ, {
            "OMNIVOICE_DATA_DIR": str(cls.data), "OMNIVOICE_CACHE_DIR": str(cls.root / "models"),
            "OMNIVOICE_ENV_FILE": str(cls.data / "environment"), "HF_HOME": str(cls.root / "hf"),
            "HF_HUB_CACHE": str(cls.root / "models"), "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
        })
        cls.environment.start()
        sys.path.insert(0, str(cls.engine / "backend"))
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from core.db import init_db
        from api.routers import pronunciation, settings, system
        init_db()
        app = FastAPI()
        app.include_router(pronunciation.router)
        app.include_router(settings.router)
        app.include_router(system.router)
        app.include_router(general_settings.create_router(cls.root / "runtime", cls.data, engine_path=cls.engine))
        cls.client = TestClient(app, client=("127.0.0.1", 4310), headers={"X-VoiceStudio-CSRF": "1"})
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
        cls.environment.stop()
        sys.path.remove(str(cls.engine / "backend"))
        cls.temporary.cleanup()

    def get(self, path):
        response = self.client.get(path)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_dictionary_crud_scope_preview_and_inert_phonemes(self):
        response = self.client.post("/pronunciation", json={"term": "VoiceStudio", "replacement": "wojs studio", "language": "pl"})
        self.assertEqual(response.status_code, 200, response.text)
        entry = response.json()
        self.assertIn(entry["id"], [row["id"] for row in self.get("/pronunciation")])
        for language, changed in (("pl", True), ("en", False)):
            preview = self.client.post("/pronunciation/test", json={"text": "VoiceStudio działa.", "language": language}).json()
            self.assertEqual(preview["changed"], changed)
        self.assertEqual(self.client.put(f"/pronunciation/{entry['id']}", json={"enabled": False}).status_code, 200)
        self.assertFalse(self.client.post("/pronunciation/test", json={"text": "VoiceStudio", "language": "pl"}).json()["changed"])
        self.assertEqual(self.client.put(f"/pronunciation/{entry['id']}", json={"enabled": True, "replacement": "studio głosu"}).status_code, 200)
        exported = self.get("/pronunciation/export")
        self.assertEqual(self.client.post("/pronunciation/import", json={**exported, "replace": True}).json()["imported"], 1)
        before = self.get("/pronunciation")
        self.assertEqual(self.client.post("/pronunciation/import", json={"entries": [{"term": "IPA", "replacement": "[bad]", "type": "ipa"}], "replace": True}).status_code, 400)
        self.assertEqual(self.get("/pronunciation"), before, "Invalid replace-import must preserve every old row")
        self.assertEqual(self.client.post("/pronunciation", json={"term": "IPA", "replacement": "aɪpiːeɪ", "type": "ipa"}).status_code, 200)
        self.assertTrue(self.client.post("/pronunciation/test", json={"text": "IPA", "language": "pl"}).json()["inert_entries"])
        for row in self.get("/pronunciation"):
            self.assertTrue(self.client.delete(f"/pronunciation/{row['id']}").json()["deleted"])

    def test_llm_settings_and_per_skill_routing_persist_without_network(self):
        providers = self.get("/api/settings/llm-providers")
        self.assertTrue(providers["providers"])
        self.assertNotIn("api_key", providers["providers"][0])
        response = self.client.put("/api/settings/llm-providers/custom", json={"base_url": "http://127.0.0.1:9999/v1", "model": "fixture-only", "activate_if_unset": False})
        self.assertEqual(response.status_code, 200, response.text)
        custom = next(row for row in self.get("/api/settings/llm-providers")["providers"] if row["id"] == "custom")
        self.assertEqual(custom["model"], "fixture-only")
        skills = self.get("/api/settings/llm-skills")["skills"]
        self.assertEqual(len(skills), 6)
        response = self.client.put("/api/settings/llm-skills/dictation_refinement", json={"enabled": False, "provider_override": "custom"})
        self.assertEqual(response.status_code, 200, response.text)
        saved = next(row for row in self.get("/api/settings/llm-skills")["skills"] if row["id"] == "dictation_refinement")
        self.assertFalse(saved["enabled"])
        self.assertEqual(saved["provider_override"], "custom")

    def test_refinement_and_asr_config_roundtrip(self):
        response = self.client.put("/api/settings/dictation-refinement", json={"auto": False, "smart_cleanup": False, "self_correction": True, "preserve_technical": True})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(self.get("/api/settings/dictation-refinement")["auto"])
        response = self.client.put("/api/settings/asr-openai-compat", json={"base_url": "http://127.0.0.1:9998/v1", "model": "fixture-whisper"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.get("/api/settings/asr-openai-compat")["model"], "fixture-whisper")

    def test_local_llm_test_connect_models_and_asr_probe(self):
        calls = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def respond(self, body):
                payload = json.dumps(body).encode()
                self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(payload))); self.end_headers(); self.wfile.write(payload)
            def do_GET(self):
                calls.append(self.path)
                self.respond({"object": "list", "data": [{"id": "fixture-model", "object": "model", "created": 0, "owned_by": "fixture"}]})
            def do_POST(self):
                calls.append(self.path)
                self.rfile.read(int(self.headers.get("Content-Length", "0")))
                self.respond({"id": "fixture", "object": "chat.completion", "created": 0, "model": "fixture-model", "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}]})
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        url = f"http://127.0.0.1:{server.server_port}/v1"
        try:
            response = self.client.put("/api/settings/llm-providers/custom", json={"base_url": url, "model": "fixture-model", "api_key": "fixture-not-a-real-secret", "activate_if_unset": False})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertNotIn("fixture-not-a-real-secret", response.text)
            result = self.client.post("/api/settings/llm-providers/custom/test").json()
            self.assertTrue(result["ok"], result)
            models = self.get("/api/settings/llm-providers/custom/models")
            self.assertTrue(models["ok"], models)
            self.assertIn("fixture-model", models["models"])
            self.assertTrue(self.client.post("/api/settings/llm-providers/custom/connect").json()["ok"])
            self.assertEqual(self.get("/api/settings/llm-providers")["active"], "custom")
            self.assertEqual(self.client.put("/api/settings/asr-openai-compat", json={"base_url": url, "model": "fixture-model"}).status_code, 200)
            result = self.client.post("/api/settings/asr-openai-compat/test").json()
            self.assertTrue(result["ok"], result)
            self.assertIn("/v1/chat/completions", calls)
            self.assertIn("/v1/models", calls)
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=2)

    def test_translator_credentials_are_encrypted_and_not_returned(self):
        from services import settings_store
        from core import prefs
        from core.db import db_conn
        for key in ("DEEPL_API_KEY", "MICROSOFT_API_KEY"):
            value = "fixture-only-secret-" + key
            response = self.client.post("/system/set-env", json={"key": key, "value": value})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertNotIn(value, response.text)
            self.assertEqual(settings_store.get_secret("translation_env." + key), value)
            self.assertIsNone(prefs.get("env." + key))
            with db_conn() as database:
                encrypted = database.execute("SELECT value FROM settings WHERE key = ?", ("secret.translation_env." + key,)).fetchone()["value"]
            self.assertNotEqual(encrypted, value)
            self.assertNotIn(value, encrypted)
        response = self.client.post("/system/set-env", json={"key": "DEEPL_BASE_URL", "value": "http://127.0.0.1:9997/v2"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(prefs.get("env.DEEPL_BASE_URL"), "http://127.0.0.1:9997/v2")

    def test_update_source_and_local_changelog_are_honest(self):
        source = self.get("/next/settings/update-source")
        self.assertFalse(source["app"]["updater_configured"])
        self.assertFalse(source["install_supported"])
        self.assertEqual(source["source"]["sourceVersion"], "0.5.7")
        self.assertTrue(self.get("/api/settings/changelog")["releases"])
        self.assertEqual(self.client.post("/next/settings/update-source/check", json={"channel": "invalid"}).status_code, 422)
        with patch.object(general_settings, "check_releases", return_value={"releases": [], "install_supported": False}) as check:
            self.assertEqual(self.client.post("/next/settings/update-source/check", json={"channel": "preview"}).status_code, 200)
            check.assert_called_once_with("preview")


if __name__ == "__main__":
    unittest.main(verbosity=2)
