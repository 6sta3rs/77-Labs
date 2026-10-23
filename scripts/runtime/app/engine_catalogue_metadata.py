"""Dependency-only engine inventory for the pinned VoiceStudio 0.5.7.

The four ordinary catalogue GETs (and the GPU report, which lists the same engines) never run a backend availability method.
Explicit selection, health and inference retain the original stock functions.
Declarations below are generated from pinned AST, not executable imports.
"""
from __future__ import annotations

from pathlib import Path as _SourcePath
import sys as _source_sys
_source_layout = _SourcePath(__file__).resolve().parent.parent
if (_source_layout / "app/launcher.py").is_file() and (_source_layout / "install/bootstrap.py").is_file():
    for _source_dir in ("app", "install"):
        _source_sys.path.insert(0, str(_source_layout / _source_dir))


from contextvars import ContextVar
import copy
import hashlib
from importlib.machinery import PathFinder
import json
import os
from pathlib import Path
import platform
import re
import sqlite3
import stat
import sys
from types import ModuleType

PINNED_ARCHIVE_SHA256 = "2b511d70698a79ff015e8b566f1879b00b55219089cd433d1d9220f56691aac6"
PINNED_ADAPTER3_MAIN_SHA256 = "23a25f0311eb97c4d17826c684e6a5b873828203e60bbace6810d15d34c61aea"
CATALOGUE_PATHS = frozenset({"/engines", "/engines/tts", "/engines/asr", "/engines/llm"})
# The GPU report lists the same engines; its stock route imports every adapter cold to probe them.
GPU_REPORT_PATH = "/api/settings/gpu-report"
METADATA_PATHS = CATALOGUE_PATHS | {GPU_REPORT_PATH}
_metadata_request = ContextVar("next_engine_catalogue_metadata_request", default=False)


class EngineMetadataContractError(RuntimeError):
    pass


def _plain(path):
    path = Path(path)
    for part in (path, *path.parents):
        try: info = part.lstat()
        except FileNotFoundError: continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 1024:
            raise EngineMetadataContractError("Metadane katalogu prowadzą przez dowiązanie.")
    return path


def _read(path, maximum=2 * 1024 ** 2):
    path = _plain(path)
    if path.stat().st_size > maximum:
        raise EngineMetadataContractError("Plik metadanych przekracza limit.")
    return path.read_bytes()


def _json(path, maximum=65536):
    try:
        result = json.loads(_read(path, maximum).decode("utf-8-sig"))
        return result if isinstance(result, dict) else {}
    except (OSError, ValueError, EngineMetadataContractError):
        return {}


def _top_level_present(name, search_paths):
    # A dotted find_spec imports its parent. PathFinder + explicit private
    # paths avoids both that and custom sys.meta_path discovery.
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
        raise EngineMetadataContractError("Sonda katalogu wymaga nazwy pakietu najwyższego poziomu.")
    try:
        spec = PathFinder.find_spec(name, [str(_plain(path)) for path in search_paths])
        if spec is None: return False
        locations = list(spec.submodule_search_locations or []) or ([spec.origin] if spec.origin else [])
        for location in locations:
            resolved = _plain(Path(location)).resolve()
            if not any(resolved.is_relative_to(Path(base).resolve()) for base in search_paths): return False
        return bool(locations)
    except (ImportError, OSError, ValueError, EngineMetadataContractError):
        return False


_DEPENDENCIES = {
    "omnivoice": (("torch", "torchaudio", "transformers", "soundfile"),),
    "omnivoice-subprocess": (("torch", "torchaudio", "transformers", "soundfile"),),
    "cosyvoice": (("cosyvoice",),), "voxcpm2": (("voxcpm",),),
    "moss-tts-nano": (("transformers", "moss_tts_nano"),),
    "kittentts": (("kittentts", "onnxruntime", "misaki", "phonemizer"),),
    "mlx-audio": (("mlx_audio",),), "supertonic3": (("supertonic",),),
    "pockettts": (("pocket_tts",),), "sherpa-onnx": (("sherpa_onnx",),),
    "whisperx": (("whisperx", "faster_whisper", "ctranslate2"),),
    "faster-whisper": (("faster_whisper", "ctranslate2"),),
    "faster-whisper-isolated": (("faster_whisper", "ctranslate2"),),
    "mlx-whisper": (("mlx_whisper",),), "pytorch-whisper": (("torch", "transformers"),),
    "nemo-parakeet": (("torch", "nemo"),), "parakeet-mlx": (("parakeet_mlx",),),
    "moonshine": (("moonshine_onnx",), ("moonshine_voice",)), "funasr": (("funasr",),),
    "sherpa-onnx-asr": (("sherpa_onnx",),), "openai-compat-asr": (("openai",),),
    "openai-compat": (("openai",),), "off": ((),), "gpt-sovits": ((),),
}
_OWN_ENV = {"indextts2": "indextts2", "moss-tts-v15": "moss-tts-v15",
    "dots-tts": "dots-tts", "confucius4-tts": "confucius4-tts",
    "cosyvoice": "cosyvoice", "voxcpm2": "voxcpm2", "moss-tts-nano": "moss-tts-nano",
    "supertonic3": "supertonic3", "pockettts": "pockettts"}
_LICENSED = frozenset({"supertonic3", "pockettts", "kittentts2", "fish-s2-pro"})
_DEFAULT_ROW = {"supports_cloning": True, "supports_voice_design": None, "gpu_compat": ["cpu"],
    "min_vram_gb": None, "preset_voices": [], "default_voice": None, "max_ref_seconds": None,
    "ref_strategy": None, "supports_emotion": False, "instruct_vocabulary": "freeform",
    "supported_language_names": None, "isolation_mode": "in-process", "output_sample_rate": None,
    "output_channels": None, "install_hint": None, "docs_url": None, "setup_snippet": None}


class EngineCatalogueMetadataScope:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        enabled = scope.get("type") == "http" and scope.get("method") == "GET" and scope.get("path") in METADATA_PATHS
        token = _metadata_request.set(enabled)
        try:
            await self.app(scope, receive, send)
        finally:
            _metadata_request.reset(token)


