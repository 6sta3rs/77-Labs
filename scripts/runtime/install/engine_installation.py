"""Explicit, app-owned installs of the bundled, curated sidecar recipes.

Catalog inspection is AST-only and never imports engines, probes Python, or
downloads files. The stock provisioner runs only inside a supervised child Job.
Its source/venv/weights live under a fresh private attempt, and uv uses copies.
Installation stages a runtime; activation is a separate restart-only action.
"""
from __future__ import annotations

from pathlib import Path as _SourcePath
import sys as _source_sys
_source_layout = _SourcePath(__file__).resolve().parent.parent
if (_source_layout / "app/launcher.py").is_file() and (_source_layout / "install/bootstrap.py").is_file():
    for _source_dir in ("app", "install"):
        _source_sys.path.insert(0, str(_source_layout / _source_dir))


import argparse
import ast
import asyncio
from contextlib import asynccontextmanager
import hashlib
import json
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
from types import SimpleNamespace
import urllib.request
import uuid
import zipfile

from model_management import _atomic_json, _no_link_ancestors, _read_json, _spawn_model_worker
from private_environment import update_private_environment

PREFIX = "NEXT_ENGINE_EVENT "
ACTIVE = {"starting", "installing", "verifying", "cancelling"}
MARKER = ".seventy-seven-runtime-complete.json"
_manager = None
_FIELDS = {
    "engine_id", "display_name", "repo_url", "tarball_url", "checkout_dirname", "env_var", "probe_module",
    "repo_ref", "source_revision", "source_required_path", "weights_repo_id", "weights_revision", "weights_subdir",
    "weights_config_names", "docs_path", "required_bytes", "weights_bytes", "dependency_bytes", "potentially_shared_bytes",
    "temporary_free_bytes", "disk_confidence", "venv_args", "compatible_python", "install_args", "uses_cuda_index",
    "uses_rocm_index", "probe_code", "source_manifest", "has_source", "cpu_torch_index", "torch_pins", "extra_sources",
    "weights_allow_patterns", "requires_install_marker", "install_revision", "weights_catalogue_download",
}


def _sha(path: Path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _literal(node):
    """Small data grammar; never eval/exec an upstream expression."""
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name) and node.id == "_GIB":
        return 1024 ** 3
    if isinstance(node, ast.Name) and node.id == "_COSYVOICE_REQUIREMENTS":
        return "{engine}/backend/engines/cosyvoice_subprocess/requirements.txt"
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return [_literal(value) for value in node.elts]
    if isinstance(node, ast.Dict):
        return {_literal(key): _literal(value) for key, value in zip(node.keys, node.values)}
    if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Mult, ast.Pow)):
        a, b = _literal(node.left), _literal(node.right)
        return a * b if isinstance(node.op, ast.Mult) else a ** b
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "ExtraSource":
        return {**dict(zip(("path", "revision", "tarball_url", "required_path"), map(_literal, node.args))),
                **{kw.arg: _literal(kw.value) for kw in node.keywords}}
    raise ValueError("Nieobsługiwany kontrakt receptury instalacji. Zaktualizuj aplikację.")


def _assignments(tree):
    for node in tree.body:
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            yield node.target.id, node.value
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    yield target.id, node.value


