"""No ML imports, sidecar dependencies or external network: archive + child fixtures."""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from types import ModuleType, SimpleNamespace
from unittest.mock import patch
import zipfile

import engine_installation as engines
from private_environment import update_private_environment

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)

ROOT = Path(__file__).resolve().parents[2]


def fixture_child():
    # Same protocol and ownership pipe as the real worker, without installers.
    mode, attempt, disclosure, engine_id = sys.argv[2:]
    attempt = Path(attempt)
    from model_management import _start_parent_watchdog
    _start_parent_watchdog(72)
    print(engines.PREFIX + json.dumps({"state": "installing", "phase": "install_deps", "message": "token=hf_fixturesecret000000"}), flush=True)
    if mode == "cancel":
        time.sleep(60)
    if mode == "fail":
        print(engines.PREFIX + json.dumps({"state": "failed", "error": "Fixture dependency failure"}), flush=True)
        return 1
    checkout = attempt / "fixture-checkout"
    py = checkout / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    py.parent.mkdir(parents=True)
    py.write_bytes(b"fixture interpreter never executed")
    (checkout / ".fixture-complete").write_text("fixture")
    (attempt / engines.MARKER).write_text(json.dumps({"engine_id": engine_id, "disclosure_id": disclosure, "install_dir": str(checkout)}))
    print(engines.PREFIX + json.dumps({"state": "complete"}), flush=True)
    time.sleep(0.15)  # success event is deliberately earlier than process exit
    return 0


class EngineInstallationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="seventy-seven-sidecar-tests-")
        self.root = Path(self.temp.name)
        self.runtime, self.data = self.root / "runtime", self.root / "data"
        self.runtime.mkdir(); self.data.mkdir()
        self.spec = {"engine_id": "fixture-engine", "display_name": "Fixture", "kind": "sidecar", "disclosure_id": "a" * 64,
                     "env_var": "OMNIVOICE_FIXTURE_DIR", "completion_marker": ".fixture-complete", "license_required": False,
                     "supported": True, "required_bytes": 1}
        self.children = []
        self.mode = "success"
        # Real bundled stdlib-only process owner, not a fake PID termination.
        archive = ROOT / "scripts/runtime/vendor/engine.zip"
        with zipfile.ZipFile(archive) as bundle:
            path = self.root / "contained_subprocess.py"
            path.write_bytes(bundle.read("backend/core/contained_subprocess.py"))
        module = importlib.util.spec_from_file_location("fixture_contained_subprocess", path)
        self.owner = importlib.util.module_from_spec(module)
        module.loader.exec_module(self.owner)

        def factory(command, **options):
            attempt = command[command.index("--attempt") + 1]
            process = self.owner.spawn_owned([sys.executable, str(Path(__file__).resolve()), "--fixture-worker", self.mode, attempt,
                                             self.spec["disclosure_id"], self.spec["engine_id"]], **options)
            self.children.append(process)
            return process
        self.manager = engines.EngineRuntimeManager(self.runtime, self.data, engine_path=self.root / "unused-engine",
                        distribution_manifest=self.root / "manifest.json", catalog=[self.spec], process_factory=factory)

    def tearDown(self):
        self.manager.close()
        self.temp.cleanup()

    def wait_done(self):
        deadline = time.monotonic() + 12
        while self.manager.busy() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertFalse(self.manager.busy(), "Fixture child ownership not released")
        return self.manager.status()["jobs"][0]

    def install(self):
        return self.manager.install(self.spec["engine_id"], self.spec["disclosure_id"], True)

    def test_metadata_of_both_real_archives_without_imports_or_downloads(self):
        reports = []
        archives = [ROOT / "scripts/runtime/vendor/engine.zip", ROOT / ".tmp/engine-candidate-7a6c898/engine.zip"]
        for index, archive in enumerate(archives):
            if not archive.is_file():
                continue
            target = self.root / f"engine-{index}"
            with zipfile.ZipFile(archive) as bundle:
                for member in ("backend/services/sidecar_install.py", "backend/services/audiocpp_runtime_install.py", "backend/engines/audiocpp/bootstrap.py"):
                    path = target / member
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(bundle.read(member))
            with patch("urllib.request.urlopen", side_effect=AssertionError("Metadata made a network request")):
                catalog = engines.read_catalog(target)
            self.assertEqual(len(catalog), 10)
            self.assertEqual(len({item["engine_id"] for item in catalog}), 10)
            self.assertFalse(next(item for item in catalog if item["engine_id"] == "dots-tts")["supported"])
            cosy = next(item for item in catalog if item["engine_id"] == "cosyvoice")
            self.assertEqual(len(cosy["extra_sources"]), 3)
            self.assertIn("{engine}", cosy["install_args"][1])
            native = next(item for item in catalog if item["kind"] == "native")
            self.assertEqual(native["download_bytes"], 56_818_905)
            self.assertEqual(native["archive_sha256"], "057332f9e3fb37706a8ecb5075ac1797efcd85fdccd739f7b65761a5920f2828")
            self.assertEqual(len(native["disclosure_id"]), 64)
            self.assertNotIn("torch", sys.modules)
            reports.append({"archive": str(archive.relative_to(ROOT)), "engines": [{"id": item["engine_id"], "disclosure_id": item["disclosure_id"]} for item in catalog]})
        self.assertTrue(reports)
        report = ROOT / ".tmp/qa/engine-installation-contract.json"
        report.write_text(json.dumps({"schema": 1, "static_only": True, "actual_installation_verified": False, "archives": reports}, indent=2) + "\n", encoding="utf-8")

    def test_catalog_status_do_not_fetch_uv_or_spawn(self):
        with patch("urllib.request.urlopen", side_effect=AssertionError("network")):
            self.assertEqual(len(self.manager.catalog()["engines"]), 1)
            self.assertEqual(self.manager.status()["jobs"], [])
            self.assertEqual(self.children, [])

    def test_install_requires_current_disclosure_and_explicit_consent(self):
        for engine, disclosure, accepted in [("unknown", self.spec["disclosure_id"], True), (self.spec["engine_id"], "old", True),
                                               (self.spec["engine_id"], self.spec["disclosure_id"], False)]:
            with self.assertRaises(ValueError):
                self.manager.install(engine, disclosure, accepted)
        self.assertEqual(self.children, [])

    def test_busy_and_license_gate_precede_child_creation(self):
        self.manager.work_busy = lambda: True
        with self.assertRaises(ValueError):
            self.install()
        self.manager.work_busy = None
        self.spec["license_required"] = True
        self.manager.license_allowed = lambda _: False
        with self.assertRaises(ValueError):
            self.install()
        self.assertEqual(self.children, [])

    def test_success_waits_for_owned_exit_then_explicit_activation_preserves_settings(self):
        (self.data / "environment").write_text("# keep\nOMNIVOICE_CACHE_DIR=D:/models\nOTHER_SETTING=yes\n", encoding="utf-8")
        old_env = os.environ.get(self.spec["env_var"])
        self.install()
        self.assertTrue(self.manager.busy())
        job = self.wait_done()
        self.assertEqual(job["state"], "complete")
        self.assertNotIn("hf_fixturesecret", json.dumps(job))
        self.assertNotIn(self.spec["env_var"], (self.data / "environment").read_text())
        response = self.manager.activate(self.spec["engine_id"], self.spec["disclosure_id"])
        self.assertTrue(response["restart_required"])
        self.assertEqual(os.environ.get(self.spec["env_var"]), old_env)
        written = (self.data / "environment").read_text()
        for value in ("# keep", "OMNIVOICE_CACHE_DIR=D:/models", "OTHER_SETTING=yes", self.spec["env_var"]):
            self.assertIn(value, written)
        self.assertEqual(self.children[0].wait(timeout=2), 0)
        self.install()  # healthy idempotent re-request
        self.assertEqual(len(self.children), 1)

    def test_cancel_real_owned_worker_and_retry_same_private_attempt(self):
        self.mode = "cancel"
        first = self.install()
        deadline = time.monotonic() + 8
        while self.manager.status()["jobs"][0]["state"] == "starting" and time.monotonic() < deadline:
            time.sleep(.02)
        self.assertTrue(self.manager.cancel(self.spec["engine_id"])["requested"])
        job = self.wait_done()
        self.assertEqual(job["state"], "cancelled")
        self.assertIsNotNone(self.children[0].poll())
        self.mode = "success"
        second = self.install()
        self.assertEqual(first["attempt_id"], second["attempt_id"])
        self.assertEqual(self.wait_done()["state"], "complete")

    def test_failure_persists_and_active_recovery_is_interrupted(self):
        self.mode = "fail"
        self.install()
        job = self.wait_done()
        self.assertEqual(job["state"], "failed")
        self.assertIn("Fixture", job["error"])
        job["state"] = "installing"
        engines._atomic_json(self.manager.path, {self.spec["engine_id"]: job})
        restored = engines.EngineRuntimeManager(self.runtime, self.data, engine_path=self.root, distribution_manifest=self.root, catalog=[self.spec])
        self.assertEqual(restored.status()["jobs"][0]["state"], "interrupted")

    def test_activation_rejects_missing_verification_files(self):
        self.install()
        job = self.wait_done()
        attempt = self.manager._attempt(self.spec, job)
        marker = json.loads((attempt / engines.MARKER).read_text())
        (Path(marker["install_dir"]) / ".fixture-complete").unlink()
        with self.assertRaises(ValueError):
            self.manager.activate(self.spec["engine_id"], self.spec["disclosure_id"])

    def test_private_cache_copy_only_ignores_old_global_env(self):
        with patch.dict(os.environ, {"UV_LINK_MODE": "hardlink", "UV_CACHE_DIR": "old-cache", "UV_INDEX_URL": "https://foreign.invalid",
                                    "HF_TOKEN": "global", "NEXT_ENGINE_HF_TOKEN": "ambient-secret", "OMNIVOICE_FIXTURE_DIR": "old-VoiceStudio", "VIRTUAL_ENV": "old-venv"}):
            env = engines.private_worker_environment(self.runtime, self.root / "attempt", [self.spec])
        self.assertEqual(env["UV_LINK_MODE"], "copy")
        self.assertEqual(env["UV_NO_CONFIG"], "1")
        self.assertNotIn("UV_INDEX_URL", env)
        self.assertNotIn("HF_TOKEN", env)
        self.assertNotIn("NEXT_ENGINE_HF_TOKEN", env)
        self.assertNotIn("VIRTUAL_ENV", env)
        self.assertNotIn("OMNIVOICE_FIXTURE_DIR", env)
        self.assertTrue(Path(env["UV_CACHE_DIR"]).is_relative_to(self.runtime))
        self.assertTrue(Path(env["OMNIVOICE_ENGINES_DIR"]).is_relative_to(self.root / "attempt"))

    def uv_fixture(self, *, duplicate=False):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as bundle:
            bundle.writestr("fixture/uv.exe", b"fixture pinned executable never run")
            bundle.writestr("fixture/uvx.exe", b"not extracted")
            if duplicate:
                bundle.writestr("another/uv.exe", b"duplicate")
        body = buffer.getvalue()
        manifest = self.root / "manifest.json"
        manifest.write_text(json.dumps({"uv": {"version": "fixture", "url": "https://github.com/astral-sh/uv/releases/download/fixture/pinned.zip", "sha256": hashlib.sha256(body).hexdigest()}}))
        return body, manifest

    def test_uv_download_verifies_zip_and_exe_not_global_marker(self):
        body, manifest = self.uv_fixture()
        calls, events = [], []
        def transport(url):
            calls.append(url)
            return io.BytesIO(body)
        executable = engines.ensure_pinned_uv(self.runtime, manifest, transport=transport, emit=lambda **event: events.append(event))
        self.assertEqual(executable.read_bytes(), b"fixture pinned executable never run")
        self.assertFalse((self.runtime / "tools/uvx.exe").exists())
        engines.ensure_pinned_uv(self.runtime, manifest, transport=lambda _: self.fail("repeated network"))
        self.assertEqual(len(calls), 1)
        self.assertEqual(events[-1]["downloaded_bytes"], len(body))
        executable.write_bytes(b"unverified executable")
        with self.assertRaises(ValueError):
            engines.ensure_pinned_uv(self.runtime, manifest)
        self.assertEqual(executable.read_bytes(), b"unverified executable")

    def test_uv_wrong_hash_and_duplicate_executable_rejected(self):
        body, manifest = self.uv_fixture()
        with self.assertRaises(ValueError):
            engines.ensure_pinned_uv(self.runtime, manifest, transport=lambda _: io.BytesIO(body + b"tamper"))
        self.assertFalse((self.runtime / "tools/uv.exe").exists())
        self.assertFalse((self.runtime / "downloads/uv.zip").exists())
        body, manifest = self.uv_fixture(duplicate=True)
        with self.assertRaises(ValueError):
            engines.ensure_pinned_uv(self.runtime, manifest, transport=lambda _: io.BytesIO(body))

    def test_environment_concurrent_merges_preserve_unrelated_keys(self):
        (self.data / "environment").write_text("# untouched\nUNCHANGED=value\n", encoding="utf-8")
        names = {f"FIXTURE_{index}" for index in range(12)}
        threads = [threading.Thread(target=update_private_environment, args=(self.data, {name: str(index)}), kwargs={"allowed_keys": names}) for index, name in enumerate(sorted(names))]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        result = (self.data / "environment").read_text()
        self.assertIn("# untouched\nUNCHANGED=value", result)
        for name in names:
            self.assertEqual(result.count(name + "="), 1)
        for changes in ({"NOT_ALLOWED": "bad"}, {"FIXTURE_0": "bad\nvalue"}):
            with self.assertRaises(ValueError):
                update_private_environment(self.data, changes, allowed_keys=names)

    def test_environment_advisory_lock_serializes_separate_processes(self):
        (self.data / "environment").write_text("KEEP=value\n", encoding="utf-8")
        children = [self.owner.spawn_owned([sys.executable, "-S", str(Path(__file__).resolve()), "--fixture-environment", str(self.data), name],
                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE) for name in ("FIXTURE_A", "FIXTURE_B")]
        try:
            for child in children:
                self.assertEqual(child.wait(timeout=12), 0)
                child.stdout.close(); child.stderr.close()
        finally:
            for child in children:
                if child.poll() is None:
                    child.kill(); child.wait(timeout=5)
        body = (self.data / "environment").read_text()
        for value in ("KEEP=value", "FIXTURE_A=9", "FIXTURE_B=9"):
            self.assertIn(value, body)

    def test_stock_worker_stages_in_private_tree_with_pinned_uv_and_no_prefs_write(self):
        engine = self.root / "audited-engine"
        with zipfile.ZipFile(ROOT / "scripts/runtime/vendor/engine.zip") as bundle:
            for member in ("backend/services/sidecar_install.py", "backend/services/audiocpp_runtime_install.py", "backend/engines/audiocpp/bootstrap.py"):
                path = engine / member; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(bundle.read(member))
        recipe = next(item for item in engines.read_catalog(engine) if item["engine_id"] == "supertonic3")
        attempt = self.runtime / "sidecars/supertonic3" / ("b" * 32)
        attempt.mkdir(parents=True)
        body, manifest = self.uv_fixture()
        engines.ensure_pinned_uv(self.runtime, manifest, transport=lambda _: io.BytesIO(body))
        config = ModuleType("core.config")
        config.DATA_DIR = attempt / "data"
        config.get_engines_dir = lambda *args: attempt / "engines"
        core = ModuleType("core"); core.__path__ = []
        services = ModuleType("services"); services.__path__ = []
        token_resolver = ModuleType("services.token_resolver")
        endpoint_race = ModuleType("services.endpoint_race")
        module_name = "fixture_stock_sidecar"
        spec = importlib.util.spec_from_file_location(module_name, engine / "backend/services/sidecar_install.py")
        installer = importlib.util.module_from_spec(spec)
        source_modules = {"core": core, "core.config": config, "core.contained_subprocess": self.owner, module_name: installer,
                          "services": services, "services.token_resolver": token_resolver, "services.endpoint_race": endpoint_race}
        original_path = list(sys.path)
        calls = []
        output = io.StringIO()
        try:
            with patch.dict(sys.modules, source_modules):
                spec.loader.exec_module(installer)
                services.sidecar_install = installer
                def create_venv(spec, job):
                    py = installer._venv_python(installer.managed_checkout(spec) / ".venv")
                    py.parent.mkdir(parents=True, exist_ok=True); py.write_bytes(b"fixture only")
                def install_deps(spec, job):
                    calls.append((installer._locate_uv(), os.environ["UV_LINK_MODE"], os.environ["UV_CACHE_DIR"]))
                    installer._log(job, "Fixture dependencies installed; no package manager executed.")
                def verify(spec, job):
                    (installer.managed_checkout(spec) / installer._INSTALL_COMPLETE_MARKER).write_text(spec.probe_module + "\n")
                installer._step_create_venv, installer._step_install_deps, installer._step_verify = create_venv, install_deps, verify
                installer._persist = lambda *_: self.fail("A staged install wrote application prefs")
                arguments = SimpleNamespace(engine=engine, runtime=self.runtime, attempt=attempt, manifest=manifest,
                                            install="supertonic3", disclosure=recipe["disclosure_id"])
                with patch.dict(os.environ, {"NEXT_ENGINE_HF_TOKEN": "hf_sidecar_fixture"}, clear=False), contextlib.redirect_stdout(output):
                    self.assertEqual(engines._install_worker(arguments, watchdog=False), 0)
                    self.assertEqual(token_resolver.resolve().token, "hf_sidecar_fixture")
                    self.assertNotIn("NEXT_ENGINE_HF_TOKEN", os.environ)
            self.assertEqual(calls, [(str(self.runtime / "tools/uv.exe"), "copy", str(self.runtime / "sidecar-cache/uv"))])
            marker = json.loads((attempt / engines.MARKER).read_text())
            self.assertTrue(Path(marker["install_dir"]).is_relative_to(attempt))
            events = [json.loads(line[len(engines.PREFIX):]) for line in output.getvalue().splitlines() if line.startswith(engines.PREFIX)]
            self.assertEqual(events[-1]["state"], "complete")
            self.assertTrue(any(event.get("phase") == "install_deps" for event in events))
            self.assertFalse((self.data / "environment").exists())
            self.assertNotIn("torch", sys.modules)
        finally:
            sys.path[:] = original_path

    def test_guard_rejects_hardlinked_partial_without_mutating_old_file(self):
        old = self.root / "old-lib.bin"
        old.write_bytes(b"old installation immutable")
        attempt = self.root / "partial"
        attempt.mkdir()
        os.link(old, attempt / "dependency.bin")
        with self.assertRaises(ValueError):
            engines._assert_private_tree(attempt)
        self.assertEqual(old.read_bytes(), b"old installation immutable")

    def test_only_sidecar_reads_and_receives_explicit_fixture_token(self):
        calls, captured = [], []
        services = ModuleType("services")
        services.settings_store = SimpleNamespace(get_hf_token=lambda: calls.append("read-fixture") or "hf_explicit_fixture_secret")
        def no_execution(command, **options):
            captured.append(options["env"])
            raise OSError("controlled fixture: no child started")
        self.manager.process_factory = no_execution
        with patch.dict(sys.modules, {"services": services}), patch.dict(os.environ, {"NEXT_ENGINE_HF_TOKEN": "ambient-fixture-secret"}):
            self.spec["kind"] = "native"
            with self.assertRaises(ValueError):
                self.install()
            self.assertEqual(calls, [])
            self.assertNotIn("NEXT_ENGINE_HF_TOKEN", captured[-1])
            self.spec["kind"] = "sidecar"
            with self.assertRaises(ValueError):
                self.install()
            self.assertEqual(calls, ["read-fixture"])
            self.assertEqual(captured[-1]["NEXT_ENGINE_HF_TOKEN"], "hf_explicit_fixture_secret")

    def test_native_worker_removes_fixture_token_before_binary_stage(self):
        engine = self.root / "native-source"
        with zipfile.ZipFile(ROOT / "scripts/runtime/vendor/engine.zip") as bundle:
            for member in ("backend/services/sidecar_install.py", "backend/services/audiocpp_runtime_install.py", "backend/engines/audiocpp/bootstrap.py"):
                path = engine / member; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(bundle.read(member))
        recipe = next(item for item in engines.read_catalog(engine) if item["engine_id"] == "audio-cpp")
        attempt = self.runtime / "sidecars/audio-cpp" / ("c" * 32)
        attempt.mkdir(parents=True)
        installer = ModuleType("services.audiocpp_runtime_install")
        installer.bootstrap = SimpleNamespace()
        binary_environments = []
        def install_fixture():
            binary_environments.append(dict(os.environ))
            target = installer.bootstrap.managed_runtime_dir(); target.mkdir()
            for name in ("audiocpp_server.exe", "audiocpp_cli.exe"):
                (target / name).write_bytes(b"fixture native bytes, never executed")
        installer._install = install_fixture
        services = ModuleType("services"); services.audiocpp_runtime_install = installer
        arguments = SimpleNamespace(engine=engine, runtime=self.runtime, attempt=attempt, manifest=self.root / "unused-manifest",
                                    install="audio-cpp", disclosure=recipe["disclosure_id"])
        original_path = list(sys.path)
        try:
            with patch.dict(sys.modules, {"services": services}), patch.dict(os.environ, {"NEXT_ENGINE_HF_TOKEN": "hf_fake_never_real", "HF_TOKEN": "fake-global"}), patch("engine_installation._private_native_install", return_value=install_fixture), patch("engine_installation.subprocess.run", return_value=SimpleNamespace(returncode=0)), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(engines._install_worker(arguments, watchdog=False), 0)
            self.assertEqual(len(binary_environments), 1)
            self.assertNotIn("NEXT_ENGINE_HF_TOKEN", binary_environments[0])
            self.assertNotIn("HF_TOKEN", binary_environments[0])
            self.assertTrue((attempt / engines.MARKER).is_file())
            self.assertNotIn("torch", sys.modules)
        finally:
            sys.path[:] = original_path

    def test_failed_native_attempt_is_retained_and_retry_gets_fresh_candidate(self):
        self.spec["kind"] = "native"
        self.mode = "fail"
        first = self.install()
        failed = self.wait_done()
        self.assertEqual(failed["state"], "failed")
        old_attempt = self.runtime / "sidecars" / self.spec["engine_id"] / first["attempt_id"]
        (old_attempt / "native").mkdir()
        (old_attempt / "native" / "partial.dll").write_bytes(b"retained partial fixture")
        second = self.install()
        self.assertNotEqual(second["attempt_id"], first["attempt_id"])
        self.wait_done()
        self.assertEqual((old_attempt / "native" / "partial.dll").read_bytes(), b"retained partial fixture")
        receipts = list(old_attempt.glob("terminal-job-*.json"))
        self.assertEqual(len(receipts), 1)
        saved = json.loads(receipts[0].read_text())
        for key in ("attempt_id", "state", "disclosure_id", "error", "log"):
            self.assertEqual(saved[key], failed[key])

    def test_cancelled_native_partial_copy_retries_without_overwrite(self):
        self.spec["kind"] = "native"
        self.mode = "cancel"
        first = self.install()
        self.manager.cancel(self.spec["engine_id"])
        self.assertEqual(self.wait_done()["state"], "cancelled")
        old_attempt = self.runtime / "sidecars" / self.spec["engine_id"] / first["attempt_id"]
        (old_attempt / "native").mkdir()
        (old_attempt / "native" / "partial.dll").write_bytes(b"cancelled copy fixture")
        self.mode = "fail"
        second = self.install()
        self.assertNotEqual(second["attempt_id"], first["attempt_id"])
        self.wait_done()
        self.assertEqual((old_attempt / "native" / "partial.dll").read_bytes(), b"cancelled copy fixture")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--fixture-worker":
        raise SystemExit(fixture_child())
    if len(sys.argv) > 1 and sys.argv[1] == "--fixture-environment":
        for index in range(10):
            update_private_environment(Path(sys.argv[2]), {sys.argv[3]: str(index)}, allowed_keys={"FIXTURE_A", "FIXTURE_B"})
            time.sleep(.005)
        raise SystemExit(0)
    unittest.main(verbosity=2)
