"""Source-only update checks. No backend import, models, network or database migration."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import bundle
import launcher
import model_management


DIRECT = "app.state.preload_task = asyncio.create_task(preload_model())"
RECONCILE = "app.state.preload_task = asyncio.create_task(_preload_after_reconcile())"


def sources(expression=DIRECT, version="0.5.6"):
    return {
        "backend/main.py": f"# Never execute this fixture.\nimport dotenv\nimport os\ndotenv.load_dotenv()\nasync def startup(app):\n    {expression}\n",
        "backend/core/config.py": "# static fixture\nVALUE = 1\n",
        "omnivoice/__init__.py": "# static fixture\n",
        "omnivoice/models/__init__.py": "# code in a models directory must remain\n",
        "LICENSE": "Fixture application notice\n",
        "LICENSE-NOTICE.md": "Fixture upstream and model notices\n",
        "README.md": "Fixture sources, not an application runtime.\n",
        "pyproject.toml": f"[project]\nname='omnivoice'\nversion='{version}'\nlicense='AGPL-3.0-only'\n",
        "uv.lock": "version=1\n",
        "backend/assets/samples/demo_voice.wav": b"public runtime sample fixture",
    }


class EngineSourceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="seventy-seven-engine-source-")
        self.root = Path(self.temporary.name)
        self.runtime = self.root / "runtime"
        self.runtime.mkdir()
        self.legacy = self.runtime / "engine"
        self.legacy.mkdir()
        (self.legacy / "keep.txt").write_text("legacy engine is untouched", encoding="utf-8")
        self.previous_root, self.previous_project = launcher.ROOT, launcher.PROJECT
        launcher.ROOT, launcher.PROJECT = self.runtime, self.legacy

    def tearDown(self):
        launcher.ROOT, launcher.PROJECT = self.previous_root, self.previous_project
        self.temporary.cleanup()

    def archive(self, contents=None):
        path = self.runtime / "engine.zip"
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, value in (contents or sources()).items():
                info = zipfile.ZipInfo("fixture")
                # ZipInfo(name) normalizes backslashes on Windows. Preserve
                # hostile raw names explicitly so the containment test is real.
                info.filename = name
                archive.writestr(info, value)
        return path

    def source_dir(self, contents=None):
        root = self.root / "source"
        root.mkdir()
        for relative, value in (contents or sources()).items():
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(value if isinstance(value, bytes) else value.encode("utf-8"))
        return root

    def test_both_known_preload_contracts_publish_distinct_complete_generations(self):
        first_archive = self.archive()
        first_digest = hashlib.sha256(first_archive.read_bytes()).hexdigest()
        first = launcher.prepare_engine()
        first_body = (first / "backend/main.py").read_bytes()
        first_manifest = json.loads((first / ".engine-ready.json").read_text())
        self.assertEqual(first_manifest["archiveSha256"], first_digest)
        self.assertEqual(first_manifest["preloadContract"], "direct-preload")
        self.assertEqual(first_manifest["adapterVersion"], 3)
        self.assertIn(b"VOICESTUDIO_NEXT_PRELOAD_TTS", first_body)
        self.assertNotIn(b"dotenv.load_dotenv()", first_body)
        self.assertIn(b"dotenv.load_dotenv(os.environ['OMNIVOICE_ENV_FILE']", first_body)
        self.assertEqual(launcher.prepare_engine(), first)
        self.archive(sources(RECONCILE, "0.5.7"))
        second = launcher.prepare_engine()
        self.assertNotEqual(first, second)
        self.assertEqual((first / "backend/main.py").read_bytes(), first_body)
        self.assertEqual(json.loads((second / ".engine-ready.json").read_text())["preloadContract"], "reconcile-preload")
        self.assertEqual((self.legacy / "keep.txt").read_text(), "legacy engine is untouched")
        self.assertEqual(launcher.PROJECT, second)

    def test_unknown_contract_is_fail_closed_and_keeps_last_project(self):
        self.archive(); previous = launcher.prepare_engine()
        self.archive(sources("app.state.preload_task = make_unknown_preload()", "0.5.8"))
        with self.assertRaisesRegex(RuntimeError, "Bundled engine preload contract changed"):
            launcher.prepare_engine()
        self.assertEqual(launcher.PROJECT, previous)
        self.assertEqual(len([path for path in (self.runtime / "engines").iterdir() if path.is_dir()]), 1)

    def test_failed_publish_cleans_only_own_staging_directory(self):
        self.archive()
        with patch.object(os, "replace", side_effect=OSError("simulated publish failure")):
            with self.assertRaisesRegex(OSError, "publish failure"):
                launcher.prepare_engine()
        self.assertEqual(launcher.PROJECT, self.legacy)
        self.assertEqual(list((self.runtime / "engines").iterdir()), [])
        self.assertTrue((self.legacy / "keep.txt").is_file())

    def test_atomic_selection_retries_transient_windows_file_lock(self):
        self.archive()
        real_replace = os.replace
        calls = []
        def locked_then_ready(source, destination):
            calls.append((source, destination))
            if len(calls) < 3:
                error = PermissionError("simulated Windows sharing violation")
                error.winerror = 32
                raise error
            return real_replace(source, destination)
        with patch.object(os, "replace", side_effect=locked_then_ready):
            project = launcher.prepare_engine()
        self.assertEqual(len(calls), 3)
        self.assertTrue((project / ".engine-ready.json").is_file())
        self.assertEqual(launcher.prepare_engine(), project)

    @unittest.skipUnless(os.name == "nt", "Windows CreateFileW sharing semantics")
    def test_windows_directory_handle_without_delete_share_does_not_block_publication(self):
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        kernel.CreateFileW.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.CloseHandle.restype = wintypes.BOOL
        opened = []
        real_mkdtemp = tempfile.mkdtemp
        def watched_directory(*args, **kwargs):
            path = real_mkdtemp(*args, **kwargs)
            # READ | WRITE sharing, deliberately WITHOUT FILE_SHARE_DELETE.
            handle = kernel.CreateFileW(path, 0x80000000, 0x1 | 0x2, None, 3, 0x02000000, None)
            if handle == ctypes.c_void_p(-1).value:
                raise ctypes.WinError(ctypes.get_last_error())
            opened.append(handle)
            return path
        self.archive()
        try:
            with patch.object(tempfile, "mkdtemp", side_effect=watched_directory):
                project = launcher.prepare_engine()
            self.assertTrue((project / ".engine-ready.json").is_file())
            self.assertEqual(launcher.prepare_engine(), project)
        finally:
            for handle in opened:
                kernel.CloseHandle(handle)

    def test_damaged_published_generation_is_not_silently_reused_or_overwritten(self):
        self.archive(); project = launcher.prepare_engine()
        path = project / "backend/core/config.py"
        path.write_text("changed externally", encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "niekompletna lub zmieniona"):
            launcher.prepare_engine()
        self.assertEqual(path.read_text(), "changed externally")

    def test_paths_links_and_windows_case_collisions_are_rejected(self):
        for bad in ("../outside.txt", "/outside.txt", "backend/../outside.txt", "C:/outside.txt", "backend/main.py:stream", "backend\\outside.txt"):
            self.archive({**sources(), bad: "must never land"})
            with self.subTest(path=bad), self.assertRaises(RuntimeError):
                launcher.prepare_engine()
        path = self.archive()
        with zipfile.ZipFile(path, "a") as archive:
            link = zipfile.ZipInfo("backend/link")
            link.create_system = 3; link.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(link, "../../outside")
        with self.assertRaisesRegex(RuntimeError, "dowiązanie"):
            launcher.prepare_engine()
        self.archive({**sources(), "BACKEND/MAIN.PY": "case collision"})
        with self.assertRaisesRegex(RuntimeError, "powtórzoną"):
            launcher.prepare_engine()
        self.assertFalse((self.root / "outside.txt").exists())

    def test_filtered_bundle_is_deterministic_and_preserves_runtime_notices_and_samples(self):
        source = self.source_dir()
        for relative in ("backend/tests/test_fixture.py", "backend/.env", "backend/.env.local", "backend/keys/.ENV.production", "backend/PRIVATE.DB-WAL", "backend/outputs/private.wav", "backend/user.db", "backend/weights/model.safetensors", "omnivoice/models/weights.bin"):
            path = source / relative; path.parent.mkdir(parents=True, exist_ok=True); path.write_text("dummy excluded fixture", encoding="utf-8")
        first, second = self.root / "first.zip", self.root / "second.zip"
        manifest = bundle.build_bundle(source, first)
        other = bundle.build_bundle(source, second)
        self.assertEqual(first.read_bytes(), second.read_bytes())
        self.assertEqual(manifest["archiveSha256"], other["archiveSha256"])
        self.assertIsNone(manifest["commit"])
        with zipfile.ZipFile(first) as archive:
            names = set(archive.namelist())
            self.assertEqual(names, set(sources()))
            self.assertEqual(archive.read("backend/assets/samples/demo_voice.wav"), b"public runtime sample fixture")
        self.assertIn("LICENSE-NOTICE.md", manifest["notices"])
        self.assertTrue(manifest["excluded"])

    def test_bad_bundle_request_does_not_replace_previous_artifacts(self):
        source = self.source_dir()
        output = self.root / "engine.zip"; provenance = self.root / "engine-provenance.json"
        output.write_bytes(b"keep archive"); provenance.write_bytes(b"keep manifest")
        with self.assertRaisesRegex(ValueError, "nie zgadza"):
            bundle.build_bundle(source, output, version="0.5.7")
        with self.assertRaisesRegex(ValueError, "repozytorium Git"):
            bundle.build_bundle(source, output, commit="a" * 40)
        self.assertEqual(output.read_bytes(), b"keep archive")
        self.assertEqual(provenance.read_bytes(), b"keep manifest")

    def test_057_required_root_manifest_and_migration_resources_cannot_be_omitted(self):
        contents = sources(RECONCILE, "0.5.7")
        contents.update({
            "config/app.json": json.dumps({"productName": "Fixture", "appId": "fixture.local", "ports": {"backend": 3900, "web": 3901, "electronDev": 3902}}),
            "alembic.ini": "[alembic]\nscript_location = %(here)s/backend/migrations\n",
            "backend/core/app_config.py": "from pathlib import Path\nCONFIG = Path(__file__).resolve().parents[2] / 'config' / 'app.json'\n",
            "backend/config/models.yaml": "models: []\n",
            "backend/config/model_licenses.json": "{}\n",
            "backend/migrations/env.py": "# migration environment fixture\n",
            "backend/migrations/script.py.mako": "# migration template fixture\n",
            "CHANGELOG.md": "# Public release notes\n",
            "docs/logo.png": b"public logo fixture",
        })
        source = self.source_dir(contents)
        output = self.root / "candidate.zip"
        bundle.build_bundle(source, output, version="0.5.7")
        original = output.read_bytes()
        with zipfile.ZipFile(output) as archive:
            self.assertTrue(bundle.REQUIRED_057_RESOURCES <= set(archive.namelist()))
            self.assertIn("docs/logo.png", archive.namelist())
        for relative in bundle.REQUIRED_057_RESOURCES:
            path = source / relative; previous = path.read_bytes(); path.unlink()
            try:
                with self.subTest(resource=relative), self.assertRaisesRegex(ValueError, "zasobów runtime"):
                    bundle.build_bundle(source, output, version="0.5.7")
                self.assertEqual(output.read_bytes(), original)
            finally:
                path.write_bytes(previous)

    def test_git_commit_ignores_dirty_and_untracked_working_tree(self):
        if not shutil.which("git"):
            self.skipTest("Git unavailable")
        source = self.source_dir()
        hooks = self.root / "empty-hooks"; hooks.mkdir()
        def git(*arguments):
            return subprocess.check_output(["git", "-C", str(source), "-c", "core.hooksPath=" + str(hooks), *arguments], stderr=subprocess.PIPE).decode().strip()
        git("init", "--quiet"); git("add", ".")
        git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture")
        commit = git("rev-parse", "HEAD")
        (source / "backend/main.py").write_text("dirty working tree must be ignored", encoding="utf-8")
        (source / "backend/untracked.py").write_text("untracked must be ignored", encoding="utf-8")
        output = self.root / "pinned.zip"
        manifest = bundle.build_bundle(source, output, commit=commit)
        self.assertEqual(manifest["commit"], commit)
        self.assertEqual(manifest["sourceKind"], "git-archive")
        with zipfile.ZipFile(output) as archive:
            self.assertIn(DIRECT.encode(), archive.read("backend/main.py"))
            self.assertNotIn("backend/untracked.py", archive.namelist())

    def test_optional_model_worker_engine_path_keeps_legacy_default(self):
        data = self.root / "data"; data.mkdir()
        private = self.runtime / "engines/pinned-adapter"
        with patch.dict(os.environ, {"HF_HUB_CACHE": str(self.root / "cache")}):
            old = model_management.ModelManager(self.runtime, data, catalog=[])
            updated = model_management.ModelManager(self.runtime, data, catalog=[], engine_path=private)
        self.assertEqual(old.engine, self.legacy)
        self.assertEqual(updated.engine, private.resolve())
        self.assertFalse(private.exists(), "Constructor must not create, import or start an engine")


if __name__ == "__main__":
    unittest.main(verbosity=2)