def read_catalog(engine_path: Path, *, platform="windows-x64") -> list[dict]:
    """Read the selected versioned engine, not an inferred/global installation."""
    engine_path = Path(engine_path)
    source = engine_path / "backend/services/sidecar_install.py"
    tree = ast.parse(source.read_text(encoding="utf-8-sig"))
    defaults = {}
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == "SidecarSpec":
            for field in node.body:
                if isinstance(field, ast.AnnAssign) and field.target.id in _FIELDS and field.value is not None:
                    defaults[field.target.id] = _literal(field.value)
    specs = dict(_assignments(tree))["SPECS"]
    if not isinstance(specs, ast.Dict):
        raise ValueError("Brak kuratorowanego katalogu silników.")
    entries = []
    for key, call in zip(specs.keys, specs.values):
        if not isinstance(call, ast.Call) or not isinstance(call.func, ast.Name) or call.func.id != "SidecarSpec":
            raise ValueError("Nieobsługiwany wpis katalogu instalacji.")
        recipe = {**defaults, **{kw.arg: _literal(kw.value) for kw in call.keywords if kw.arg in _FIELDS}}
        engine_id = _literal(key)
        if recipe["engine_id"] != engine_id or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", engine_id):
            raise ValueError("Nieprawidłowy identyfikator kuratorowanego silnika.")
        recipe.update(kind="sidecar", installer_sha256=_sha(source),
                      completion_marker=_literal(dict(_assignments(tree))["_INSTALL_COMPLETE_MARKER"]))
        urls = [url for url in (recipe.get("repo_url"), recipe.get("tarball_url")) if url]
        urls += [item["tarball_url"] for item in recipe.get("extra_sources", [])]
        links = [{"title": "Kod i warunki projektu", "url": recipe["repo_url"].removesuffix(".git")}] if recipe["repo_url"] else []
        for arg in recipe["install_args"]:
            match = re.fullmatch(r"([A-Za-z0-9_.-]+)==([0-9][A-Za-z0-9_.-]*)", arg)
            if match:
                package_url = f"https://pypi.org/project/{match[1]}/{match[2]}/"
                urls.append(package_url)
                links.append({"title": f"Pakiet {arg}: pochodzenie i licencja", "url": package_url})
        if recipe.get("weights_repo_id"):
            weights_url = f"https://huggingface.co/{recipe['weights_repo_id']}/tree/{recipe.get('weights_revision') or 'main'}"
            urls.append(weights_url)
            links.append({"title": "Wagi i warunki modelu", "url": weights_url})
        recipe.update(source_urls=urls, license_links=links, license_required=engine_id in {"supertonic3", "pockettts"},
                      license_summary="Kod, zależności i wagi mają odrębne warunki. Sprawdź podane źródła; licencja aplikacji ich nie zastępuje.",
                      download_bytes=None, size_confidence=recipe.get("disk_confidence", "unknown"),
                      supported=not (platform.startswith("windows") and engine_id == "dots-tts"),
                      host_note="Brak instalacji dots.tts dla Windows." if platform.startswith("windows") and engine_id == "dots-tts" else
                      "Automatyczna receptura wymaga dostępnego GPU NVIDIA/CUDA." if engine_id == "moss-tts-v15" else "",
                      dependency_policy="Źródła i główne pakiety są przypięte; zależności przechodnie są rozwiązywane przez uv. To nie jest pełny plik lock.")
        entries.append(recipe)
    bootstrap = engine_path / "backend/engines/audiocpp/bootstrap.py"
    values = {name: _literal(node) for name, node in _assignments(ast.parse(bootstrap.read_text(encoding="utf-8-sig")))
              if name in {"VERSION", "GH_REPO", "_ASSETS", "_ASSET_SIZES", "DIR_ENV"}}
    asset = values["_ASSETS"].get(platform)
    entry = {"engine_id": "audio-cpp", "display_name": "audio.cpp", "kind": "native", "env_var": values["DIR_ENV"],
             "supported": asset is not None, "host_note": "" if asset else "Brak przypiętego wydania dla tego systemu.",
             "version": values["VERSION"], "required_bytes": (values["_ASSET_SIZES"].get(platform) or 0) * 4,
             "download_bytes": values["_ASSET_SIZES"].get(platform), "size_confidence": "published-archive",
             "license_required": False, "license_summary": "Warunki kodu audio.cpp i modeli GGUF są odrębne. Instalacja obejmuje program, bez wag.",
             "license_links": [{"title": "Kod i warunki audio.cpp", "url": f"https://github.com/{values['GH_REPO']}"}],
             "installer_sha256": _sha(engine_path / "backend/services/audiocpp_runtime_install.py"), "bootstrap_sha256": _sha(bootstrap),
             "dependency_policy": "Przypięte wydanie binarne; rozmiar i SHA-256 sprawdzane przed uruchomieniem testu urządzeń."}
    if asset:
        entry.update(archive_name=asset[0], archive_sha256=asset[1], source_urls=[f"https://github.com/{values['GH_REPO']}/releases/download/{values['VERSION']}/{asset[0]}"])
    else:
        entry["source_urls"] = []
    entries.append(entry)
    for recipe in entries:
        recipe["disclosure_id"] = hashlib.sha256(json.dumps(recipe, sort_keys=True).encode()).hexdigest()
    return entries


def scrub(text):
    text = str(text)
    text = re.sub(r"\bhf_[A-Za-z0-9]{8,}\b", "[token]", text)
    text = re.sub(r"(?i)(authorization|token|password|secret|api[_-]?key)(\s*[:=]\s*)([^\s,;]+)", r"\1\2[ukryto]", text)
    text = re.sub(r"(https?://)[^/@\s]+:[^/@\s]+@", r"\1[ukryto]@", text)
    for raw in (str(Path.home()), os.environ.get("USERPROFILE", "")):
        if len(raw) > 3:
            text = text.replace(raw, "[użytkownik]")
    return text[:1600]


def private_worker_environment(runtime: Path, attempt: Path, specs: list[dict]):
    env = dict(os.environ)
    for key in list(env):
        if key.startswith(("UV_", "PIP_", "HF_", "HUGGINGFACE_", "HUGGING_FACE_")) or key in {"NEXT_ENGINE_HF_TOKEN", "VIRTUAL_ENV", "PYTHONPATH", "PYTHONHOME", "OMNIVOICE_ENV_FILE", "OMNIVOICE_CACHE_DIR", "OMNIVOICE_AUDIOCPP_BIN", "OMNIVOICE_ENGINES_DIR"}:
            env.pop(key, None)
    for spec in specs:
        env.pop(spec["env_var"], None)
    cache = runtime / "sidecar-cache"
    env.update(OMNIVOICE_DATA_DIR=str(attempt / "data"), OMNIVOICE_ENV_FILE=str(attempt / "data/environment"),
               OMNIVOICE_ENGINES_DIR=str(attempt / "engines"), OMNIVOICE_CACHE_DIR=str(cache / "hf"),
               UV_CACHE_DIR=str(cache / "uv"), UV_PYTHON_INSTALL_DIR=str(cache / "python"), UV_LINK_MODE="copy",
               UV_NO_CONFIG="1", UV_PYTHON_PREFERENCE="only-managed", UV_PYTHON_DOWNLOADS="automatic",
               HF_HOME=str(cache / "hf"), HF_HUB_CACHE=str(cache / "hf/hub"), HF_TOKEN_PATH=str(cache / "no-ambient-token"),
               HF_HUB_DISABLE_IMPLICIT_TOKEN="1", HF_HUB_OFFLINE="0", TRANSFORMERS_OFFLINE="0", HF_HUB_DISABLE_XET="1",
               PYTHONNOUSERSITE="1", PYTHONUTF8="1", PYTHONIOENCODING="utf-8", GIT_CONFIG_NOSYSTEM="1",
               GIT_CONFIG_GLOBAL=os.devnull)
    return env


