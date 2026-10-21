"""Offline bootstrap tests. Never downloads Python, dependencies, or models."""
import contextlib
import io
import json
import os
import shutil
import subprocess
from pathlib import Path
import tempfile
import types
import sys
import unittest
from unittest.mock import patch
import zipfile

import bootstrap


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="seventy-seven-bootstrap-")
        self.base = Path(self.temporary.name) / "VoiceStudioNext"
        self.base.mkdir()
        self.root = self.base / "runtime_abc0123"
        self.root.mkdir()
        (self.root / ".installer-owner.json").write_text(json.dumps({"id": self.root.name, "owner": bootstrap.OWNER}), encoding="utf-8")
        self.manifest = json.loads(Path(__file__).with_name("bootstrap-provenance.json").read_text(encoding="utf-8"))
        self.scratch = tempfile.TemporaryDirectory(prefix="sst-")
        self.addCleanup(self.scratch.cleanup)
        self.temp_base = Path(self.scratch.name)
        self.temp_patch = patch("bootstrap.build_temp_base", return_value=self.temp_base)
        self.temp_patch.start()
        self.addCleanup(self.temp_patch.stop)

    def tearDown(self):
        self.temporary.cleanup()

    def test_plan_is_offline_explicit_and_keeps_model_download_separate(self):
        with patch("urllib.request.urlopen", side_effect=AssertionError("Network forbidden")), patch("subprocess.run", side_effect=AssertionError("Process forbidden")):
            cpu = bootstrap.plan("cpu", self.manifest)
            cuda = bootstrap.plan("cuda", self.manifest)
        self.assertFalse(cpu["modelsIncluded"])
        self.assertEqual(cpu["linkMode"], "copy")
        self.assertGreater(cuda["minimumFreeGb"], cpu["minimumFreeGb"])
        with self.assertRaises(ValueError):
            bootstrap.plan("unreviewed", self.manifest)

    def test_root_requires_private_candidate_and_owned_marker(self):
        self.assertEqual(bootstrap.validate_root(self.root, self.base), self.root)
        legacy = self.base / "runtime"
        legacy.mkdir()
        (legacy / "keep.txt").write_text("do not alter")
        with self.assertRaises(ValueError):
            bootstrap.validate_root(legacy, self.base)
        with self.assertRaises(ValueError):
            bootstrap.validate_root(self.root, self.base / "other")
        (self.root / ".installer-owner.json").write_text('{"owner":"someone else"}')
        with self.assertRaises(ValueError):
            bootstrap.validate_root(self.root, self.base)
        self.assertEqual((legacy / "keep.txt").read_text(), "do not alter")

    def test_cpu_overlay_preserves_other_packages_and_hashes(self):
        text = "# generated\nother==1.0 \\\n    --hash=sha256:unchanged\ntorch==2.8.0+cu128 ; sys_platform == 'win32' \\\n    --hash=sha256:cuda\ntorchaudio==2.8.0+cu128 --hash=sha256:audio\ntorchvision==0.23.0+cu128 --hash=sha256:vision\n"
        converted = bootstrap.cpu_requirements(text, self.manifest["cpuWheels"])
        self.assertIn("other==1.0 \\\n    --hash=sha256:unchanged", converted)
        self.assertNotIn("cu128", converted)
        for name, wheel in self.manifest["cpuWheels"].items():
            self.assertIn(name + " @ " + wheel["url"], converted)
            self.assertIn(wheel["sha256"], converted)
        with self.assertRaises(ValueError):
            bootstrap.cpu_requirements("torch==3.0\n", self.manifest["cpuWheels"])

    def fixture_archive(self, dangerous=False, preload="preload_model()"):
        archive = self.root / "engine.zip"
        with zipfile.ZipFile(archive, "w") as output:
            output.writestr("pyproject.toml", "[project]\nname='fixture'\nversion='0.5.7'\n")
            output.writestr("uv.lock", "version=1\n")
            output.writestr("backend/main.py", f"import dotenv\nimport os\ndotenv.load_dotenv()\napp.state.preload_task = asyncio.create_task({preload})\n")
            if dangerous:
                output.writestr("../outside.txt", "escape")
        manifest = json.loads(json.dumps(self.manifest))
        manifest["engine"]["archiveSha256"] = bootstrap.sha256(archive)
        with zipfile.ZipFile(archive) as source:
            import hashlib
            for name, key in (("pyproject.toml", "pyprojectSha256"), ("uv.lock", "lockSha256")):
                manifest["engine"][key] = hashlib.sha256(source.read(name)).hexdigest()
        return manifest

    def test_engine_extraction_checks_hash_paths_and_does_not_overwrite(self):
        manifest = self.fixture_archive()
        engine = bootstrap.extract_engine(self.root, manifest)
        self.assertIn("VOICESTUDIO_NEXT_PRELOAD_TTS", (engine / "backend/main.py").read_text())
        self.assertNotIn("dotenv.load_dotenv()", (engine / "backend/main.py").read_text())
        self.assertIn("dotenv.load_dotenv(os.environ['OMNIVOICE_ENV_FILE']", (engine / "backend/main.py").read_text())
        self.assertTrue((engine / ".next-engine-v1").is_file())
        with self.assertRaises(ValueError):
            bootstrap.extract_engine(self.root, manifest)

    def test_dangerous_archive_is_rejected_before_any_extraction(self):
        manifest = self.fixture_archive(dangerous=True)
        with self.assertRaises(ValueError):
            bootstrap.extract_engine(self.root, manifest)
        self.assertFalse((self.root / "engine").exists())
        self.assertFalse((self.root / "outside.txt").exists())

    def test_reconcile_preload_is_disabled_in_candidate_and_unknown_contract_rejected(self):
        manifest = self.fixture_archive(preload="_preload_after_reconcile()")
        engine = bootstrap.extract_engine(self.root, manifest)
        patched = (engine / "backend/main.py").read_text(encoding="utf-8")
        self.assertIn("_preload_after_reconcile()", patched)
        self.assertIn("if _env_flag('VOICESTUDIO_NEXT_PRELOAD_TTS', default=False) else None", patched)
        self.assertIn("0.5.7", (engine / ".next-engine-v1").read_text(encoding="utf-8"))
        shutil.rmtree(engine)
        manifest = self.fixture_archive(preload="unknown_preload()")
        with self.assertRaisesRegex(ValueError, "kontrakt"):
            bootstrap.extract_engine(self.root, manifest)
        self.assertFalse((self.root / "engine/.next-engine-v1").exists())

    def test_doctor_identity_uses_sources_before_backend_import(self):
        engine = self.root / "engine"; engine.mkdir()
        project = engine / "pyproject.toml"; project.write_text("[project]\nversion='0.5.7'\n", encoding="utf-8")
        core = types.ModuleType("core"); core.__path__ = []
        version_module = types.ModuleType("core.version"); version_module.APP_VERSION = "0.5.6"
        core.version = version_module
        with patch.dict(sys.modules, {"core": core, "core.version": version_module}):
            self.assertEqual(bootstrap.use_source_version(engine), "0.5.7")
            self.assertEqual(version_module.APP_VERSION, "0.5.7")

    def test_pipeline_uses_frozen_hashes_copy_and_only_candidate_paths(self):
        workspace = bootstrap.prepare_build_workspace(self.root, "cpu")
        pipeline = bootstrap.commands(self.root, "cpu", build_workspace=workspace)
        self.assertIn("--frozen", pipeline["lock"])
        self.assertIn("--offline", pipeline["lock"])
        self.assertIn("--require-hashes", pipeline["dependencies"])
        self.assertEqual(pipeline["dependencies"][pipeline["dependencies"].index("--link-mode") + 1], "copy")
        self.assertIn(str(self.root / ".venv/Scripts/python.exe"), pipeline["dependencies"])
        self.assertNotIn("--system", pipeline["dependencies"])
        self.assertEqual(pipeline["dependencies"][pipeline["dependencies"].index("--cache-dir") + 1], str(Path(workspace["path"]) / "c"))
        self.assertNotIn(str(self.root / "wheel-cache"), pipeline["dependencies"])

    def test_build_workspace_is_short_owned_retained_and_reused_after_failure(self):
        receipt = bootstrap.prepare_build_workspace(self.root, "cpu")
        scratch = Path(receipt["path"])
        self.assertEqual(scratch.parent, self.temp_base)
        self.assertLessEqual(len(str(scratch / "c")), 80)
        self.assertTrue(receipt["retained"])
        self.assertEqual(receipt["candidate_marker_sha256"], bootstrap.sha256(self.root / ".installer-owner.json"))
        self.assertEqual(json.loads((scratch / ".runtime-build-owner.json").read_text()), receipt)
        partial = scratch / "c/partial-own-download"; partial.write_bytes(b"retained after controlled failure")
        with self.assertRaisesRegex(RuntimeError, "fixture failure"):
            with bootstrap.build_environment(receipt): raise RuntimeError("fixture failure")
        self.assertEqual(bootstrap.prepare_build_workspace(self.root, "cpu"), receipt)
        self.assertEqual(partial.read_bytes(), b"retained after controlled failure")

    def test_build_environment_is_scoped_and_restored_even_on_error(self):
        receipt = bootstrap.prepare_build_workspace(self.root, "cpu")
        inherited = {"TEMP": "original-temp", "TMP": "original-tmp", "UV_CACHE_DIR": "never-use-global-cache"}
        with patch.dict(os.environ, inherited):
            with self.assertRaises(RuntimeError):
                with bootstrap.build_environment(receipt):
                    self.assertEqual(os.environ["UV_CACHE_DIR"], str(Path(receipt["path"]) / "c"))
                    self.assertEqual(os.environ["TEMP"], str(Path(receipt["path"]) / "t"))
                    self.assertEqual(os.environ["TMP"], os.environ["TEMP"])
                    raise RuntimeError("controlled failure")
            for name, value in inherited.items(): self.assertEqual(os.environ[name], value)

    def test_build_workspace_rejects_other_candidate_receipt_without_changes(self):
        receipt = bootstrap.prepare_build_workspace(self.root, "cpu")
        other = self.base / "runtime_def456"; other.mkdir()
        (other / ".installer-owner.json").write_text(json.dumps({"id": other.name, "owner": bootstrap.OWNER}))
        pointer = other / "build-workspace.json"
        pointer.write_text(json.dumps(receipt))
        before = pointer.read_bytes()
        with self.assertRaisesRegex(ValueError, "receipt"):
            bootstrap.prepare_build_workspace(other, "cpu")
        self.assertEqual(pointer.read_bytes(), before)

    def test_build_workspace_rejects_corrupt_proof_or_escaped_pointer(self):
        receipt = bootstrap.prepare_build_workspace(self.root, "cpu")
        proof = Path(receipt["path"]) / ".runtime-build-owner.json"
        proof.write_text("{}")
        with self.assertRaisesRegex(ValueError, "receipt"):
            bootstrap.prepare_build_workspace(self.root, "cpu")
        pointer = self.root / "build-workspace.json"
        receipt["path"] = str(self.root / "outside-not-temp")
        pointer.write_text(json.dumps(receipt))
        with self.assertRaisesRegex(ValueError, "poza własny Temp"):
            bootstrap.prepare_build_workspace(self.root, "cpu")
        self.assertFalse((self.root / "outside-not-temp").exists())

    def test_build_workspace_rejects_marker_hardlink_and_low_space_or_deep_temp(self):
        with patch("shutil.disk_usage", return_value=types.SimpleNamespace(free=1024)):
            with self.assertRaisesRegex(ValueError, "mało miejsca"):
                bootstrap.prepare_build_workspace(self.root, "cpu")
        self.assertFalse((self.root / "build-workspace.json").exists())
        deep = self.temp_base / ("deep" * 15); deep.mkdir()
        with patch("bootstrap.build_temp_base", return_value=deep):
            with self.assertRaisesRegex(ValueError, "80 znaków"):
                bootstrap.prepare_build_workspace(self.root, "cpu")
        marker = self.root / ".installer-owner.json"
        os.link(marker, self.root / "another-link")
        with self.assertRaisesRegex(ValueError, "hardlink"):
            bootstrap.prepare_build_workspace(self.root, "cpu")

    @unittest.skipUnless(os.name == "nt", "Windows junction semantics")
    def test_build_workspace_rejects_actual_junction_without_touching_target(self):
        receipt = bootstrap.prepare_build_workspace(self.root, "cpu")
        link = Path(receipt["path"]) / "t"; link.rmdir()
        target = self.temp_base / "retained-target"; target.mkdir()
        sentinel = target / "keep.txt"; sentinel.write_text("unchanged")
        subprocess.run(["cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(target)],
            check=True, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            with self.assertRaisesRegex(ValueError, "junction"):
                bootstrap.prepare_build_workspace(self.root, "cpu")
            self.assertEqual(sentinel.read_text(), "unchanged")
        finally:
            os.rmdir(link)  # only this owned junction entry, never its target

    def test_doctor_has_isolated_data_and_no_inherited_hf_token(self):
        with patch.dict(os.environ, {"HF_TOKEN": "fake-secret", "OMNIVOICE_DATA_DIR": "old-user-data"}):
            environment = bootstrap.doctor_environment(self.root)
        self.assertNotIn("HF_TOKEN", environment)
        self.assertEqual(environment["OMNIVOICE_DATA_DIR"], str(self.root / "doctor-data"))
        self.assertEqual(environment["HF_HUB_OFFLINE"], "1")
        self.assertEqual(environment["OMNIVOICE_PRELOAD_TTS_ASR"], "0")

    def test_fixture_install_activatable_only_after_doctor_and_health(self):
        manifest = self.fixture_archive()
        requirements = "torch==2.8.0+cu128 --hash=sha256:fixture\ntorchaudio==2.8.0+cu128 --hash=sha256:fixture\ntorchvision==0.23.0+cu128 --hash=sha256:fixture\n"
        calls = []
        def runner(command, *, cwd):
            calls.append(command)
            self.assertLessEqual(len(os.environ["UV_CACHE_DIR"]), 80)
            self.assertEqual(Path(os.environ["TEMP"]).parent, Path(os.environ["UV_CACHE_DIR"]).parent)
            if "export" in command:
                (self.root / "requirements.lock.txt").write_text(requirements)
            if "venv" in command:
                (self.root / ".venv/Scripts").mkdir(parents=True)
                (self.root / ".venv/Scripts/python.exe").write_text("fixture")
            if "-c" in command:
                self.assertIn("from mcp.server.fastmcp import FastMCP", command[-1])
                self.assertIn("pywintypes", command[-1])
                self.assertIn("configure_windows_runtime_paths", command[-1])
                (self.root / "doctor.json").write_text('{"imports":"passed","mcp_sdk":"passed","pywin32":"passed"}')
        def health(_root):
            self.assertFalse((self.root / "installation-ready.json").exists())
            return {"status": 200, "owned": True, "isolatedData": True}
        with patch("shutil.disk_usage", return_value=type("Disk", (), {"free": 100 * 1024 ** 3})()), contextlib.redirect_stdout(io.StringIO()):
            result = bootstrap.install(self.root, "cpu", manifest, runner=runner, health_probe=health)
        self.assertEqual(result["health"]["status"], 200)
        self.assertTrue((self.root / "installation-ready.json").is_file())
        self.assertTrue((self.root / "python-ready.json").is_file())
        self.assertFalse((self.base / "active-runtime.json").exists())
        self.assertEqual(len(calls), 5)

    def test_doctor_never_accepts_health_only_or_missing_mcp_dependency_evidence(self):
        def runner(command, *, cwd):
            self.assertIn("from mcp.server.fastmcp import FastMCP", command[-1])
            self.assertIn("pywintypes", command[-1])
            (self.root / "doctor.json").write_text('{"imports":"passed"}')
        with self.assertRaisesRegex(ValueError, "MCP SDK"):
            bootstrap.doctor(self.root, "cpu", runner=runner)
        self.assertFalse((self.root / "installation-ready.json").exists())

    def test_health_failure_never_marks_candidate_ready(self):
        self.fixture_archive()
        with patch("bootstrap.extract_engine"), patch("bootstrap.doctor", return_value={"imports": "passed"}), patch("shutil.disk_usage", return_value=type("Disk", (), {"free": 100 * 1024 ** 3})()), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "health fixture"):
                bootstrap.install(self.root, "cuda", self.manifest, runner=lambda *a, **kw: None, health_probe=lambda _: (_ for _ in ()).throw(RuntimeError("health fixture")))
        self.assertFalse((self.root / "installation-ready.json").exists())
        self.assertFalse((self.root / "python-ready.json").exists())

    def test_embedded_lock_and_provenance_hashes_are_current(self):
        archive = Path(__file__).with_name("engine.zip")
        self.assertEqual(bootstrap.sha256(archive), self.manifest["engine"]["archiveSha256"])
        import hashlib
        with zipfile.ZipFile(archive) as source:
            self.assertEqual(hashlib.sha256(source.read("uv.lock")).hexdigest(), self.manifest["engine"]["lockSha256"])
            self.assertEqual(hashlib.sha256(source.read("pyproject.toml")).hexdigest(), self.manifest["engine"]["pyprojectSha256"])

    def test_real_lock_exports_offline_and_accepts_cpu_overlay(self):
        uv = shutil.which("uv")
        if not uv:
            self.skipTest("Offline uv executable not available")
        engine = self.root / "engine"
        engine.mkdir()
        with zipfile.ZipFile(Path(__file__).with_name("engine.zip")) as archive:
            for name in ("pyproject.toml", "uv.lock"):
                (engine / name).write_bytes(archive.read(name))
        environment = dict(os.environ, UV_OFFLINE="1", UV_NO_CONFIG="1", UV_CACHE_DIR=str(self.root / "empty-cache"))
        command = bootstrap.commands(self.root, "cpu", build_workspace=bootstrap.prepare_build_workspace(self.root, "cpu"))["lock"]
        command[0] = uv
        result = subprocess.run(command, env=environment, capture_output=True, text=True, encoding="utf-8", timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        exported = (self.root / "requirements.lock.txt").read_text(encoding="utf-8")
        converted = bootstrap.cpu_requirements(exported, self.manifest["cpuWheels"])
        self.assertIn("--hash=sha256:", converted)
        self.assertNotIn("torch==2.8.0+cu128", converted)


if __name__ == "__main__":
    unittest.main(verbosity=2)
