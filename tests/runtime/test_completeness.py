"""Pinned completeness contract using size-only fixtures; never loads models."""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import ast
import copy
import hashlib
import importlib.abc
import json
import os
from pathlib import Path
import sys
import subprocess
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

import tts_catalog
import tts_extensions

ROOT = Path(__file__).resolve().parents[2]
CH = "ResembleAI/chatterbox"
KO = "hexgrad/Kokoro-82M"
# Independently observed sizes in the pinned public-model snapshots. The test
# creates no real weights: its files are zero-filled, used only for size checks.
SMALL_SIZES = {
    CH: {"conds.pt": 107374},
    KO: {"voices/af_heart.pt": 523425, "voices/ef_dora.pt": 523420,
         "voices/ff_siwis.pt": 523425, "voices/hf_alpha.pt": 523425,
         "voices/if_sara.pt": 523425, "voices/pf_dora.pt": 523425},
}


def module(name, **values):
    result = ModuleType(name)
    result.__dict__.update(values)
    return result


class NoML(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, *args, **kwargs):
        if fullname.split(".")[0] in {"torch", "numpy", "transformers", "huggingface_hub", "omnivoice", "chatterbox", "kokoro"}:
            raise AssertionError("Completeness must not import ML: " + fullname)


class CompletenessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="seventy-seven-completeness-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        path = self.root / "engine/backend/api/routers/setup/models.py"
        path.parent.mkdir(parents=True)
        with zipfile.ZipFile(ROOT / "scripts/runtime/vendor/engine.zip") as archive:
            raw = archive.read("backend/api/routers/setup/models.py")
        path.write_bytes(raw)
        parsed = ast.parse(raw)
        names = {"snapshot_has_weights", "snapshot_is_complete", "cache_is_complete", "ModelCatalog", "invalidate_cache"}
        statements = [node for node in parsed.body
                      if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names
                      or isinstance(node, ast.Assign) and any(isinstance(value, ast.Name) and value.id in {"_WEIGHT_FLOORS", "_MIN_WEIGHT_BYTES"} for value in node.targets)]
        self.models = module("api.routers.setup.models", __file__=str(path), os=os, Path=Path, KNOWN_MODELS=[], _cache={})
        exec(compile(ast.Module(body=statements, type_ignores=[]), str(path), "exec"), self.models.__dict__)
        self.stock = self.models.snapshot_is_complete
        setup = module("api.routers.setup", models=self.models, __path__=[])
        imports = {"api": module("api", __path__=[]), "api.routers": module("api.routers", __path__=[]),
                   "api.routers.setup": setup, "api.routers.setup.models": self.models}
        self.modules = patch.dict(sys.modules, imports)
        self.modules.start(); self.addCleanup(self.modules.stop)
        finder = NoML()
        sys.meta_path.insert(0, finder); self.addCleanup(lambda: sys.meta_path.remove(finder))

    def fixture(self, repo):
        spec = copy.deepcopy(next(model for model in tts_catalog.MODELS if model["repo_id"] == repo))
        folder = self.root / "cache" / ("models--" + repo.replace("/", "--")) / "snapshots" / spec["revision"]
        for name in spec["required_files"]:
            size = SMALL_SIZES[repo].get(name, 5242880 if Path(name).suffix in {".pt", ".pth", ".safetensors"} else 2)
            target = folder / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("wb") as output:
                output.truncate(size)
        return spec, folder

    def test_complete_pinned_chatterbox_and_kokoro_are_usable_after_catalog_registration(self):
        for repo in [CH, KO]:
            with self.subTest(repo=repo):
                spec, folder = self.fixture(repo)
                self.assertFalse(self.stock(spec, str(folder)), "Pinned stock reproduces the false incomplete result")
                tts_extensions.register_catalog()
                self.assertTrue(self.models.snapshot_is_complete(spec, str(folder)))

    def test_missing_and_truncated_auxiliary_and_principal_files_are_rejected(self):
        tts_extensions.register_catalog()
        for repo in [CH, KO]:
            spec, folder = self.fixture(repo)
            for name in spec["required_files"]:
                with self.subTest(repo=repo, missing=name):
                    self.fixture(repo)
                    (folder / name).unlink()
                    self.assertFalse(self.models.snapshot_is_complete(spec, str(folder)))
                with self.subTest(repo=repo, truncated=name):
                    self.fixture(repo)
                    minimum = SMALL_SIZES[repo].get(name, 5242880 if Path(name).suffix in {".pt", ".pth", ".safetensors"} else 1)
                    with (folder / name).open("wb") as output:
                        output.truncate(minimum - 1)
                    self.assertFalse(self.models.snapshot_is_complete(spec, str(folder)))

    def test_unknown_repo_revision_snapshot_and_auxiliary_tensor_keep_stock_rules(self):
        tts_extensions.register_catalog()
        spec, folder = self.fixture(KO)
        for patch in [{"repo_id": "other/unknown"}, {"revision": "0" * 40}, {"config_only": True}]:
            with self.subTest(patch=patch):
                self.assertFalse(self.models.snapshot_is_complete({**spec, **patch}, str(folder)))
        alias = folder.with_name("unreviewed-revision")
        folder.rename(alias)
        self.assertFalse(self.models.snapshot_is_complete(spec, str(alias)))
        alias.rename(folder)
        (folder / "new-small.pt").write_bytes(b"unreviewed auxiliary tensor")
        self.assertFalse(self.models.snapshot_is_complete({**spec, "required_files": [*spec["required_files"], "new-small.pt"]}, str(folder)))
        self.assertFalse(self.models.snapshot_is_complete({**spec, "required_files": ["voices/af_heart.pt"]}, str(folder)))

    def test_repeated_registration_is_idempotent_and_does_not_mutate_specs(self):
        spec, folder = self.fixture(CH)
        before = copy.deepcopy(spec)
        tts_extensions.register_catalog()
        validator = self.models.snapshot_is_complete
        tts_extensions.register_catalog()
        self.assertIs(self.models.snapshot_is_complete, validator)
        self.assertTrue(validator(spec, str(folder)))
        self.assertEqual(spec, before)

    def test_changed_stock_source_is_rejected_before_any_wrapper_is_installed(self):
        source = Path(self.models.__file__)
        source.write_bytes(source.read_bytes() + b"\n# unknown upstream change\n")
        with self.assertRaisesRegex(RuntimeError, "Nieobsługiwany kontrakt"):
            tts_extensions.register_catalog()
        self.assertIs(self.models.snapshot_is_complete, self.stock)

    def test_registration_preserves_unknown_fixture_namespace_without_source(self):
        fixture = SimpleNamespace(KNOWN_MODELS=[], ModelCatalog=lambda: "fixture catalogue")
        with patch.dict(sys.modules, {"api.routers.setup": module("api.routers.setup", models=fixture)}):
            tts_extensions.register_catalog()
        self.assertEqual(len(fixture.KNOWN_MODELS), len(tts_catalog.MODELS))
        self.assertEqual(fixture._catalog, "fixture catalogue")
        self.assertFalse(hasattr(fixture, "snapshot_is_complete"))

    def test_real_imported_module_without_source_remains_fail_closed(self):
        del self.models.__file__
        with self.assertRaisesRegex(RuntimeError, "Nieobsługiwany kontrakt"):
            tts_extensions.register_catalog()
        self.assertIs(self.models.snapshot_is_complete, self.stock)

    def test_actual_stock_models_get_changes_from_incomplete_to_installed_with_same_files(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        snapshots = {}
        specs = []
        for repo in [CH, KO]:
            spec, folder = self.fixture(repo)
            spec.update(role="TTS", size_gb=1)
            snapshots[repo] = folder
            specs.append(spec)
        self.models.KNOWN_MODELS[:] = specs
        scanned = SimpleNamespace(repos=[SimpleNamespace(repo_id=repo, size_on_disk=42, last_accessed=None, nb_files=8) for repo in snapshots])
        self.models.__dict__.update(
            _GIB=1024 ** 3, MIN_FREE_GB=1,
            _current_platform_tags=lambda: ["win32", "cpu"],
            _cached=lambda key: self.models._cache.get(key),
            _set_cache=lambda key, value: self.models._cache.update({key: value}),
            _snapshot_dirs=lambda repo: [str(snapshots[repo])] if repo in snapshots else [],
            _model_supported=lambda spec: True, _model_curated=lambda spec, tags: False,
            _model_license_info=lambda repo: {"scope": "completeness fixture; no legal decision"},
            _model_licence_acceptance=lambda repo: {"repo_id": repo, "state": "fixture_only"},
            hf_cache_dir=lambda: str(self.root / "cache"), disk_free_bytes=lambda: 1024 ** 4,
        )
        raw = Path(self.models.__file__).read_bytes()
        route = next(node for node in ast.parse(raw).body if isinstance(node, ast.FunctionDef) and node.name == "list_models")
        app = FastAPI()
        self.models.router = app
        exec(compile(ast.Module(body=[route], type_ignores=[]), str(self.models.__file__), "exec"), self.models.__dict__)
        with patch.dict(sys.modules, {"huggingface_hub": module("huggingface_hub", scan_cache_dir=lambda: scanned)}):
            with TestClient(app) as client:
                before = client.get("/models")
                self.assertEqual(before.status_code, 200)
                self.assertTrue(all(row["incomplete"] and not row["installed"] for row in before.json()["models"]))
                files_before = {str(path): (path.stat().st_size, path.stat().st_mtime_ns) for folder in snapshots.values() for path in folder.rglob("*") if path.is_file()}
                tts_extensions.register_catalog()
                after = client.get("/models")
                self.assertEqual(after.status_code, 200)
                selected = [row for row in after.json()["models"] if row["repo_id"] in snapshots]
                self.assertEqual(len(selected), 2)
                self.assertTrue(all(row["installed"] and not row["incomplete"] for row in selected))
                self.assertEqual(files_before, {str(path): (path.stat().st_size, path.stat().st_mtime_ns) for folder in snapshots.values() for path in folder.rglob("*") if path.is_file()})

    def test_independent_stdlib_process_registers_same_download_worker_catalog_hook(self):
        import_text = str(Path(__file__).resolve().parent)
        code = "import sys, json;sys.path.insert(0," + repr(import_text) + ");from test_completeness import CompletenessTests,CH,KO;import tts_extensions\n"
        code += "case=CompletenessTests();case.setUp()\ntry:\n for repo in [CH,KO]:\n  spec,folder=case.fixture(repo);assert not case.stock(spec,str(folder));tts_extensions.register_catalog();assert case.models.snapshot_is_complete(spec,str(folder))\n print(json.dumps({'repos':2,'process':'isolated stdlib fixture','inference':False}))\nfinally:case.doCleanups()\n"
        flags = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
        result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=15, **flags)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)["repos"], 2)

    def test_stock_installer_validation_uses_same_adapted_rule(self):
        spec, folder = self.fixture(CH)
        self.models.KNOWN_MODELS.append(spec)
        with zipfile.ZipFile(ROOT / "scripts/runtime/vendor/engine.zip") as archive:
            raw = archive.read("backend/api/routers/setup/download.py")
        path = Path(self.models.__file__).with_name("download.py")
        path.write_bytes(raw)
        function = next(node for node in ast.parse(raw).body if isinstance(node, ast.FunctionDef) and node.name == "_validate_snapshot_has_weights")
        download = module("api.routers.setup.download", __file__=str(path), os=os, KNOWN_MODELS=self.models.KNOWN_MODELS, snapshot_is_complete=self.stock)
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), "exec"), download.__dict__)
        with patch.dict(sys.modules, {"api.routers.setup.download": download}):
            with self.assertRaises(OSError):
                download._validate_snapshot_has_weights(CH, str(folder))
            tts_extensions.register_catalog()
            download._validate_snapshot_has_weights(CH, str(folder))
            (folder / "conds.pt").write_bytes(b"truncated")
            with self.assertRaises(OSError):
                download._validate_snapshot_has_weights(CH, str(folder))

    def test_unknown_stock_download_source_or_replaced_alias_is_not_overwritten(self):
        with zipfile.ZipFile(ROOT / "scripts/runtime/vendor/engine.zip") as archive:
            raw = archive.read("backend/api/routers/setup/download.py")
        path = Path(self.models.__file__).with_name("download.py")
        for changed_source in [True, False]:
            path.write_bytes(raw + b"\n# unknown source\n" if changed_source else raw)
            alias = self.stock if changed_source else lambda *args: True
            download = module("api.routers.setup.download", __file__=str(path), snapshot_is_complete=alias)
            with patch.dict(sys.modules, {"api.routers.setup.download": download}):
                with self.assertRaisesRegex(RuntimeError, "Nieobsługiwany kontrakt"):
                    tts_extensions.register_catalog()
                self.assertIs(download.snapshot_is_complete, alias)
                self.assertIs(self.models.snapshot_is_complete, self.stock)

    @unittest.skipUnless(os.environ.get("NEXT_COMPLETENESS_READONLY_CACHE"), "Optional exact cache path; never searches user model folders")
    def test_existing_pinned_cache_is_readonly_red_then_green(self):
        cache = Path(os.environ["NEXT_COMPLETENESS_READONLY_CACHE"])
        self.assertTrue(cache.is_absolute())
        for repo in [CH, KO]:
            spec = copy.deepcopy(next(model for model in tts_catalog.MODELS if model["repo_id"] == repo))
            folder = cache / ("models--" + repo.replace("/", "--")) / "snapshots" / spec["revision"]
            before = {name: ((folder / name).stat().st_size, (folder / name).stat().st_mtime_ns) for name in spec["required_files"]}
            self.assertFalse(self.stock(spec, str(folder)))
            tts_extensions.register_catalog()
            self.assertTrue(self.models.snapshot_is_complete(spec, str(folder)))
            self.assertEqual(before, {name: ((folder / name).stat().st_size, (folder / name).stat().st_mtime_ns) for name in spec["required_files"]})


if __name__ == "__main__":
    unittest.main(verbosity=2)