def _atomic_bytes(path: Path, content: bytes):
    _no_link_ancestors(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def ensure_pinned_uv(runtime: Path, manifest: Path, *, transport=None, emit=lambda **event: None):
    """Called ONLY by an explicitly requested install worker, never catalog/status."""
    pin = _read_json(Path(manifest), {}).get("uv", {})
    if not re.fullmatch(r"[a-f0-9]{64}", pin.get("sha256", "")) or not pin.get("url", "").startswith("https://github.com/astral-sh/uv/releases/download/"):
        raise ValueError("Brak poprawnego manifestu przypiętego uv.")
    runtime = Path(runtime)
    archive, executable = runtime / "downloads/uv.zip", runtime / "tools/uv.exe"
    _no_link_ancestors(archive)
    _no_link_ancestors(executable)
    if not archive.is_file():
        emit(state="installing", phase="prepare_uv", message="Pobieranie przypiętego narzędzia uv.")
        if transport is None:
            def transport(url):
                return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "SeventySevenLabs"}), timeout=30)
        archive.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix="uv.", suffix=".zip.part", dir=archive.parent)
        try:
            total = 0
            with os.fdopen(fd, "wb") as output, transport(pin["url"]) as response:
                while chunk := response.read(256 * 1024):
                    total += len(chunk)
                    if total > 100 * 1024 * 1024:
                        raise ValueError("Archiwum uv przekracza dozwolony rozmiar.")
                    output.write(chunk)
                    emit(state="installing", phase="prepare_uv", downloaded_bytes=total)
            if _sha(Path(temporary)) != pin["sha256"]:
                raise ValueError("Suma SHA-256 archiwum uv jest niezgodna z manifestem.")
            os.replace(temporary, archive)
        finally:
            Path(temporary).unlink(missing_ok=True)
    if _sha(archive) != pin["sha256"]:
        raise ValueError("Suma SHA-256 archiwum uv jest niezgodna z manifestem.")
    with zipfile.ZipFile(archive) as bundle:
        members = [member for member in bundle.infolist() if Path(member.filename.replace("\\", "/")).name.lower() == "uv.exe"]
        if len(members) != 1 or members[0].file_size > 80 * 1024 * 1024 or stat.S_ISLNK(members[0].external_attr >> 16):
            raise ValueError("Archiwum uv nie zawiera jednego poprawnego uv.exe.")
        content = bundle.read(members[0])
    if executable.exists():
        if not executable.is_file() or executable.read_bytes() != content:
            raise ValueError("Prywatny uv.exe nie odpowiada zweryfikowanemu archiwum. Napraw instalację środowiska.")
    else:
        _atomic_bytes(executable, content)
    return executable


