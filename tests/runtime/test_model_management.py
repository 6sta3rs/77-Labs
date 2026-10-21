"""Isolated model-manager checks. No user's model is downloaded or removed."""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import contextlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

import model_management as models


REPO = "fixture/tiny-model"
SPEC = {"repo_id": REPO, "role": "TTS", "engines": [], "size_gb": 0.0001}


def module(name, **values):
    result = ModuleType(name)
    result.__dict__.update(values)
    return result


class ModelManagementTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="seventy-seven-model-tests-")
        self.root = Path(self.temporary.name)
        self.runtime, self.data, self.cache = self.root / "runtime", self.root / "data", self.root / "models"
        self.runtime.mkdir(); self.data.mkdir(); self.cache.mkdir()
        (self.runtime / "model-cache.json").write_text(json.dumps({"path": str(self.cache), "source": str(self.root / "old-app-models")}))
        self.environment = patch.dict(os.environ, {"HF_HUB_CACHE": str(self.cache), "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"})
        self.environment.start()
        self.fake_modules = {
            "api.routers.setup.models": module("api.routers.setup.models", KNOWN_MODELS=[SPEC], _model_supported=lambda _: True,
                                                disk_space_error=lambda *a, **kw: None, invalidate_cache=lambda: None,
                                                snapshot_is_complete=lambda spec, path: (Path(path) / "model.onnx").stat().st_size == 65536),
            "core.engine_licenses": module("core.engine_licenses", LICENSE_GATED_ENGINES=frozenset()),
            "services": module("services"),
            "services.settings_store": module("services.settings_store", get_hf_token=lambda: None, get_license_accepted=lambda _: True),
        }
        self.fake_modules["services"].settings_store = self.fake_modules["services.settings_store"]
        self.imports = patch.dict(sys.modules, self.fake_modules)
        self.imports.start()
        self.manager = models.ModelManager(self.runtime, self.data, catalog=[SPEC])

    def tearDown(self):
        self.manager.close()
        deadline = time.monotonic() + 5
        while self.manager.busy() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.imports.stop(); self.environment.stop(); self.temporary.cleanup()

    def test_storage_survives_new_manager_and_preserves_private_settings(self):
        (self.data / "environment").write_text("OTHER_SETTING=preserve-me\n", encoding="utf-8")
        chosen = self.root / "new model folder"
        result = self.manager.set_storage(str(chosen))
        self.assertTrue(result["restart_required"])
        self.assertEqual(models.selected_model_cache(self.runtime, self.data), chosen)
        self.assertIn("OTHER_SETTING=preserve-me", (self.data / "environment").read_text())
        with patch.dict(os.environ, {"HF_HUB_CACHE": str(chosen)}):
            restarted = models.ModelManager(self.runtime, self.data, catalog=[SPEC])
            self.assertFalse(restarted.storage()["restart_required"])
        self.assertTrue((chosen / models.MARKER).is_file())

    def test_storage_rejects_old_runtime_data_and_nonempty_foreign_directories(self):
        foreign = self.root / "foreign"
        foreign.mkdir(); (foreign / "keep.txt").write_text("untouched")
        for path in (self.root / "old-app-models", self.runtime / "engine", self.data, self.root, foreign):
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.manager.set_storage(str(path))
        self.assertEqual((foreign / "keep.txt").read_text(), "untouched")

    def test_storage_rejects_relative_control_and_env_comment_paths(self):
        for path in ("relative/models", "bad\npath", str(self.root / "folder #comment")):
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.manager.set_storage(path)

    def test_corrupt_download_state_is_quarantined_and_engine_still_starts(self):
        state = self.data / "model-downloads.json"
        for body in (b'{"' + REPO.encode() + b'": {"state": "dow', b"\xff\xfe{"):
            with self.subTest(body=body):
                state.write_bytes(body)
                restarted = models.ModelManager(self.runtime, self.data, catalog=[SPEC])
                self.assertEqual(restarted.status()["jobs"], [])
                self.assertFalse(state.exists())
                quarantined = list(self.data.glob("model-downloads.json.corrupt-*"))
                self.assertTrue(quarantined)
                self.assertEqual(quarantined[-1].read_bytes(), body)
                for item in quarantined:
                    item.unlink()

    def test_incomplete_status_is_marked_interrupted_after_restart(self):
        models._atomic_json(self.data / "model-downloads.json", {REPO: {"repo_id": REPO, "state": "downloading", "downloaded_bytes": 15}})
        restarted = models.ModelManager(self.runtime, self.data, catalog=[SPEC])
        self.assertEqual(restarted.status()["jobs"][0]["state"], "interrupted")
        self.assertEqual(restarted.status()["jobs"][0]["downloaded_bytes"], 15)

    def test_delete_requires_exact_confirmation_and_preserves_external_hardlink(self):
        external = self.root / "old-immutable-weight.bin"
        external.write_bytes(b"shared immutable model")
        repository = self.cache / models._repo_name(REPO)
        repository.mkdir(); os.link(external, repository / "weight.bin")
        with self.assertRaises(ValueError):
            self.manager.delete(REPO, "yes")
        self.assertTrue(repository.is_dir())
        self.assertTrue(self.manager.delete(REPO, REPO)["deleted"])
        self.assertFalse(repository.exists())
        self.assertEqual(external.read_bytes(), b"shared immutable model")

    def test_delete_rejects_busy_and_resident_model(self):
        repository = self.cache / models._repo_name(REPO)
        repository.mkdir()
        self.manager.work_busy = lambda: True
        with self.assertRaises(ValueError):
            self.manager.delete(REPO, REPO)
        self.manager.work_busy = lambda: False
        with patch.dict(sys.modules, {"services.model_manager": SimpleNamespace(get_model_status=lambda: {"loaded": True})}):
            with self.assertRaises(ValueError):
                self.manager.delete(REPO, REPO)
        self.assertTrue(repository.exists())

    def test_delete_and_storage_reject_directory_links(self):
        outside = self.root / "outside"
        outside.mkdir(); (outside / "keep.txt").write_text("keep")
        link = self.cache / models._repo_name(REPO)
        try:
            link.symlink_to(outside, target_is_directory=True)
        except OSError:
            if os.name != "nt":
                raise
            result = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(outside)], capture_output=True)
            if result.returncode:
                self.skipTest("This account cannot create a symbolic link or directory junction")
        with self.assertRaises(ValueError):
            self.manager.delete(REPO, REPO)
        with self.assertRaises(ValueError):
            self.manager.set_storage(str(link))
        self.assertTrue((outside / "keep.txt").is_file())

    def test_unknown_and_traversal_repo_is_rejected(self):
        for repo in ("../escape", "fixture/../../escape", "other/unknown", "/absolute"):
            with self.subTest(repo=repo), self.assertRaises(ValueError):
                self.manager.spec(repo)

    def test_router_validates_payload_and_roundtrips_storage_without_network(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        stubs = {"api.dependencies": module("api.dependencies", require_admin=lambda: None)}
        with patch.dict(sys.modules, stubs):
            app = FastAPI()
            app.include_router(models.create_router(self.runtime, self.data))
            with TestClient(app) as client:
                self.assertEqual(client.get("/next/models/jobs").json()["jobs"], [])
                self.assertEqual(client.put("/next/models/storage", json={"wrong_key": "x"}).status_code, 422)
                target = self.root / "router-models"
                saved = client.put("/next/models/storage", json={"path": str(target)})
                self.assertEqual(saved.status_code, 200)
                self.assertTrue(saved.json()["restart_required"])
                self.assertEqual(client.get("/next/models/storage").json()["configured"], str(target))

    def wait_finished(self):
        deadline = time.monotonic() + 8
        while self.manager.busy() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertFalse(self.manager.busy())
        return self.manager.status()["jobs"][0]

    def fixture_process(self, delay=0.2):
        script = self.root / "fixture_worker.py"
        script.write_text("import json,time,sys,os,importlib.util\n"
                          "definition=importlib.util.spec_from_file_location('actual_model_watchdog',sys.argv[1])\n"
                          "operation=importlib.util.module_from_spec(definition);sys.modules[definition.name]=operation;definition.loader.exec_module(operation)\n"
                          "operation._start_parent_watchdog(72)\n"
                          f"print({models.PREFIX!r}+json.dumps(dict(state='downloading',downloaded_bytes=1024,total_bytes=2048)),flush=True)\n"
                          f"time.sleep({delay!r})\n"
                          f"print({models.PREFIX!r}+json.dumps(dict(state='complete')),flush=True)\n", encoding="utf-8")

        def factory(command, **options):
            self.assertEqual(options["env"]["HF_HUB_OFFLINE"], "0")
            self.assertEqual(options["env"]["HF_HUB_CACHE"], str(self.cache))
            self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")
            return subprocess.Popen([sys.executable, str(script), str(Path(models.__file__).resolve())], **options)
        self.manager.process_factory = factory

    def test_supervised_install_records_real_child_events_and_persists_result(self):
        self.fixture_process()
        self.manager.install(REPO)
        self.assertTrue(self.manager.busy())
        job = self.wait_finished()
        self.assertEqual(job["state"], "complete")
        self.assertEqual(job["downloaded_bytes"], 1024)
        restored = models.ModelManager(self.runtime, self.data, catalog=[SPEC])
        self.assertEqual(restored.status()["jobs"][0]["state"], "complete")

    def test_cancel_stops_child_and_allows_resume_without_changing_inference_offline(self):
        self.fixture_process(delay=30)
        self.manager.install(REPO)
        with self.assertRaises(ValueError):
            self.manager.set_storage(str(self.root / "new"))
        self.assertTrue(self.manager.cancel(REPO)["cancelled"])
        self.assertEqual(self.wait_finished()["state"], "cancelled")
        self.fixture_process(delay=0.05)
        self.manager.install(REPO)
        self.assertEqual(self.wait_finished()["state"], "complete")
        self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")

    @unittest.skipUnless(os.name == "nt", "Windows redirector/Job Object regression")
    def test_windows_private_venv_cancel_drains_redirector_worker_and_helper_and_resumes(self):
        import psutil
        self.assertIn(".venv", Path(sys.executable).parts, "Run with the isolated runtime .venv interpreter")
        source = Path(sys.executable).resolve().parents[2] / "engine/backend/core/contained_subprocess.py"
        if not source.is_file():
            self.fail(f"Missing real upstream process owner: {source}")
        definition = importlib.util.spec_from_file_location("next_model_test_process_owner", source)
        owner = importlib.util.module_from_spec(definition)
        definition.loader.exec_module(owner)
        script = self.root / "windows_fixture_worker.py"
        worker_ids = self.root / "worker-pids.json"
        helper_id = self.root / "helper-pid.json"
        helper_script = self.root / "windows_helper.py"
        helper_script.write_text("import os,sys,json,time\nfrom pathlib import Path\nPath(sys.argv[1]).write_text(json.dumps(dict(pid=os.getpid())))\ntime.sleep(60)\n", encoding="utf-8")
        script.write_text(
            "import sys,os,json,time,threading,subprocess,importlib.util\n"
            "from pathlib import Path\n"
            "definition=importlib.util.spec_from_file_location('actual_model_watchdog',sys.argv[4])\n"
            "operation=importlib.util.module_from_spec(definition);sys.modules[definition.name]=operation;definition.loader.exec_module(operation)\n"
            "operation._start_parent_watchdog(72)\n"
            "child=subprocess.Popen([sys.executable,sys.argv[3],sys.argv[2]],stdin=subprocess.DEVNULL,stderr=open(sys.argv[2]+'.error','w'),creationflags=subprocess.CREATE_NO_WINDOW)\n"
            "Path(sys.argv[1]).write_text(json.dumps(dict(worker=os.getpid(),helper_redirector=child.pid)))\n"
            f"print({models.PREFIX!r}+json.dumps(dict(state='downloading',downloaded_bytes=1,total_bytes=2)),flush=True)\n"
            "time.sleep(60)\n", encoding="utf-8")
        children = []
        def factory(command, **options):
            # This is the real isolated venv executable, so Windows may create
            # a redirector + a second Python process before running the script.
            child = owner.spawn_owned([sys.executable, str(script), str(worker_ids), str(helper_id), str(helper_script), str(Path(models.__file__).resolve())], **options)
            children.append(child)
            return child
        self.manager.process_factory = factory
        unrelated = owner.spawn_owned([sys.executable, "-c", "import time;time.sleep(60)"],
                                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _round in range(2):
                worker_ids.unlink(missing_ok=True); helper_id.unlink(missing_ok=True)
                self.manager.install(REPO)
                deadline = time.monotonic() + 10
                while (not worker_ids.is_file() or not helper_id.is_file()) and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertTrue(worker_ids.is_file(), "Actual venv worker did not start")
                self.assertTrue(helper_id.is_file(), "Nested helper did not start: " + (Path(str(helper_id) + '.error').read_text() if Path(str(helper_id) + '.error').is_file() else 'no helper stderr'))
                ids = json.loads(worker_ids.read_text())
                all_pids = {children[-1].pid, ids["worker"], ids["helper_redirector"], json.loads(helper_id.read_text())["pid"],
                            *(child.pid for child in psutil.Process(children[-1].pid).children(recursive=True))}
                handles = [psutil.Process(pid) for pid in all_pids]
                started = time.monotonic()
                self.assertTrue(self.manager.cancel(REPO)["cancelled"])
                self.assertEqual(self.manager.status()["jobs"][0]["state"], "cancelling")
                self.assertEqual(self.wait_finished()["state"], "cancelled")
                _gone, alive = psutil.wait_procs(handles, timeout=2)
                self.assertEqual([process.pid for process in alive], [], f"Orphaned fixture PIDs: {all_pids}")
                self.assertLess(time.monotonic() - started, 8)
                self.assertIsNone(unrelated.poll(), "Cancelling a model must not stop unrelated Python")
        finally:
            # Only this explicitly retained unrelated fixture process is killed.
            self.manager.close()
            unrelated.kill(); unrelated.wait(timeout=5)

    def test_worker_transfer_over_controlled_local_transport_has_bytes_and_verifies_snapshot(self):
        payload = bytes(range(256)) * 256
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200); self.send_header("Content-Length", str(len(payload))); self.end_headers()
                self.wfile.write(payload)
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        calls = []
        def download(**kwargs):
            calls.append(kwargs)
            self.assertEqual(kwargs["revision"], "a" * 40)
            self.assertEqual(kwargs["token"], False)
            if kwargs.get("dry_run"):
                return [SimpleNamespace(file_size=len(payload), will_download=True)]
            import urllib.request
            target = self.cache / "snapshot"
            target.mkdir()
            with urllib.request.urlopen(f"http://127.0.0.1:{server.server_port}/model", timeout=5) as response, (target / "model.onnx").open("wb") as output:
                with kwargs["tqdm_class"](total=len(payload), unit="B", desc="model.onnx") as progress:
                    reconstruction = kwargs["tqdm_class"](total=len(payload), unit="B", desc="Reconstructing (incomplete total...)")
                    while block := response.read(8192):
                        output.write(block); progress.update(len(block)); reconstruction.update(len(block))
                    reconstruction.close()
            return str(target)
        stubs = {
            "huggingface_hub": module("huggingface_hub", snapshot_download=download),
            "services.hf_revisions": module("services.hf_revisions", revision_for=lambda _: "a" * 40, remember_revision=lambda *a: None),
            "services.hf_auth": module("services.hf_auth", CANONICAL_ENDPOINT="https://huggingface.co", apply_process_token_policy=lambda: None, token_for_endpoint=lambda endpoint, token: token),
            "services.endpoint_race": module("services.endpoint_race", download_endpoint=lambda **kwargs: None),
            "core": module("core", user_env=module("core.user_env", get_user_env=lambda *args, **kwargs: None)),
            "tts_extensions": module("tts_extensions", register_catalog=lambda: None),
        }
        result = io.StringIO()
        original_path = list(sys.path)
        try:
            with patch.dict(sys.modules, stubs), patch.dict(os.environ, {"OMNIVOICE_DATA_DIR": str(self.data)}), contextlib.redirect_stdout(result):
                self.assertEqual(models._download(REPO, self.runtime / "engine", self.cache, parent_watchdog=False), 0)
            events = [json.loads(line[len(models.PREFIX):]) for line in result.getvalue().splitlines() if line.startswith(models.PREFIX)]
            self.assertEqual(events[-1]["state"], "complete")
            self.assertEqual(max(event.get("downloaded_bytes", 0) for event in events), len(payload))
            self.assertEqual((self.cache / "snapshot/model.onnx").read_bytes(), payload)
            self.assertEqual(len(calls), 2)
        finally:
            sys.path[:] = original_path
            server.shutdown(); server.server_close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
