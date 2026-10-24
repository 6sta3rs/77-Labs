"""App-owned model storage and supervised, explicit Hugging Face installs.

The inference process stays offline. Only the download child has network access;
it uses reviewed upstream revisions and the private cache selected by the user.
Never edits a completed blob (the initial cache may contain immutable hardlinks).
"""
from __future__ import annotations

from pathlib import Path as _SourcePath
import sys as _source_sys
_source_layout = _SourcePath(__file__).resolve().parent.parent
if (_source_layout / "app/launcher.py").is_file() and (_source_layout / "install/bootstrap.py").is_file():
    for _source_dir in ("app", "install"):
        _source_sys.path.insert(0, str(_source_layout / _source_dir))


import argparse
import asyncio
from contextlib import asynccontextmanager
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
from typing import Callable


ACTIVE_STATES = {"starting", "planning", "downloading", "verifying", "cancelling"}
MARKER = ".seventy-seven-model-cache.json"
PREFIX = "NEXT_MODEL_EVENT "
_manager = None


def _read_json(path: Path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return fallback


def _atomic_json(path: Path, value):
    _atomic_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def _atomic_text(path: Path, body: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(body)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def selected_model_cache(runtime: Path, data: Path | None = None) -> Path:
    """Read exactly the private setting that upstream main.py loads at startup."""
    data = data or runtime.parent / "data"
    try:
        lines = (data / "environment").read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        lines = []
    for line in lines:
        if line.startswith("OMNIVOICE_CACHE_DIR="):
            raw = line.partition("=")[2].strip()
            if raw:
                return Path(raw).expanduser().resolve()
    manifest = _read_json(runtime / "model-cache.json", {})
    return Path(manifest["path"]).resolve() if manifest.get("path") else (runtime.parent / "models").resolve()


def _is_reparse(path: Path) -> bool:
    info = path.lstat()
    return path.is_symlink() or bool(getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 1024))


def _no_link_ancestors(path: Path):
    for current in (path, *path.parents):
        if current.exists() and _is_reparse(current):
            raise ValueError("Katalog modeli nie może prowadzić przez dowiązanie ani punkt połączenia.")


def _repo_name(repo_id: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*", repo_id) or ".." in repo_id:
        raise ValueError("Nieprawidłowy identyfikator modelu.")
    return "models--" + repo_id.replace("/", "--")


def _spawn_model_worker(command, **options):
    # Upstream's retained owner starts a Windows child suspended, places it
    # in a private kill-on-close Job, and only then resumes it. This includes
    # the venv redirector and the actual Python worker without a spawn race.
    # The same API owns an independently cancellable process group on POSIX.
    from core.contained_subprocess import spawn_owned
    return spawn_owned(command, **options)


_COMPLETENESS_SOURCE_SHA256 = "c9cc8da431abe73c3705f1f1d429994c81f70c2e0706465a4b77dcb0a04ba5cf"
_COMPLETENESS_DOWNLOAD_SHA256 = "4a46197a69e8f548f08c9cd58f7138a4072bcb46a3c1ed1b2a8ff51a0cf9bf2d"
# These are auxiliary tensors, not the principal weights. Minimum byte sizes
# are bound to the exact public snapshots; other repos/revisions keep stock's
# 5 MiB weight floors. This is completeness, not an authenticity/inference test.
_SMALL_TENSOR_RULES = {
    "ResembleAI/chatterbox": {
        "revision": "5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18",
        "required": frozenset({"ve.pt", "s3gen.pt", "t3_mtl23ls_v3.safetensors", "grapheme_mtl_merged_expanded_v1.json", "conds.pt", "Cangjie5_TC.json"}),
        "minimums": {"conds.pt": 107374},
    },
    "hexgrad/Kokoro-82M": {
        "revision": "f3ff3571791e39611d31c381e3a41a3af07b4987",
        "required": frozenset({"config.json", "kokoro-v1_0.pth", "voices/af_heart.pt", "voices/ef_dora.pt", "voices/ff_siwis.pt", "voices/hf_alpha.pt", "voices/if_sara.pt", "voices/pf_dora.pt"}),
        "minimums": {"voices/af_heart.pt": 523425, "voices/ef_dora.pt": 523420, "voices/ff_siwis.pt": 523425,
                     "voices/hf_alpha.pt": 523425, "voices/if_sara.pt": 523425, "voices/pf_dora.pt": 523425},
    },
}


def _bind_stock_completeness_alias(models, original, adapted):
    # setup.__init__ may already have imported download's from-import alias.
    # Bind that single pinned alias too; never import a downloader just for this.
    download = sys.modules.get("api.routers.setup.download")
    if download is None or vars(download).get("snapshot_is_complete") is adapted:
        return
    try:
        path = Path(download.__file__).resolve(strict=True)
        if (vars(download).get("snapshot_is_complete") is not original
                or path != Path(models.__file__).resolve().with_name("download.py")
                or path.stat().st_size > 2 * 1024 * 1024
                or hashlib.sha256(path.read_bytes()).hexdigest() != _COMPLETENESS_DOWNLOAD_SHA256):
            raise ValueError("unsupported downloader alias")
    except (AttributeError, OSError, TypeError, ValueError) as exc:
        raise RuntimeError("Nieobsługiwany kontrakt weryfikacji pobierania modeli. Zaktualizuj aplikację i silnik.") from exc
    download.snapshot_is_complete = adapted


def configure_model_completeness(models):
    """Adapt the pinned stock validator in this process only, after its import.

    register_catalog calls this in both the inference parent and the isolated
    download child, before either imports/uses snapshot_is_complete. No source
    file, cache blob, shared library or model is ever written by this adapter.
    """
    from types import ModuleType
    original = vars(models).get("snapshot_is_complete")
    # Some isolated clients supply only a declaration namespace, not an
    # imported stock module. Leave those untouched; a real module without a
    # verifiable source still fails closed below.
    if not isinstance(models, ModuleType):
        return original
    if getattr(original, "_next_small_tensor_source", None) == _COMPLETENESS_SOURCE_SHA256:
        _bind_stock_completeness_alias(models, original.__wrapped__, original)
        return original
    try:
        source = Path(models.__file__).resolve(strict=True)
        code = original.__code__
        if not callable(original) or original.__name__ != "snapshot_is_complete" or code.co_firstlineno != 336 or Path(code.co_filename).resolve() != source or source.stat().st_size > 1024 * 1024 or hashlib.sha256(source.read_bytes()).hexdigest() != _COMPLETENESS_SOURCE_SHA256:
            raise ValueError("unsupported validator")
    except (AttributeError, OSError, TypeError, ValueError) as exc:
        raise RuntimeError("Nieobsługiwany kontrakt kompletności modeli. Zaktualizuj aplikację i silnik.") from exc

    def snapshot_is_complete(model, snapshot_path):
        rule = _SMALL_TENSOR_RULES.get(model.get("repo_id"))
        required = model.get("required_files")
        if (rule is None or model.get("revision") != rule["revision"] or model.get("config_only")
                or not isinstance(required, (list, tuple)) or not all(isinstance(name, str) for name in required)
                or not rule["required"].issubset(required)):
            return original(model, snapshot_path)
        try:
            folder = Path(snapshot_path)
            if folder.name != rule["revision"]:
                return original(model, snapshot_path)
            for name, minimum in rule["minimums"].items():
                path = folder / name
                if not path.is_file() or path.stat().st_size < minimum:
                    return False
        except (OSError, TypeError, ValueError):
            return False
        # Delegate all principal weights, metadata and any new/unknown required
        # file to the unmodified stock algorithm. Never lower its global floor.
        checked = {**model, "required_files": [name for name in required if name not in rule["minimums"]]}
        return original(checked, snapshot_path)

    snapshot_is_complete.__wrapped__ = original
    snapshot_is_complete._next_small_tensor_source = _COMPLETENESS_SOURCE_SHA256
    _bind_stock_completeness_alias(models, original, snapshot_is_complete)
    models.snapshot_is_complete = snapshot_is_complete
    invalidate = vars(models).get("invalidate_cache")
    if callable(invalidate): invalidate()
    return snapshot_is_complete


class ModelManager:
    def __init__(self, runtime: Path, data: Path, *, catalog=None, process_factory=None, work_busy: Callable[[], bool] | None = None, engine_path: Path | None = None):
        self.runtime, self.data = runtime.resolve(), data.resolve()
        self.engine = (engine_path or self.runtime / "engine").resolve()
        self.effective = Path(os.environ.get("HF_HUB_CACHE") or selected_model_cache(runtime, data)).resolve()
        self.catalog = catalog
        self.process_factory = process_factory or _spawn_model_worker
        self.work_busy = work_busy
        self.lock = threading.RLock()
        self.processes: dict[str, subprocess.Popen] = {}
        self._done_events: dict[int, threading.Event] = {}
        self._stopping: set[int] = set()
        self.jobs_path = data / "model-downloads.json"
        try:
            self.jobs: dict[str, dict] = _read_json(self.jobs_path, {})
        except ValueError as error:  # JSONDecodeError/UnicodeDecodeError, e.g. after power loss
            # Keep the damaged file for inspection instead of blocking engine start.
            try:
                self.jobs_path.replace(self.jobs_path.with_name(f"{self.jobs_path.name}.corrupt-{time.strftime('%Y%m%dT%H%M%S')}"))
            except OSError:
                pass
            logging.getLogger(__name__).warning("Uszkodzony plik stanu %s (%s); użyto wartości domyślnych.", self.jobs_path, error)
            self.jobs = {}
        self.last_write = 0.0
        for job in self.jobs.values():
            if job.get("state") in ACTIVE_STATES:
                job.update(state="interrupted", error="Pobieranie przerwano przy zamknięciu silnika. Wybierz Wznów, aby dokończyć brakujące pliki.", updated_at=time.time())
        if self.jobs:
            self._persist()

    def specs(self):
        if self.catalog is not None:
            return self.catalog
        from api.routers.setup.models import KNOWN_MODELS
        return KNOWN_MODELS

    def spec(self, repo_id):
        _repo_name(repo_id)
        item = next((model for model in self.specs() if model["repo_id"] == repo_id), None)
        if item is None:
            raise ValueError("Model nie należy do sprawdzonego katalogu tej aplikacji.")
        return item

    def _persist(self):
        _atomic_json(self.jobs_path, self.jobs)
        self.last_write = time.monotonic()

    def _update(self, repo_id: str, values: dict, *, force=False):
        with self.lock:
            self.jobs[repo_id].update(values, updated_at=time.time())
            if force or time.monotonic() - self.last_write > 1:
                self._persist()

    def busy(self):
        with self.lock:
            return bool(self.processes)

    def storage(self):
        selected = selected_model_cache(self.runtime, self.data)
        return {"configured": str(selected), "effective": str(self.effective),
                "restart_required": selected != self.effective, "inference_offline": True,
                "active_downloads": len(self.processes)}

    def _validate_storage(self, raw: str) -> Path:
        if not raw.strip() or any(ord(ch) < 32 for ch in raw) or re.search(r"\s#", raw):
            raise ValueError("Podaj pełną ścieżkę katalogu bez znaków sterujących i sekwencji spacja + #.")
        candidate = Path(raw.strip()).expanduser()
        if not candidate.is_absolute():
            raise ValueError("Podaj pełną, bezwzględną ścieżkę katalogu.")
        _no_link_ancestors(candidate)
        path = candidate.resolve()
        manifest = _read_json(self.runtime / "model-cache.json", {})
        forbidden = [self.runtime, self.data]
        if manifest.get("source"):
            forbidden.append(Path(manifest["source"]).resolve())
        for key in ("APPDATA", "LOCALAPPDATA"):
            if os.environ.get(key):
                forbidden.append((Path(os.environ[key]) / "OmniVoice").resolve())
        if any(path == item or path.is_relative_to(item) or item.is_relative_to(path) for item in forbidden):
            raise ValueError("Wybierz osobny katalog modeli poza silnikiem, danymi i starą instalacją VoiceStudio.")
        current = selected_model_cache(self.runtime, self.data)
        own = path == current or path == self.effective or bool(manifest.get("path") and path == Path(manifest["path"]).resolve())
        if path.exists() and not path.is_dir():
            raise ValueError("Ta ścieżka wskazuje plik, a nie katalog.")
        if path.exists() and not own and not (path / MARKER).is_file() and any(path.iterdir()):
            raise ValueError("Wybierz pusty katalog albo katalog modeli utworzony przez Seventy Seven Labs. Istniejące dane nie zostaną przeniesione.")
        path.mkdir(parents=True, exist_ok=True)
        handle, probe = tempfile.mkstemp(prefix=".seventy-seven-write-", dir=path)
        os.close(handle)
        Path(probe).unlink()
        return path

    def set_storage(self, raw):
        with self.lock:
            if self.busy():
                raise ValueError("Zakończ lub anuluj pobieranie przed zmianą katalogu.")
            path = self._validate_storage(raw)
            _atomic_json(path / MARKER, {"owner": "Seventy Seven Labs", "version": 1})
            from private_environment import update_private_environment
            update_private_environment(self.data, {"OMNIVOICE_CACHE_DIR": str(path)}, allowed_keys={"OMNIVOICE_CACHE_DIR"})
            return self.storage()

    def status(self):
        with self.lock:
            return {"jobs": [dict(job) for job in self.jobs.values()], "storage": self.storage()}

    def install(self, repo_id):
        spec = self.spec(repo_id)
        from api.routers.setup.models import _model_supported, disk_space_error
        if not _model_supported(spec):
            raise ValueError("Ten model nie obsługuje bieżącego systemu lub urządzenia.")
        from core.engine_licenses import LICENSE_GATED_ENGINES
        from services import settings_store
        for engine in set(spec.get("engines") or []) & LICENSE_GATED_ENGINES:
            if not settings_store.get_license_accepted(engine):
                raise ValueError("Najpierw przeczytaj i zaakceptuj licencję tego silnika.")
        with self.lock:
            if self.storage()["restart_required"]:
                raise ValueError("Uruchom ponownie silnik, aby zastosować nowy katalog modeli.")
            if self.busy():
                raise ValueError("Pobierany jest już model. Poczekaj lub anuluj bieżące pobieranie.")
            self._validate_storage(str(self.effective))
            error = disk_space_error(int(float(spec.get("size_gb") or 0) * 1024 ** 3), cache_dir=str(self.effective))
            if error:
                raise ValueError("Za mało miejsca na dysku. Zwolnij miejsce lub wybierz większy dysk. " + error)
            self.jobs[repo_id] = {"repo_id": repo_id, "state": "starting", "downloaded_bytes": 0, "total_bytes": None,
                                  "cache_dir": str(self.effective), "error": "", "updated_at": time.time()}
            self._persist()
            environment = dict(os.environ)
            environment.update(HF_HUB_OFFLINE="0", TRANSFORMERS_OFFLINE="0", HF_HUB_DISABLE_XET="1",
                               HF_HOME=str(self.effective), HF_HUB_CACHE=str(self.effective), HF_HUB_DISABLE_IMPLICIT_TOKEN="1",
                               OMNIVOICE_DATA_DIR=str(self.data), OMNIVOICE_ENV_FILE=str(self.data / "environment"),
                               PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
            try:
                process = self.process_factory([sys.executable, str(Path(__file__).resolve()), "--download", repo_id,
                                                "--engine", str(self.engine), "--cache", str(self.effective)],
                                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                               env=environment, text=True, encoding="utf-8", errors="replace", bufsize=1)
            except Exception as exc:
                self._update(repo_id, {"state": "failed", "error": f"Nie można uruchomić pobierania: {exc}"}, force=True)
                raise ValueError(self.jobs[repo_id]["error"]) from exc
            self.processes[repo_id] = process
            self._done_events[id(process)] = threading.Event()
            threading.Thread(target=self._watch, args=(repo_id, process), daemon=True).start()
            return dict(self.jobs[repo_id])

    def _watch(self, repo_id, process):
        failure = "Pobieranie nie zostało ukończone. Sprawdź połączenie, miejsce na dysku i dostęp do modelu."
        succeeded = False
        leftover = False
        code = None
        try:
            for line in process.stdout:
                if not line.startswith(PREFIX):
                    continue
                event = json.loads(line[len(PREFIX):])
                if event.get("state") == "complete":
                    succeeded = True
                    # Waiting through the retained owner also drains helpers
                    # that inherited stdout, so EOF cannot be held by a child
                    # after the successful direct process has exited.
                    # The child verified the snapshot before reporting complete, so a
                    # helper that outlives the wait is killed below, not a failure.
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        leftover = True
                    continue
                if event.get("error"):
                    failure = str(event["error"])[:800]
                with self.lock:
                    if self.jobs[repo_id]["state"] != "cancelling":
                        values = {key: value for key, value in event.items() if key in {"state", "downloaded_bytes", "total_bytes", "filename", "error"}}
                        if values.get("state") not in ACTIVE_STATES:
                            values.pop("state", None)
                        self._update(repo_id, values)
            code = process.wait(timeout=5)
        except subprocess.TimeoutExpired as exc:
            if not succeeded:
                failure = f"Nie można odczytać postępu pobierania: {exc}"
        except Exception as exc:
            failure = f"Nie można odczytać postępu pobierania: {exc}"
        finally:
            self._close_stdin(process)
            if code is None:
                try:
                    process.kill()
                    code = process.wait(timeout=5)
                except (OSError, subprocess.TimeoutExpired) as exc:
                    # Keep ownership/busy evidence if termination could not be
                    # confirmed; never advertise cancellation while work lives.
                    self._update(repo_id, {"state": "cancelling", "error": f"Nie potwierdzono zatrzymania pobierania: {exc}"}, force=True)
                    return
            if process.stdout:
                process.stdout.close()
            try:
                from api.routers.setup.models import invalidate_cache
                invalidate_cache()
            except ImportError:
                pass
            with self.lock:
                cancelled = self.jobs[repo_id]["state"] == "cancelling"
                state = "cancelled" if cancelled else "complete" if succeeded and (code == 0 or leftover) else "failed"
                self._update(repo_id, {"state": state, "error": "" if state in {"complete", "cancelled"} else failure}, force=True)
                self.processes.pop(repo_id, None)
                self._stopping.discard(id(process))
                completed = self._done_events.pop(id(process))
                completed.set()

    @staticmethod
    def _close_stdin(process):
        if process.stdin:
            try:
                process.stdin.close()
            except (OSError, ValueError):
                pass

    def _cancel_and_wait(self, repo_id, process, completed):
        # EOF reaches the actual worker even when Popen owns a Windows venv
        # redirector. Do not terminate that redirector before giving the worker
        # watchdog its opportunity to exit.
        if completed.wait(timeout=2):
            return
        try:
            process.terminate()  # retained Job/process-group, never a discovered PID
            process.wait(timeout=5)
            if completed.wait(timeout=2):
                return
            process.kill()
            process.wait(timeout=5)
            if completed.wait(timeout=2):
                return
            raise TimeoutError("proces nie zwolnił strumienia postępu")
        except (OSError, subprocess.TimeoutExpired, TimeoutError) as exc:
            with self.lock:
                if self.processes.get(repo_id) is process:
                    self._update(repo_id, {"state": "cancelling", "error": f"Nie potwierdzono zatrzymania pobierania: {exc}"}, force=True)

    def cancel(self, repo_id):
        with self.lock:
            process = self.processes.get(repo_id)
            if process is None:
                return {"cancelled": False, "repo_id": repo_id}
            if id(process) in self._stopping:
                return {"cancelled": True, "repo_id": repo_id}
            self._update(repo_id, {"state": "cancelling"}, force=True)
            self._stopping.add(id(process))
            self._close_stdin(process)
            completed = self._done_events[id(process)]
            threading.Thread(target=self._cancel_and_wait, args=(repo_id, process, completed), daemon=True).start()
        return {"cancelled": True, "repo_id": repo_id}

    def close(self):
        with self.lock:
            processes = [(repo_id, process, self._done_events[id(process)]) for repo_id, process in self.processes.items()]
        for repo_id, process, completed in processes:
            self.cancel(repo_id)
            if not completed.wait(timeout=12):
                process.kill()
                process.wait(timeout=3)
                if not completed.wait(timeout=2):
                    raise RuntimeError("Nie potwierdzono zamknięcia prywatnego pobierania modeli.")

    def delete(self, repo_id, confirmation):
        self.spec(repo_id)
        if confirmation != repo_id:
            raise ValueError("Wpisz pełny identyfikator modelu, aby potwierdzić usunięcie.")
        with self.lock:
            if self.busy():
                raise ValueError("Zakończ pobieranie przed usuwaniem modelu.")
            if self.work_busy and self.work_busy():
                raise ValueError("Silnik jest zajęty. Poczekaj na zakończenie pracy i spróbuj ponownie.")
            # Memory-mapped weights and sidecar caches may remain resident
            # after a render. A fresh engine session is the safe delete window.
            model_manager = sys.modules.get("services.model_manager")
            if model_manager is not None:
                status = model_manager.get_model_status()
                if status.get("loaded") or status.get("loading"):
                    raise ValueError("Model jest wczytany do pamięci. Zatrzymaj i uruchom ponownie silnik przed usunięciem wag.")
            self._validate_storage(str(self.effective))
            target = self.effective / _repo_name(repo_id)
            if not target.exists():
                raise ValueError("Modelu nie ma w bieżącym katalogu.")
            _no_link_ancestors(target)
            if target.resolve().parent != self.effective:
                raise ValueError("Ścieżka modelu wykracza poza prywatny cache.")
            for directory, dirs, _files in os.walk(target, followlinks=False):
                for name in dirs:
                    if _is_reparse(Path(directory) / name):
                        raise ValueError("Model zawiera dowiązanie katalogu. Nie usunięto żadnych plików.")
            # rmtree unlinks file symlinks and hardlinks; it never changes the
            # physical bytes referenced by another app's immutable hardlink.
            failures = []
            shutil.rmtree(target, onexc=lambda _function, path, error: failures.append((path, error)))
            # A stale "complete" job would keep advertising the removed (or half-removed) model.
            if self.jobs.pop(repo_id, None) is not None:
                self._persist()
            from api.routers.setup.models import invalidate_cache
            invalidate_cache()
            if failures:
                raise ValueError(f"Nie udało się usunąć {len(failures)} plików modelu (np. {Path(failures[0][0]).name}: {failures[0][1]}). Zamknij programy używające tych plików i spróbuj ponownie; model jest niekompletny.")
            return {"deleted": True, "repo_id": repo_id}


def busy():
    return bool(_manager and _manager.busy())


_ONBOARDING_SOURCE = "VoiceStudio 0.5.7 / 7a6c8980bb9c04db145357a8190a37a0e9f462da / stock model-licence registry"
_ONBOARDING_PROOF = {
    "backend/config/model_licenses.json": "6ca94c00ef1a62130ad0e236cc5b2ed7c53caaed218e0cc9589b784ec4c853e6",
    "backend/services/model_acceptance.py": "edc681624b61430c5e25f1787b48191f044310c976d0b52a76274c02076ae9fe",
    "backend/services/model_licenses.py": "027c27c14a022a7021707ba9d00093f3d27aa15d1b50b7eacb0e2ea1fc472491",
}


class OnboardingPlanError(RuntimeError):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code = status, code


def onboarding_plan(app, engine_path: Path) -> dict:
    """Read the selected TTS's proven licence gate, without backend resolution.

    No install/cache/hardware probe, constructor, network or acceptance write.
    Unknown model closures are explicit errors, never an empty success plan.
    """
    engine = Path(engine_path).resolve()
    try:
        for relative, expected in _ONBOARDING_PROOF.items():
            path = engine / relative
            if not path.is_file():
                raise OnboardingPlanError(501, "onboarding_unsupported", "Ten silnik nie udostępnia obsługi warunków modeli VoiceStudio 0.5.7. Zaktualizuj prywatny silnik.")
            _no_link_ancestors(path)
            if path.stat().st_size > 2 * 1024 * 1024 or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                raise OnboardingPlanError(501, "onboarding_unsupported", "Źródła rejestru warunków nie odpowiadają obsługiwanej wersji 0.5.7. Zaktualizuj aplikację i silnik.")
    except (OSError, ValueError) as exc:
        raise OnboardingPlanError(503, "onboarding_registry_unavailable", "Nie można bezpiecznie odczytać rejestru warunków. Żadna decyzja nie została zmieniona.") from exc
    catalogue = getattr(app, "_next_engine_catalogue_metadata", None)
    if catalogue is None or not callable(getattr(catalogue, "selected_tts_payload", None)):
        raise OnboardingPlanError(503, "onboarding_not_ready", "Lekki katalog aktywnego silnika nie jest jeszcze gotowy. Poczekaj na uruchomienie silnika i ponów odczyt.")
    try:
        if Path(catalogue.engine).resolve() != engine:
            raise ValueError("different engine generation")
        selection = catalogue.selected_tts_payload()
    except Exception as exc:
        raise OnboardingPlanError(503, "onboarding_selection_unavailable", "Nie odczytano ustawień aktywnego TTS. Ponów odczyt po przygotowaniu prywatnego silnika.") from exc
    if not isinstance(selection, dict) or selection.get("selection_check") != "configured" or not isinstance(selection.get("active"), str) or not selection["active"]:
        raise OnboardingPlanError(503, "onboarding_selection_unresolved", "Nie ustalono aktywnego silnika TTS. Wybierz silnik przed przeglądem jego warunków.")
    engine_id, model_id = selection["active"], selection.get("active_model")
    # OmniVoice's manager has a second, unconditional gate for BOTH registry
    # rows. Passing identity here would incorrectly drop its audio tokenizer.
    # The isolated engine reuses that same checkpoint/tokenizer load path.
    if engine_id in {"omnivoice", "omnivoice-subprocess"}:
        if model_id != "k2-fsa/OmniVoice":
            raise OnboardingPlanError(503, "onboarding_model_unresolved", "Nie potwierdzono kompletu składników wybranego checkpointu OmniVoice. Odczytaj jego warunki w katalogu modeli.")
        gate_engine, identity = "omnivoice", None
        required_repos = {"k2-fsa/OmniVoice", "eustlb/higgs-audio-v2-tokenizer"}
    elif engine_id == "mlx-audio" and isinstance(model_id, str) and re.fullmatch(r"[A-Za-z0-9][\w.-]*/[\w.-]+", model_id):
        gate_engine, identity, required_repos = engine_id, model_id, {model_id}
    else:
        raise OnboardingPlanError(503, "onboarding_model_unresolved", "Nie ustalono bezpiecznego planu składników tego TTS. Przejrzyj warunki wybranego modelu w katalogu; nie zakładamy braku wymaganych potwierdzeń.")
    try:
        from services import model_acceptance, model_licenses
        for module, relative in ((model_acceptance, "backend/services/model_acceptance.py"), (model_licenses, "backend/services/model_licenses.py")):
            if Path(module.__file__).resolve() != (engine / relative).resolve():
                raise ValueError("different licence module generation")
        registry_path = engine / "backend/config/model_licenses.json"
        if Path(model_licenses.REGISTRY_PATH).resolve() != registry_path.resolve():
            raise ValueError("different registry")
        if not all(callable(getattr(model_acceptance, name, None)) for name in ("repos_for_engine", "status", "accept", "revoke", "details")):
            raise OnboardingPlanError(501, "onboarding_unsupported", "Brak kompletnego API warunków modeli 0.5.7. Zaktualizuj prywatny silnik.")
        registry = model_licenses.load_registry(registry_path)
        known = {row["id"] for row in registry["models"] if gate_engine in (row.get("engines") or [])}
        if not required_repos <= known:
            raise ValueError("unknown selected model or missing dependency")
        repos = model_acceptance.repos_for_engine(gate_engine, identity)
        if not isinstance(repos, list) or len(repos) != len(required_repos) or set(repos) != required_repos:
            raise ValueError("incomplete gate")
        statuses = [model_acceptance.status(repo) for repo in repos]
        for repo, status in zip(repos, statuses):
            if not isinstance(status, dict) or status.get("repo_id") != repo or "license" not in status or status["license"] is not None and not isinstance(status["license"], str) or not isinstance(status.get("required"), bool) or not isinstance(status.get("accepted"), bool) or status.get("category") not in {"commercial", "conditions", "unknown", "noncommercial"} or status.get("state") not in {"not_required", "accepted", "not_accepted", "withdrawn", "terms_updated"} or not re.fullmatch(r"v2:[0-9a-f]{64}", str(status.get("fingerprint", ""))):
                raise ValueError("incomplete acceptance status")
            if status["accepted"] != (status["state"] in {"accepted", "not_required"}) or status["required"] != (status["state"] != "not_required") or status["required"] != (status["category"] != "commercial"):
                raise ValueError("inconsistent acceptance status")
    except OnboardingPlanError:
        raise
    except (ImportError, AttributeError) as exc:
        raise OnboardingPlanError(501, "onboarding_unsupported", "Ten silnik nie udostępnia kompletnego API warunków modeli 0.5.7. Zaktualizuj prywatny silnik.") from exc
    except Exception as exc:
        raise OnboardingPlanError(503, "onboarding_registry_unavailable", "Nie odczytano pełnego planu i stanu warunków modeli. Żadna decyzja nie została zmieniona; ponów odczyt.") from exc
    selected = {"id": engine_id, "model_id": model_id}
    if isinstance(selection.get("label"), str): selected["label"] = selection["label"]
    return {"schema": 1, "engine": selected, "models": statuses, "source": _ONBOARDING_SOURCE}


def create_router(runtime: Path, data: Path, *, engine_path: Path | None = None):
    global _manager
    from fastapi import APIRouter, Depends, HTTPException, Request
    from pydantic import BaseModel
    from activity import backend_work_busy
    from api.dependencies import require_admin

    # Annotated local request types are assigned below (this module uses
    # postponed annotations; FastAPI resolves public endpoint annotations).
    class StorageBody(BaseModel):
        path: str

    class ModelBody(BaseModel):
        repo_id: str
        confirmation: str = ""

    globals()["StorageBody"], globals()["ModelBody"], globals()["Request"] = StorageBody, ModelBody, Request
    manager = ModelManager(runtime, data, work_busy=backend_work_busy, engine_path=engine_path)
    _manager = manager

    @asynccontextmanager
    async def lifespan(_app):
        try:
            yield
        finally:
            await asyncio.to_thread(manager.close)

    router = APIRouter(prefix="/next/models", dependencies=[Depends(require_admin)], lifespan=lifespan)

    def call(action, *args):
        try:
            return action(*args)
        except (ValueError, OSError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/onboarding")
    def onboarding(request: Request):
        try:
            return onboarding_plan(request.app, manager.engine)
        except OnboardingPlanError as exc:
            raise HTTPException(status_code=exc.status, detail={"code": exc.code, "message": str(exc)}) from exc

    @router.get("/storage")
    def storage():
        return manager.storage()

    @router.put("/storage")
    def set_storage(body: StorageBody):
        return call(manager.set_storage, body.path)

    @router.get("/jobs")
    def jobs():
        return manager.status()

    @router.post("/install")
    def install(body: ModelBody):
        return call(manager.install, body.repo_id)

    @router.post("/cancel")
    def cancel(body: ModelBody):
        return call(manager.cancel, body.repo_id)

    @router.post("/delete")
    def delete(body: ModelBody):
        return call(manager.delete, body.repo_id, body.confirmation)

    return router


def _watch_windows_parent_pipe(handle, on_exit, *, peek=None, read_file=None, sleep=time.sleep):
    """Poll without a pending ReadFile: a blocked pipe read can deadlock DLL init.

    This worker owns stdin's only reader. ReadFile is called solely for bytes
    already reported as buffered, so neither numpy/OpenBLAS initialization nor
    normal CPython shutdown waits on a blocking stdin operation.
    """
    if peek is None or read_file is None:
        import _winapi
        peek = peek or _winapi.PeekNamedPipe
        read_file = read_file or _winapi.ReadFile
    try:
        while True:
            available, _ = peek(handle)
            if available:
                read_file(handle, available)
            else:
                sleep(0.25)
    except OSError:
        pass  # EOF/broken parent pipe is the ownership signal.
    on_exit()


def _watch_parent_pipe(on_exit):
    descriptor = sys.stdin.fileno()
    if os.name == "nt":
        import msvcrt
        return _watch_windows_parent_pipe(msvcrt.get_osfhandle(descriptor), on_exit)
    try:
        while os.read(descriptor, 1):
            pass
    except OSError:
        pass
    on_exit()


def _start_parent_watchdog(exit_code):
    # This is an operation worker, not the backend. Prevent main.py from
    # arming a second stdin watcher or clearing the backend's run sentinel.
    os.environ.pop("OMNIVOICE_DESKTOP_CONTAINED", None)
    thread = threading.Thread(target=_watch_parent_pipe, args=(lambda: os._exit(exit_code),),
                              name="next-operation-parent-watchdog", daemon=True)
    thread.start()
    return thread


def _download(repo_id: str, engine: Path, cache: Path, *, parent_watchdog=True):
    # A crashed parent closes stdin. Only this worker's callback runs.
    if parent_watchdog:
        _start_parent_watchdog(72)
    sys.path[:0] = [str(engine), str(engine / "backend")]
    # The child never loads a global dotenv or inherits a stale/default mirror.
    # Restore only the app-owned endpoint before Hub captures its constants.
    data = os.environ.get("OMNIVOICE_DATA_DIR")
    if not data:
        raise ValueError("Brak prywatnego katalogu danych procesu pobierania.")
    from core import user_env
    private_env = str(Path(data).resolve() / "environment")
    os.environ["OMNIVOICE_ENV_FILE"] = private_env
    endpoint = user_env.get_user_env("HF_ENDPOINT", path=private_env)
    if endpoint:
        os.environ["HF_ENDPOINT"] = endpoint
    else:
        os.environ.pop("HF_ENDPOINT", None)
    from services.hf_auth import CANONICAL_ENDPOINT, apply_process_token_policy, token_for_endpoint
    from services.endpoint_race import download_endpoint
    apply_process_token_policy()
    from tts_catalog import all_specs
    if repo_id in all_specs():
        from tts_extensions import register_catalog
        register_catalog()
    from huggingface_hub import snapshot_download
    if os.name == "nt":
        # Some Hub versions cache a positive symlink probe at another root,
        # then fail with WinError 1314 on the actual target volume. The owned
        # download child uses Hub's copy fallback, without requiring elevation.
        import huggingface_hub
        file_download = getattr(huggingface_hub, "file_download", None)
        if file_download is not None:
            file_download.are_symlinks_supported = lambda cache_dir=None: False
    from tqdm.auto import tqdm
    from services.hf_revisions import revision_for, remember_revision
    from api.routers.setup.models import KNOWN_MODELS, snapshot_is_complete, disk_space_error
    spec = next(model for model in KNOWN_MODELS if model["repo_id"] == repo_id)
    # Only the encrypted app token is eligible. Never discover a global CLI
    # token or inherit credentials from the original VoiceStudio installation.
    from services import settings_store
    hf_token = settings_store.get_hf_token() or False
    output_lock = threading.Lock()
    progress_lock = threading.Lock()
    byte_bars = {}
    total_bytes = None
    last_emit = 0.0

    def emit(**event):
        with output_lock:
            print(PREFIX + json.dumps(event, ensure_ascii=False), flush=True)

    class ByteProgress(tqdm):
        def __init__(self, *args, **kwargs):
            kwargs["disable"] = False
            super().__init__(*args, **kwargs)
            # Hub 1.7 reports both network transfer and reconstruction bars.
            # Summing both would double the measured bytes. Older versions
            # expose only per-file byte bars, which remain eligible here.
            self._count_bytes = self.unit == "B" and not str(self.desc).lower().startswith("reconstruct")
            if self._count_bytes:
                with progress_lock:
                    byte_bars[id(self)] = int(self.n)

        def display(self, *args, **kwargs):
            pass

        def update(self, n=1):
            result = super().update(n)
            self.report()
            return result

        def report(self, force=False):
            nonlocal last_emit
            if not getattr(self, "_count_bytes", False):
                return
            with progress_lock:
                byte_bars[id(self)] = int(getattr(self, "n", 0))
                now = time.monotonic()
                report = force or now - last_emit >= 0.25
                if report:
                    last_emit = now
                downloaded = sum(byte_bars.values())
            if report:
                emit(state="downloading", downloaded_bytes=downloaded, total_bytes=total_bytes, filename=str(self.desc or ""))

        def close(self):
            self.report(force=True)
            super().close()

    try:
        emit(state="planning", total_bytes=None)
        specs = [spec, *(spec.get("dependencies") or [])]
        plans = []
        for item in specs:
            endpoint = download_endpoint(gated=bool(item.get("gated"))) or CANONICAL_ENDPOINT
            kwargs = {"repo_id": item["repo_id"], "revision": item.get("revision") or revision_for(item["repo_id"]), "cache_dir": str(cache),
                      "endpoint": endpoint, "token": token_for_endpoint(endpoint, hf_token)}
            if item.get("allow_patterns"):
                kwargs["allow_patterns"] = item["allow_patterns"]
            try:
                plan = snapshot_download(**kwargs, dry_run=True)
                plans.extend(plan)
            except TypeError:
                # Older hub versions cannot plan bytes. Keep an indeterminate
                # bar while displaying measured transfer bytes; never fake %.
                plans = []
                break
        if plans:
            total_bytes = sum(int(getattr(file, "file_size", 0) or 0) for file in plans if getattr(file, "will_download", not getattr(file, "is_cached", False)))
            if error := disk_space_error(total_bytes, cache_dir=str(cache)):
                raise ValueError(error)
        emit(state="downloading", downloaded_bytes=0, total_bytes=total_bytes)
        for item in specs:
            revision = item.get("revision") or revision_for(item["repo_id"])
            endpoint = download_endpoint(gated=bool(item.get("gated"))) or CANONICAL_ENDPOINT
            kwargs = {"repo_id": item["repo_id"], "revision": revision, "cache_dir": str(cache),
                      "endpoint": endpoint, "token": token_for_endpoint(endpoint, hf_token),
                      "tqdm_class": ByteProgress, "max_workers": 4, "local_files_only": False}
            if item.get("allow_patterns"):
                kwargs["allow_patterns"] = item["allow_patterns"]
            snapshot = snapshot_download(**kwargs)
            emit(state="verifying", filename=item["repo_id"])
            if not snapshot_is_complete(item, snapshot):
                raise ValueError("Pobrany model jest niekompletny: brakuje wymaganych wag lub konfiguracji.")
            remember_revision(item["repo_id"], revision, str(cache))
        emit(state="complete")
        return 0
    except Exception as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        detail = ("Repozytorium wymaga zgody lub prawidłowego tokenu Hugging Face zapisanego w tej aplikacji. "
                  if status in {401, 403} else "Pobieranie nie powiodło się. ")
        explanation = str(exc).replace(hf_token, "[token]") if isinstance(hf_token, str) else str(exc)
        emit(state="failed", error=detail + explanation[:650])
        return 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--download", required=True)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    arguments = parser.parse_args()
    raise SystemExit(_download(arguments.download, arguments.engine, arguments.cache))