class EngineRuntimeManager:
    def __init__(self, runtime: Path, data: Path, *, engine_path: Path, distribution_manifest: Path,
                 work_busy=None, process_factory=None, catalog=None, license_allowed=None):
        self.runtime, self.data = Path(runtime).resolve(), Path(data).resolve()
        self.engine, self.manifest = Path(engine_path).resolve(), Path(distribution_manifest).resolve()
        self.root = self.runtime / "sidecars"
        self.path = self.data / "engine-runtime-jobs.json"
        self.specs = catalog if catalog is not None else read_catalog(self.engine)
        self.work_busy = work_busy
        self.process_factory = process_factory or _spawn_model_worker
        self.license_allowed = license_allowed or self._license_allowed
        self.lock = threading.RLock()
        self.processes, self.done, self.stopping = {}, {}, set()
        self.jobs = _read_json(self.path, {})
        for job in self.jobs.values():
            if job.get("state") in ACTIVE:
                job.update(state="interrupted", error="Instalację przerwano. Możesz jawnie ponowić próbę.")
        if self.jobs:
            self._persist()

    @staticmethod
    def _license_allowed(engine_id):
        from services import settings_store
        return settings_store.get_license_accepted(engine_id)

    def _persist(self):
        _atomic_json(self.path, self.jobs)

    def _spec(self, engine_id):
        spec = next((item for item in self.specs if item["engine_id"] == engine_id), None)
        if spec is None:
            raise ValueError("Silnik nie należy do katalogu tej wersji aplikacji.")
        return spec

    def busy(self):
        with self.lock:
            return bool(self.processes)

    def catalog(self):
        return {"engines": [{**spec, "license_accepted": not spec["license_required"] or bool(self.license_allowed(spec["engine_id"]))} for spec in self.specs],
                "root": str(self.root), "copy_only": True}

    def status(self):
        with self.lock:
            jobs = json.loads(json.dumps(list(self.jobs.values())))
            for job in jobs:
                spec = next((item for item in self.specs if item["engine_id"] == job.get("engine_id")), None)
                activation = job.get("activation")
                job["effective"] = bool(spec and activation and os.environ.get(spec["env_var"]) == activation)
                job["restart_required"] = bool(activation and not job["effective"])
                job["verified"] = bool(spec and job.get("state") == "complete" and self._verified(spec, job))
            return {"jobs": jobs, "busy": self.busy()}

    def _attempt(self, spec, job):
        if not re.fullmatch(r"[a-f0-9]{32}", job.get("attempt_id", "")):
            raise ValueError("Nieprawidłowy identyfikator prywatnej instalacji.")
        path = self.root / spec["engine_id"] / job["attempt_id"]
        _no_link_ancestors(path)
        return path

    def install(self, engine_id, disclosure_id, accepted):
        spec = self._spec(engine_id)
        if not accepted or disclosure_id != spec["disclosure_id"]:
            raise ValueError("Przeczytaj aktualne źródła, warunki i zakres pobierania oraz potwierdź instalację.")
        if not spec["supported"]:
            raise ValueError(spec["host_note"] or "Ten system nie jest obsługiwany.")
        if spec["license_required"] and not self.license_allowed(engine_id):
            raise ValueError("Najpierw zaakceptuj warunki tego silnika w katalogu modeli.")
        with self.lock:
            if self.busy() or (self.work_busy and self.work_busy()):
                raise ValueError("Silnik lub instalator jest zajęty. Poczekaj na zakończenie pracy.")
            previous = self.jobs.get(engine_id, {})
            if previous.get("state") == "complete" and previous.get("disclosure_id") == disclosure_id and self._verified(spec, previous):
                return dict(previous)
            retry = previous.get("state") in {"failed", "cancelled", "interrupted"} and previous.get("disclosure_id") == disclosure_id and bool(re.fullmatch(r"[a-f0-9]{32}", previous.get("attempt_id", "")))
            if retry and spec["kind"] == "native" and (previous.get("state") == "failed" or (self._attempt(spec, previous) / "native").exists()):
                # A failed native copy can contain partial immutable files.
                # Retain its exact terminal job and allocate a fresh candidate.
                prior_attempt = self._attempt(spec, previous)
                prior_attempt.mkdir(parents=True, exist_ok=True)
                _atomic_json(prior_attempt / ("terminal-job-" + uuid.uuid4().hex + ".json"), previous)
                retry = False
            job = {"engine_id": engine_id, "disclosure_id": disclosure_id, "attempt_id": previous["attempt_id"] if retry else uuid.uuid4().hex,
                   "state": "starting", "phase": "preflight", "steps": [], "log": [], "error": "", "updated_at": time.time(),
                   "activation": None, "restart_required": False}
            attempt = self._attempt(spec, job)
            _no_link_ancestors(self.runtime / "sidecar-cache")
            attempt.mkdir(parents=True, exist_ok=True)
            free = shutil.disk_usage(attempt).free
            required = max(spec.get("required_bytes") or 0, spec.get("temporary_free_bytes") or 0) + 5 * 1024 ** 3
            if free < required:
                raise ValueError(f"Za mało miejsca na dysku: potrzeba około {required / 1024**3:.1f} GB z zapasem; dostępne {free / 1024**3:.1f} GB.")
            self.jobs[engine_id] = job
            self._persist()
            env = private_worker_environment(self.runtime, attempt, self.specs)
            if spec["kind"] == "sidecar":
                try:
                    from services import settings_store
                    token = settings_store.get_hf_token()
                    if token:
                        env["NEXT_ENGINE_HF_TOKEN"] = token
                except ImportError:
                    pass
            command = [sys.executable, str(Path(__file__).resolve()), "--install", engine_id,
                       "--engine", str(self.engine), "--runtime", str(self.runtime), "--attempt", str(attempt),
                       "--manifest", str(self.manifest), "--disclosure", disclosure_id]
            try:
                process = self.process_factory(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                               text=True, encoding="utf-8", errors="replace", bufsize=1, env=env, cwd=str(attempt))
            except Exception as exc:
                job.update(state="failed", error=scrub(exc))
                self._persist()
                raise ValueError("Nie można uruchomić prywatnego instalatora: " + scrub(exc)) from exc
            self.processes[engine_id] = process
            self.done[id(process)] = threading.Event()
            threading.Thread(target=self._watch, args=(engine_id, process), daemon=True).start()
            return dict(job)

    def _verified(self, spec, job):
        try:
            return self._verification_files_present(spec, job)
        except (OSError, ValueError, KeyError, TypeError):
            return False

    def _verification_files_present(self, spec, job):
        marker = _read_json(self._attempt(spec, job) / MARKER, {})
        if marker.get("disclosure_id") != spec["disclosure_id"] or marker.get("engine_id") != spec["engine_id"]:
            return False
        target = Path(marker.get("install_dir", ""))
        _no_link_ancestors(target)
        if not target.resolve().is_relative_to(self._attempt(spec, job)):
            return False
        if spec["kind"] == "native":
            binaries = marker.get("binaries", {})
            return set(binaries) == {"audiocpp_server.exe", "audiocpp_cli.exe"} and all((target / name).is_file() and _sha(target / name) == value for name, value in binaries.items())
        py = target / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        complete = target / spec["completion_marker"]
        return py.is_file() and complete.is_file() and (not spec.get("weights_repo_id") or (target / spec["weights_subdir"] / ".omnivoice_weights_complete").is_file())

    def _watch(self, engine_id, process):
        success, code, failure = False, None, "Instalacja nie została ukończona. Sprawdź zapisane fazy i log."
        last_write = 0
        try:
            for line in process.stdout:
                if not line.startswith(PREFIX):
                    continue
                event = json.loads(line[len(PREFIX):])
                if event.get("state") == "complete":
                    success = True
                    process.wait(timeout=5)  # release retained nested helpers before EOF
                    continue
                if event.get("error"):
                    failure = scrub(event["error"])
                with self.lock:
                    job = self.jobs[engine_id]
                    if job["state"] != "cancelling":
                        values = {key: value for key, value in event.items() if key in {"phase", "steps", "downloaded_bytes", "total_bytes", "weights_progress"}}
                        if "steps" in values:
                            values["steps"] = [{"id": scrub(step.get("id", "")), "state": scrub(step.get("state", "")), "detail": scrub(step.get("detail") or "")} for step in values["steps"]]
                        if isinstance(values.get("weights_progress"), dict):
                            values["weights_progress"] = {**values["weights_progress"], "filename": scrub(values["weights_progress"].get("filename") or "")}
                        job.update(values)
                        if event.get("state") in ACTIVE:
                            job["state"] = event["state"]
                    if event.get("log"):
                        job["log"] = [scrub(item) for item in event["log"]][-120:]
                    if event.get("message"):
                        job["log"] = [*job["log"], scrub(event["message"])][-120:]
                    job["updated_at"] = time.time()
                    if time.monotonic() - last_write > 0.75:
                        self._persist()
                        last_write = time.monotonic()
            code = process.wait(timeout=5)
        except Exception as exc:
            failure = "Nie można potwierdzić zakończenia instalacji: " + scrub(exc)
        finally:
            self._close_stdin(process)
            if code is None:
                try:
                    process.kill()
                    code = process.wait(timeout=5)
                except (OSError, subprocess.TimeoutExpired):
                    with self.lock:
                        self.jobs[engine_id].update(state="cancelling", error="Nie potwierdzono zatrzymania drzewa instalatora.")
                        self._persist()
                    return  # retain ownership and busy state
            if process.stdout:
                process.stdout.close()
            with self.lock:
                job, spec = self.jobs[engine_id], self._spec(engine_id)
                state = "cancelled" if job["state"] == "cancelling" else "complete" if code == 0 and success and self._verified(spec, job) else "failed"
                job.update(state=state, error="" if state in {"complete", "cancelled"} else failure, updated_at=time.time())
                self._persist()
                self.processes.pop(engine_id, None)
                self.stopping.discard(id(process))
                self.done.pop(id(process)).set()

    @staticmethod
    def _close_stdin(process):
        if process.stdin:
            try:
                process.stdin.close()
            except (OSError, ValueError):
                pass

    def cancel(self, engine_id):
        self._spec(engine_id)
        with self.lock:
            process = self.processes.get(engine_id)
            if process is None or id(process) in self.stopping:
                return {"requested": process is not None}
            self.jobs[engine_id].update(state="cancelling", updated_at=time.time())
            self._persist()
            self.stopping.add(id(process))
            completed = self.done[id(process)]
            self._close_stdin(process)
            threading.Thread(target=self._cancel_wait, args=(engine_id, process, completed), daemon=True).start()
        return {"requested": True}

    def _cancel_wait(self, engine_id, process, completed):
        if completed.wait(2):
            return
        try:
            process.terminate()
            process.wait(timeout=5)
            if not completed.wait(2):
                raise TimeoutError("Proces nie zwolnił strumienia postępu.")
        except (OSError, subprocess.TimeoutExpired, TimeoutError) as exc:
            with self.lock:
                if self.processes.get(engine_id) is process:
                    self.jobs[engine_id]["error"] = "Nie potwierdzono zatrzymania: " + scrub(exc)
                    self._persist()

    def close(self):
        with self.lock:
            processes = [(key, process, self.done[id(process)]) for key, process in self.processes.items()]
        for key, process, completed in processes:
            self.cancel(key)
            if not completed.wait(12):
                process.kill()
                process.wait(timeout=5)
                if not completed.wait(2):
                    raise RuntimeError("Nie potwierdzono zamknięcia prywatnego instalatora silnika.")

    def activate(self, engine_id, disclosure_id):
        spec = self._spec(engine_id)
        with self.lock:
            if self.busy() or (self.work_busy and self.work_busy()):
                raise ValueError("Poczekaj na zakończenie pracy silnika i instalatora.")
            job = self.jobs.get(engine_id, {})
            if disclosure_id != spec["disclosure_id"] or job.get("state") != "complete" or not self._verified(spec, job):
                raise ValueError("Brak ukończonej, sprawdzonej instalacji tej receptury.")
            marker = _read_json(self._attempt(spec, job) / MARKER, {})
            target = Path(marker["install_dir"])
            _no_link_ancestors(target)
            if not target.is_dir() or not target.resolve().is_relative_to(self._attempt(spec, job)):
                raise ValueError("Katalog silnika wykracza poza prywatną instalację.")
            # Restart-only: don't mutate os.environ or an in-use sidecar.
            update_private_environment(self.data, {spec["env_var"]: str(target)}, allowed_keys={item["env_var"] for item in self.specs})
            job.update(activation=str(target), restart_required=True)
            self._persist()
            return {"engine_id": engine_id, "restart_required": True, "install_dir": str(target)}


