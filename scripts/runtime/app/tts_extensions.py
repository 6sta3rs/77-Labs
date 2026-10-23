"""Register private TTS sidecars without modifying the bundled engine archive."""
from __future__ import annotations

from pathlib import Path as _SourcePath
import sys as _source_sys
_source_layout = _SourcePath(__file__).resolve().parent.parent
if (_source_layout / "app/launcher.py").is_file() and (_source_layout / "install/bootstrap.py").is_file():
    for _source_dir in ("app", "install"):
        _source_sys.path.insert(0, str(_source_layout / _source_dir))

import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from tts_catalog import ENGINES, LANGUAGES, LANGUAGE_CODES, MODELS, model_spec, require_snapshot, CHATTERBOX_TOKENIZER_SHA256

ROOT = Path(__file__).resolve().parent
ENV_VERSION = 1
_setup_processes = {}
_fish_probe = {}

def fish_transport_ready(config):
    import time
    import urllib.request
    cached = _fish_probe.get(config["url"])
    if cached and time.monotonic()-cached[0] < 5:
        return cached[1]
    try:
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*args,**kwargs):
                return None
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect)
        with opener.open(config["url"]+"/v1/health",timeout=.4) as response:
            ready = json.loads(response.read(4096)).get("status") == "ok"
    except (OSError, ValueError):
        ready = False
    _fish_probe[config["url"]] = (time.monotonic(),ready)
    return ready

def setup_busy():
    return any(process.poll() is None for process in list(_setup_processes.values()))

def environment_dir(engine_id, root=ROOT):
    return root / "tts-envs" / ENGINES[engine_id]["family"]

def environment_python(engine_id, root=ROOT):
    folder = environment_dir(engine_id, root)
    return folder / ("Scripts/python.exe" if os.name == "nt" else "bin/python")

def uses_legacy_kitten(engine_id, root=ROOT):
    """KittenTTS without a private environment runs on the pinned engine's built-in backend."""
    return engine_id == "kittentts" and not environment_python(engine_id, root).is_file()

def validate_fish_configuration(data):
    url = urlsplit(str(data.get("url", "")))
    # Accept only an explicit loopback service; no arbitrary reference upload.
    if url.scheme != "http" or url.hostname not in {"127.0.0.1", "::1"} or url.username or url.password or url.path not in {"", "/"} or url.query or url.fragment:
        raise ValueError("Usługa Fish musi mieć jawny adres HTTP loopback, bez ścieżki i danych logowania.")
    if data.get("repo_id") != model_spec("fish-s2-pro")["repo_id"] or data.get("revision") != model_spec("fish-s2-pro")["revision"]:
        raise ValueError("Konfiguracja usługi nie potwierdza przypiętego modelu Fish S2 Pro.")
    # This manifest is an explicit local configuration declaration, not health
    # evidence. Only a completed synthesis can prove the service's behaviour.
    return {**data, "url": data["url"].rstrip("/")}

def fish_configuration(root=ROOT):
    path = root / "fish-s2-service.json"
    if not path.is_file():
        raise RuntimeError("Skonfiguruj własną usługę Fish S2 Pro w Linux/WSL.")
    return validate_fish_configuration(json.loads(path.read_text(encoding="utf-8")))

def engine_state(engine_id, root=ROOT):
    spec = ENGINES[engine_id]
    folder = environment_dir(engine_id, root)
    python = environment_python(engine_id, root)
    manifest = folder / "environment.json"
    dependencies = False
    try:
        info = json.loads(manifest.read_text(encoding="utf-8"))
        dependencies = python.is_file() and python.stat().st_size > 0 and info.get("schema") == ENV_VERSION and info.get("family") == spec["family"] and info.get("probe") == "passed"
        if spec["family"]=="chatterbox":
            assets=folder/'assets'/'pkuseg'/'spacy_ontonotes'
            dependencies=dependencies and info.get('assets',{}).get('spacy_ontonotes')==CHATTERBOX_TOKENIZER_SHA256 and (assets/'features.msgpack').is_file() and (assets/'weights.npz').is_file()
    except (OSError, ValueError, TypeError):
        pass
    weights = False
    try:
        require_snapshot(model_spec(engine_id))
        weights = True
    except RuntimeError:
        pass
    reason = ""
    configured = True
    if spec["family"] == "fish":
        try:
            config = fish_configuration(root)
            if not fish_transport_ready(config):
                configured = False
                reason = "Brak połączenia z lokalną usługą Fish S2 Pro. Uruchom ją w Linux/WSL."
        except (OSError, ValueError, RuntimeError) as exc:
            configured = False
            reason = str(exc)
    if not reason and not dependencies:
        reason = "Przygotuj osobne środowisko tego silnika w „Modele i silnik”."
    if not reason and not weights:
        reason = "Pobierz komplet przypiętych wag w „Modele i silnik”."
    return {"id": engine_id, "dependencies_ready": bool(dependencies), "weights_ready": weights, "configured": configured, "available": bool(dependencies and weights and configured), "reason": reason}

