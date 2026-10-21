"""Exercise private settings with the real bundled store in temporary data.

Run using the private venv and --engine pointing to an extracted bundled
engine. No synthesis, global login, microphone, network or old app writes.
"""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import argparse
from contextlib import closing, redirect_stdout
import io
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import time
from types import ModuleType
import unittest
from unittest.mock import patch

import system_settings as settings


class ValidationTests(unittest.TestCase):
    def test_proxy_validation_rejects_control_codes_bad_ports_and_queries(self):
        for raw in ("http://host:70000", "https://host?secret=x", "file:///private", "http://host\n", "socks5://", "http://host/a b"):
            with self.subTest(raw=raw):
                # Whitespace around the entire input is intentionally trimmed.
                if raw == "http://host\n":
                    self.assertEqual(settings.validate_proxy(raw), "http://host")
                else:
                    with self.assertRaises(ValueError):
                        settings.validate_proxy(raw)
        self.assertEqual(settings.validate_proxy(" http://u:p@127.0.0.1:8888 "), "http://u:p@127.0.0.1:8888")

    def test_proxy_read_never_returns_credentials_or_path(self):
        # Windows environment names are case-insensitive: adding the lowercase
        # empty aliases after HTTPS_PROXY would erase the test value itself.
        with patch.dict(os.environ, {"HTTPS_PROXY": "https://demo:fixture-password@proxy.invalid:8443/private"}, clear=True):
            state = settings.proxy_state()
        self.assertEqual(state, {"set": True, "address": "https://proxy.invalid:8443", "has_credentials": True})
        self.assertNotIn("fixture-password", json.dumps(state))


class OriginalStoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="seventy-seven-settings-")
        cls.folder = Path(cls.temporary.name)
        cls.data = cls.folder / "data"
        cls.data.mkdir()
        cls.environment = patch.dict(os.environ, {
            "OMNIVOICE_DATA_DIR": str(cls.data), "OMNIVOICE_ENV_FILE": str(cls.data / "environment"),
            "HF_HOME": str(cls.folder / "private-hf"), "HF_TOKEN_PATH": str(cls.folder / "private-hf/token"),
            "VOICESTUDIO_NEXT_TOKEN": "fixture-owner-marker", "OMNIVOICE_SERVER_MODE": "0",
            "OMNIVOICE_ALLOWED_ORIGINS": "http://tauri.localhost", "OMNIVOICE_API_KEY": "",
        })
        cls.environment.start()
        from core import config
        cls.engine = Path(config.__file__).resolve().parents[2]
        cls.db = Path(config.DB_PATH)
        if not cls.db.resolve().is_relative_to(cls.data.resolve()):
            raise RuntimeError("Test refuses a database outside its temporary data.")
        with closing(sqlite3.connect(cls.db)) as connection:
            connection.execute("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT, updated_at REAL)")
            connection.commit()
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        cls.app = FastAPI()
        cls.app.include_router(settings.create_router(cls.folder, cls.data))
        from api.routers import settings as original_settings
        for route in original_settings.router.routes:
            if route.path.startswith("/api/settings/hf-mirror"):
                cls.app.router.routes.append(route)
        cls.client = TestClient(cls.app, client=("127.0.0.1", 49000), headers={"Origin": "http://tauri.localhost", "X-VoiceStudio-CSRF": "1", "Sec-Fetch-Site": "same-origin"})

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        cls.environment.stop()
        cls.temporary.cleanup()

    def test_hf_roundtrip_is_encrypted_and_cannot_mutate_cli_login(self):
        from services import token_resolver
        sentinel = self.folder / "private-hf/token"
        sentinel.parent.mkdir(exist_ok=True)
        sentinel.write_text("untouched-cli-fixture", encoding="utf-8")
        token = "hf_fixture_private_token_0123456789"
        with patch.object(token_resolver, "persist_hub_token", side_effect=AssertionError("CLI/network path forbidden")):
            response = self.client.put("/next/settings/hf-token", json={"token": token})
            self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["set"])
        self.assertNotIn(token, response.text)
        from services import settings_store
        self.assertEqual(settings_store.get_hf_token(), token)
        with closing(sqlite3.connect(self.db)) as connection:
            blob = connection.execute("SELECT value FROM settings WHERE key='hf_token'").fetchone()[0]
        self.assertNotIn(token, blob)
        self.assertTrue(blob.startswith("gAAAA"))
        self.assertEqual(self.client.delete("/next/settings/hf-token").status_code, 200)
        self.assertIsNone(settings_store.get_hf_token())
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "untouched-cli-fixture")

    def test_invalid_token_unknown_key_and_unowned_executable_are_rejected(self):
        self.assertEqual(self.client.put("/next/settings/hf-token", json={"token": "not-hf"}).status_code, 400)
        self.assertEqual(self.client.put("/next/settings/credential", json={"key": "PATH", "value": "no"}).status_code, 400)
        self.assertEqual(self.client.post("/next/settings/media-tool", json={"tool": "ffmpeg", "path": "C:/not-executed.exe"}).status_code, 403)
        self.assertFalse((self.data / ".path-authorizations").exists())

    def test_credentials_state_does_not_return_secret_material(self):
        from services import settings_store
        settings_store.set_secret("translation_env.DEEPL_API_KEY", "fixture-deepl-secret-123456")
        response = self.client.get("/next/settings/credentials")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn("fixture-deepl-secret", response.text)
        row = next(row for row in response.json()["fields"] if row["key"] == "DEEPL_API_KEY")
        self.assertTrue(row["set"])
        self.assertEqual(row["value"], "")
        self.assertEqual(row["masked"], "••••3456")

    def test_original_translation_write_encrypts_secret_and_can_clear_it(self):
        from services import settings_store
        response = self.client.put("/next/settings/credential", json={"key": "DEEPL_API_KEY", "value": "fixture-route-secret-3456789"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn("fixture-route-secret", response.text)
        self.assertEqual(settings_store.get_secret("translation_env.DEEPL_API_KEY"), "fixture-route-secret-3456789")
        prefs = self.data / "prefs.json"
        self.assertNotIn("fixture-route-secret", prefs.read_text(encoding="utf-8"))
        response = self.client.put("/next/settings/credential", json={"key": "DEEPL_API_KEY", "value": ""})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(settings_store.get_secret("translation_env.DEEPL_API_KEY"))

    def test_native_media_path_uses_one_shot_original_authorization(self):
        from services import media_tools
        with patch.object(media_tools, "set_custom_path", return_value={"ok": True, "origin": "custom"}) as selected:
            response = self.client.post("/next/settings/media-tool", json={"tool": "ffprobe", "path": "C:/fixture-not-executed.exe"}, headers={"x-voicestudio-next": "fixture-owner-marker"})
        self.assertEqual(response.status_code, 200, response.text)
        selected.assert_called_once_with("ffprobe", "C:/fixture-not-executed.exe")
        self.assertEqual(list((self.data / ".path-authorizations").iterdir()), [])

    def test_proxy_password_is_encrypted_restored_and_clear_survives_restart(self):
        from services import settings_store
        value = "http://demo:proxy-password-fixture@127.0.0.1:8888"
        with patch.dict(os.environ):
            response = self.client.put("/next/settings/proxy", json={"url": value})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertNotIn("proxy-password-fixture", response.text)
            self.assertEqual(settings_store.get_secret("next.proxy"), value)
            os.environ.pop("HTTP_PROXY", None)
            os.environ.pop("HTTPS_PROXY", None)
            settings.apply_environment()
            for key in settings.PROXY_KEYS:
                self.assertEqual(os.environ[key], value)
            response = self.client.put("/next/settings/proxy", json={"url": ""})
            self.assertEqual(response.status_code, 200, response.text)
            os.environ["HTTP_PROXY"] = "http://inherited.invalid"
            settings.apply_environment()
            for key in settings.PROXY_KEYS:
                self.assertNotIn(key, os.environ)
        with closing(sqlite3.connect(self.db)) as connection:
            rows = connection.execute("SELECT value FROM settings").fetchall()
        self.assertNotIn("proxy-password-fixture", json.dumps(rows))

    def test_remote_guest_cannot_read_or_write_private_settings(self):
        from fastapi.testclient import TestClient
        with TestClient(self.app, client=("192.0.2.1", 49000)) as remote:
            self.assertEqual(remote.get("/next/settings/credentials").status_code, 403)
            self.assertEqual(remote.put("/next/settings/hf-token", json={"token": "hf_fixture_unauthorized"}).status_code, 403)

    def test_original_hf_mirror_save_clear_and_restart_use_only_private_environment(self):
        from core import user_env
        from services import endpoint_race
        private = self.data / "environment"
        private.write_text("OTHER_SETTING=preserved\n", encoding="utf-8")
        foreign = self.folder / "foreign-global-environment"
        foreign.write_text("HF_ENDPOINT=https://global.invalid\n", encoding="utf-8")
        with patch.dict(os.environ), patch.object(user_env, "USER_ENV_PATH", str(foreign)), patch.object(endpoint_race, "ensure_decision", side_effect=AssertionError("manual must not probe")) as race, patch("urllib.request.urlopen", side_effect=AssertionError("network forbidden")) as network:
            response = self.client.put("/api/settings/hf-mirror", json={"url": "https://mirror.invalid/models/", "mode": "manual"})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["configured"], "https://mirror.invalid/models")
            self.assertTrue(response.json()["restart_required"])
            self.assertIn("HF_ENDPOINT=https://mirror.invalid/models", private.read_text())
            self.assertIn("OTHER_SETTING=preserved", private.read_text())
            repeated = self.client.put("/api/settings/hf-mirror", json={"url": "https://mirror.invalid/models", "mode": "manual"})
            self.assertFalse(repeated.json()["restart_required"])
            os.environ.pop("HF_ENDPOINT", None)
            self.assertTrue(user_env.load_into_environ())
            self.assertEqual(os.environ["HF_ENDPOINT"], "https://mirror.invalid/models")
            response = self.client.put("/api/settings/hf-mirror", json={"url": "", "mode": "manual"})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["configured"], "")
            self.assertNotIn("HF_ENDPOINT", private.read_text())
            self.assertNotIn("HF_ENDPOINT", os.environ)
            self.assertEqual(foreign.read_text(), "HF_ENDPOINT=https://global.invalid\n")
            race.assert_not_called(); network.assert_not_called()

    def test_original_hf_mirror_rejects_credentials_and_insecure_remote_addresses(self):
        for url in ("https://user:password@mirror.invalid", "http://mirror.invalid", "https://mirror.invalid?secret=value", "https://mirror.invalid/#fragment"):
            with self.subTest(url=url):
                response = self.client.put("/api/settings/hf-mirror", json={"url": url, "mode": "manual"})
                self.assertEqual(response.status_code, 400, response.text)

    def test_original_hf_mirror_auto_probe_uses_fake_http_without_tokens(self):
        from services import endpoint_race
        class HttpResponse:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, size=-1): return b""
        requests = []
        def fake_http(request, **kwargs):
            self.assertIn(request.full_url.split("/", 3)[2], {"huggingface.co", "hf-mirror.com"})
            self.assertIsNone(request.get_header("Authorization"))
            requests.append((request.full_url, request.get_method()))
            return HttpResponse()
        with patch.dict(os.environ), patch("urllib.request.urlopen", side_effect=fake_http):
            os.environ.pop(endpoint_race.MODE_ENV, None)
            response = self.client.put("/api/settings/hf-mirror", json={"url": "", "mode": "auto"})
            self.assertEqual(response.status_code, 200, response.text)
            initial = len(requests)
            response = self.client.post("/api/settings/hf-mirror/test")
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["mode"], "auto")
            self.assertTrue(response.json()["auto"]["reachable"])
            self.assertEqual(len(response.json()["auto"]["results"]), 2)
            self.assertGreater(len(requests), initial)
            self.assertGreaterEqual(sum(method == "HEAD" for _, method in requests), 2)
            count = len(requests)
            self.assertEqual(self.client.get("/api/settings/hf-mirror").status_code, 200)
            self.assertEqual(len(requests), count, "A settings read must not probe the network")

    def test_download_worker_never_sends_private_token_to_mirror_and_routes_gated_dependencies(self):
        import model_management
        from core import prefs
        from services import endpoint_race, settings_store
        from services import hf_revisions
        def stub(name, **values):
            result = ModuleType(name); result.__dict__.update(values); return result
        token = "hf_fixture_download_private_token_123456789"
        settings_store.set_hf_token(token)
        private = self.data / "environment"
        original_path = list(sys.path)
        parent = {"repo_id": "fixture/public", "gated": False, "revision": "a" * 40,
                  "dependencies": [{"repo_id": "fixture/gated", "gated": True, "revision": "b" * 40}]}
        for mode in ("manual-mirror", "manual-official", "auto-mirror"):
            with self.subTest(mode=mode), patch.dict(os.environ):
                private.write_text("HF_ENDPOINT=https://mirror.invalid\n" if mode == "manual-mirror" else "", encoding="utf-8")
                endpoint_race.set_mode_pref("auto" if mode == "auto-mirror" else "manual")
                prefs.set_("hf_endpoint_auto", {"endpoint": endpoint_race.COMMUNITY_MIRROR, "reachable": True, "latency_ms": 5, "checked_at": time.time(), "results": []})
                os.environ.pop(endpoint_race.MODE_ENV, None)
                os.environ["HF_ENDPOINT"] = "https://inherited-must-not-be-used.invalid"
                calls = []
                def fake_download(**kwargs):
                    calls.append(kwargs)
                    if kwargs.get("dry_run"): return []
                    return str(self.folder / "fake-snapshot")
                modules = {"huggingface_hub": stub("huggingface_hub", snapshot_download=fake_download),
                           "api.routers.setup.models": stub("api.routers.setup.models", KNOWN_MODELS=[parent], snapshot_is_complete=lambda *args: True, disk_space_error=lambda *args, **kwargs: None)}
                try:
                    with patch.dict(sys.modules, modules), patch.object(hf_revisions, "revision_for", return_value="c" * 40), patch.object(hf_revisions, "remember_revision"), patch.object(endpoint_race, "ensure_decision", side_effect=AssertionError("worker must not start a race")), redirect_stdout(io.StringIO()):
                        result = model_management._download(parent["repo_id"], self.engine, self.folder / "fake-cache", parent_watchdog=False)
                    self.assertEqual(result, 0)
                    self.assertEqual(len(calls), 4)
                    for call in calls:
                        if mode == "manual-mirror":
                            expected_endpoint, expected_token = "https://mirror.invalid", False
                        elif mode == "auto-mirror" and call["repo_id"] == "fixture/public":
                            expected_endpoint, expected_token = endpoint_race.COMMUNITY_MIRROR, False
                        else:
                            expected_endpoint, expected_token = endpoint_race.CANONICAL_ENDPOINT, token
                        self.assertEqual(call["endpoint"], expected_endpoint)
                        self.assertEqual(call["token"], expected_token)
                finally:
                    sys.path[:] = original_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", type=Path, required=True)
    arguments, remaining = parser.parse_known_args()
    backend = arguments.engine.resolve() / "backend"
    if not (backend / "services/settings_store.py").is_file():
        raise SystemExit("--engine must point to the extracted bundled engine.")
    sys.path.insert(0, str(backend))
    unittest.main(argv=[sys.argv[0], *remaining])