def busy():
    return bool(_manager and _manager.busy())


def create_router(runtime: Path, data: Path, *, engine_path: Path, distribution_manifest: Path, work_busy=None):
    global _manager
    from fastapi import APIRouter, Depends, HTTPException
    from pydantic import BaseModel
    from api.dependencies import require_admin

    class EngineInstallBody(BaseModel):
        engine_id: str
        disclosure_id: str = ""
        accepted: bool = False

    globals()["EngineInstallBody"] = EngineInstallBody
    manager = EngineRuntimeManager(runtime, data, engine_path=engine_path, distribution_manifest=distribution_manifest, work_busy=work_busy)
    _manager = manager

    @asynccontextmanager
    async def lifespan(_app):
        try:
            yield
        finally:
            await asyncio.to_thread(manager.close)

    router = APIRouter(prefix="/next/engine-runtimes", dependencies=[Depends(require_admin)], lifespan=lifespan)

    def call(action, *args):
        try:
            return action(*args)
        except (ValueError, OSError) as exc:
            raise HTTPException(status_code=400, detail=scrub(exc)) from exc

    @router.get("/catalog")
    def catalog():
        return call(manager.catalog)

    @router.get("/jobs")
    def jobs():
        return manager.status()

    @router.post("/install")
    def install(body: EngineInstallBody):
        return call(manager.install, body.engine_id, body.disclosure_id, body.accepted)

    @router.post("/cancel")
    def cancel(body: EngineInstallBody):
        return call(manager.cancel, body.engine_id)

    @router.post("/activate")
    def activate(body: EngineInstallBody):
        return call(manager.activate, body.engine_id, body.disclosure_id)

    return router


