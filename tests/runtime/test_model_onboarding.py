"""Pinned stock licence logic with RAM decisions and temporary public sources.

No real settings DB, network, subprocess, model import or acceptance mutation.
"""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import copy
import hashlib
import importlib.abc
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

import model_management as models

ROOT = Path(__file__).resolve().parents[2]
OMNI = "k2-fsa/OmniVoice"
TOKENIZER = "eustlb/higgs-audio-v2-tokenizer"
KOKORO = "mlx-community/Kokoro-82M-bf16"


def module(name, **values):
    result = ModuleType(name)
    result.__dict__.update(values)
    return result


def forbidden(*args, **kwargs):
    raise AssertionError("Forbidden model/network/process/write operation")


class NoModelImports(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, *args, **kwargs):
        if fullname.split(".")[0] in {"torch", "numpy", "transformers", "huggingface_hub", "omnivoice", "whisperx"} or fullname in {"services.tts_backend", "services.model_manager", "api.routers.setup.models"}:
            raise AssertionError("Forbidden model/backend import: " + fullname)


class OnboardingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="seventy-seven-onboarding-test-")
        self.root = Path(self.tmp.name)
        self.engine = self.root / "engine"
        self.records = {}
        self.reads = []
        with zipfile.ZipFile(ROOT / "scripts/runtime/vendor/engine.zip") as archive:
            for relative in models._ONBOARDING_PROOF:
                target = self.engine / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(relative))
        services = module("services", __path__=[str(self.engine / "backend/services")])
        core = module("core", __path__=[])
        def get_text(key, default=None):
            self.reads.append(key)
            return self.records.get(key, default)
        store = module("services.settings_store", get_text=get_text, set_text=forbidden, get_license_accepted=forbidden)
        modules = {"services": services, "services.settings_store": store, "core": core,
                   "core.path_security": module("core.path_security", UnsafePath=ValueError, resolve_within=forbidden)}
        services.settings_store = store
        self.modules = patch.dict(sys.modules, modules)
        self.modules.start()
        for name in ["model_licenses", "model_acceptance"]:
            filename = self.engine / "backend/services" / (name + ".py")
            loaded = module("services." + name, __file__=str(filename))
            sys.modules[loaded.__name__] = loaded
            setattr(services, name, loaded)
            exec(compile(filename.read_bytes(), str(filename), "exec"), loaded.__dict__)
        self.licenses = services.model_licenses
        self.acceptance = services.model_acceptance
        # API existence is checked, but neither operation may execute on GET.
        self.acceptance.accept = self.acceptance.revoke = forbidden
        self.selection = {"active": "omnivoice", "configured_active": "omnivoice", "selection_check": "configured",
                          "active_model": OMNI, "label": "OmniVoice"}
        self.app = SimpleNamespace(_next_engine_catalogue_metadata=SimpleNamespace(engine=self.engine, selected_tts_payload=lambda: copy.deepcopy(self.selection)))
        self.finder = NoModelImports()
        sys.meta_path.insert(0, self.finder)
        self.network = patch.object(socket, "create_connection", forbidden)
        self.process = patch.object(subprocess, "Popen", forbidden)
        self.network.start(); self.process.start()

    def tearDown(self):
        self.process.stop(); self.network.stop()
        sys.meta_path.remove(self.finder)
        self.modules.stop()
        self.tmp.cleanup()

    def plan(self):
        return models.onboarding_plan(self.app, self.engine)

    def error(self, status, code=None):
        with self.assertRaises(models.OnboardingPlanError) as raised:
            self.plan()
        self.assertEqual(raised.exception.status, status)
        if code:
            self.assertEqual(raised.exception.code, code)
        self.assertNotIn(str(self.root), str(raised.exception))

    def test_none_accepted_two_exact_repos_with_stock_fingerprints(self):
        before = copy.deepcopy(self.records)
        result = self.plan()
        self.assertEqual(set(result), {"schema", "engine", "models", "source"})
        self.assertEqual(result["schema"], 1)
        self.assertEqual(result["engine"], {"id": "omnivoice", "label": "OmniVoice", "model_id": OMNI})
        self.assertIn("0.5.7", result["source"])
        self.assertEqual([row["repo_id"] for row in result["models"]], [OMNI, TOKENIZER])
        for row in result["models"]:
            self.assertTrue(row["required"])
            self.assertFalse(row["accepted"])
            self.assertRegex(row["fingerprint"], r"^v2:[0-9a-f]{64}$")
            self.assertIn("license", row)
        self.assertEqual(self.records, before)
        self.assertEqual(set(self.reads), {"model_licence_accepted:" + repo.casefold() for repo in [OMNI, TOKENIZER]})

    def test_one_and_both_accepted_are_authoritative_ram_statuses(self):
        fingerprints = {row["repo_id"]: row["fingerprint"] for row in self.plan()["models"]}
        for repo in [OMNI, TOKENIZER]:
            self.records["model_licence_accepted:" + repo.casefold()] = fingerprints[repo]
            states = {row["repo_id"]: row["accepted"] for row in self.plan()["models"]}
            self.assertTrue(states[repo])
            self.assertEqual(states[TOKENIZER], repo == TOKENIZER)

    def test_withdrawn_and_changed_fingerprint_are_not_accepted(self):
        self.records["model_licence_accepted:" + OMNI.casefold()] = "revoked"
        self.records["model_licence_accepted:" + TOKENIZER.casefold()] = "v2:" + "0" * 64
        result = self.plan()["models"]
        self.assertEqual([row["state"] for row in result], ["withdrawn", "terms_updated"])
        self.assertTrue(all(not row["accepted"] for row in result))

    def test_omnivoice_dependency_is_not_dropped_by_configured_identity(self):
        calls = []
        original = self.acceptance.repos_for_engine
        self.acceptance.repos_for_engine = lambda engine, identity=None: (calls.append((engine, identity)), original(engine, identity))[1]
        self.plan()
        self.assertEqual(calls, [("omnivoice", None)])

    def test_isolated_omnivoice_includes_same_physical_tokenizer(self):
        self.selection["active"] = "omnivoice-subprocess"
        self.assertEqual({row["repo_id"] for row in self.plan()["models"]}, {OMNI, TOKENIZER})

    def test_mlx_concrete_model_does_not_ask_about_all_alternatives(self):
        self.selection.update(active="mlx-audio", active_model=KOKORO)
        self.assertEqual([row["repo_id"] for row in self.plan()["models"]], [KOKORO])

    def test_custom_unknown_or_local_model_never_succeeds_with_empty_plan(self):
        for engine, identity in [("omnivoice", "custom/unreviewed"), ("omnivoice", "C:/models/local"), ("mlx-audio", "custom/unknown"), ("mlx-audio", "kokoro"), ("cosyvoice", None)]:
            with self.subTest(engine=engine, identity=identity):
                self.selection.update(active=engine, active_model=identity)
                self.error(503)

    def test_unresolved_auto_never_guesses_omnivoice(self):
        self.selection.update(active="", configured_active="auto", selection_check="not_resolved")
        self.error(503, "onboarding_selection_unresolved")

    def test_missing_or_different_generation_catalogue_is_503(self):
        del self.app._next_engine_catalogue_metadata
        self.error(503, "onboarding_not_ready")
        self.app._next_engine_catalogue_metadata = SimpleNamespace(engine=self.root / "other", selected_tts_payload=forbidden)
        self.error(503, "onboarding_selection_unavailable")

    def test_legacy_missing_acceptance_source_is_501(self):
        (self.engine / "backend/services/model_acceptance.py").unlink()
        self.error(501, "onboarding_unsupported")

    def test_changed_or_corrupt_registry_source_is_501(self):
        (self.engine / "backend/config/model_licenses.json").write_text('{"models": []}', encoding="utf-8")
        self.error(501, "onboarding_unsupported")

    def test_missing_accept_api_is_not_a_successful_readonly_legacy_plan(self):
        self.acceptance.accept = None
        self.error(501, "onboarding_unsupported")

    def test_stock_empty_or_partial_repo_mapping_fails_closed(self):
        for repos in [[], [OMNI], [OMNI, OMNI]]:
            self.acceptance.repos_for_engine = lambda *args: repos
            self.error(503, "onboarding_registry_unavailable")

    def test_bad_status_missing_fingerprint_or_wrong_repo_is_503(self):
        original = self.acceptance.status
        for patch in [{"fingerprint": ""}, {"repo_id": "other/model"}, {"accepted": True}, {"category": "invented"}, {"required": False, "accepted": True, "state": "not_required"}]:
            self.acceptance.status = lambda repo: {**original(repo), **patch}
            self.error(503, "onboarding_registry_unavailable")

    def test_unexpected_status_exception_does_not_leak_path_or_secret(self):
        def failed(repo):
            raise RuntimeError(str(self.root) + " private token fixture")
        self.acceptance.status = failed
        self.error(503, "onboarding_registry_unavailable")

    def test_module_from_different_runtime_is_503(self):
        self.acceptance.__file__ = str(self.root / "foreign.py")
        self.error(503, "onboarding_registry_unavailable")

    def test_http_route_contract_errors_and_existing_admin_gate(self):
        from fastapi import FastAPI, HTTPException
        from fastapi.testclient import TestClient
        runtime, data = self.root / "runtime", self.root / "data"
        runtime.mkdir(); data.mkdir()
        dependencies = module("api.dependencies", require_admin=lambda: None)
        with patch.dict(sys.modules, {"api.dependencies": dependencies, "activity": module("activity", backend_work_busy=lambda: False)}):
            app = FastAPI()
            app._next_engine_catalogue_metadata = self.app._next_engine_catalogue_metadata
            app.include_router(models.create_router(runtime, data, engine_path=self.engine))
            with TestClient(app) as client:
                answer = client.get("/next/models/onboarding")
                self.assertEqual(answer.status_code, 200)
                self.assertEqual(answer.json(), self.plan())
                del app._next_engine_catalogue_metadata
                self.assertEqual(client.get("/next/models/onboarding").status_code, 503)
                self.assertEqual(client.post("/next/models/onboarding").status_code, 405)
            def denied():
                raise HTTPException(status_code=403, detail="fixture admin denied")
            app.dependency_overrides[dependencies.require_admin] = denied
            with TestClient(app) as client:
                self.assertEqual(client.get("/next/models/onboarding").status_code, 403)

    def test_asgi_real_pinned_metadata_catalogue_and_fixture_sqlite_200_503_501(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        import engine_catalogue_metadata as metadata
        runtime, data = self.root / "real-catalogue-runtime", self.root / "real-catalogue-data"
        runtime.mkdir(); data.mkdir()
        archive = ROOT / "scripts/runtime/vendor/engine.zip"
        with zipfile.ZipFile(archive) as source:
            for relative in metadata._DATA["source_hashes"]:
                target = self.engine / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read(relative))
        (runtime / "tts_catalog.py").write_bytes((ROOT / "scripts/runtime/app/tts_catalog.py").read_bytes())
        site = runtime / ".venv" / ("Lib/site-packages" if os.name == "nt" else f"lib/python{sys.version_info.major}.{sys.version_info.minor}/site-packages")
        site.mkdir(parents=True)
        database = data / "omnivoice.db"
        original_connect = sqlite3.connect
        with original_connect(database) as connection:
            connection.execute("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
        connection.close()
        # Both the real catalogue and the real stock acceptance functions can
        # read ONLY this fresh fixture DB. No real/private settings module runs.
        def fixture_connect(path, *args, **kwargs):
            self.assertEqual(str(path).split("?")[0], database.as_uri())
            self.assertTrue(kwargs.get("uri"))
            self.assertIn("mode=ro", str(path))
            return original_connect(path, *args, **kwargs)
        def read_fixture(key, default=None):
            connection = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)
            try:
                row = connection.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
                return row[0] if row else default
            finally:
                connection.close()
        dependencies = module("api.dependencies", require_admin=lambda: None)
        before_modules = set(sys.modules)
        env = {"VOICESTUDIO_NEXT_BUNDLE": str(archive), "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"}
        stubs = {"api.dependencies": dependencies, "activity": module("activity", backend_work_busy=lambda: False)}
        with patch.dict(os.environ, env, clear=True), patch.dict(sys.modules, stubs), patch.object(sqlite3, "connect", fixture_connect), patch.object(sys.modules["services.settings_store"], "get_text", read_fixture), patch.object(metadata.platform, "machine", forbidden), patch.object(metadata.MetadataCatalogue, "family_payload", forbidden), patch.object(metadata.MetadataCatalogue, "_state", forbidden):
            catalogue = metadata.MetadataCatalogue(engine_path=self.engine, runtime_root=runtime, data_dir=data)
            self.assertIs(type(catalogue), metadata.MetadataCatalogue)
            self.assertEqual(catalogue.selected_tts_payload()["active"], "omnivoice")
            app = FastAPI()
            app.include_router(models.create_router(runtime, data, engine_path=self.engine))
            with TestClient(app) as client:
                unavailable = client.get("/next/models/onboarding")
                self.assertEqual(unavailable.status_code, 503)
                self.assertIsInstance(unavailable.json()["detail"]["message"], str)
                self.assertEqual(unavailable.json()["detail"]["code"], "onboarding_not_ready")
                app._next_engine_catalogue_metadata = catalogue
                before = hashlib.sha256(database.read_bytes()).hexdigest()
                first = client.get("/next/models/onboarding")
                self.assertEqual(first.status_code, 200, first.text)
                result = first.json()
                self.assertEqual(result["engine"]["id"], "omnivoice")
                self.assertEqual(result["engine"]["model_id"], OMNI)
                self.assertEqual([item["repo_id"] for item in result["models"]], [OMNI, TOKENIZER])
                self.assertTrue(all(item["required"] and not item["accepted"] for item in result["models"]))
                self.assertEqual(hashlib.sha256(database.read_bytes()).hexdigest(), before)
                # Seed test evidence directly in the owned fixture; never call
                # accept/revoke, even against the fake store.
                connection = original_connect(database)
                try:
                    connection.executemany("INSERT INTO settings(key,value) VALUES (?,?)", [("model_licence_accepted:" + item["repo_id"].casefold(), item["fingerprint"]) for item in result["models"]])
                    connection.commit()
                finally:
                    connection.close()
                before = hashlib.sha256(database.read_bytes()).hexdigest()
                accepted = client.get("/next/models/onboarding")
                self.assertEqual(accepted.status_code, 200)
                self.assertTrue(all(item["accepted"] for item in accepted.json()["models"]))
                self.assertEqual(hashlib.sha256(database.read_bytes()).hexdigest(), before)
                (data / "prefs.json").write_text('{"tts_backend":"unknown-fixture"}', encoding="utf-8")
                unresolved = client.get("/next/models/onboarding")
                self.assertEqual(unresolved.status_code, 503)
                self.assertEqual(unresolved.json()["detail"]["code"], "onboarding_selection_unresolved")
                (data / "prefs.json").write_text('{}', encoding="utf-8")
                (self.engine / "backend/services/model_acceptance.py").unlink()
                unsupported = client.get("/next/models/onboarding")
                self.assertEqual(unsupported.status_code, 501)
                self.assertEqual(unsupported.json()["detail"]["code"], "onboarding_unsupported")
                self.assertIsInstance(unsupported.json()["detail"]["message"], str)
        self.assertFalse(any(name.split(".")[0] in {"torch", "numpy", "transformers", "huggingface_hub", "omnivoice"} for name in set(sys.modules) - before_modules))


if __name__ == "__main__":
    unittest.main()