def register_catalog():
    from api.routers.setup import models
    for spec in MODELS:
        existing = next((item for item in models.KNOWN_MODELS if item["repo_id"] == spec["repo_id"]), None)
        if existing is None:
            models.KNOWN_MODELS.append(dict(spec))
        else:
            existing.update(spec)
    models._catalog = models.ModelCatalog()
    from model_management import configure_model_completeness
    configure_model_completeness(models)

def register(root=ROOT):
    import activity
    if not getattr(activity.backend_work_busy, "_next_tts", False):
        previous_busy = activity.backend_work_busy
        def work_busy():
            return setup_busy() or previous_busy()
        work_busy._next_tts = True
        activity.backend_work_busy = work_busy
    from core import engine_licenses
    gated = {key for key, spec in ENGINES.items() if spec.get("license_required")}
    engine_licenses.LICENSE_GATED_ENGINES = frozenset(engine_licenses.LICENSE_GATED_ENGINES | gated)
    from services import tts_backend
    from services.subprocess_backend import SubprocessBackend
    legacy_kitten = tts_backend._REGISTRY["kittentts"]
    register_catalog()
    workers = root / "tts_workers"
    workers.mkdir(exist_ok=True)

    def make_class(engine_id, spec):
        class PrivateTTS(SubprocessBackend):
            id = engine_id
            display_name = model_spec(engine_id)["label"]
            supports_cloning = spec["clone"]
            supports_voice_design = bool(spec.get("design"))
            gpu_compat = ("cpu",) if engine_id in {"kokoro", "kittentts", "fish-s2-pro"} else ("cuda", "cpu")
            _DEFAULT_SAMPLE_RATE = spec["sample_rate"]
            @classmethod
            def configured_identity(cls):
                if uses_legacy_kitten(engine_id, root):
                    # Exact checkpoint expression of pinned 0.5.7's legacy
                    # KittenTTSBackend._ensure_loaded, including its env pin.
                    return os.environ.get("OMNIVOICE_KITTENTTS_MODEL", "KittenML/kitten-tts-mini-0.8")
                return model_spec(engine_id)["repo_id"]
            def __init__(self):
                super().__init__()
                # Stock's instance cache compares this with configured_identity;
                # without a snapshot every request would retire the sidecar.
                self._configured_repo = type(self).configured_identity()
            def built_identity(self):
                return self._configured_repo
            @classmethod
            def is_available(cls):
                if uses_legacy_kitten(engine_id, root):
                    return legacy_kitten.is_available()
                state = engine_state(engine_id, root)
                return state["available"], state["reason"]
            @classmethod
            def venv_python(cls):
                if not engine_state(engine_id, root)["available"]:
                    raise RuntimeError(engine_state(engine_id, root)["reason"])
                return environment_python(engine_id, root)
            @classmethod
            def sidecar_script(cls):
                return workers / f"run_{engine_id}.py"
            @property
            def sample_rate(self):
                return spec["sample_rate"]
            @property
            def supported_languages(self):
                return [LANGUAGE_CODES[name] for name in spec.get("languages", LANGUAGES.get(spec["family"], ["English"]))]
            def model_identity(self):
                return self.built_identity()
            def _validate_generate_authorization(self):
                if spec.get("license_required"):
                    from services import settings_store
                    if not settings_store.get_license_accepted(engine_id):
                        raise RuntimeError("Przeczytaj i zaakceptuj warunki modelu w „Modele i silnik”.")
            def generate(self, text, **kw):
                language = self._check_language(kw.get("language"))
                kw["language"] = language
                if uses_legacy_kitten(engine_id, root):
                    if not hasattr(self, "_legacy"):
                        self._legacy = legacy_kitten()
                    return self._legacy.generate(text, **kw)
                return super().generate(text, **kw)
            def unload(self):
                if hasattr(self, "_legacy"):
                    self._legacy.unload()
                super().unload()
            @classmethod
            def runtime_compute_profile(cls, caps):
                from services.engine_routing import resolve_routing
                compat = cls.gpu_compat
                try:
                    manifest = json.loads((environment_dir(engine_id, root)/"environment.json").read_text(encoding="utf-8"))
                    if manifest.get("device") == "cpu":
                        compat = ("cpu",)
                except (OSError, ValueError):
                    pass
                return {"gpu_compat":compat,"min_vram_gb":0,**resolve_routing(compat,caps,0)}
        return PrivateTTS

    for engine_id, spec in ENGINES.items():
        code = "import sys,os,json\nfrom pathlib import Path\nroot=Path(__file__).resolve().parents[1]\n"
        code += "sys.path=[str(root)]+[p for p in sys.path if Path(p or '.').resolve()!=Path(__file__).resolve().parent]\n"
        code += "manifest=json.loads((root/'tts-envs'/"+repr(spec['family'])+"/'environment.json').read_text(encoding='utf-8'))\nos.environ['NEXT_TTS_DEVICE']=manifest['device']\n"
        code += "os.environ['PKUSEG_HOME']=str(root/'tts-envs'/"+repr(spec['family'])+"/'assets'/'pkuseg')\n"
        code += "from tts_worker import serve\nserve(" + repr(engine_id) + ")\n"
        (workers / f"run_{engine_id}.py").write_text(code, encoding="utf-8")
        tts_backend._REGISTRY[engine_id] = make_class(engine_id, spec)

    # Attach only owned, non-secret explanations after upstream's scrubber.
    from api import public_engine_metadata as public
    original = public.public_backends
    def public_backends(rows):
        result = original(rows)
        for row in result:
            engine_id = row.get("id")
            if engine_id not in ENGINES:
                continue
            if uses_legacy_kitten(engine_id, root):
                row.update(description=ENGINES[engine_id]["description"], supported_language_names=["English"])
                continue
            spec = ENGINES[engine_id]
            state = engine_state(engine_id, root)
            row.update(installed=state["dependencies_ready"] and state["weights_ready"], reason=state["reason"] or None, description=spec["description"], supported_language_names=spec.get("languages", LANGUAGES.get(spec["family"], ["English"])))
        return result
    public.public_backends = public_backends