class MetadataCatalogue:
    def __init__(self, *, engine_path, runtime_root, data_dir):
        self.engine = _plain(Path(engine_path).absolute()).resolve()
        self.runtime = _plain(Path(runtime_root).absolute()).resolve()
        self.data = _plain(Path(data_dir).absolute()).resolve()
        # Raw proof binds the declaration index to the exact archive and the
        # files read from the selected generation, not the package version.
        # The retained installer ZIP may be older than the selected source
        # bundle. Match launcher.prepare_engine's explicit immutable bundle.
        archive = _plain(Path(os.environ.get("VOICESTUDIO_NEXT_BUNDLE", str(self.runtime / "engine.zip"))).absolute())
        with _plain(archive).open("rb") as stream:
            actual = hashlib.file_digest(stream, "sha256").hexdigest()
        if actual != PINNED_ARCHIVE_SHA256:
            raise EngineMetadataContractError("Szybki katalog wymaga przypiętego archiwum VoiceStudio 0.5.7.")
        for relative, expected in _DATA["source_hashes"].items():
            if hashlib.sha256(_read(self.engine / relative)).hexdigest() != expected:
                raise EngineMetadataContractError("Zmienił się kontrakt źródeł szybkiego katalogu: " + relative)
        extra = _read(self.runtime / "tts_catalog.py").replace(b"\r\n", b"\n")
        if hashlib.sha256(extra).hexdigest() != _DATA["extra_catalogue_lf_sha256"]:
            raise EngineMetadataContractError("Zmieniły się deklaracje dodatkowych silników TTS.")
        self.rows = copy.deepcopy({family: _DATA[family] for family in ("tts", "asr", "llm")})
        self.rows["tts"].update(copy.deepcopy(_DATA["extra"]))
        site = self.runtime / ".venv" / ("Lib/site-packages" if os.name == "nt" else "lib/python%d.%d/site-packages" % sys.version_info[:2])
        search = [self.engine, _plain(site)]
        names = {name for groups in _DEPENDENCIES.values() for group in groups for name in group}
        self.packages = {name: _top_level_present(name, search) for name in sorted(names)}
        self._binary_hashes = {}

    def _binary_matches(self, path, expected):
        if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected): return False
        try:
            path = _plain(path)
            info = path.stat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not 0 < info.st_size <= 200 * 1024 ** 2: return False
            key = (str(path), info.st_size, info.st_mtime_ns, info.st_ino, expected)
            if key not in self._binary_hashes:
                with path.open("rb") as stream: matched = hashlib.file_digest(stream, "sha256").hexdigest() == expected
                if len(self._binary_hashes) > 32: self._binary_hashes.clear()
                self._binary_hashes[key] = matched
            return self._binary_hashes[key]
        except (OSError, EngineMetadataContractError): return False

    def _owned_install(self, engine_id):
        # Read the already-registered installer's DATA, not any of its methods,
        # locks, availability probes or subprocess helpers.
        installer = sys.modules.get("engine_installation")
        manager = vars(installer).get("_manager") if installer else None
        specs = vars(manager).get("specs", []) if manager is not None else []
        if not isinstance(specs, (list, tuple)): return False
        wanted = "audio-cpp" if engine_id == "audiocpp" else engine_id
        spec = next((value for value in specs if isinstance(value, dict) and value.get("engine_id") == wanted), None)
        if not spec: return False
        job = _json(self.data / "engine-runtime-jobs.json", 1024 * 1024).get(wanted, {})
        if not isinstance(job, dict): return False
        attempt_id = job.get("attempt_id")
        if job.get("state") != "complete" or not isinstance(attempt_id, str) or not re.fullmatch(r"[0-9a-f]{32}", attempt_id):
            return False
        attempt = self.runtime / "sidecars" / wanted / attempt_id
        marker = _json(attempt / ".seventy-seven-runtime-complete.json")
        if marker.get("engine_id") != wanted or marker.get("disclosure_id") != spec.get("disclosure_id"): return False
        raw = marker.get("install_dir")
        if not isinstance(raw, str) or not Path(raw).is_absolute(): return False
        try:
            target = _plain(Path(raw)).resolve()
            if not target.is_relative_to(_plain(attempt).resolve()): return False
            if spec.get("kind") == "native":
                binaries = marker.get("binaries", {})
                return isinstance(binaries, dict) and set(binaries) == {"audiocpp_server.exe", "audiocpp_cli.exe"} and all(self._binary_matches(target / name, sha) for name, sha in binaries.items())
            completion = spec.get("completion_marker")
            if not isinstance(completion, str) or Path(completion).is_absolute() or ".." in Path(completion).parts: return False
            python = _plain(target / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python"))
            if not python.is_file() or not _plain(target / completion).is_file(): return False
            if spec.get("weights_repo_id"):
                subdir = spec.get("weights_subdir", "checkpoints")
                if not isinstance(subdir, str) or Path(subdir).is_absolute() or ".." in Path(subdir).parts: return False
                if not _plain(target / subdir / ".omnivoice_weights_complete").is_file(): return False
            return True
        except (OSError, EngineMetadataContractError, TypeError): return False

    def _gguf_binary(self):
        machine = platform.machine().lower()
        slug = "windows-x86_64" if sys.platform == "win32" else ("darwin-arm64" if machine in {"arm64","aarch64"} else "darwin-x86_64") if sys.platform == "darwin" else "linux-aarch64" if machine in {"arm64","aarch64"} else "linux-x86_64"
        filename = "omnivoice-tts-" + slug + (".exe" if sys.platform == "win32" else "")
        try:
            manifest = _read(self.engine / "bin/checksums.sha256", 65536).decode("utf-8")
            for line in manifest.splitlines():
                fields = line.split()
                if len(fields) == 2 and fields[1].lstrip("*") == filename:
                    return self._binary_matches(self.engine / "bin" / filename, fields[0])
        except (OSError, ValueError, EngineMetadataContractError): pass
        return False

    def _licenses(self):
        path = self.data / "omnivoice.db"
        if not path.is_file(): return {}, "missing"
        try:
            _plain(path)
            connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=.05)
            try:
                keys = [name + "_license_accepted" for name in sorted(_LICENSED)]
                result = connection.execute("SELECT key,value FROM settings WHERE key IN (" + ",".join("?" for _ in keys) + ")", keys).fetchall()
                return {key.removesuffix("_license_accepted"): value == "1" for key, value in result}, "read"
            finally: connection.close()
        except (OSError, sqlite3.Error, EngineMetadataContractError):
            return {}, "unavailable"

    def _private_environment(self, row):
        family = row["private_family"]
        folder = self.runtime / "tts-envs" / family
        info = _json(folder / "environment.json", 16384)
        python = folder / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        try:
            present = _plain(python).is_file() and python.stat().st_size > 0
        except (OSError, EngineMetadataContractError):
            present = False
        return bool(present and info.get("schema") == 1 and info.get("family") == family and info.get("probe") == "passed")

    def _state(self, engine_id, row, prefs):
        apple = sys.platform == "darwin" and platform.machine().lower() in {"arm64", "aarch64"}
        if engine_id in {"mlx-audio", "mlx-whisper", "parakeet-mlx"} and not apple:
            return "platform_unsupported", "Ten silnik wymaga Apple Silicon i nie działa na tym systemie."
        if engine_id == "dots-tts" and sys.platform == "win32":
            return "platform_unsupported", "Ten silnik nie obsługuje Windows."
        if self._owned_install(engine_id):
            return "dependencies_detected", "Wykryto zgodny znacznik własnej instalacji i wymagane pliki. Sprawdzenie silnika nastąpi po jawnym wyborze."
        if row.get("private_family"):
            own = self._private_environment(row)
            if engine_id == "kittentts" and not own:
                # Metadata-only legacy fallback. NEVER call legacy.is_available.
                detected = all(self.packages.get(name, False) for name in _DEPENDENCIES["kittentts"][0])
                if detected: return "dependencies_detected", "Wykryto zależności starszego KittenTTS. Wybór uruchomi jawne sprawdzenie."
            if not own:
                return "missing_dependencies", "Przygotuj osobne środowisko tego silnika w „Modele i silnik”."
            if engine_id == "fish-s2-pro":
                config = _json(self.runtime / "fish-s2-service.json", 16384)
                from urllib.parse import urlsplit
                try:
                    parsed = urlsplit(str(config.get("url", "")))
                    configured = (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "::1"} and
                        not parsed.username and not parsed.password and parsed.path in {"", "/"} and
                        not parsed.query and not parsed.fragment and parsed.port is not None)
                except ValueError: configured = False
                if not configured:
                    return "runtime_unconfigured", "Nie potwierdzono konfiguracji własnej usługi Fish. Katalog nie wykonuje połączenia."
            return "dependencies_detected", "Wykryto prywatne środowisko. Wagi i działanie silnika nie zostały tu zweryfikowane."
        if engine_id == "omnivoice-gguf" and self._gguf_binary():
            return "dependencies_detected", "Program odpowiada lokalnemu manifestowi SHA-256. Nie uruchomiono go i nie sprawdzono modelu ani sprzętu."
        if engine_id in {"audiocpp", "omnivoice-gguf"}:
            return "runtime_unconfigured", "Natywny silnik wymaga osobnego przygotowania. Katalog nie uruchamia programów ani sond sprzętu."
        if engine_id in _OWN_ENV:
            folder = self.data / "engines" / _OWN_ENV[engine_id]
            site = folder / ".venv" / ("Lib/site-packages" if os.name == "nt" else "lib/python%d.%d/site-packages" % sys.version_info[:2])
            groups = _DEPENDENCIES.get(engine_id, ())
            # Only top-level probes in the explicitly owned sidecar; no interpreter launch.
            if groups and any(all(_top_level_present(name, [_plain(site), _plain(folder)]) for name in group) for group in groups):
                return "dependencies_detected", "Wykryto zależności w osobnym środowisku. Sprawdzenie nastąpi po jawnym wyborze."
        groups = _DEPENDENCIES.get(engine_id)
        if groups is None:
            return "runtime_unconfigured", "Nie potwierdzono konfiguracji osobnego środowiska tego silnika."
        if not any(all(self.packages.get(name, False) for name in group) for group in groups):
            return "missing_dependencies", "Nie wykryto wszystkich wymaganych pakietów. Przygotuj zależności silnika."
        if engine_id == "openai-compat" and not (os.environ.get("TRANSLATE_BASE_URL") or os.environ.get("LLM_DEFAULT_PROVIDER") or prefs.get("llm_backend") == "openai-compat"):
            return "runtime_unconfigured", "Nie potwierdzono konfiguracji dostawcy LLM. Katalog nie łączy się z usługą."
        if engine_id == "openai-compat-asr" and not (os.environ.get("ASR_OPENAI_COMPAT_BASE_URL") or prefs.get("asr_backend") == engine_id):
            return "runtime_unconfigured", "Nie potwierdzono konfiguracji usługi ASR. Katalog nie łączy się z usługą."
        if engine_id == "off":
            return "dependencies_detected", "Brak modelu językowego. Jawny wybór wyłączy korzystanie z LLM."
        return "dependencies_detected", "Wykryto wymagane zależności. Sprawdzenie silnika nastąpi po jawnym wyborze."

    def selected_tts_payload(self):
        """Configuration only: no dependency, platform, licence or binary probe.

        Match family_payload's TTS ENV/prefs precedence and checkpoint rules,
        without enumerating unrelated backends or touching an availability path.
        """
        prefs = _json(self.data / "prefs.json")
        env = os.environ.get("OMNIVOICE_TTS_BACKEND")
        configured = env or prefs.get("tts_backend") or "omnivoice"
        if not isinstance(configured, str): configured = ""
        active = configured if configured in self.rows["tts"] else ""
        model, model_check = None, "not_checked"
        if active in {"omnivoice", "omnivoice-subprocess"}:
            configured_model = os.environ.get("OMNIVOICE_MODEL", "k2-fsa/OmniVoice").strip()
            model = configured_model if (configured_model == "test" or "/" in configured_model or "\\" in configured_model or os.path.isabs(configured_model)) else "k2-fsa/OmniVoice"
            model_check = "configured_not_loaded"
        elif active == "mlx-audio":
            declaration = self.rows["tts"][active]
            key = os.environ.get("OMNIVOICE_MLX_AUDIO_MODEL") or prefs.get("mlx_audio_model_id") or declaration.get("DEFAULT_MODEL_KEY", "kokoro")
            model = declaration.get("CURATED_MODELS", {}).get(key, key)
            model_check = "configured_not_loaded"
        selected = {"active": active, "configured_active": configured, "selection_check": "configured" if active else "not_resolved",
                    "active_model": model, "model_check": model_check, "env_override": bool(env)}
        label = self.rows["tts"].get(active, {}).get("display_name")
        if isinstance(label, str): selected["label"] = label
        return selected

    def gpu_rows(self, family):
        """Rows for the GPU report from declarations: routing is pure host arithmetic, availability stays unverified.

        `available` means only "dependencies detected"; running the engine is still proven by an explicit selection.
        """
        from core.device_caps import detect_host_caps
        from services.engine_routing import routing_fields
        caps = detect_host_caps()
        return [{**row, "available": row["availability_check"] == "dependencies_detected",
                 **routing_fields(tuple(row.get("gpu_compat") or ("cpu",)), caps, float(row.get("min_vram_gb") or 0.0))}
                for row in self.family_payload(family)["backends"]]

    def family_payload(self, family):
        if family not in self.rows:
            raise EngineMetadataContractError("Nieznana rodzina szybkiego katalogu.")
        prefs = _json(self.data / "prefs.json")
        env = os.environ.get("OMNIVOICE_" + family.upper() + "_BACKEND")
        configured = env or prefs.get(family + "_backend") or {"tts": "omnivoice", "asr": "auto", "llm": "auto"}[family]
        if not isinstance(configured, str): configured = ""
        if family == "asr" and env == "omnivoice": configured = "pytorch-whisper"
        active = configured if configured in self.rows[family] else ""
        licenses, license_check = self._licenses() if family == "tts" else ({}, "not_applicable")
        backends = []
        for engine_id, declared in self.rows[family].items():
            row = copy.deepcopy(_DEFAULT_ROW)
            row.update(copy.deepcopy(declared))
            if family != "tts":
                row.update(supports_cloning=None, supports_voice_design=None)
            row.pop("private_family", None)
            for key in ("CURATED_MODELS", "CURATED_MODEL_LANGUAGES", "DEFAULT_MODEL_KEY"): row.pop(key, None)
            languages = declared.get("supported_language_names")
            if languages == "@omnivoice": row["supported_language_names"] = list(_DATA["omnivoice_language_names"])
            state, reason = self._state(engine_id, declared, prefs)
            row.update(id=engine_id, available=False, reason=reason, last_error=None,
                availability_check=state, can_verify=state == "dependencies_detected", inference_verified=False,
                hardware_check="not_checked", effective_device="unknown", routing_status="unavailable",
                routing_reason="Nie wykonano sondy sprzętu ani załadowania modelu.", one_click_install=False,
                installed=False if state == "missing_dependencies" else None, weights_check="not_checked", execution_evidence=None)
            if family == "tts":
                required = engine_id in _LICENSED
                row.update(license_required=required, license_accepted=licenses.get(engine_id, False) if required else True, license_check=license_check)
            if engine_id == "mlx-audio":
                models = declared.get("CURATED_MODELS", {})
                row["curated_models"] = [{"key": key, "label": key, "repo_id": repo} for key, repo in models.items()]
                row["active_model"] = os.environ.get("OMNIVOICE_MLX_AUDIO_MODEL") or prefs.get("mlx_audio_model_id", declared.get("DEFAULT_MODEL_KEY", "kokoro"))
            backends.append(row)
        model, model_check = None, "not_checked"
        if family == "tts" and active in {"omnivoice", "omnivoice-subprocess"}:
            configured_model = os.environ.get("OMNIVOICE_MODEL", "k2-fsa/OmniVoice").strip()
            model = configured_model if (configured_model == "test" or "/" in configured_model or "\\" in configured_model or os.path.isabs(configured_model)) else "k2-fsa/OmniVoice"
            model_check = "configured_not_loaded"
        elif family == "tts" and active == "mlx-audio":
            declaration = self.rows["tts"]["mlx-audio"]
            key = os.environ.get("OMNIVOICE_MLX_AUDIO_MODEL") or prefs.get("mlx_audio_model_id") or declaration.get("DEFAULT_MODEL_KEY", "kokoro")
            model = declaration.get("CURATED_MODELS", {}).get(key, key)
            model_check = "configured_not_loaded"
        if family == "asr":
            # Only the model the ACTIVE backend would load: Faster-Whisper's CTranslate2 pick (ASR_MODEL_FASTER pin, else the
            # prefs value) or WhisperX's own pin; None means the engine default (or a backend that takes no model).
            if active in {"faster-whisper", "faster-whisper-isolated"}:
                picked = os.environ.get("ASR_MODEL_FASTER") or prefs.get("asr_model_faster")
            else:
                picked = os.environ.get("ASR_MODEL_WHISPERX") if active == "whisperx" else None
            if isinstance(picked, str) and picked.strip(): model, model_check = picked.strip(), "configured_not_loaded"
        return {"active": active, "configured_active": configured, "selection_check": "configured" if active else "not_resolved",
                "active_model": model, "model_check": model_check, "env_override": bool(env), "backends": backends, "availability_mode": "metadata_only"}