def _assert_private_tree(path):
    _no_link_ancestors(path)
    for directory, dirs, files in os.walk(path, followlinks=False):
        for name in [*dirs, *files]:
            target = Path(directory) / name
            _no_link_ancestors(target)
            if target.is_file() and target.stat().st_nlink > 1:
                raise ValueError("Prywatna instalacja zawiera współdzielony hardlink. Nie zmieniono jego zawartości.")


def _native_ast_digest(node):
    def normalized(value):
        if isinstance(value, ast.AST):
            return [type(value).__name__, {key: normalized(item) for key, item in ast.iter_fields(value) if key != "type_params"}]
        if isinstance(value, list):
            return [normalized(item) for item in value]
        return value
    return hashlib.sha256(json.dumps(normalized(node), sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _publish_native_copy(source, target, attempt):
    """Publish immutable files without renaming an image-locked Windows folder."""
    source, target, attempt = Path(source), Path(target), Path(attempt)
    for path in (attempt, source, target):
        _no_link_ancestors(path)
    attempt = attempt.resolve(strict=True)
    source = source.resolve(strict=True)
    if not source.is_dir() or source == attempt or not source.is_relative_to(attempt) or target != attempt / "native" or target.is_relative_to(source):
        raise ValueError("Publikacja programu może dotyczyć wyłącznie własnej próby/native.")
    if target.exists():
        raise ValueError("Katalog native już istnieje. Zachowano go bez nadpisania; wymagana nowa próba.")
    _assert_private_tree(source)
    files = []
    for directory, dirs, names in os.walk(source, followlinks=False):
        for name in names:
            path = Path(directory) / name
            info = path.stat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise ValueError("Pakiet programu zawiera niedozwolony plik lub współdzielony hardlink.")
            files.append((path.relative_to(source), info.st_size))
    if not files or sum(size for _, size in files) > 1_000_000_000:
        raise ValueError("Natywny pakiet jest pusty lub przekracza 1 GB.")
    target.mkdir()  # exclusive; a partial copy is deliberately retained on failure
    for relative, expected_size in files:
        original, copied = source / relative, target / relative
        _no_link_ancestors(original)
        _no_link_ancestors(copied)
        copied.parent.mkdir(parents=True, exist_ok=True)
        before = _sha(original)
        with original.open("rb") as input_stream, copied.open("xb") as output_stream:
            shutil.copyfileobj(input_stream, output_stream)
        if copied.stat().st_size != expected_size or copied.stat().st_nlink != 1 or _sha(copied) != before or _sha(original) != before:
            raise ValueError("Kopia programu nie odpowiada zweryfikowanemu plikowi źródłowemu.")
    _assert_private_tree(target)


def _private_native_install(installer, source, expected_sha, attempt):
    """Compile only the reviewed function in a private namespace, never patch os."""
    source = Path(source)
    if _sha(source) != expected_sha:
        raise ValueError("Źródło instalatora zmieniło się po potwierdzeniu receptury.")
    tree = ast.parse(source.read_text(encoding="utf-8-sig"))
    functions = [item for item in tree.body if isinstance(item, ast.FunctionDef) and item.name == "_install"]
    if len(functions) != 1 or _native_ast_digest(functions[0]) != "85cb92ca2f49d68803b9d9fba5f89a1da49473d84c3a4c78e352800a4760a574":
        raise ValueError("Nieobsługiwany kontrakt publikacji audio.cpp. Zaktualizuj adapter aplikacji.")
    function = functions[0]
    replacements = [item for item in ast.walk(function) if isinstance(item, ast.Call) and isinstance(item.func, ast.Attribute)
                    and isinstance(item.func.value, ast.Name) and item.func.value.id == "os" and item.func.attr == "replace"]
    expected = ast.parse("os.replace(prepared, target)", mode="eval").body
    if len(replacements) != 1 or ast.dump(replacements[0], include_attributes=False) != ast.dump(expected, include_attributes=False):
        raise ValueError("Nieznany krok publikacji przypiętego audio.cpp.")
    replacements[0].func = ast.Name(id="_next_publish_native", ctx=ast.Load())
    # The stock overwrite branch must fail rather than remove even a partial
    # target. This proxy exists only in the compiled function's private globals.
    def refuse_removal(_path, *args, **kwargs):
        raise ValueError("Katalog native już istnieje; zachowano wszystkie pliki bez nadpisania.")
    namespace = dict(vars(installer))
    namespace.update(_next_publish_native=lambda prepared, target: _publish_native_copy(prepared, target, attempt),
                     shutil=SimpleNamespace(copytree=shutil.copytree, rmtree=refuse_removal))
    compiled = ast.fix_missing_locations(ast.Module(body=[function], type_ignores=[]))
    exec(compile(compiled, str(source) + " [private-copy-publication]", "exec"), namespace)
    return namespace["_install"]


def _install_worker(arguments, *, watchdog=True):
    if watchdog:
        from model_management import _start_parent_watchdog
        _start_parent_watchdog(72)  # before any engine/ML imports
    output_lock = threading.Lock()

    def emit(**event):
        with output_lock:
            print(PREFIX + json.dumps(event, ensure_ascii=False), flush=True)

    try:
        specs = read_catalog(arguments.engine)
        recipe = next(item for item in specs if item["engine_id"] == arguments.install)
        if recipe["disclosure_id"] != arguments.disclosure:
            raise ValueError("Receptura zmieniła się po potwierdzeniu. Odśwież katalog.")
        owned_root = arguments.runtime.resolve() / "sidecars" / recipe["engine_id"]
        if arguments.attempt.resolve().parent != owned_root or not re.fullmatch(r"[a-f0-9]{32}", arguments.attempt.name):
            raise ValueError("Katalog operacji nie należy do prywatnego instalatora.")
        _assert_private_tree(arguments.attempt)
        # Consume only the token explicitly supplied for a sidecar operation.
        # Native binaries never inherit it, including from an ambient shell.
        operation_token = os.environ.pop("NEXT_ENGINE_HF_TOKEN", None) if recipe["kind"] == "sidecar" else None
        environment = private_worker_environment(arguments.runtime, arguments.attempt, specs)
        os.environ.clear()
        os.environ.update(environment)
        sys.path[:0] = [str(arguments.engine), str(arguments.engine / "backend")]
        if recipe["kind"] == "native":
            from services import audiocpp_runtime_install as installer
            target = arguments.attempt / "native"
            installer.bootstrap.managed_runtime_dir = lambda: target
            def download(url, destination, digest, expected_size):
                # Same release verification as stock, with measured bytes.
                if url != recipe["source_urls"][0] or digest != recipe["archive_sha256"]:
                    raise ValueError("Adres wydania audio.cpp nie odpowiada potwierdzonej recepturze.")
                hasher, received = hashlib.sha256(), 0
                with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "SeventySevenLabs"}), timeout=30) as response, destination.open("wb") as output:
                    while chunk := response.read(256 * 1024):
                        received += len(chunk)
                        if received > expected_size:
                            raise ValueError("Rozmiar wydania audio.cpp jest niezgodny.")
                        output.write(chunk)
                        hasher.update(chunk)
                        emit(state="installing", phase="native_download", downloaded_bytes=received, total_bytes=expected_size)
                if received != expected_size or hasher.hexdigest() != digest:
                    raise ValueError("Rozmiar lub SHA-256 wydania audio.cpp jest niezgodny.")
                # Retain the fully verified, pinned ZIP for this private attempt.
                # Stock temp cleanup may otherwise erase the evidence on failure.
                retained = arguments.attempt / "downloads" / recipe["archive_name"]
                _no_link_ancestors(retained)
                retained.parent.mkdir(exist_ok=True)
                if retained.exists():
                    if retained.stat().st_size != expected_size or _sha(retained) != digest:
                        raise ValueError("Istniejący zapis pakietu programu jest niezgodny; zachowano go bez nadpisania.")
                else:
                    with destination.open("rb") as input_stream, retained.open("xb") as output_stream:
                        shutil.copyfileobj(input_stream, output_stream)
                    if retained.stat().st_size != expected_size or _sha(retained) != digest or retained.stat().st_nlink != 1:
                        raise ValueError("Nie udało się zachować zgodnej kopii zweryfikowanego pakietu.")
                emit(state="verifying", phase="native_verify", message="Archiwum zweryfikowane. Rozpakowywanie i test programu bez modelu.")

            installer._download = download
            emit(state="installing", phase="native_runtime", message="Pobieranie i weryfikacja przypiętego wydania audio.cpp; następnie test urządzeń bez modelu.")
            private_install = _private_native_install(installer, arguments.engine / "backend/services/audiocpp_runtime_install.py", recipe["installer_sha256"], arguments.attempt)
            private_install()
            emit(state="verifying", phase="native_probe", message="Weryfikacja skopiowanego programu bez ładowania modelu.")
            probe = subprocess.run([str(target / "audiocpp_server.exe"), "--list-devices"], cwd=str(target), capture_output=True, timeout=20, check=False)
            if probe.returncode != 0:
                raise ValueError("Skopiowany program audio.cpp nie przeszedł testu urządzeń bez modelu.")
            install_dir = target
        else:
            uv = ensure_pinned_uv(arguments.runtime, arguments.manifest, emit=emit)
            from services import sidecar_install as installer
            from dataclasses import replace
            from types import SimpleNamespace
            original = installer.get_spec(arguments.install)
            install_args = tuple(arg.replace("{engine}", str(arguments.engine)) for arg in recipe["install_args"])
            spec = replace(original, install_args=install_args, installed_probe=lambda: False, invalidate=lambda: None, requires_install_marker=True)
            installer.SPECS = {**installer.SPECS, spec.engine_id: spec}
            installer._locate_uv = lambda: str(uv)
            installer.uv_subprocess_env = lambda _parent: dict(os.environ)
            ok, reason = installer.host_support(spec)
            if not ok:
                raise ValueError(reason)
            # Resolve solely the app's explicitly supplied token. No HF CLI,
            # no former VoiceStudio settings, no credential-bearing mirrors.
            from services import token_resolver, endpoint_race
            token = operation_token
            token_resolver.resolve = lambda *args, **kwargs: SimpleNamespace(token=token) if token else None
            endpoint_race.effective_endpoint = lambda: "https://huggingface.co"
            job = installer._new_job(spec.engine_id)
            original_log = installer._log

            def log(job, line):
                original_log(job, scrub(line))
                emit(state="verifying" if any(step["id"] == "verify" and step["state"] == "running" for step in job["steps"]) else "installing",
                     phase=next((step["id"] for step in job["steps"] if step["state"] == "running"), "preflight"),
                     steps=job["steps"], log=list(job["log"])[-120:])

            installer._log = log

            def staged(_spec, current):
                installer._job_step(current, "persist")["detail"] = "Przygotowano; aktywacja wymaga osobnej akcji i restartu."

            installer._step_persist = staged
            stop_poll = threading.Event()

            def progress():
                while not stop_poll.wait(0.5):
                    snapshot = installer._serialize_job(job)
                    emit(state="installing", phase=next((step["id"] for step in snapshot["steps"] if step["state"] == "running"), "preflight"),
                         steps=snapshot["steps"], weights_progress=snapshot.get("weights_progress"))

            poller = threading.Thread(target=progress, daemon=True)
            poller.start()
            try:
                installer._run_install(spec, job)
            finally:
                stop_poll.set()
                poller.join(2)
            if job["state"] != "succeeded" or not installer._healthy(spec):
                raise ValueError(str(job.get("error") or "Nie udało się zweryfikować instalacji.") + " " + str(job.get("remediation") or ""))
            install_dir = installer.managed_checkout(spec)
        if not install_dir.resolve().is_relative_to(arguments.attempt.resolve()):
            raise ValueError("Instalator próbował opuścić prywatny katalog.")
        binaries = {name: _sha(install_dir / name) for name in ("audiocpp_server.exe", "audiocpp_cli.exe")} if recipe["kind"] == "native" else {}
        _atomic_json(arguments.attempt / MARKER, {"schema": 1, "engine_id": recipe["engine_id"], "disclosure_id": recipe["disclosure_id"],
                                                "install_dir": str(install_dir), "completed_at": time.time(), "copy_only": True, "binaries": binaries})
        emit(state="complete")
        return 0
    except Exception as exc:
        emit(state="failed", error=scrub(exc))
        return 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--install", required=True)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--attempt", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--disclosure", required=True)
    raise SystemExit(_install_worker(parser.parse_args()))