def create_router(root=ROOT):
    """Provision dependencies in a supervised child, never inside shared venv."""
    from fastapi import APIRouter, HTTPException, Depends
    from pydantic import BaseModel
    import threading
    import subprocess
    import asyncio
    from contextlib import asynccontextmanager
    from core.contained_subprocess import spawn_owned
    from api.dependencies import require_admin
    processes = _setup_processes
    lock = threading.Lock()
    jobs = root / "tts-setup"
    jobs.mkdir(exist_ok=True)

    def stop_process(proc):
        if proc.poll() is not None:
            return
        if proc.stdin:
            proc.stdin.close()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill();proc.wait(timeout=5)

    @asynccontextmanager
    async def lifespan(_app):
        try:
            yield
        finally:
            for proc in list(processes.values()):
                await asyncio.to_thread(stop_process,proc)
    router = APIRouter(prefix="/next/tts", dependencies=[Depends(require_admin)],lifespan=lifespan)

    class Prepare(BaseModel):
        engine_id: str
        device: str = "cpu"

    globals()["Prepare"] = Prepare
    class FishService(BaseModel):
        url: str
        confirmed_model: bool
    globals()["FishService"] = FishService

    @router.put("/fish-service")
    def configure_fish(body: FishService):
        if not body.confirmed_model:
            raise HTTPException(400, "Potwierdź model uruchomionej usługi Fish.")
        try:
            spec = model_spec("fish-s2-pro")
            config = validate_fish_configuration({"url": body.url, "repo_id":spec["repo_id"],"revision":spec["revision"]})
        except ValueError as exc:
            raise HTTPException(400,str(exc)) from exc
        temporary = root / "fish-s2-service.tmp"
        temporary.write_text(json.dumps(config),encoding="utf-8")
        temporary.replace(root/"fish-s2-service.json")
        return {"configured":True}

    @router.get("/status")
    def status():
        rows = []
        for engine_id in ENGINES:
            state = engine_state(engine_id, root)
            try:
                state["setup"] = json.loads((jobs / f"{ENGINES[engine_id]['family']}.json").read_text(encoding="utf-8"))
                process = processes.get(ENGINES[engine_id]['family'])
                if process is not None and process.poll() is not None and state["setup"].get("state") in {"creating","installing","checking"}:
                    state["setup"] = {"state":"failed","message":"Instalator zakończył pracę bez potwierdzenia. Sprawdź lokalny log i ponów przygotowanie."}
            except (OSError, ValueError):
                state["setup"] = None
            state["name"] = model_spec(engine_id)["label"]
            rows.append(state)
        return {"engines": rows}

    @router.post("/prepare")
    def prepare(body: Prepare):
        if body.engine_id not in ENGINES:
            raise HTTPException(400, "Nieznany silnik.")
        if body.device not in {"cpu", "cuda"}:
            raise HTTPException(400, "Wybierz CPU albo CUDA.")
        family = ENGINES[body.engine_id]["family"]
        with lock:
            if any(process.poll() is None for process in processes.values()):
                raise HTTPException(409, "Trwa przygotowywanie środowiska. Poczekaj na zakończenie.")
            # Use the private CPython base, not the hardlinked application's venv.
            python = root / "python" / ("python.exe" if os.name == "nt" else "bin/python3")
            if not python.is_file():
                raise HTTPException(409, "Najpierw przygotuj prywatny Python aplikacji.")
            log = open(jobs / f"{family}.log", "ab")
            from prepare_tts import write_state
            write_state(jobs / f"{family}.json", state="creating", message="Uruchamianie przygotowania bibliotek", device=body.device)
            try:
                proc = spawn_owned([str(python), str(root / "prepare_tts.py"), "--engine", body.engine_id, "--root", str(root), "--device", body.device, "--supervised"], stdin=subprocess.PIPE, stdout=log, stderr=log)
            finally:
                log.close()
            processes[family] = proc
            return {"started": True, "family": family}

    return router