def _registry_ids(module, family):
    registry = vars(module).get("_REGISTRY")
    if not isinstance(registry, dict):
        raise EngineMetadataContractError("Zmienił się kontrakt rejestru silników.")
    result = set(dict.keys(registry))  # bypass lazy keys/items/values
    lazy = vars(module).get("_LAZY_REGISTRY", {}) if family == "tts" else vars(type(registry)).get("_LAZY", {}) if family == "asr" else {}
    if not isinstance(lazy, dict):
        raise EngineMetadataContractError("Zmienił się kontrakt leniwego rejestru.")
    return result | set(dict.keys(lazy))


def _router_binding(catalogue, router):
    """Validate an already-imported module and prepare one payload wrapper."""
    if not isinstance(router, ModuleType):
        raise EngineMetadataContractError("Brak zaimportowanego routera silników po przygotowaniu backendu.")
    expected_router = catalogue.engine / "backend/api/routers/engines.py"
    raw = vars(router).get("__file__")
    if not isinstance(raw, str) or _plain(Path(raw).absolute()).resolve() != expected_router.resolve():
        raise EngineMetadataContractError("Router nie pochodzi z wybranej generacji silnika.")
    families = vars(router).get("_FAMILIES", {})
    if set(families) != {"tts", "asr", "llm"}:
        raise EngineMetadataContractError("Zmienił się kontrakt rodzin silników.")
    for family, entry in families.items():
        if _registry_ids(entry[0], family) != set(catalogue.rows[family]):
            raise EngineMetadataContractError("Niezgodny zestaw silników: " + family)
    original = vars(router).get("_family_payload")
    if not callable(original):
        raise EngineMetadataContractError("Brak kontraktu payload rodziny silników.")
    bound = getattr(original, "_next_engine_catalogue_metadata", None)
    if bound is not None:
        if bound is catalogue: return original
        raise EngineMetadataContractError("Router ma już inne powiązanie katalogu metadanych.")
    def family_payload(family, module):
        if _metadata_request.get():
            return catalogue.family_payload(family)
        return original(family, module)  # explicit POST/health keeps ALL stock gates
    family_payload._next_engine_catalogue_metadata = catalogue
    family_payload.__wrapped__ = original
    return family_payload


def _bind_gpu_listing(catalogue, router):
    """Answer list_backends() from declarations inside the GPU-report scope only; every other caller keeps the original."""
    for family, entry in vars(router).get("_FAMILIES", {}).items():
        module, original = entry[0], vars(entry[0]).get("list_backends")
        if family not in {"tts", "asr"} or not callable(original) or getattr(original, "_next_engine_catalogue_metadata", None) is not None:
            continue
        def listing(*args, _family=family, _original=original, **kwargs):
            if _metadata_request.get():
                return catalogue.gpu_rows(_family)
            return _original(*args, **kwargs)
        listing._next_engine_catalogue_metadata = catalogue
        listing.__wrapped__ = original
        module.list_backends = listing


_FASTER_WHISPER_DEFAULT = "Systran/faster-whisper-large-v3"
_FASTER_WHISPER_TURBO = "deepdml/faster-whisper-large-v3-turbo-ct2"


def _repo_installed(repo):
    """The engine's own complete-snapshot check; a failed lookup counts as not installed."""
    try:
        from api.routers.setup.models import installed_snapshot_path
        return bool(installed_snapshot_path(repo))
    except Exception:
        return False


def apply_asr_model_defaults(data_dir):
    """Run after the engine restored env.* prefs, so nothing here counts as an external override.

    The stock default (large-v3, 2.9 GB) would otherwise be requested by dubbing, queue, conversion and speech-to-text
    for users who only installed the turbo weight. Neither prefs.json nor asr_backend is changed.
    """
    picked = _json(Path(data_dir) / "prefs.json").get("asr_model_faster")
    if isinstance(picked, str) and picked.strip():
        # The isolated sidecar reads only os.environ; the prefs value is not an env.* key, so restore_env skips it.
        os.environ.setdefault("ASR_MODEL_FASTER", picked.strip())
    elif not (os.environ.get("ASR_MODEL_FASTER") or os.environ.get("ASR_MODEL_WHISPERX")):
        if not _repo_installed(_FASTER_WHISPER_DEFAULT) and _repo_installed(_FASTER_WHISPER_TURBO):
            os.environ.setdefault("ASR_MODEL_FASTER", _FASTER_WHISPER_TURBO)
            os.environ.setdefault("ASR_MODEL_WHISPERX", _FASTER_WHISPER_TURBO)


