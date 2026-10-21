"""Isolated catalogue contract; no backend/ML import, model or network."""
import asyncio
import ast
import builtins
import copy
import hashlib
import importlib.metadata
import json
import logging
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
import types
import unittest
import uuid
from unittest.mock import patch
import zipfile

import engine_catalogue_metadata as subject


class LazyTrap(dict):
    _LAZY = {}
    def items(self): raise AssertionError("lazy registry items executed")
    def values(self): raise AssertionError("lazy registry values executed")
    def __getitem__(self, key): raise AssertionError("lazy class resolution executed")


class FakeApp:
    def __init__(self):
        self.middleware = []
        self.started = False
        self.included = []
        self.before_include = None
    def add_middleware(self, middleware):
        if self.started: raise RuntimeError("Cannot add middleware after application has started")
        self.middleware.append(middleware)
    def include_router(self, router):
        if self.before_include: self.before_include()
        self.included.append(router)
    def mount(self, *args, **kwargs): pass
    def get(self, *args, **kwargs): return lambda function: function


class CatalogueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="ssmeta-")
        cls.root = Path(cls.temporary.name)
        cls.engine = cls.root / "engine"; cls.runtime = cls.root / "runtime"; cls.runtime.mkdir()
        archive = Path(__file__).with_name("engine.zip")
        shutil.copyfile(archive, cls.runtime / "engine.zip")
        with zipfile.ZipFile(archive) as source:
            for name in subject._DATA["source_hashes"]:
                target = cls.engine / name; target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read(name))
            cls.raw_main = source.read("backend/main.py").decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
            cls.prefs_source = source.read("backend/core/prefs.py").decode("utf-8-sig")
            cls.asr_source = source.read("backend/services/asr_backend.py").decode("utf-8-sig")
        # Independently reproduce the two known adapter3 transformations;
        # never import/call launcher.prepare_engine to establish this proof.
        expression = "app.state.preload_task = asyncio.create_task(_preload_after_reconcile())"
        assert cls.raw_main.count(expression) == 1
        assert cls.raw_main.count("dotenv.load_dotenv()") == 1
        cls.adapter_main = cls.raw_main.replace(expression, expression + " if _env_flag('VOICESTUDIO_NEXT_PRELOAD_TTS', default=False) else None")
        cls.adapter_main = cls.adapter_main.replace("dotenv.load_dotenv()", "dotenv.load_dotenv(os.environ['OMNIVOICE_ENV_FILE'], override=False) if os.environ.get('OMNIVOICE_ENV_FILE') else None")
        cls.adapter_main_sha = hashlib.sha256(cls.adapter_main.encode()).hexdigest()
        assert cls.adapter_main_sha == "23a25f0311eb97c4d17826c684e6a5b873828203e60bbace6810d15d34c61aea"
        (cls.engine / "backend/main.py").write_bytes(cls.adapter_main.encode())
        shutil.copyfile(Path(__file__).with_name("tts_catalog.py"), cls.runtime / "tts_catalog.py")

    @classmethod
    def tearDownClass(cls): cls.temporary.cleanup()

    def setUp(self):
        self.data_temp = tempfile.TemporaryDirectory(prefix="ssmd-")
        self.addCleanup(self.data_temp.cleanup)
        self.data = Path(self.data_temp.name)
        self.packages = set()
        self.probes = []
        def probe(name, paths):
            self.assertNotIn(".", name)
            self.probes.append(name)
            return name in self.packages
        self.probe_patch = patch.object(subject, "_top_level_present", side_effect=probe)
        self.probe_patch.start(); self.addCleanup(self.probe_patch.stop)
        self.env_patch = patch.dict(os.environ, {}, clear=True)
        self.env_patch.start(); self.addCleanup(self.env_patch.stop)
        self.calls = []
        self.marker = object()
        self.modules = {}
        for family in ("tts", "asr", "llm"):
            ids = set(subject._DATA[family])
            if family == "tts": ids.update(subject._DATA["extra"])
            module = types.ModuleType("fixture_" + family)
            module._REGISTRY = LazyTrap({name: object() for name in ids})
            self.modules[family] = module
        self.router = types.ModuleType("api.routers.engines")
        self.router.__file__ = str(self.engine / "backend/api/routers/engines.py")
        self.router._FAMILIES = {name: (module, name + "_backend") for name, module in self.modules.items()}
        def original(family, module):
            self.calls.append((family, module, subject._metadata_request.get()))
            return self.marker
        self.original = self.router._family_payload = original
        self.modules_patch = patch.dict(sys.modules, {"api.routers.engines": self.router})
        self.modules_patch.start(); self.addCleanup(self.modules_patch.stop)

    def catalogue(self):
        return subject.MetadataCatalogue(engine_path=self.engine, runtime_root=self.runtime, data_dir=self.data)

    def install(self):
        app = FakeApp()
        catalogue = subject.configure_engine_catalogue(app, engine_path=self.engine, runtime_root=self.runtime, data_dir=self.data)
        return app, catalogue

    def deferred_startup(self):
        """Execute pinned lifecycle AST with only heavyweight build imports stubbed.

        This is a controlled lifecycle fixture, not a claim of importing the
        entire real backend or running its startup/ML in the CPU interpreter.
        """
        sys.modules.pop("api.routers.engines", None)
        startup = types.ModuleType("fixture_pinned_main")
        startup.__file__ = str(self.engine / "backend/main.py")
        app = startup.app = FakeApp()
        startup.__dict__.update(os=os, sys=sys, threading=threading, logging=logging, logger=logging.getLogger("fixture-pinned-main"),
            StaticFiles=lambda **kwargs: object(), OUTPUTS_DIR=str(self.data / "outputs"), VOICES_DIR=str(self.data / "voices"), Request=object,
            _startup_progress=types.SimpleNamespace(mark_ready=lambda: None))
        self.router.router = object()
        spa = types.ModuleType("core.spa_inject")
        spa.dev_ui_redirect = lambda *args: None
        spa.frontend_available = lambda *args: False
        spa.frontend_dist_dir = lambda: str(self.engine / "missing-frontend")
        spa.inject_api_base = lambda *args: ""
        spa.is_valid_public_api_base = lambda *args: False
        spa.web_ui_missing_body = lambda *args: ("text/plain", "fixture")
        core = types.ModuleType("core"); core.__path__ = []; core.spa_inject = spa
        services = types.ModuleType("services"); services.__path__ = []
        translation = types.ModuleType("services.translation_apis"); translation.SECRET_ENV_KEYS = frozenset()
        store = types.ModuleType("services.settings_store")
        services.settings_store = store
        self.lifecycle_modules = patch.dict(sys.modules, {"core": core, "core.spa_inject": spa, "services": services, "services.translation_apis": translation, "services.settings_store": store})
        self.lifecycle_modules.start(); self.addCleanup(self.lifecycle_modules.stop)
        prefs_namespace = {"os": os, "UNRESTORED_ENV_KEYS": frozenset({"OMNIVOICE_PORT", "OMNIVOICE_UI_PORT"})}
        restore = next(node for node in ast.parse(self.prefs_source).body if isinstance(node, ast.FunctionDef) and node.name == "restore_env")
        exec(compile(ast.Module(body=[restore], type_ignores=[]), "pinned/core/prefs.py", "exec"), prefs_namespace)
        timeout = next(node for node in ast.parse(self.asr_source).body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "ASR_TRANSCRIBE_TIMEOUT_S" for target in node.targets))
        def build_inner():
            # Same pinned restore_env function runs before the pinned ASR
            # module-level expression, matching main.py612..714 ordering.
            prefs_namespace["restore_env"]({"env.OMNIVOICE_ASR_TRANSCRIBE_TIMEOUT_S": "123.0"})
            asr_namespace = {"os": os}
            exec(compile(ast.Module(body=[timeout], type_ignores=[]), "pinned/asr_backend.py", "exec"), asr_namespace)
            startup.captured_asr_timeout = asr_namespace["ASR_TRANSCRIBE_TIMEOUT_S"]
            startup.restored_external_keys = prefs_namespace["_EXTERNALLY_PROVIDED"]
            sys.modules["api.routers.engines"] = self.router
            startup._router_modules.append(self.router)
            startup._phase_a_built = True
        startup._phase_a_build_inner = build_inner
        names = {"_phase_a_built", "_phase_a_finalized", "_router_modules", "_phase_a_started", "_phase_a_finished", "_EAGER"}
        nodes = []
        for node in ast.parse(self.adapter_main).body:
            if isinstance(node, ast.FunctionDef) and node.name in {"_env_flag", "_phase_a_build", "_phase_a_finalize"}: nodes.append(node)
            elif isinstance(node, (ast.Assign, ast.AnnAssign)):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                if any(isinstance(target, ast.Name) and target.id in names for target in targets): nodes.append(node)
            elif isinstance(node, ast.If) and isinstance(node.test, ast.Name) and node.test.id == "_EAGER": nodes.append(node)
        os.environ["OMNIVOICE_EAGER_INIT"] = "0"
        os.environ["OMNIVOICE_MCP_DISABLE"] = "1"
        exec(compile(ast.Module(body=nodes, type_ignores=[]), startup.__file__, "exec"), startup.__dict__)
        self.assertFalse(startup._phase_a_built)
        self.assertEqual(startup._router_modules, [])
        self.assertNotIn("api.routers.engines", sys.modules, "Pinned deferred import does not publish the engines router")
        return app, startup

    def test_deferred_pinned_lifecycle_binds_before_include_after_env_without_late_middleware(self):
        app, startup = self.deferred_startup()
        original = startup._phase_a_finalize
        catalogue = subject.configure_engine_catalogue(app, engine_path=self.engine, runtime_root=self.runtime, data_dir=self.data, startup_module=startup)
        wrapped = startup._phase_a_finalize
        self.assertIsNot(wrapped, original)
        self.assertEqual(len(app.middleware), 1)
        self.assertFalse(startup._phase_a_started.is_set())
        self.assertNotIn("api.routers.engines", sys.modules)
        self.assertNotIn("OMNIVOICE_ASR_TRANSCRIBE_TIMEOUT_S", os.environ)
        app.before_include = lambda: self.assertIsNot(self.router._family_payload, self.original)
        app.started = True
        startup._phase_a_build()
        self.assertEqual(startup.captured_asr_timeout, 123.0)
        self.assertNotIn("OMNIVOICE_ASR_TRANSCRIBE_TIMEOUT_S", startup.restored_external_keys)
        self.assertIsNone(wrapped())
        self.assertIsNot(self.router._family_payload, self.original)
        self.assertEqual(app.included, [self.router.router])
        self.assertEqual(len(app.middleware), 1, "No add_middleware call is permitted after startup")
        payload = self.router._family_payload
        self.assertIsNone(wrapped())
        self.assertIs(self.router._family_payload, payload)
        self.assertEqual(app.included, [self.router.router])
        self.assertIs(subject.configure_engine_catalogue(app, engine_path=self.engine, runtime_root=self.runtime, data_dir=self.data, startup_module=startup), catalogue)
        self.assertIs(startup._phase_a_finalize, wrapped)
        self.assertIs(self.router._family_payload("tts", self.modules["tts"]), self.marker)
        token = subject._metadata_request.set(True)
        try: self.assertIsInstance(self.router._family_payload("tts", self.modules["tts"]), dict)
        finally: subject._metadata_request.reset(token)

    def test_adapter3_main_proof_is_derived_from_pinned_zip_transformations(self):
        self.assertEqual(subject.PINNED_ADAPTER3_MAIN_SHA256, self.adapter_main_sha)
        self.assertEqual(hashlib.sha256((self.engine / "backend/main.py").read_bytes()).hexdigest(), self.adapter_main_sha)
        parsed = ast.parse(self.adapter_main)
        build = next(node for node in parsed.body if isinstance(node, ast.FunctionDef) and node.name == "_phase_a_build_inner")
        order = {}
        for node in ast.walk(build):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in {"migrate_legacy_translate_prefs", "restore_env"}:
                order[node.func.id] = node.lineno
            if isinstance(node, ast.ImportFrom) and node.module == "api.routers" and any(alias.name == "engines" for alias in node.names):
                order["router_import"] = node.lineno
        self.assertLess(order["migrate_legacy_translate_prefs"], order["restore_env"])
        self.assertLess(order["restore_env"], order["router_import"])

    def test_deferred_setup_without_startup_or_with_wrong_identity_is_fail_closed(self):
        app, startup = self.deferred_startup()
        original = startup._phase_a_finalize
        for invalid in [None, types.SimpleNamespace(__file__=startup.__file__)]:
            with self.assertRaises(subject.EngineMetadataContractError):
                subject.configure_engine_catalogue(app, engine_path=self.engine, runtime_root=self.runtime, data_dir=self.data, startup_module=invalid)
            self.assertEqual(app.middleware, [])
        saved = startup.__file__
        startup.__file__ = str(self.engine / "wrong-main.py")
        with self.assertRaisesRegex(subject.EngineMetadataContractError, "generacji"):
            subject.configure_engine_catalogue(app, engine_path=self.engine, runtime_root=self.runtime, data_dir=self.data, startup_module=startup)
        startup.__file__ = saved
        startup.app = FakeApp()
        with self.assertRaisesRegex(subject.EngineMetadataContractError, "finalizacji"):
            subject.configure_engine_catalogue(app, engine_path=self.engine, runtime_root=self.runtime, data_dir=self.data, startup_module=startup)
        startup.app = app
        startup._phase_a_finalize = None
        with self.assertRaisesRegex(subject.EngineMetadataContractError, "finalizacji"):
            subject.configure_engine_catalogue(app, engine_path=self.engine, runtime_root=self.runtime, data_dir=self.data, startup_module=startup)
        self.assertEqual(app.middleware, [])
        self.assertNotIn("api.routers.engines", sys.modules)
        startup._phase_a_finalize = original

    def test_unknown_adapter_main_hash_does_not_install_scope_or_wrapper(self):
        app, startup = self.deferred_startup()
        original = startup._phase_a_finalize
        path = self.engine / "backend/main.py"
        content = path.read_bytes()
        try:
            path.write_bytes(content + b"\n# different startup contract\n")
            with self.assertRaisesRegex(subject.EngineMetadataContractError, "adaptera3"):
                subject.configure_engine_catalogue(app, engine_path=self.engine, runtime_root=self.runtime, data_dir=self.data, startup_module=startup)
            self.assertEqual(app.middleware, [])
            self.assertIs(startup._phase_a_finalize, original)
        finally: path.write_bytes(content)

    def test_deferred_finalizer_rejects_before_build_and_missing_router(self):
        app, startup = self.deferred_startup()
        subject.configure_engine_catalogue(app, engine_path=self.engine, runtime_root=self.runtime, data_dir=self.data, startup_module=startup)
        with self.assertRaisesRegex(subject.EngineMetadataContractError, "przygotowaniu"):
            startup._phase_a_finalize()
        self.assertEqual(app.included, [])
        startup._phase_a_built = True
        with self.assertRaisesRegex(subject.EngineMetadataContractError, "Brak zaimportowanego"):
            startup._phase_a_finalize()
        self.assertEqual(app.included, [])

    def test_real_starlette_started_stack_never_gets_late_middleware(self):
        from starlette.applications import Starlette
        _fixture_app, startup = self.deferred_startup()
        app = startup.app = Starlette()
        startup._phase_a_finalize = lambda: self.marker
        subject.configure_engine_catalogue(app, engine_path=self.engine, runtime_root=self.runtime, data_dir=self.data, startup_module=startup)
        app.middleware_stack = object()  # Real Starlette now rejects add_middleware.
        with self.assertRaises(RuntimeError): app.add_middleware(subject.EngineCatalogueMetadataScope)
        startup._phase_a_build()
        self.assertIs(startup._phase_a_finalize(), self.marker)
        self.assertEqual(len(app.user_middleware), 1)
        self.assertIs(self.router._family_payload("tts", self.modules["tts"]), self.marker)

    def test_original_finalizer_return_and_exception_are_preserved_after_bind(self):
        app, startup = self.deferred_startup()
        failure = RuntimeError("stock-finalizer-sentinel")
        calls = []
        def original(value=None, *, fail=False):
            calls.append(value)
            if fail: raise failure
            return value
        startup._phase_a_finalize = original
        subject.configure_engine_catalogue(app, engine_path=self.engine, runtime_root=self.runtime, data_dir=self.data, startup_module=startup)
        startup._phase_a_build()
        self.assertIs(startup._phase_a_finalize(self.marker), self.marker)
        payload = self.router._family_payload
        with self.assertRaises(RuntimeError) as caught: startup._phase_a_finalize(None, fail=True)
        self.assertIs(caught.exception, failure)
        self.assertIs(self.router._family_payload, payload)
        self.assertEqual(calls, [self.marker, None])

    def test_deferred_configure_does_not_import_main_router_or_any_ml_stack(self):
        app, startup = self.deferred_startup()
        importer = builtins.__import__
        forbidden = {"main", "torch", "transformers", "torchaudio", "onnxruntime", "misaki", "whisperx"}
        def guarded(name, *args, **kwargs):
            if name.split(".")[0] in forbidden or name.startswith("api.routers"):
                raise AssertionError("Premature backend import: " + name)
            return importer(name, *args, **kwargs)
        with patch("builtins.__import__", side_effect=guarded), patch("subprocess.Popen", side_effect=AssertionError("Process")), patch("socket.create_connection", side_effect=AssertionError("Network")):
            subject.configure_engine_catalogue(app, engine_path=self.engine, runtime_root=self.runtime, data_dir=self.data, startup_module=startup)
        self.assertNotIn("api.routers.engines", sys.modules)
        self.assertFalse(startup._phase_a_started.is_set())

    def test_eager_router_binding_preserves_stock_identity_and_single_scope(self):
        app, catalogue = self.install()
        payload = self.router._family_payload
        self.assertIs(payload.__wrapped__, self.original)
        self.assertIs(subject.configure_engine_catalogue(app, engine_path=self.engine, runtime_root=self.runtime, data_dir=self.data), catalogue)
        self.assertIs(self.router._family_payload, payload)
        self.assertEqual(len(app.middleware), 1)
        self.assertIs(self.router._family_payload("tts", self.modules["tts"]), self.marker)

    def test_pinned_sources_provenance_complete_ids_and_declared_languages(self):
        catalogue = self.catalogue()
        self.assertEqual(len(catalogue.rows["tts"]), 24)
        self.assertEqual(len(catalogue.rows["asr"]), 11)
        self.assertEqual(len(catalogue.rows["llm"]), 2)
        rows = {row["id"]: row for row in catalogue.family_payload("tts")["backends"]}
        self.assertIn("polish", rows["omnivoice"]["supported_language_names"])
        self.assertEqual(rows["kittentts"]["supported_language_names"], ["English"])
        self.assertIn("Polish", rows["chatterbox-multilingual"]["supported_language_names"])
        self.assertIn("Japanese", rows["qwen3-tts"]["supported_language_names"])
        self.assertFalse(rows["kokoro"]["supports_cloning"])
        self.assertTrue(rows["qwen3-voice-design"]["supports_voice_design"])

    def test_changed_raw_source_rejected_before_wrapper_install(self):
        target = self.engine / "backend/api/routers/engines.py"; original = target.read_bytes()
        try:
            target.write_bytes(original + b"\n# changed contract\n")
            app = FakeApp()
            with self.assertRaisesRegex(subject.EngineMetadataContractError, "kontrakt"):
                subject.configure_engine_catalogue(app, engine_path=self.engine, runtime_root=self.runtime, data_dir=self.data)
            self.assertIs(self.router._family_payload, self.original)
            self.assertEqual(app.middleware, [])
        finally: target.write_bytes(original)

    def test_changed_extra_declarations_fail_closed(self):
        target = self.runtime / "tts_catalog.py"; original = target.read_bytes()
        try:
            target.write_bytes(original + b"\n# changed declaration\n")
            with self.assertRaisesRegex(subject.EngineMetadataContractError, "deklaracje"):
                self.catalogue()
        finally: target.write_bytes(original)

    def test_real_top_level_finder_never_executes_package_or_imports_dotted_parent(self):
        self.probe_patch.stop()
        try:
            site=self.data/"private-site"; package=site/"torch"; package.mkdir(parents=True)
            (package/"__init__.py").write_text("raise AssertionError('Package must not execute')")
            before=set(sys.modules)
            self.assertTrue(subject._top_level_present("torch",[site]))
            with self.assertRaisesRegex(subject.EngineMetadataContractError,"najwyższego"):
                subject._top_level_present("torch.nn",[site])
            self.assertEqual(set(sys.modules),before)
        finally:self.probe_patch.start()

    def test_selected_immutable_bundle_overrides_retained_legacy_installer_zip(self):
        archive = self.runtime / "engine.zip"; original = archive.read_bytes()
        selected = self.root / "selected-engine.zip"; selected.write_bytes(original)
        try:
            archive.write_bytes(b"old retained installer archive")
            with patch.dict(os.environ, {"VOICESTUDIO_NEXT_BUNDLE": str(selected)}):
                self.assertEqual(len(self.catalogue().rows["tts"]),24)
            with self.assertRaisesRegex(subject.EngineMetadataContractError,"archiwum"):
                self.catalogue()
        finally:archive.write_bytes(original); selected.unlink()

    def test_unknown_live_engine_fails_closed_without_lazy_iteration(self):
        dict.__setitem__(self.modules["tts"]._REGISTRY, "new-unreviewed", object())
        with self.assertRaisesRegex(subject.EngineMetadataContractError, "Niezgodny zestaw"):
            self.install()
        self.assertIs(self.router._family_payload, self.original)

    def test_configured_active_is_read_without_auto_detection_and_env_wins(self):
        catalogue = self.catalogue()
        self.assertEqual(catalogue.family_payload("asr")["active"], "")
        self.assertEqual(catalogue.family_payload("asr")["configured_active"], "auto")
        prefs = self.data / "prefs.json"; prefs.write_text(json.dumps({"asr_backend": "whisperx", "tts_backend": "kokoro"}))
        self.assertEqual(catalogue.family_payload("asr")["active"], "whisperx")
        with patch.dict(os.environ, {"OMNIVOICE_ASR_BACKEND": "omnivoice", "OMNIVOICE_TTS_BACKEND": "kittentts"}):
            self.assertEqual(catalogue.family_payload("asr")["active"], "pytorch-whisper")
            result = catalogue.family_payload("tts")
            self.assertEqual(result["active"], "kittentts"); self.assertTrue(result["env_override"])
        self.assertEqual(self.calls, [])
        self.assertEqual(catalogue.family_payload("llm")["active"], "")
        self.assertEqual(catalogue.family_payload("llm")["configured_active"], "auto")
        prefs.write_text('{"asr_backend":"omnivoice"}')
        self.assertEqual(catalogue.family_payload("asr")["configured_active"],"omnivoice")
        self.assertEqual(catalogue.family_payload("asr")["active"],"")

    def test_malformed_local_configuration_is_unknown_without_probes(self):
        (self.data/"prefs.json").write_text('{"asr_backend":[],"llm_backend":{"bad":"type"}}')
        catalogue=self.catalogue()
        self.assertEqual(catalogue.family_payload("llm")["active"],"")
        self.assertEqual(catalogue.family_payload("asr")["active"],"")
        (self.data/"engine-runtime-jobs.json").write_text('{"audio-cpp":["bad"]}')
        module,_,_,_=self.owned_fixture()
        (self.data/"engine-runtime-jobs.json").write_text('{"audio-cpp":["bad"]}')
        with patch.dict(sys.modules,{"engine_installation":module}):
            self.assertFalse(catalogue._owned_install("audiocpp"))

    def test_checkpoint_self_heal_model_unknown_and_mlx_env_precedence(self):
        catalogue = self.catalogue()
        with patch.dict(os.environ, {"OMNIVOICE_MODEL": "  omnivoice  "}):
            self.assertEqual(catalogue.family_payload("tts")["active_model"],"k2-fsa/OmniVoice")
        with patch.dict(os.environ, {"OMNIVOICE_MODEL": "  test  "}):
            self.assertEqual(catalogue.family_payload("tts")["active_model"],"test")
        (self.data/"prefs.json").write_text('{"tts_backend":"mlx-audio","mlx_audio_model_id":"kokoro"}')
        with patch.dict(os.environ, {"OMNIVOICE_MLX_AUDIO_MODEL":"qwen3-tts"}):
            result = catalogue.family_payload("tts")
            declared = catalogue.rows["tts"]["mlx-audio"]["CURATED_MODELS"]
            self.assertEqual(result["active_model"],declared["qwen3-tts"])
            row = next(x for x in result["backends"] if x["id"]=="mlx-audio")
            self.assertEqual(row["active_model"],"qwen3-tts")
        self.assertEqual(catalogue.family_payload("asr")["model_check"],"not_checked")

    def test_dependency_presence_never_claims_available_or_inference(self):
        self.packages.update({"torch", "torchaudio", "transformers", "soundfile"})
        catalogue = self.catalogue()
        rows = {r["id"]: r for r in catalogue.family_payload("tts")["backends"]}
        self.assertEqual(rows["omnivoice"]["availability_check"], "dependencies_detected")
        self.assertTrue(rows["omnivoice"]["can_verify"])
        self.assertFalse(rows["omnivoice"]["available"]); self.assertFalse(rows["omnivoice"]["inference_verified"])
        self.assertEqual(rows["omnivoice"]["effective_device"], "unknown")
        self.assertEqual(rows["omnivoice"]["hardware_check"], "not_checked")
        self.assertIsNone(rows["omnivoice"]["installed"])

    def test_legacy_kitten_fallback_is_metadata_only(self):
        self.packages.update(subject._DEPENDENCIES["kittentts"][0])
        rows = {r["id"]: r for r in self.catalogue().family_payload("tts")["backends"]}
        self.assertEqual(rows["kittentts"]["availability_check"], "dependencies_detected")
        self.assertTrue(rows["kittentts"]["can_verify"]); self.assertFalse(rows["kittentts"]["available"])

    def owned_fixture(self, *, native=True):
        engine = "audio-cpp" if native else "indextts2"
        attempt_id = uuid.uuid4().hex
        attempt = self.runtime/"sidecars"/engine/attempt_id
        target = attempt/"runtime"; target.mkdir(parents=True)
        spec={"engine_id":engine,"disclosure_id":"d"*64,"kind":"native" if native else "python","completion_marker":"complete.json"}
        marker={"engine_id":engine,"disclosure_id":"d"*64,"install_dir":str(target)}
        if native:
            marker["binaries"]={}
            for name in ("audiocpp_server.exe","audiocpp_cli.exe"):
                (target/name).write_bytes(b"controlled owned binary fixture")
                marker["binaries"][name]=hashlib.sha256((target/name).read_bytes()).hexdigest()
        else:
            python=target/".venv"/("Scripts/python.exe" if os.name=="nt" else "bin/python")
            python.parent.mkdir(parents=True); python.write_bytes(b"private Python fixture")
            (target/"complete.json").write_text("{}")
        (attempt/".seventy-seven-runtime-complete.json").write_text(json.dumps(marker))
        (self.data/"engine-runtime-jobs.json").write_text(json.dumps({engine:{"state":"complete","attempt_id":attempt_id}}))
        module=types.ModuleType("engine_installation"); module._manager=types.SimpleNamespace(specs=[spec])
        return module,target,attempt,marker

    def test_owned_native_receipt_files_enable_explicit_verify_without_execution(self):
        module,target,attempt,marker=self.owned_fixture()
        with patch.dict(sys.modules,{"engine_installation":module}), patch("subprocess.Popen",side_effect=AssertionError("No execution")):
            catalogue=self.catalogue()
            row=next(x for x in catalogue.family_payload("tts")["backends"] if x["id"]=="audiocpp")
            self.assertTrue(row["can_verify"]); self.assertFalse(row["available"]); self.assertFalse(row["inference_verified"])
            (target/"audiocpp_cli.exe").write_bytes(b"tampered")
            row=next(x for x in catalogue.family_payload("tts")["backends"] if x["id"]=="audiocpp")
            self.assertFalse(row["can_verify"])
            marker["install_dir"]=str(self.root)
            (attempt/".seventy-seven-runtime-complete.json").write_text(json.dumps(marker))
            self.assertFalse(catalogue._owned_install("audiocpp"))

    def test_owned_python_sidecar_receipt_can_verify_without_parent_dependencies(self):
        module,target,attempt,marker=self.owned_fixture(native=False)
        with patch.dict(sys.modules,{"engine_installation":module}):
            row=next(x for x in self.catalogue().family_payload("tts")["backends"] if x["id"]=="indextts2")
            self.assertTrue(row["can_verify"]); self.assertFalse(row["available"])
            (target/"complete.json").unlink()
            self.assertFalse(self.catalogue()._owned_install("indextts2"))

    def test_pinned_gguf_binary_manifest_can_verify_without_spawn(self):
        catalogue=self.catalogue()
        folder=self.engine/"bin"; folder.mkdir(exist_ok=True)
        machine=subject.platform.machine().lower()
        slug="windows-x86_64" if sys.platform=="win32" else ("darwin-arm64" if machine in {"arm64","aarch64"} else "darwin-x86_64") if sys.platform=="darwin" else "linux-aarch64" if machine in {"arm64","aarch64"} else "linux-x86_64"
        name="omnivoice-tts-"+slug+(".exe" if sys.platform=="win32" else "")
        binary=folder/name; binary.write_bytes(b"own controlled native fixture")
        checksum=folder/"checksums.sha256"; checksum.write_text(hashlib.sha256(binary.read_bytes()).hexdigest()+"  "+name+"\n")
        try:
            row=next(x for x in catalogue.family_payload("tts")["backends"] if x["id"]=="omnivoice-gguf")
            self.assertTrue(row["can_verify"]); self.assertFalse(row["inference_verified"])
            binary.write_bytes(b"changed"); self.assertFalse(catalogue._gguf_binary())
        finally:binary.unlink();checksum.unlink()

    def test_missing_platform_and_runtime_unconfigured_are_conservative(self):
        self.packages.update({"mlx_audio", "openai"})
        catalogue = self.catalogue()
        with patch.object(subject.sys, "platform", "win32"):
            rows = {r["id"]: r for r in catalogue.family_payload("tts")["backends"]}
            self.assertEqual(rows["mlx-audio"]["availability_check"], "platform_unsupported")
            self.assertFalse(rows["mlx-audio"]["can_verify"])
            self.assertEqual(rows["omnivoice"]["availability_check"], "missing_dependencies")
            self.assertEqual(rows["audiocpp"]["availability_check"], "runtime_unconfigured")
        llm = {r["id"]: r for r in catalogue.family_payload("llm")["backends"]}
        self.assertEqual(llm["openai-compat"]["availability_check"], "runtime_unconfigured")
        self.assertTrue(llm["off"]["can_verify"]); self.assertFalse(llm["off"]["available"])

    def test_license_read_is_separate_readonly_and_never_accepts(self):
        path = self.data / "omnivoice.db"
        with sqlite3.connect(path) as c:
            c.execute("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)")
            c.execute("INSERT INTO settings VALUES('kittentts2_license_accepted','1')")
            c.execute("INSERT INTO settings VALUES('hf_token','must-never-be-read-or-returned')")
        c.close()
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        catalogue = self.catalogue()
        rows = {r["id"]: r for r in catalogue.family_payload("tts")["backends"]}
        self.assertTrue(rows["kittentts2"]["license_required"]); self.assertTrue(rows["kittentts2"]["license_accepted"])
        self.assertFalse(rows["fish-s2-pro"]["license_accepted"])
        self.assertNotIn("must-never-be-read-or-returned", json.dumps(rows))
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)
        self.assertFalse(rows["kittentts2"]["inference_verified"])

    def test_busy_license_database_is_bounded_fail_closed(self):
        path = self.data / "omnivoice.db"
        connection = sqlite3.connect(path)
        connection.execute("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)"); connection.commit()
        connection.execute("BEGIN EXCLUSIVE")
        try:
            started = time.monotonic()
            rows = {r["id"]: r for r in self.catalogue().family_payload("tts")["backends"]}
            self.assertLess(time.monotonic() - started, 2)
            self.assertFalse(rows["pockettts"]["license_accepted"])
            self.assertEqual(rows["pockettts"]["license_check"], "unavailable")
        finally: connection.rollback(); connection.close()

    def test_stock_shape_and_unknown_evidence_for_every_family(self):
        catalogue = self.catalogue()
        fields = {"id","display_name","available","reason","install_hint","last_error","isolation_mode",
            "gpu_compat","effective_device","routing_status","routing_reason","availability_check",
            "can_verify","inference_verified","hardware_check","supported_language_names"}
        for family in ("tts","asr","llm"):
            value = catalogue.family_payload(family)
            self.assertIsInstance(value["active"], str)
            self.assertIn("active_model", value); self.assertIn("env_override", value)
            self.assertEqual({row["id"] for row in value["backends"]}, set(catalogue.rows[family]))
            for row in value["backends"]:
                self.assertTrue(fields <= row.keys())
                self.assertFalse(row["available"]); self.assertFalse(row["inference_verified"])
                self.assertIn(row["availability_check"], {"dependencies_detected","missing_dependencies","platform_unsupported","runtime_unconfigured"})

    def test_four_get_scope_reaches_real_anyio_worker_and_resets(self):
        import anyio
        self.install()
        async def scenario():
            seen = []
            async def endpoint(scope, receive, send):
                result = await anyio.to_thread.run_sync(lambda: self.router._family_payload("tts", self.modules["tts"]))
                seen.append((scope["path"], result))
            middleware = subject.EngineCatalogueMetadataScope(endpoint)
            for path in subject.CATALOGUE_PATHS:
                await middleware({"type":"http","method":"GET","path":path}, None, None)
                self.assertFalse(subject._metadata_request.get())
            return seen
        seen = asyncio.run(scenario())
        self.assertEqual(len(seen),4); self.assertEqual(self.calls,[])
        self.assertTrue(all(isinstance(result,dict) for _,result in seen))

    def test_explicit_post_health_and_nonexact_paths_delegate_original_identity(self):
        self.install()
        async def endpoint(scope, receive, send):
            self.assertIs(self.router._family_payload("tts", self.modules["tts"]), self.marker)
        middleware = subject.EngineCatalogueMetadataScope(endpoint)
        async def scenario():
            for method,path in [("POST","/engines/select"),("GET","/engines/omnivoice/health"),("GET","/engines/tts/"),("GET","/engines/translation")]:
                await middleware({"type":"http","method":method,"path":path},None,None)
        asyncio.run(scenario())
        self.assertEqual(len(self.calls),4)
        self.assertTrue(all(flag is False for _,_,flag in self.calls))

    def test_exception_cancellation_and_concurrent_post_do_not_leak_context(self):
        self.install()
        async def scenario():
            entered, release = asyncio.Event(), asyncio.Event()
            async def endpoint(scope, receive, send):
                if scope["method"]=="GET":
                    self.assertTrue(subject._metadata_request.get()); entered.set(); await release.wait()
                    raise asyncio.CancelledError()
                self.assertFalse(subject._metadata_request.get())
                self.assertIs(self.router._family_payload("tts",self.modules["tts"]),self.marker)
            middleware=subject.EngineCatalogueMetadataScope(endpoint)
            task=asyncio.create_task(middleware({"type":"http","method":"GET","path":"/engines"},None,None))
            await entered.wait()
            await middleware({"type":"http","method":"POST","path":"/engines/select"},None,None)
            release.set()
            with self.assertRaises(asyncio.CancelledError):await task
            self.assertFalse(subject._metadata_request.get())
        asyncio.run(scenario())

    def test_no_network_subprocess_heavy_import_or_metadata_scan_and_fast_first_get(self):
        forbidden={"torch","transformers","torchaudio","onnxruntime","misaki","kittentts","openai","faster_whisper","soundfile"}
        importer=builtins.__import__
        def guarded(name,*args,**kwargs):
            if name.split(".")[0] in forbidden:raise AssertionError("Heavy import:"+name)
            return importer(name,*args,**kwargs)
        before=set(sys.modules)
        with patch("builtins.__import__",side_effect=guarded), patch("socket.create_connection",side_effect=AssertionError("Network")), patch("urllib.request.urlopen",side_effect=AssertionError("Network")), patch("subprocess.Popen",side_effect=AssertionError("Subprocess")), patch("importlib.metadata.packages_distributions",side_effect=AssertionError("Metadata scan")):
            started=time.monotonic()
            self.install()
            token=subject._metadata_request.set(True)
            try:
                for family in ("tts","asr","llm"):self.router._family_payload(family,self.modules[family])
            finally:subject._metadata_request.reset(token)
            self.assertLess(time.monotonic()-started,2)
        self.assertFalse(forbidden & (set(sys.modules)-before))
        self.assertEqual(self.calls,[])

    def test_selected_tts_configuration_never_probes_backend_platform_process_or_licences(self):
        def forbidden(*args, **kwargs):
            raise AssertionError("Configuration-only selection executed a probe")
        catalogue = self.catalogue()
        before = set(sys.modules)
        with patch.object(subject.platform, "machine", forbidden), patch.object(subject.MetadataCatalogue, "family_payload", forbidden), patch.object(subject.MetadataCatalogue, "_state", forbidden), patch.object(subject.MetadataCatalogue, "_licenses", forbidden), patch("subprocess.Popen", forbidden), patch("socket.create_connection", forbidden):
            selected = catalogue.selected_tts_payload()
            self.assertEqual(selected["active"], "omnivoice")
            self.assertEqual(selected["active_model"], "k2-fsa/OmniVoice")
            self.assertEqual(selected["selection_check"], "configured")
            (self.data / "prefs.json").write_text('{"tts_backend":"mlx-audio","mlx_audio_model_id":"csm"}', encoding="utf-8")
            selected = catalogue.selected_tts_payload()
            self.assertEqual(selected["active_model"], "mlx-community/csm-1b-8bit")
            self.assertFalse(selected["env_override"])
            with patch.dict(os.environ, {"OMNIVOICE_MLX_AUDIO_MODEL": "mlx-community/Kokoro-82M-bf16"}):
                self.assertEqual(catalogue.selected_tts_payload()["active_model"], "mlx-community/Kokoro-82M-bf16")
            with patch.dict(os.environ, {"OMNIVOICE_TTS_BACKEND": "omnivoice-subprocess", "OMNIVOICE_MODEL": "bare-invalid-checkpoint"}):
                selected = catalogue.selected_tts_payload()
                self.assertEqual(selected["active"], "omnivoice-subprocess")
                self.assertEqual(selected["active_model"], "k2-fsa/OmniVoice")
                self.assertTrue(selected["env_override"])
            with patch.dict(os.environ, {"OMNIVOICE_TTS_BACKEND": "omnivoice", "OMNIVOICE_MODEL": " test "}):
                self.assertEqual(catalogue.selected_tts_payload()["active_model"], "test")
            (self.data / "prefs.json").write_text('{"tts_backend":"auto"}', encoding="utf-8")
            selected = catalogue.selected_tts_payload()
            self.assertEqual(selected["configured_active"], "auto")
            self.assertEqual(selected["active"], "")
            self.assertIsNone(selected["active_model"])
            self.assertEqual(selected["selection_check"], "not_resolved")
        self.assertEqual(self.calls, [])
        self.assertFalse(any(name.split(".")[0] in {"torch", "numpy", "transformers", "omnivoice", "huggingface_hub"} for name in set(sys.modules) - before))

    def test_post_success_return_unmodified_then_get_reads_new_prefs(self):
        self.install()
        def selected(family,module):
            (self.data/"prefs.json").write_text('{"tts_backend":"kokoro"}')
            return self.marker
        # Keep the captured original callable but give it explicit stock-like side effects.
        self.original.__code__ = selected.__code__
        self.assertIs(self.router._family_payload("tts",self.modules["tts"]),self.marker)
        token=subject._metadata_request.set(True)
        try:self.assertEqual(self.router._family_payload("tts",self.modules["tts"])["active"],"kokoro")
        finally:subject._metadata_request.reset(token)


if __name__=="__main__":unittest.main(verbosity=2)
