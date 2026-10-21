"""Stock 0.5.7 licence resolution with real PrivateTTS classes, no ML or HTTP."""
from __future__ import annotations

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import ast
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import sys
import tempfile
from types import ModuleType
import typing
import unittest
from unittest.mock import patch
import zipfile

import tts_catalog
import tts_extensions

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)

ROOT = Path(__file__).resolve().parents[2]


def stock_nodes(source, wanted):
    tree = ast.parse(source)
    nodes = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in wanted]
    if {node.name for node in nodes} != set(wanted):
        raise AssertionError("The pinned stock contract changed")
    return ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), *nodes], type_ignores=[])


class PrivateTtsIdentityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with zipfile.ZipFile(ROOT / "scripts/runtime/vendor/engine.zip") as archive:
            cls.backend_source = archive.read("backend/services/tts_backend.py").decode("utf-8")
            cls.acceptance_source = archive.read("backend/services/model_acceptance.py").decode("utf-8")
            cls.registry = json.loads(archive.read("backend/config/model_licenses.json"))

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="seventy-seven-identity-")
        self.root = Path(self.temporary.name)
        self.repo_calls, self.generations, self.loads, self.state = [], [], [], {"accepted": False}
        stock = ast.parse(self.backend_source)
        legacy = next(node for node in stock.body if isinstance(node, ast.ClassDef) and node.name == "KittenTTSBackend")
        loader = next(node for node in legacy.body if isinstance(node, ast.FunctionDef) and node.name == "_ensure_loaded")
        checkpoint = next(node for node in ast.walk(loader) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                          and node.func.attr == "get" and node.args and isinstance(node.args[0], ast.Constant)
                          and node.args[0].value == "OMNIVOICE_KITTENTTS_MODEL")
        # This is the real pinned loader's expression, evaluated without its
        # model constructor/import. The adapter must match it, not guess a repo.
        self.legacy_identity = lambda: eval(compile(ast.Expression(checkpoint), "stock-kitten-checkpoint", "eval"), {"os": os})
        base = next(node for node in stock.body if isinstance(node, ast.ClassDef) and node.name == "TTSBackend")
        identity = next(node for node in base.body if isinstance(node, ast.FunctionDef) and node.name == "configured_identity")
        fake_base = ast.ClassDef(name="Base", bases=[], keywords=[], body=[identity], decorator_list=[])
        namespace = {}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), fake_base], type_ignores=[])), "stock-base-identity", "exec"), namespace)
        owner = self
        class Subprocess(namespace["Base"]):
            def __init__(self): self._base_initialized = True
            def _check_language(self, language): return "en" if language == "English" else language
            def generate(self, text, **kw): owner.generations.append(("private", self.id, text, kw)); return kw
            def unload(self): return None
        class LegacyKitten(Subprocess):
            id = "kittentts"
            def generate(self, text, **kw): owner.generations.append(("legacy", self.id, text, kw)); return kw
            @classmethod
            def is_available(cls): return True, "controlled package fixture"
        self.legacy = LegacyKitten
        backend = ModuleType("services.tts_backend"); backend._REGISTRY = {"kittentts": LegacyKitten}
        acceptance = ModuleType("services.model_acceptance")
        def status(repo):
            self.repo_calls.append(repo)
            return {"repo_id": repo, "required": True, "accepted": self.state["accepted"], "license": None, "category": "unknown", "fingerprint": "fixture-only"}
        acceptance.__dict__.update(_REPO=re.compile(r"[A-Za-z0-9][\w.-]*/[\w.-]+\Z"), _registry=lambda: self.registry,
                                   status=status, logger=logging.getLogger("private-tts-fixture"), Iterable=typing.Iterable)
        wanted = {"ModelLicenceNotAccepted", "ensure_accepted", "repos_for_engine", "ensure_engine_accepted"}
        exec(compile(ast.fix_missing_locations(stock_nodes(self.acceptance_source, wanted)), "stock-model-acceptance", "exec"), acceptance.__dict__)
        exec(compile(ast.fix_missing_locations(stock_nodes(self.backend_source, {"ensure_engine_licence", "_built_for_other_model"})), "stock-engine-licence", "exec"), backend.__dict__)
        services = ModuleType("services"); services.tts_backend = backend; services.model_acceptance = acceptance
        subprocess_backend = ModuleType("services.subprocess_backend"); subprocess_backend.SubprocessBackend = Subprocess
        core = ModuleType("core"); licences = ModuleType("core.engine_licenses"); licences.LICENSE_GATED_ENGINES = frozenset(); core.engine_licenses = licences
        api = ModuleType("api"); public = ModuleType("api.public_engine_metadata"); public.public_backends = lambda rows: rows; api.public_engine_metadata = public
        activity = ModuleType("activity"); activity.backend_work_busy = lambda: False
        self.modules = patch.dict(sys.modules, {"services": services, "services.tts_backend": backend, "services.model_acceptance": acceptance,
            "services.subprocess_backend": subprocess_backend, "core": core, "core.engine_licenses": licences, "api": api,
            "api.public_engine_metadata": public, "activity": activity})
        self.modules.start(); self.addCleanup(self.modules.stop)
        with patch.object(tts_extensions, "register_catalog", lambda: None):
            tts_extensions.register(self.root)
        self.classes, self.ensure, self.refused = backend._REGISTRY, backend.ensure_engine_licence, acceptance.ModelLicenceNotAccepted
        self.changed_model = backend._built_for_other_model

    def tearDown(self):
        self.temporary.cleanup()

    def prepare_private_kitten_marker(self):
        path = tts_extensions.environment_python("kittentts", self.root)
        path.parent.mkdir(parents=True); path.write_bytes(b"fixture never executed")

    def test_kokoro_missing_record_is_checked_and_refused_before_any_model_operation(self):
        klass = self.classes["kokoro"]
        with self.assertRaises(self.refused) as caught:
            self.ensure(klass)
        self.assertEqual(klass.configured_identity(), "hexgrad/Kokoro-82M")
        self.assertEqual(self.repo_calls, ["hexgrad/Kokoro-82M"])
        self.assertEqual(caught.exception.models[0]["repo_id"], "hexgrad/Kokoro-82M")
        self.assertEqual(self.generations, [])

    def test_all_eight_private_adapters_report_exact_curated_repo_to_stock_gate(self):
        self.prepare_private_kitten_marker()
        for engine in tts_catalog.ENGINES:
            with self.subTest(engine=engine):
                expected = tts_catalog.model_spec(engine)["repo_id"]
                klass = self.classes[engine]
                self.assertEqual(klass.configured_identity(), expected)
                self.repo_calls.clear()
                with self.assertRaises(self.refused): self.ensure(klass)
                self.assertEqual(self.repo_calls, [expected])

    def test_legacy_kitten_matches_actual_stock_env_and_default_checkpoint_expression(self):
        klass = self.classes["kittentts"]
        for value in (None, "fixture-owner/legacy-checkpoint", "D:/private-fixture/model"):
            with self.subTest(value=value), patch.dict(os.environ, {}, clear=True):
                if value is not None: os.environ["OMNIVOICE_KITTENTTS_MODEL"] = value
                self.assertEqual(klass.configured_identity(), self.legacy_identity())
        self.prepare_private_kitten_marker()
        with patch.dict(os.environ, {"OMNIVOICE_KITTENTTS_MODEL": "fixture-owner/legacy-override"}):
            self.assertEqual(klass.configured_identity(), tts_catalog.model_spec("kittentts")["repo_id"])

    def test_gate_is_rechecked_after_controlled_revocation_without_writing_acceptance(self):
        klass = self.classes["kokoro"]
        self.state["accepted"] = True; self.ensure(klass)
        self.state["accepted"] = False
        with self.assertRaises(self.refused): self.ensure(klass)
        self.assertEqual(self.repo_calls, ["hexgrad/Kokoro-82M", "hexgrad/Kokoro-82M"])

    def test_generation_delegation_and_legacy_fallback_remain_unchanged(self):
        for engine in tts_catalog.ENGINES:
            result = self.classes[engine]().generate("public fixture", language="English")
            self.assertEqual(result["language"], "en")
        self.assertEqual([row[0] for row in self.generations], ["legacy" if engine == "kittentts" else "private" for engine in tts_catalog.ENGINES])
        self.assertEqual(len(self.generations), 8)

    def test_stock_cache_reuses_all_eight_instances_and_detects_real_legacy_checkpoint_change(self):
        self.prepare_private_kitten_marker()
        for engine in tts_catalog.ENGINES:
            with self.subTest(engine=engine):
                klass = self.classes[engine]; instance = klass()
                self.assertTrue(instance._base_initialized)
                self.assertFalse(self.changed_model(klass, instance))
                self.assertEqual(instance.built_identity(), klass.configured_identity())
        tts_extensions.environment_python("kittentts", self.root).unlink()  # own fixture, not an interpreter
        klass = self.classes["kittentts"]
        with patch.dict(os.environ, {"OMNIVOICE_KITTENTTS_MODEL": "fixture-owner/one"}):
            instance = klass()
            self.assertFalse(self.changed_model(klass, instance))
            os.environ["OMNIVOICE_KITTENTTS_MODEL"] = "fixture-owner/two"
            self.assertTrue(self.changed_model(klass, instance))
            self.assertEqual(instance.model_identity(), "fixture-owner/one")


if __name__ == "__main__":
    report = None
    if "--report" in sys.argv:
        position = sys.argv.index("--report"); report = Path(sys.argv[position + 1]); del sys.argv[position:position + 2]
        if report.resolve().parent != (ROOT / ".tmp/qa").resolve(): raise ValueError("Fixture receipt must remain in .tmp/qa")
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(PrivateTtsIdentityTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if report is not None:
        data = {"scope": "stdlib fixture; stock AST gate + actual PrivateTTS classes", "passed": result.wasSuccessful(), "tests": result.testsRun,
                "failures": [str(case) for case, _ in result.failures], "errors": [str(case) for case, _ in result.errors],
                "stock_archive_sha256": hashlib.sha256((ROOT / "scripts/runtime/vendor/engine.zip").read_bytes()).hexdigest(),
                "model_load_performed": False, "generation_performed": False, "http_performed": False, "acceptance_written": False}
        report.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    raise SystemExit(0 if result.wasSuccessful() else 1)