def _startup_finalizer(app, catalogue, startup_module):
    """Bind after stock build/ENV restore, immediately before router include."""
    if not isinstance(startup_module, ModuleType):
        raise EngineMetadataContractError("Odroczony katalog wymaga przypiętego modułu rozruchowego.")
    values = vars(startup_module)
    raw = values.get("__file__")
    expected = catalogue.engine / "backend/main.py"
    if not isinstance(raw, str) or _plain(Path(raw).absolute()).resolve() != expected.resolve():
        raise EngineMetadataContractError("Moduł rozruchowy nie pochodzi z wybranej generacji silnika.")
    if hashlib.sha256(_read(expected)).hexdigest() != PINNED_ADAPTER3_MAIN_SHA256:
        raise EngineMetadataContractError("Zmienił się kontrakt rozruchu adaptera3 szybkiego katalogu.")
    original = values.get("_phase_a_finalize")
    if values.get("app") is not app or not callable(original):
        raise EngineMetadataContractError("Brak zgodnego kontraktu finalizacji aplikacji.")
    if getattr(original, "_next_engine_catalogue_metadata", None) is not None:
        raise EngineMetadataContractError("Finalizacja ma już inne powiązanie katalogu metadanych.")
    bound_router = None
    def finalize(*args, **kwargs):
        nonlocal bound_router
        if vars(startup_module).get("_phase_a_built") is not True:
            raise EngineMetadataContractError("Router można powiązać dopiero po przygotowaniu backendu i ustawień.")
        router = sys.modules.get("api.routers.engines")
        if bound_router is None:
            payload = _router_binding(catalogue, router)
            router._family_payload = payload
            _bind_gpu_listing(catalogue, router)
            bound_router = router
            apply_asr_model_defaults(catalogue.data)
        elif router is not bound_router:
            raise EngineMetadataContractError("Router silników zmienił się po powiązaniu finalizacji.")
        return original(*args, **kwargs)
    finalize._next_engine_catalogue_metadata = catalogue
    finalize.__wrapped__ = original
    return finalize


def configure_engine_catalogue(app, *, engine_path, runtime_root, data_dir, startup_module=None):
    """Prepare scope before lifespan; bind without importing routers or ML.

    Eager startup already has the router. Deferred startup imports it inside
    stock Phase A, after preferences/ENV restore. Its finalizer is the stable,
    pinned handoff before include_router; middleware is never added there.
    """
    previous = getattr(app, "_next_engine_catalogue_metadata", None)
    if previous is not None: return previous
    catalogue = MetadataCatalogue(engine_path=engine_path, runtime_root=runtime_root, data_dir=data_dir)
    router = sys.modules.get("api.routers.engines")
    if router is not None:
        payload = _router_binding(catalogue, router)
        finalizer = None
    else:
        finalizer = _startup_finalizer(app, catalogue, startup_module)
        payload = None
    # Starlette forbids adding middleware after startup. Do it now, before
    # committing either global wrapper, so a late caller fails without patches.
    app.add_middleware(EngineCatalogueMetadataScope)
    if router is not None:
        router._family_payload = payload
        _bind_gpu_listing(catalogue, router)
        apply_asr_model_defaults(catalogue.data)
    else: startup_module._phase_a_finalize = finalizer
    app._next_engine_catalogue_metadata = catalogue
    return catalogue


# Embedded sparse declarations and raw source hashes. This is data, not imports.
_DATA = json.loads(r'''
{
  "tts": {
    "omnivoice": {
      "supports_voice_design": true,
      "gpu_compat": [
        "cuda",
        "rocm",
        "mps",
        "cpu"
      ],
      "min_vram_gb": 6.0,
      "max_ref_seconds": 20.0,
      "ref_strategy": "best_window",
      "instruct_vocabulary": "tags",
      "supported_language_names": "@omnivoice",
      "display_name": "VoiceStudio (k2-fsa/OmniVoice, 600+ languages)",
      "output_sample_rate": 24000,
      "output_channels": 1,
      "install_hint": "pip install omnivoice  (bundled — no extra install needed)",
      "docs_url": "https://github.com/debpalash/VoiceStudio/blob/main/docs/engines/omnivoice.md"
    },
    "cosyvoice": {
      "gpu_compat": [
        "cuda",
        "cpu"
      ],
      "supported_language_names": [
        "cantonese",
        "chinese",
        "english",
        "french",
        "german",
        "italian",
        "japanese",
        "korean",
        "russian",
        "spanish"
      ],
      "display_name": "CosyVoice 3 (9 langs, zero-shot, instruct, Apache-2.0)",
      "install_hint": "git clone --recursive FunAudioLLM/CosyVoice + pip install -r requirements.txt + SoX",
      "docs_url": "https://github.com/debpalash/VoiceStudio/blob/main/docs/engines/cosyvoice.md"
    },
    "kittentts": {
      "supports_cloning": false,
      "gpu_compat": [
        "cpu"
      ],
      "preset_voices": [
        "expr-voice-2-m",
        "expr-voice-2-f",
        "expr-voice-3-m",
        "expr-voice-3-f",
        "expr-voice-4-m",
        "expr-voice-4-f",
        "expr-voice-5-m",
        "expr-voice-5-f"
      ],
      "default_voice": "expr-voice-2-f",
      "supported_language_names": [
        "english"
      ],
      "display_name": "KittenTTS (English, 8 preset voices, CPU realtime)",
      "output_sample_rate": 24000,
      "output_channels": 1,
      "install_hint": "pip install kittentts  (ONNX, CPU-only, ~80 MB)",
      "docs_url": "https://github.com/debpalash/VoiceStudio/blob/main/docs/engines/kittentts.md"
    },
    "mlx-audio": {
      "gpu_compat": [
        "mps",
        "cpu"
      ],
      "display_name": "MLX-Audio (mac-ARM, 14+ engines: Kokoro, CSM, Dia, Qwen3, …)",
      "CURATED_MODELS": {
        "kokoro": "mlx-community/Kokoro-82M-bf16",
        "csm": "mlx-community/csm-1b-8bit",
        "qwen3-tts": "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit",
        "dia": "mlx-community/Dia-1.6B",
        "chatterbox": "mlx-community/Chatterbox-TTS-4bit",
        "melotts": "mlx-community/MeloTTS-English-v3-MLX",
        "outetts": "mlx-community/Llama-OuteTTS-1.0-1B-4bit"
      },
      "DEFAULT_MODEL_KEY": "kokoro",
      "CURATED_MODEL_LANGUAGES": {
        "kokoro": [
          "en",
          "es",
          "fr",
          "hi",
          "it",
          "pt",
          "ja",
          "zh"
        ],
        "csm": [
          "en"
        ],
        "qwen3-tts": [
          "zh",
          "en",
          "ja",
          "ko",
          "de",
          "fr",
          "ru",
          "pt",
          "es",
          "it"
        ],
        "dia": [
          "en"
        ],
        "chatterbox": [
          "en"
        ],
        "melotts": [
          "en"
        ],
        "outetts": [
          "en",
          "ar",
          "zh",
          "nl",
          "fr",
          "de",
          "it",
          "ja",
          "ko",
          "lt",
          "ru",
          "es",
          "pt",
          "be",
          "bn",
          "ka",
          "hu",
          "lv",
          "fa",
          "pl",
          "sw",
          "ta",
          "uk"
        ]
      },
      "install_hint": "pip install mlx-audio  (Apple Silicon only)",
      "docs_url": "https://github.com/debpalash/VoiceStudio/blob/main/docs/engines/mlx-audio.md"
    },
    "voxcpm2": {
      "supports_voice_design": true,
      "gpu_compat": [
        "cuda",
        "mps",
        "cpu"
      ],
      "max_ref_seconds": 30.0,
      "ref_strategy": "head",
      "supported_language_names": [
        "burmese",
        "chinese",
        "danish",
        "dutch",
        "english",
        "finnish",
        "french",
        "german",
        "greek",
        "hebrew",
        "hindi",
        "indonesian",
        "italian",
        "japanese",
        "khmer",
        "korean",
        "lao",
        "malay",
        "norwegian",
        "polish",
        "portuguese",
        "russian",
        "spanish",
        "swahili",
        "swedish",
        "thai",
        "turkish",
        "vietnamese"
      ],
      "display_name": "VoxCPM2 (30 langs, studio 48 kHz, voice design)",
      "output_sample_rate": 48000,
      "output_channels": 1,
      "install_hint": "pip install \"voxcpm>=2.0.3\"  (floor: 2.0.3 fixed Apple-Silicon audio quality; CPU/MPS supported, CUDA recommended for speed)",
      "docs_url": "https://github.com/debpalash/VoiceStudio/blob/main/docs/engines/voxcpm2.md"
    },
    "moss-tts-nano": {
      "supports_voice_design": false,
      "gpu_compat": [
        "cuda",
        "cpu"
      ],
      "supported_language_names": [
        "chinese",
        "czech",
        "danish",
        "english",
        "french",
        "german",
        "greek",
        "hebrew",
        "hungarian",
        "italian",
        "japanese",
        "korean",
        "persian",
        "polish",
        "portuguese",
        "russian",
        "spanish",
        "swedish",
        "turkish"
      ],
      "display_name": "MOSS-TTS-Nano (20 langs, CPU realtime, 48 kHz)",
      "output_sample_rate": 48000,
      "output_channels": 1,
      "install_hint": "git clone OpenMOSS/MOSS-TTS-Nano && pip install -e .  (not on PyPI)",
      "docs_url": "https://github.com/debpalash/VoiceStudio/blob/main/docs/engines/moss-tts-nano.md"
    },
    "gpt-sovits": {
      "supports_voice_design": false,
      "gpu_compat": [
        "cuda",
        "cpu"
      ],
      "supported_language_names": [
        "cantonese",
        "chinese",
        "english",
        "japanese",
        "korean"
      ],
      "display_name": "GPT-SoVITS (5 langs, zero-shot, RTF 0.014, MIT)",
      "install_hint": "External API server — start api_v2.py on port 9880",
      "docs_url": "https://github.com/debpalash/VoiceStudio/blob/main/docs/engines/gpt-sovits.md"
    },
    "sherpa-onnx": {
      "supports_cloning": false,
      "gpu_compat": [
        "cuda",
        "cpu"
      ],
      "display_name": "Sherpa-ONNX (20+ engines, WASM-ready, universal runtime)",
      "install_hint": "pip install sherpa-onnx  (universal ONNX runtime, WASM-ready)",
      "docs_url": "https://github.com/debpalash/VoiceStudio/blob/main/docs/engines/sherpa-onnx.md"
    },
    "indextts2": {
      "supports_voice_design": false,
      "gpu_compat": [
        "cuda",
        "rocm",
        "cpu"
      ],
      "supports_emotion": true,
      "supported_language_names": [
        "chinese",
        "english",
        "japanese",
        "spanish"
      ],
      "isolation_mode": "subprocess",
      "display_name": "IndexTTS 2.5 (multilingual emotion-controlled cloning)",
      "output_sample_rate": 24000,
      "output_channels": 1,
      "install_hint": "git clone --branch indextts-2.5 https://github.com/index-tts/index-tts.git && cd index-tts && uv venv .venv && uv pip install --python .venv/bin/python -e .  (Windows: .venv\\Scripts\\python.exe; NOT uv sync --all-extras)",
      "docs_url": "https://github.com/debpalash/VoiceStudio/blob/main/docs/engines/indextts.md"
    },
    "omnivoice-gguf": {
      "supports_voice_design": false,
      "gpu_compat": [
        "cuda",
        "mps",
        "cpu"
      ],
      "instruct_vocabulary": "tags",
      "supported_language_names": "@omnivoice",
      "display_name": "OmniVoice (GGUF, hardware-adaptive)",
      "install_hint": "Bundled — runs the C++ omnivoice-tts binary in bin/. Quants download lazily from Serveurperso/OmniVoice-GGUF on first generate.",
      "docs_url": "https://github.com/debpalash/VoiceStudio/blob/main/docs/engines/omnivoice-gguf.md"
    },
    "supertonic3": {
      "supports_cloning": false,
      "supports_voice_design": false,
      "gpu_compat": [
        "cpu"
      ],
      "preset_voices": [
        "M1",
        "M3",
        "M4",
        "M5",
        "F3",
        "F4",
        "F5"
      ],
      "default_voice": "M1",
      "isolation_mode": "subprocess",
      "display_name": "Supertonic-3 (31 langs, CPU ONNX, 7 preset voices, OpenRAIL-M)",
      "output_sample_rate": 44100,
      "output_channels": 1,
      "install_hint": "uv sync --extra supertonic  (CPU-only ONNX, 31 langs, ~400 MB model on first use; OpenRAIL-M model license)",
      "docs_url": "https://github.com/debpalash/VoiceStudio/blob/main/docs/engines/supertonic3.md"
    },
    "moss-tts-v15": {
      "supports_voice_design": false,
      "gpu_compat": [
        "cuda",
        "rocm",
        "xpu",
        "npu",
        "cpu"
      ],
      "isolation_mode": "subprocess",
      "display_name": "MOSS-TTS-v1.5 (8B, 31 langs, zero-shot clone, Apache-2.0)",
      "output_sample_rate": 24000,
      "output_channels": 1,
      "install_hint": "git clone OpenMOSS/MOSS-TTS + set OMNIVOICE_MOSS_TTS_V15_DIR  (own venv, transformers==5.0; 8B, ~16 GB weights; CUDA/ROCm/XPU/NPU/CPU, no MPS; Apache-2.0)",
      "docs_url": "https://github.com/debpalash/VoiceStudio/blob/main/docs/engines/moss-tts-v15.md"
    },
    "dots-tts": {
      "supports_voice_design": false,
      "gpu_compat": [
        "cuda",
        "cpu"
      ],
      "isolation_mode": "subprocess",
      "display_name": "dots.tts (2B, 24 langs, zero-shot clone, CUDA/CPU, 48 kHz, Apache-2.0)",
      "output_sample_rate": 48000,
      "output_channels": 1,
      "install_hint": "git clone rednote-hilab/dots.tts + set OMNIVOICE_DOTS_TTS_DIR  (own venv, transformers==4.57; 2B, ~9 GB weights; CUDA/CPU, Linux/macOS only — no Windows; Apache-2.0)",
      "docs_url": "https://github.com/debpalash/VoiceStudio/blob/main/docs/engines/dots-tts.md"
    },
    "omnivoice-subprocess": {
      "supports_voice_design": true,
      "gpu_compat": [
        "cuda",
        "rocm",
        "mps",
        "cpu"
      ],
      "min_vram_gb": 6.0,
      "max_ref_seconds": 20.0,
      "ref_strategy": "best_window",
      "instruct_vocabulary": "tags",
      "supported_language_names": "@omnivoice",
      "isolation_mode": "subprocess",
      "display_name": "OmniVoice (subprocess-isolated, killable on timeout)",
      "output_sample_rate": 24000,
      "output_channels": 1,
      "install_hint": "No extra install; uses the host OmniVoice install. Opt in with OMNIVOICE_TTS_BACKEND=omnivoice-subprocess (same model in a killable sidecar, for unattended reliability).",
      "docs_url": "https://github.com/debpalash/VoiceStudio/blob/main/docs/engines/omnivoice-subprocess.md"
    },
    "pockettts": {
      "gpu_compat": [
        "cpu"
      ],
      "isolation_mode": "subprocess",
      "display_name": "PocketTTS (Kyutai, 6 langs, CPU-only, MIT/CC-BY-4.0)",
      "output_sample_rate": 24000,
      "output_channels": 1,
      "install_hint": "uv sync --extra pockettts  (Kyutai, CPU-only, ~100 MB model on first use; MIT code + CC-BY-4.0 weights; HF-gated, review terms and set HF_TOKEN)",
      "docs_url": "https://github.com/debpalash/VoiceStudio/blob/main/docs/engines/pockettts.md"
    },
    "confucius4-tts": {
      "supports_voice_design": false,
      "gpu_compat": [
        "cuda",
        "rocm",
        "xpu",
        "npu",
        "cpu"
      ],
      "supported_language_names": [
        "chinese",
        "english",
        "french",
        "german",
        "indonesian",
        "italian",
        "japanese",
        "korean",
        "malay",
        "portuguese",
        "russian",
        "spanish",
        "thai",
        "vietnamese"
      ],
      "isolation_mode": "subprocess",
      "display_name": "Confucius4-TTS (LLM, 14 langs, cross-lingual zero-shot clone, Apache-2.0)",
      "output_sample_rate": 22050,
      "output_channels": 1,
      "install_hint": "git clone netease-youdao/Confucius4-TTS + set OMNIVOICE_CONFUCIUS4_TTS_DIR  (own Python 3.10 venv; 14-lang cross-lingual zero-shot clone; ~5 GB weights auto-download; CUDA/ROCm/XPU/NPU/CPU, no MPS; Apache-2.0)",
      "docs_url": "https://github.com/debpalash/VoiceStudio/blob/main/docs/engines/confucius4-tts.md"
    },
    "audiocpp": {
      "supports_voice_design": true,
      "gpu_compat": [
        "cpu"
      ],
      "supported_language_names": [
        "chinese",
        "english"
      ],
      "display_name": "audio.cpp · Breeze-TTS-2 (native GGUF, en+zh, clone+design; weights research/non-commercial)",
      "output_sample_rate": 24000,
      "output_channels": 1,
      "install_hint": "download the matching audio.cpp v0.7.4 prebuilt + set OMNIVOICE_AUDIOCPP_BIN, then explicitly install Breeze-TTS-2 in Model Catalogue → Models  (native CPU/Vulkan/CUDA/Metal GGUF server, no Python; en+zh clone+design; ~4.73 GiB; weights research/non-commercial only)",
      "docs_url": "https://github.com/debpalash/VoiceStudio/blob/main/docs/engines/audio-cpp.md"
    }
  },
  "asr": {
    "whisperx": {
      "gpu_compat": [
        "cuda",
        "cpu"
      ],
      "display_name": "WhisperX (faster-whisper + wav2vec2 forced alignment)",
      "install_hint": "pip install whisperx  (CTranslate2 + wav2vec2 alignment; CUDA or CPU)"
    },
    "faster-whisper": {
      "gpu_compat": [
        "cuda",
        "cpu"
      ],
      "display_name": "Faster-Whisper (CTranslate2 — Linux/Windows/macOS)",
      "install_hint": "pip install faster-whisper  (CTranslate2; cross-platform, CUDA or CPU)"
    },
    "mlx-whisper": {
      "gpu_compat": [
        "mps",
        "cpu"
      ],
      "display_name": "MLX Whisper (Apple Silicon CoreML)",
      "install_hint": "pip install mlx-whisper  (Apple Silicon only)"
    },
    "pytorch-whisper": {
      "gpu_compat": [
        "cuda",
        "mps",
        "cpu"
      ],
      "display_name": "PyTorch Whisper (CUDA / CPU via transformers pipeline)",
      "install_hint": "Bundled with transformers — no extra install (CUDA/MPS/CPU)"
    },
    "nemo-parakeet": {
      "gpu_compat": [
        "cuda",
        "cpu"
      ],
      "display_name": "Parakeet TDT (NVIDIA NeMo — 25 langs, CUDA/CPU)",
      "install_hint": "No safe install path in this app yet — nemo_toolkit's ASR extras pin transformers>=4.57,<4.58, which conflicts with VoiceStudio's own transformers>=5.3 requirement and WILL break the backend (ImportError on startup) if installed into this shared venv. Do NOT install nemo_toolkit here. If you want to try Parakeet TDT, set it up in a separate/dedicated Python environment — not the one VoiceStudio manages; in-app isolation for this engine is tracked separately."
    },
    "parakeet-mlx": {
      "gpu_compat": [
        "mps"
      ],
      "display_name": "Parakeet TDT v3 (MLX — Apple Silicon, 25 langs)",
      "install_hint": "uv add parakeet-mlx  (Apple Silicon only — installed by default on mac-ARM source installs since 0.3.22. Parakeet TDT v3 on the GPU via MLX: 25 European languages, word timestamps, ~2 GB unified memory.)"
    },
    "moonshine": {
      "gpu_compat": [
        "cpu"
      ],
      "display_name": "Moonshine (edge-optimized, ONNX)",
      "install_hint": "uv pip install moonshine-onnx  (or moonshine-voice; edge/CPU-optimized ASR)"
    },
    "funasr": {
      "gpu_compat": [
        "cuda",
        "cpu"
      ],
      "display_name": "FunASR (SenseVoice — 50+ languages, all-in-one)",
      "install_hint": "pip install funasr  (SenseVoiceSmall + FSMN-VAD; CUDA or CPU)"
    },
    "sherpa-onnx-asr": {
      "gpu_compat": [
        "cpu"
      ],
      "display_name": "Sherpa-ONNX dictation (live, CPU — streaming + offline)",
      "install_hint": "uv add sherpa-onnx  (ONNX live dictation; CPU, cross-platform)"
    },
    "openai-compat-asr": {
      "gpu_compat": [
        "cpu"
      ],
      "display_name": "OpenAI-compatible (remote server)",
      "install_hint": "No install needed — configure a server endpoint in Model Catalogue. Points VoiceStudio at any OpenAI-compatible server (a self-hosted Qwen3-ASR/FunASR/SenseVoice server, OpenAI's own Whisper API, or similar) — a path to Qwen3-ASR today, without waiting on a direct transformers integration."
    },
    "faster-whisper-isolated": {
      "gpu_compat": [
        "cuda",
        "cpu"
      ],
      "isolation_mode": "subprocess",
      "display_name": "Faster-Whisper (crash-isolated subprocess)",
      "install_hint": "No extra install (reuses faster-whisper). Escape hatch for hanging transcribes: runs ASR in a separate process that can be force-killed to reclaim a hung transcribe and its VRAM (#730). Slightly slower per call than in-process faster-whisper."
    }
  },
  "llm": {
    "openai-compat": {
      "gpu_compat": [],
      "display_name": "OpenAI-compatible (real OpenAI, Ollama, LM Studio, …)",
      "install_hint": "Set TRANSLATE_BASE_URL (+ TRANSLATE_API_KEY) — OpenAI, Ollama (http://localhost:11434/v1), or any compatible host."
    },
    "off": {
      "gpu_compat": [],
      "display_name": "Off (no LLM)"
    }
  },
  "extra": {
    "chatterbox-multilingual": {
      "display_name": "Chatterbox Multilingual V3",
      "description": "Polska narracja i klonowanie głosu; Chatterbox Multilingual V3.",
      "supports_voice_design": false,
      "gpu_compat": [
        "cuda",
        "cpu"
      ],
      "supported_language_names": [
        "Arabic",
        "Chinese",
        "Danish",
        "Dutch",
        "English",
        "Finnish",
        "French",
        "German",
        "Greek",
        "Hebrew",
        "Hindi",
        "Italian",
        "Japanese",
        "Korean",
        "Malay",
        "Norwegian",
        "Polish",
        "Portuguese",
        "Russian",
        "Spanish",
        "Swahili",
        "Swedish",
        "Turkish"
      ],
      "isolation_mode": "subprocess",
      "output_sample_rate": 24000,
      "output_channels": 1,
      "private_family": "chatterbox",
      "license_required": false
    },
    "kokoro": {
      "display_name": "Kokoro-82M",
      "description": "Gotowy głos dobierany do języka; zapisany profil nie jest klonowany. Bez oficjalnej obsługi polskiego.",
      "supports_cloning": false,
      "supports_voice_design": false,
      "supported_language_names": [
        "English",
        "Spanish",
        "French",
        "Hindi",
        "Italian",
        "Portuguese"
      ],
      "isolation_mode": "subprocess",
      "output_sample_rate": 24000,
      "output_channels": 1,
      "private_family": "kokoro",
      "license_required": false
    },
    "kittentts": {
      "display_name": "KittenTTS 0.8 Mini",
      "description": "KittenTTS 0.8 Mini: angielski głos Bella na CPU, bez klonowania zapisanego profilu.",
      "supports_cloning": false,
      "supports_voice_design": false,
      "supported_language_names": [
        "English"
      ],
      "isolation_mode": "subprocess",
      "output_sample_rate": 24000,
      "output_channels": 1,
      "private_family": "kitten",
      "license_required": false
    },
    "kittentts2": {
      "display_name": "KittenTTS 2 · packed",
      "description": "KittenTTS 2: klonowanie z transkryptem referencji. Brak oficjalnej obsługi polskiego.",
      "supports_voice_design": false,
      "gpu_compat": [
        "cuda",
        "cpu"
      ],
      "supported_language_names": [
        "English",
        "Arabic",
        "Chinese",
        "French",
        "German",
        "Hindi",
        "Italian",
        "Portuguese",
        "Russian",
        "Spanish",
        "Japanese",
        "Korean",
        "Turkish",
        "Dutch",
        "Swedish",
        "Danish",
        "Finnish",
        "Swahili",
        "Greek",
        "Hebrew"
      ],
      "isolation_mode": "subprocess",
      "output_sample_rate": 24000,
      "output_channels": 1,
      "private_family": "kitten",
      "license_required": true
    },
    "qwen3-tts": {
      "display_name": "Qwen3-TTS Base 0.6B",
      "description": "Qwen3-TTS Base 0.6B: klonowanie głosu w 10 językach, bez polskiego.",
      "supports_voice_design": false,
      "gpu_compat": [
        "cuda",
        "cpu"
      ],
      "supported_language_names": [
        "Chinese",
        "English",
        "Japanese",
        "Korean",
        "German",
        "French",
        "Russian",
        "Portuguese",
        "Spanish",
        "Italian"
      ],
      "isolation_mode": "subprocess",
      "output_sample_rate": 24000,
      "output_channels": 1,
      "private_family": "qwen3",
      "license_required": false
    },
    "qwen3-tts-1.7b": {
      "display_name": "Qwen3-TTS Base 1.7B",
      "description": "Qwen3-TTS Base 1.7B: klonowanie głosu w 10 językach, bez polskiego.",
      "supports_voice_design": false,
      "gpu_compat": [
        "cuda",
        "cpu"
      ],
      "supported_language_names": [
        "Chinese",
        "English",
        "Japanese",
        "Korean",
        "German",
        "French",
        "Russian",
        "Portuguese",
        "Spanish",
        "Italian"
      ],
      "isolation_mode": "subprocess",
      "output_sample_rate": 24000,
      "output_channels": 1,
      "private_family": "qwen3",
      "license_required": false
    },
    "qwen3-voice-design": {
      "display_name": "Qwen3-TTS VoiceDesign 1.7B",
      "description": "Qwen3 VoiceDesign: tworzenie głosu z opisu w 10 językach, bez polskiego.",
      "supports_cloning": false,
      "supports_voice_design": true,
      "gpu_compat": [
        "cuda",
        "cpu"
      ],
      "supported_language_names": [
        "Chinese",
        "English",
        "Japanese",
        "Korean",
        "German",
        "French",
        "Russian",
        "Portuguese",
        "Spanish",
        "Italian"
      ],
      "isolation_mode": "subprocess",
      "output_sample_rate": 24000,
      "output_channels": 1,
      "private_family": "qwen3",
      "license_required": false
    },
    "fish-s2-pro": {
      "display_name": "Fish Audio S2 Pro",
      "description": "Fish S2 Pro: klonowanie i polski przez osobną usługę Linux/WSL.",
      "supports_voice_design": false,
      "supported_language_names": [
        "Polish",
        "English",
        "German",
        "French",
        "Spanish",
        "Italian",
        "Portuguese",
        "Chinese",
        "Japanese",
        "Korean",
        "Russian",
        "Arabic"
      ],
      "isolation_mode": "subprocess",
      "output_sample_rate": 44100,
      "output_channels": 1,
      "private_family": "fish",
      "license_required": true
    }
  },
  "source_hashes": {
    "omnivoice/utils/lang_map.py": "a2710effacec1684e17bdaa7241018e66262196f66acd296e918217ed5699262",
    "backend/services/tts_backend.py": "9620e836491a10a06606ad0f6887bf8c547ef8e4b2d740abe980bc51e97b3dbf",
    "backend/engines/indextts/__init__.py": "a929f2ed1fbe0201d263166d7017d892f72338d56d88330ca9478c18f726a96c",
    "backend/engines/omnivoice_gguf/__init__.py": "df84dedd8daebe823dd2420655c2ad3ea02df18edc254266c3e99b5316051ca9",
    "backend/engines/omnivoice_gguf/backend.py": "53e8416a8eaa82f79da294d2f0720bd2283e9fa18e366fc601e4f17ba941b817",
    "backend/engines/supertonic3/__init__.py": "d546b6e43e3445b853d4ce7f7b30b2d6d04d2ecc2927495fd78aa177a5c3e296",
    "backend/engines/supertonic3/backend.py": "ed4c3e3c530186144ceec339364197bec8e336221d0f24d2874c9d5c25a14b56",
    "backend/engines/supertonic3/constants.py": "e0c2c59159907094f290077cbab44698cdedc1c14b47b22180646e188f176a74",
    "backend/engines/moss_tts_v15/__init__.py": "c9ced83cb25dbd498f92d5595a0022f64008cbc0687ae3cca997161dd1d7858f",
    "backend/engines/dots_tts/__init__.py": "0806fb00b22801f87dba63c014b7c6e19d24624aba7853f1658ef5d4ee8c2d6e",
    "backend/engines/omnivoice_subprocess/__init__.py": "615f604c07a05621e27fe8e6e5ab0c91f47a2ad048ca8d7b03f52606fcc76656",
    "backend/engines/pockettts/__init__.py": "c77efee69c2b2a84dc045637b56aec4a226d5a730e6e1a09bd556cfabff6b991",
    "backend/engines/confucius4/__init__.py": "cdf063d002b88a7e882d67c1b8608dd10155d3da9b1e824e6ca932421f0c1697",
    "backend/engines/audiocpp/__init__.py": "ad05a958e16f38e89ac550b8e71fd28ad90eae64a097a24559fc6c409d34ff7f",
    "backend/services/asr_backend.py": "1c61d49aeae7cd930fd8ccc08d064a5cc89dd6d8264e671073f1e6cc780ebf7e",
    "backend/services/subprocess_asr.py": "73aa7d15cb2f27c0a261d15d15170386b950d8637bee7414a43eb38c6844995c",
    "backend/services/llm_backend.py": "780939d800f9f87f6961b989f7490584fa18c506462011a4ccd42191f4716af3",
    "backend/api/routers/engines.py": "e4bc2e87f497b421fd5f5db485505bb3a13b639cf775732b1b7526da75663b6e",
    "backend/core/gpu_report.py": "e21ee89d6287b9faa7044f2504f23b54f75d855c88670c086269592e690d7c39",
    "backend/services/engine_routing.py": "f5bad389bda7391fc57a75165e6eab66528e832ea2bc1276dd7b3b4b4030b7c3",
    "backend/services/settings_store.py": "47560b06b2ba153fa1b6ddf056aa6b1ee1457f66f63541482434d206f59d5348",
    "backend/core/engine_licenses.py": "0fe344535c6e4590a221fa34a8854bc8ee0e8000a67fd99bda4d36c44ab01b76",
    "backend/services/sidecar_install.py": "4c5ba4c5b10b18da2fbe4d00380fa4e7df71d8470b76674c4c560576fd68eb6f",
    "backend/engines/audiocpp/bootstrap.py": "ecedabe30a78df874bf87f5b3c2c9f4716c79cebc1796165d8b9412877bf2eb1",
    "pyproject.toml": "8e8a518130b9201bc4b7a46af1834751232cae8d1d752e3a6b0af9ffdebbe8ea"
  },
  "extra_catalogue_lf_sha256": "4717ea9d5abf1dc2fb55281b6e949a37ff6c89161904a90952bea8b390f84c07",
  "omnivoice_language_names": [
    "abadi",
    "abkhazian",
    "abron",
    "abua",
    "adamawa fulfulde",
    "adyghe",
    "afade",
    "afrikaans",
    "agwagwune",
    "aja (benin)",
    "akebu",
    "alago",
    "albanian",
    "algerian arabic",
    "algerian saharan arabic",
    "ambo-pasco quechua",
    "ambonese malay",
    "amdo tibetan",
    "amharic",
    "anaang",
    "angika",
    "antankarana malagasy",
    "aragonese",
    "arbëreshë albanian",
    "arequipa-la unión quechua",
    "armenian",
    "ashe",
    "ashéninka perené",
    "askopan",
    "assamese",
    "asturian",
    "atayal",
    "awak",
    "ayacucho quechua",
    "azerbaijani",
    "baatonum",
    "bacama",
    "bade",
    "bafia",
    "bafut",
    "bagirmi fulfulde",
    "bago-kusuntu",
    "baharna arabic",
    "bakoko",
    "balanta-ganja",
    "balti",
    "bamenyam",
    "bamun",
    "bangwinji",
    "banjar",
    "bankon",
    "baoulé",
    "bara malagasy",
    "barok",
    "basa (cameroon)",
    "basa (nigeria)",
    "bashkir",
    "basque",
    "batak mandailing",
    "batanga",
    "bateri",
    "bats",
    "bayot",
    "bebele",
    "belarusian",
    "bengali",
    "betawi",
    "bhili",
    "bhojpuri",
    "bilur",
    "bima",
    "bodo",
    "boghom",
    "bokyi",
    "bomu",
    "bondei",
    "borgu fulfulde",
    "bosnian",
    "brahui",
    "braj",
    "breton",
    "buduma",
    "buginese",
    "bukharic",
    "bulgarian",
    "bulu (cameroon)",
    "bundeli",
    "bunun",
    "bura-pabir",
    "burak",
    "burmese",
    "burushaski",
    "cacaloxtepec mixtec",
    "cajatambo north lima quechua",
    "cakfem-mushere",
    "cameroon pidgin",
    "campidanese sardinian",
    "cantonese",
    "catalan",
    "cebuano",
    "cen",
    "central kurdish",
    "central nahuatl",
    "central pame",
    "central pashto",
    "central puebla nahuatl",
    "central tarahumara",
    "central yupik",
    "central-eastern niger fulfulde",
    "chadian arabic",
    "chichewa",
    "chichicapan zapotec",
    "chiga",
    "chimalapa zoque",
    "chimborazo highland quichua",
    "chinese",
    "chiquián ancash quechua",
    "chitwania tharu",
    "chokwe",
    "chuvash",
    "cibak",
    "coastal konjo",
    "copainalá zoque",
    "cornish",
    "corongo ancash quechua",
    "croatian",
    "cross river mbembe",
    "cuyamecalco mixtec",
    "czech",
    "dadiya",
    "dagbani",
    "dameli",
    "danish",
    "dargwa",
    "dazaga",
    "deccan",
    "degema",
    "dera (nigeria)",
    "dghwede",
    "dhatki",
    "dhivehi",
    "dhofari arabic",
    "dijim-bwilim",
    "dogri",
    "domaaki",
    "dotyali",
    "duala",
    "dutch",
    "dũya",
    "dyula",
    "eastern balochi",
    "eastern bolivian guaraní",
    "eastern egyptian bedawi arabic",
    "eastern krahn",
    "eastern mari",
    "eastern yiddish",
    "ebrié",
    "eggon",
    "egyptian arabic",
    "ejagham",
    "eleme",
    "eloyi",
    "embu",
    "english",
    "erzya",
    "esan",
    "esperanto",
    "estonian",
    "eton (cameroon)",
    "ewondo",
    "extremaduran",
    "fang (equatorial guinea)",
    "fanti",
    "farefare",
    "fe'fe'",
    "filipino",
    "filomena mata-coahuitlán totonac",
    "finnish",
    "fipa",
    "french",
    "fulah",
    "galician",
    "gambian wolof",
    "ganda",
    "garhwali",
    "gawar-bati",
    "gawri",
    "gbagyi",
    "gbari",
    "geji",
    "gen",
    "georgian",
    "german",
    "geser-gorom",
    "gheg albanian",
    "ghomálá'",
    "gidar",
    "glavda",
    "goan konkani",
    "goaria",
    "goemai",
    "gola",
    "greek",
    "guarani",
    "guduf-gava",
    "guerrero amuzgo",
    "gujarati",
    "gujari",
    "gulf arabic",
    "gurgula",
    "gusii",
    "gusilay",
    "gweno",
    "güilá zapotec",
    "hadothi",
    "hahon",
    "haitian",
    "hakha chin",
    "hakö",
    "halia",
    "hausa",
    "hawaiian",
    "hazaragi",
    "hebrew",
    "hemba",
    "herero",
    "highland konjo",
    "hijazi arabic",
    "hindi",
    "huarijio",
    "huautla mazatec",
    "huaxcaleca nahuatl",
    "huba",
    "huitepec mixtec",
    "hula",
    "hungarian",
    "hunjara-kaina ke",
    "hwana",
    "ibibio",
    "icelandic",
    "idakho-isukha-tiriki",
    "idoma",
    "igbo",
    "igo",
    "ikposo",
    "ikwere",
    "imbabura highland quichua",
    "indonesian",
    "indus kohistani",
    "interlingua (international auxiliary language association)",
    "inupiaq",
    "irish",
    "iron ossetic",
    "isekiri",
    "isoko",
    "italian",
    "ito",
    "itzá",
    "ixtayutla mixtec",
    "izon",
    "jambi malay",
    "japanese",
    "jaqaru",
    "jauja wanca quechua",
    "jaunsari",
    "javanese",
    "jiba",
    "jju",
    "judeo-moroccan arabic",
    "juxtlahuaca mixtec",
    "kabardian",
    "kabras",
    "kabuverdianu",
    "kabyle",
    "kachi koli",
    "kairak",
    "kalabari",
    "kalasha",
    "kalenjin",
    "kalkoti",
    "kamba",
    "kamo",
    "kanauji",
    "kanembu",
    "kannada",
    "karekare",
    "kashmiri",
    "kathoriya tharu",
    "kati",
    "kazakh",
    "keiyo",
    "khams tibetan",
    "khana",
    "khetrani",
    "khmer",
    "khowar",
    "kinga",
    "kinnauri",
    "kinyarwanda",
    "kirghiz",
    "kirya-konzəl",
    "kochila tharu",
    "kohistani shina",
    "kohumono",
    "kok borok",
    "kol (papua new guinea)",
    "kom (cameroon)",
    "koma",
    "konkani",
    "konzo",
    "korean",
    "korwa",
    "kota (india)",
    "koti",
    "kuanua",
    "kuanyama",
    "kui (india)",
    "kulung (nigeria)",
    "kuot",
    "kushi",
    "kwambi",
    "kwasio",
    "lala-roba",
    "lamang",
    "lao",
    "larike-wakasihu",
    "lasi",
    "latgalian",
    "latvian",
    "levantine arabic",
    "liana-seti",
    "liberia kpelle",
    "liberian english",
    "libyan arabic",
    "ligurian",
    "lijili",
    "lingala",
    "lithuanian",
    "loarki",
    "logooli",
    "logudorese sardinian",
    "loja highland quichua",
    "loloda",
    "longuda",
    "loxicha zapotec",
    "luba-lulua",
    "luo",
    "lushai",
    "luxembourgish",
    "maasina fulfulde",
    "maba (chad)",
    "macedo-romanian",
    "macedonian",
    "mada (cameroon)",
    "mafa",
    "maithili",
    "malay",
    "malayalam",
    "mali",
    "malinaltepec me'phaa",
    "maltese",
    "mandara",
    "mandjak",
    "manggarai",
    "manipuri",
    "mansoanka",
    "manx",
    "maori",
    "marathi",
    "marghi central",
    "marghi south",
    "maria (india)",
    "marwari (pakistan)",
    "masana",
    "masikoro malagasy",
    "matsés",
    "mazaltepec zapotec",
    "mazatlán mazatec",
    "mazatlán mixe",
    "mbe",
    "mbo (cameroon)",
    "mbum",
    "medumba",
    "mekeo",
    "meru",
    "mesopotamian arabic",
    "mewari",
    "min nan chinese",
    "mingrelian",
    "mitlatongo mixtec",
    "miya",
    "mokpwe",
    "moksha",
    "mom jango",
    "mongolian",
    "moroccan arabic",
    "motu",
    "mpiemo",
    "mpumpong",
    "mundang",
    "mungaka",
    "musey",
    "musgu",
    "musi",
    "naba",
    "najdi arabic",
    "nalik",
    "nawdm",
    "ndonga",
    "neapolitan",
    "nepali",
    "ngamo",
    "ngas",
    "ngiemboon",
    "ngizim",
    "ngomba",
    "ngombale",
    "nigerian fulfulde",
    "nigerian pidgin",
    "nimadi",
    "nobiin",
    "north mesopotamian arabic",
    "north moluccan malay",
    "northern betsimisaraka malagasy",
    "northern hindko",
    "northern kurdish",
    "northern pame",
    "northern pashto",
    "northern uzbek",
    "northwest gbaya",
    "norwegian",
    "norwegian bokmål",
    "norwegian nynorsk",
    "notsi",
    "nyankpa",
    "nyungwe",
    "nzanyi",
    "nüpode huitoto",
    "occitan",
    "od",
    "odia",
    "odual",
    "omani arabic",
    "orizaba nahuatl",
    "orma",
    "ormuri",
    "oromo",
    "pahari-potwari",
    "paiwan",
    "panjabi",
    "papuan malay",
    "parkari koli",
    "pedi",
    "pero",
    "persian",
    "petats",
    "phalura",
    "piemontese",
    "piya-kwonci",
    "plateau malagasy",
    "polish",
    "poqomam",
    "portuguese",
    "pulaar",
    "pular",
    "puno quechua",
    "pushto",
    "pökoot",
    "qaqet",
    "quiotepec chinantec",
    "rana tharu",
    "rangi",
    "rapoisi",
    "ratahan",
    "rayón zoque",
    "romanian",
    "romansh",
    "rombo",
    "rotokas",
    "rukai",
    "russian",
    "sacapulteco",
    "saidi arabic",
    "sakalava malagasy",
    "sakizaya",
    "saleman",
    "samba daka",
    "samba leko",
    "san felipe otlaltepec popoloca",
    "san francisco del mar huave",
    "san juan atzingo popoloca",
    "san martín itunyoso triqui",
    "san miguel el grande mixtec",
    "sansi",
    "sanskrit",
    "santa ana de tusi pasco quechua",
    "santa catarina albarradas zapotec",
    "santali",
    "santiago del estero quichua",
    "saposa",
    "saraiki",
    "sardinian",
    "saya",
    "sediq",
    "serbian",
    "seri",
    "shina",
    "shona",
    "siar-lak",
    "sibe",
    "sicilian",
    "sihuas ancash quechua",
    "sikkimese",
    "sinaugoro",
    "sindhi",
    "sindhi bhil",
    "sinhala",
    "sinicahua mixtec",
    "sipacapense",
    "siwai",
    "slovak",
    "slovenian",
    "solos",
    "somali",
    "soninke",
    "south giziga",
    "south ucayali ashéninka",
    "southeastern nochixtlán mixtec",
    "southern betsimisaraka malagasy",
    "southern pashto",
    "southern pastaza quechua",
    "soyaltepec mazatec",
    "spanish",
    "standard arabic",
    "standard moroccan tamazight",
    "sudanese arabic",
    "sulka",
    "svan",
    "swahili",
    "swedish",
    "tae'",
    "tahaggart tamahaq",
    "taita",
    "tajik",
    "tamil",
    "tandroy-mahafaly malagasy",
    "tangale",
    "tanosy malagasy",
    "tarok",
    "tatar",
    "tedaga",
    "telugu",
    "tem",
    "teop",
    "tepeuxila cuicatec",
    "tepinapa chinantec",
    "tera",
    "terei",
    "termanu",
    "tesaka malagasy",
    "tetelcingo nahuatl",
    "teutila cuicatec",
    "thai",
    "tibetan",
    "tidaá mixtec",
    "tidore",
    "tigak",
    "tigre",
    "tigrinya",
    "tilquiapan zapotec",
    "tinputz",
    "tlacoapa me'phaa",
    "tlacoatzintepec chinantec",
    "tlingit",
    "toki pona",
    "tomoip",
    "tondano",
    "tonsea",
    "tooro",
    "torau",
    "torwali",
    "tsimihety malagasy",
    "tsotso",
    "tswana",
    "tugen",
    "tuki",
    "tula",
    "tulu",
    "tunen",
    "tungag",
    "tunisian arabic",
    "tupuri",
    "turkana",
    "turkish",
    "turkmen",
    "tututepec mixtec",
    "twi",
    "ubaghara",
    "uighur",
    "ukrainian",
    "umbundu",
    "upper sorbian",
    "urdu",
    "ushojo",
    "uzbek",
    "vai",
    "vietnamese",
    "votic",
    "võro",
    "waci gbe",
    "wadiyara koli",
    "waja",
    "wakhi",
    "wanga",
    "wapan",
    "warji",
    "welsh",
    "wemale",
    "western frisian",
    "western highland purepecha",
    "western juxtlahuaca mixtec",
    "western maninkakan",
    "western mari",
    "western niger fulfulde",
    "western panjabi",
    "wolof",
    "wuzlam",
    "xanaguía zapotec",
    "xhosa",
    "yace",
    "yakut",
    "yalahatan",
    "yanahuanca pasco quechua",
    "yangben",
    "yaqui",
    "yauyos quechua",
    "yekhee",
    "yiddish",
    "yidgha",
    "yoruba",
    "yutanduchi mixtec",
    "zacatlán-ahuacatlán-tepetzintla nahuatl",
    "zarma",
    "zaza",
    "zulu",
    "ömie"
  ]
}
''')
