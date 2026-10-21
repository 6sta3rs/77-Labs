"""Build a fresh, copy-only runtime candidate. Invoked by the native installer.

--plan is read-only/offline. Actual installation requires the native-owned
process tree and an app-created candidate marker. Never upgrades the legacy
runtime or installs a model. Activation is a separate native operation.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import stat
import subprocess
import sys
import threading
import time
import tomllib
import urllib.request
import zipfile
from windows_runtime_paths import configure_windows_runtime_paths

EVENT = "NEXT_BOOTSTRAP_EVENT "
OWNER = "Seventy Seven Labs runtime installer v1"
BUILD_OWNER = "Seventy Seven Labs private build workspace v1"
BUILD_CACHE_PATH_LIMIT = 80


def emit(phase, message):
    print(EVENT + json.dumps({"phase": phase, "message": message}, ensure_ascii=False), flush=True)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("x", encoding="utf-8") as target:
        json.dump(value, target, ensure_ascii=False, indent=2)
    os.replace(temporary, path)


def _plain_build_path(path):
    path = Path(path)
    for part in (path, *path.parents):
        if part.exists() or part.is_symlink():
            info = part.lstat()
            if part.is_symlink() or getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 1024):
                raise ValueError("Cache budowania prowadzi przez dowiązanie lub junction.")
            if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
                raise ValueError("Cache budowania nie może korzystać ze współdzielonych hardlinków.")
    return path


def build_temp_base():
    """Use the real per-user Temp, not inherited TEMP set to the long candidate.

    SHGetKnownFolderPath ignores the installer's deliberate LOCALAPPDATA/TEMP
    overrides. The only external write is a fresh, receipted child of Temp.
    No system setting or parent directory is created/changed.
    """
    if sys.platform != "win32":
        import tempfile
        return Path(tempfile.gettempdir())
    import ctypes as ct
    import uuid
    class Guid(ct.Structure):
        _fields_ = [("data1", ct.c_ulong), ("data2", ct.c_ushort), ("data3", ct.c_ushort), ("data4", ct.c_ubyte * 8)]
    identifier = Guid.from_buffer_copy(uuid.UUID("f1b32785-6fba-4fcf-9d55-7b8e7f157091").bytes_le)
    shell, ole = ct.WinDLL("shell32"), ct.WinDLL("ole32")
    shell.SHGetKnownFolderPath.argtypes = [ct.POINTER(Guid), ct.c_uint, ct.c_void_p, ct.POINTER(ct.c_void_p)]
    shell.SHGetKnownFolderPath.restype = ct.c_long
    ole.CoTaskMemFree.argtypes = [ct.c_void_p]
    result = ct.c_void_p()
    if shell.SHGetKnownFolderPath(ct.byref(identifier), 0, None, ct.byref(result)) != 0:
        raise ValueError("Windows nie podał prywatnego katalogu Temp do budowania zależności.")
    try:
        return Path(ct.wstring_at(result)) / "Temp"
    finally:
        ole.CoTaskMemFree(result)


def prepare_build_workspace(root, profile):
    """Create/reuse only a short, owned cache; retain it after failure/cancel."""
    root = _plain_build_path(Path(root).absolute()).resolve()
    marker = _plain_build_path(root / ".installer-owner.json")
    owner = json.loads(marker.read_text(encoding="utf-8"))
    if owner != {"owner": OWNER, "id": root.name} or not re.fullmatch(r"runtime_[0-9a-f]+", root.name):
        raise ValueError("Brak własności kandydata dla cache budowania.")
    base = _plain_build_path(build_temp_base())
    if not base.is_absolute() or not base.is_dir() or str(base).startswith("\\\\") or base.resolve().is_relative_to(root):
        raise ValueError("Cache budowania wymaga istniejącego lokalnego katalogu Temp poza kandydatem.")
    base = base.resolve()
    if profile not in {"cpu", "cuda"}: raise ValueError("Nieznany profil budowania.")
    free_budget = (20 if profile == "cpu" else 35) * 1024 ** 3
    if shutil.disk_usage(base).free < free_budget:
        raise ValueError("Za mało miejsca w prywatnym Temp na cache i budowanie zależności.")
    pointer = _plain_build_path(root / "build-workspace.json")
    if pointer.exists():
        receipt = json.loads(pointer.read_text(encoding="utf-8"))
        workspace = _plain_build_path(Path(receipt.get("path", "")))
        if (not workspace.is_absolute() or workspace.parent.resolve() != base or
                not re.fullmatch(r"ssb-[0-9a-f]{12}", workspace.name)):
            raise ValueError("Zapisany cache budowania wykracza poza własny Temp.")
        proof = _plain_build_path(workspace / ".runtime-build-owner.json")
        if (receipt.get("owner") != BUILD_OWNER or receipt.get("schema") != 1 or
                receipt.get("candidate") != str(root) or receipt.get("candidate_marker_sha256") != sha256(marker) or
                receipt.get("profile") != profile or receipt.get("retained") is not True or
                json.loads(proof.read_text(encoding="utf-8")) != receipt):
            raise ValueError("Cache budowania nie należy do tego kandydata lub jego receipt jest niezgodny.")
    else:
        workspace = base / ("ssb-" + secrets.token_hex(6))
        if len(str(workspace / "c")) > BUILD_CACHE_PATH_LIMIT:
            raise ValueError("Prywatny Temp jest zbyt głęboki: cache budowania przekroczyłby 80 znaków. Nie zmieniono ustawień Windows.")
        workspace.mkdir()  # exclusive; never reuse an unmarked existing folder
        receipt = {"schema": 1, "owner": BUILD_OWNER, "candidate": str(root), "candidate_marker_sha256": sha256(marker),
                   "path": str(workspace), "profile": profile, "retained": True,
                   "cache_path_limit": BUILD_CACHE_PATH_LIMIT, "minimum_free_bytes": free_budget}
        atomic_json(workspace / ".runtime-build-owner.json", receipt)
        for name in ("c", "t"): (workspace / name).mkdir()
        atomic_json(pointer, receipt)
    for name in ("c", "t"):
        path = _plain_build_path(workspace / name)
        if not path.is_dir() or len(str(path)) > BUILD_CACHE_PATH_LIMIT:
            raise ValueError("Nieprawidłowy lub zbyt długi prywatny cache budowania.")
    return receipt


@contextlib.contextmanager
def build_environment(workspace):
    root = _plain_build_path(Path(workspace["path"]))
    for name in ("c", "t"):
        path = _plain_build_path(root / name)
        if not path.is_dir(): raise ValueError("Brak prywatnego katalogu cache budowania.")
    changes = {"UV_CACHE_DIR": str(root / "c"), "TEMP": str(root / "t"), "TMP": str(root / "t")}
    previous = {key: os.environ.get(key) for key in changes}
    try:
        os.environ.update(changes)
        yield
    finally:
        for key, value in previous.items():
            if value is None: os.environ.pop(key, None)
            else: os.environ[key] = value


def validate_root(root: Path, expected_base: Path | None = None):
    expected_base = expected_base or Path(os.environ["LOCALAPPDATA"]) / "VoiceStudioNext"
    if not root.is_absolute() or not re.fullmatch(r"runtime_[0-9a-f]+", root.name):
        raise ValueError("Instalator wymaga nowego, oznaczonego katalogu runtime_<id>.")
    for part in (root, *root.parents):
        if part.exists():
            attributes = getattr(part.lstat(), "st_file_attributes", 0)
            if part.is_symlink() or attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 1024):
                raise ValueError("Ścieżka instalacji prowadzi przez dowiązanie lub junction.")
    if root.resolve().parent != expected_base.resolve():
        raise ValueError("Kandydat runtime wykracza poza prywatny katalog aplikacji.")
    marker = json.loads((root / ".installer-owner.json").read_text(encoding="utf-8"))
    if marker.get("owner") != OWNER or marker.get("id") != root.name:
        raise ValueError("Brak prawidłowego znacznika własności instalacji.")
    return root.resolve()


def plan(profile, manifest):
    if profile not in {"cpu", "cuda"}:
        raise ValueError("Wybierz CPU albo NVIDIA CUDA.")
    return {"profile": profile, "python": manifest["python"]["version"], "uv": manifest["uv"]["version"],
            "minimumFreeGb": 20 if profile == "cpu" else 35, "linkMode": "copy", "modelsIncluded": False,
            "downloadCost": "Kilka GB zależności; wagi modeli pobiera się osobno." if profile == "cpu" else "Kilka–kilkanaście GB zależności CUDA; wagi modeli pobiera się osobno.",
            "activation": "Osobna akcja po doctorze importów i rzeczywistym /health; istniejący runtime pozostaje zachowany.",
            "phases": ["python", "engine", "lock", "venv", "dependencies", "doctor", "health", "ready"]}


def cpu_requirements(exported: str, wheels: dict):
    """Replace only the three torch variants; preserve every other hash/marker."""
    blocks = []
    current = []
    for line in exported.splitlines():
        current.append(line)
        if not line.rstrip().endswith("\\"):
            blocks.append("\n".join(current)); current = []
    if current:
        raise ValueError("Eksport wymagań kończy się niepełnym wpisem.")
    retained = []
    removed = set()
    for block in blocks:
        match = re.match(r"^(torch|torchaudio|torchvision)==([^\s;\\]+)", block)
        if match:
            if match[2].split("+")[0] != wheels[match[1]]["version"].split("+")[0]:
                raise ValueError("Wersja PyTorch w lockfile nie pasuje do przypiętej nakładki CPU.")
            removed.add(match[1])
        else:
            retained.append(block)
    if removed != set(wheels):
        raise ValueError("Kontrakt wersji PyTorch w lockfile zmienił się; nie zastosowano nakładki CPU.")
    for name, artifact in wheels.items():
        if not re.fullmatch(r"[0-9a-f]{64}", artifact["sha256"]):
            raise ValueError("Brak przypiętego skrótu koła CPU.")
        retained.append(f"{name} @ {artifact['url']} --hash=sha256:{artifact['sha256']}")
    return "\n".join(retained) + "\n"


def extract_engine(root, manifest):
    archive_path = root / "engine.zip"
    if sha256(archive_path) != manifest["engine"]["archiveSha256"]:
        raise ValueError("Archiwum silnika nie zgadza się z przypiętym SHA-256.")
    engine = root / "engine"
    if engine.exists():
        raise ValueError("Katalog silnika kandydata już istnieje. Ponów instalację w nowym kandydacie.")
    with zipfile.ZipFile(archive_path) as archive:
        entries = archive.infolist()
        for item in entries:
            relative = Path(item.filename)
            target = (engine / relative).resolve()
            mode = item.external_attr >> 16
            if relative.is_absolute() or ".." in relative.parts or not target.is_relative_to(engine.resolve()) or stat.S_ISLNK(mode):
                raise ValueError("Archiwum silnika zawiera niebezpieczną ścieżkę.")
        for filename, key in (("uv.lock", "lockSha256"), ("pyproject.toml", "pyprojectSha256")):
            if hashlib.sha256(archive.read(filename)).hexdigest() != manifest["engine"][key]:
                raise ValueError("Metadane silnika nie zgadzają się z przypiętym SHA-256.")
        archive.extractall(engine)
    # The same private-only preload opt-out as launcher.prepare_engine().
    main = engine / "backend/main.py"
    body = main.read_text(encoding="utf-8")
    contracts = ("app.state.preload_task = asyncio.create_task(preload_model())",
                 "app.state.preload_task = asyncio.create_task(_preload_after_reconcile())")
    matches = [original for original in contracts if body.count(original) == 1]
    if len(matches) != 1 or sum(body.count(original) for original in contracts) != 1:
        raise ValueError("Zmienił się kontrakt wstępnego wczytywania silnika.")
    original = matches[0]
    replacement = original + " if _env_flag('VOICESTUDIO_NEXT_PRELOAD_TTS', default=False) else None"
    body = body.replace(original, replacement)
    if "dotenv.load_dotenv()" in body:
        body = body.replace("dotenv.load_dotenv()", "dotenv.load_dotenv(os.environ['OMNIVOICE_ENV_FILE'], override=False) if os.environ.get('OMNIVOICE_ENV_FILE') else None")
    main.write_text(body, encoding="utf-8")
    source_version = tomllib.loads((engine / "pyproject.toml").read_text(encoding="utf-8-sig")).get("project", {}).get("version", "unknown")
    (engine / ".next-engine-v1").write_text(f"VoiceStudio {source_version} / Next private engine v1", encoding="utf-8")
    return engine


def commands(root: Path, profile: str, *, build_workspace):
    uv = root / "tools/uv.exe"
    python = root / "python/cpython-3.11.14-windows-x86_64-none/python.exe"
    venv_python = root / ".venv/Scripts/python.exe"
    requirements = root / "requirements.lock.txt"
    return {
        "lock": [str(uv), "export", "--offline", "--frozen", "--no-dev", "--no-emit-project", "--no-editable", "--project", str(root / "engine"), "--output-file", str(requirements)],
        "venv": [str(uv), "venv", "--no-python-downloads", "--python", str(python), str(root / ".venv")],
        "dependencies": [str(uv), "pip", "sync", "--python", str(venv_python), "--require-hashes", "--link-mode", "copy", "--cache-dir", str(Path(build_workspace["path"]) / "c"),
                         "--index", "https://download.pytorch.org/whl/cu128", "--default-index", "https://pypi.org/simple", "--index-strategy", "unsafe-best-match", str(requirements)],
        "check": [str(uv), "pip", "check", "--python", str(venv_python)],
    }


def run(command, *, cwd):
    subprocess.run(command, cwd=cwd, check=True, stdin=subprocess.DEVNULL)


def doctor_environment(root):
    environment = dict(os.environ)
    for key in list(environment):
        if key.startswith(("OMNIVOICE_", "HF_", "HUGGINGFACE_", "TRANSFORMERS_")):
            del environment[key]
    isolated = root / "doctor-data"
    isolated.mkdir(exist_ok=True)
    environment.update(OMNIVOICE_DATA_DIR=str(isolated), OMNIVOICE_ENV_FILE=str(isolated / "environment"),
                       OMNIVOICE_CACHE_DIR=str(root / "doctor-models"), HF_HOME=str(root / "doctor-models"),
                       HF_HUB_CACHE=str(root / "doctor-models"), HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
                       OMNIVOICE_PRELOAD_CAPTURE_ASR="0", OMNIVOICE_PRELOAD_WATERMARK="0", OMNIVOICE_PRELOAD_TTS_ASR="0",
                       VOICESTUDIO_NEXT_PRELOAD_TTS="0", OMNIVOICE_MCP_DISABLE="1", OMNIVOICE_STARTUP_WATCHDOG_S="300",
                       PYTHONUTF8="1", PYTHONIOENCODING="utf-8", PYTHONDONTWRITEBYTECODE="1")
    return environment


def doctor(root, profile, runner=run):
    python = root / ".venv/Scripts/python.exe"
    code = ("import json,sys;"
            "from pathlib import Path;"
            f"sys.path.insert(0,{str(root)!r});"
            "from windows_runtime_paths import configure_windows_runtime_paths;configure_windows_runtime_paths();"
            "from mcp.server.fastmcp import FastMCP;"
            "import importlib;importlib.import_module('pywintypes') if sys.platform=='win32' else None;"
            "import torch,fastapi,uvicorn,transformers,cryptography,soundfile,numpy;"
            f"expected={profile!r};"
            "assert sys.version_info[:2]==(3,11),'Niewłaściwa wersja Pythona';"
            "assert (torch.version.cuda is None) if expected=='cpu' else (torch.cuda.is_available() and torch.version.cuda=='12.8'),'Wybrany profil CPU/CUDA nie jest dostępny';"
            f"Path({str(root / 'doctor.json')!r}).write_text(json.dumps(dict(python=sys.version,torch=torch.__version__,cuda=torch.version.cuda,cuda_available=torch.cuda.is_available(),imports='passed',mcp_sdk='passed',pywin32='passed' if sys.platform=='win32' else 'not-applicable')),encoding='utf-8')")
    runner([str(python), "-c", code], cwd=root)
    linked = [path for path in (root / ".venv").rglob("*") if path.is_file() and path.stat().st_nlink > 1]
    if linked:
        raise ValueError("Nowe środowisko zawiera hardlinki; kandydat nie zostanie aktywowany.")
    evidence = json.loads((root / "doctor.json").read_text(encoding="utf-8"))
    if evidence.get("mcp_sdk") != "passed" or evidence.get("pywin32") not in {"passed", "not-applicable"}:
        raise ValueError("Doctor nie potwierdził importu MCP SDK i zależności Windows.")
    return evidence


def probe_health(root, timeout=300):
    # Bind an ephemeral loopback port; authenticate the response using a
    # per-run marker so a racing foreign listener cannot pass this doctor.
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    token = secrets.token_hex(24)
    source = root / "engine/backend/core/contained_subprocess.py"
    definition = importlib.util.spec_from_file_location("next_bootstrap_process_owner", source)
    owner = importlib.util.module_from_spec(definition)
    definition.loader.exec_module(owner)
    log = root / "doctor-health.log"
    with log.open("w", encoding="utf-8") as output:
        process = owner.spawn_owned([str(root / ".venv/Scripts/python.exe"), str(root / "bootstrap.py"), "--doctor-server", "--root", str(root), "--port", str(port), "--token", token],
                                    stdin=subprocess.PIPE, stdout=output, stderr=subprocess.STDOUT, env=doctor_environment(root), cwd=root)
        try:
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError("Silnik kandydata zakończył się przed /health. Szczegóły: doctor-health.log.")
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as response:
                        if response.status == 200 and response.headers.get("x-seventy-seven-doctor") == token:
                            with urllib.request.urlopen(f"http://127.0.0.1:{port}/model/status", timeout=3) as model_response:
                                if model_response.headers.get("x-seventy-seven-doctor") != token:
                                    raise RuntimeError("Brak znacznika własności statusu modeli.")
                                model_state = json.load(model_response)
                            if model_state.get("loaded") or model_state.get("loading"):
                                raise RuntimeError("Doctor nie powinien wczytywać wag modelu.")
                            return {"status": 200, "owned": True, "isolatedData": True, "modelsLoaded": False}
                except OSError:
                    pass
                time.sleep(0.25)
            raise TimeoutError("Silnik kandydata nie potwierdził /health w ciągu 5 minut. Szczegóły: doctor-health.log.")
        finally:
            process.stdin.close()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=5)


def install(root, profile, manifest, *, runner=run, health_probe=probe_health):
    selected_plan = plan(profile, manifest)
    if shutil.disk_usage(root).free < selected_plan["minimumFreeGb"] * 1024 ** 3:
        raise ValueError(f"Instalacja {profile.upper()} wymaga co najmniej {selected_plan['minimumFreeGb']} GB wolnego miejsca, bez wag modeli.")
    workspace = prepare_build_workspace(root, profile)
    emit("engine", f"Prywatny cache budowania: {workspace['path']}. Pozostaje zachowany także po błędzie lub anulowaniu; bez globalnego cache.")
    def prepared_runner(command, *, cwd):
        with build_environment(workspace):
            return runner(command, cwd=cwd)
    emit("engine", "Weryfikacja SHA-256 i wypakowanie prywatnych źródeł silnika.")
    extract_engine(root, manifest)
    pipeline = commands(root, profile, build_workspace=workspace)
    emit("lock", "Eksport przypiętego uv.lock bez odświeżania wersji.")
    prepared_runner(pipeline["lock"], cwd=root)
    requirements = root / "requirements.lock.txt"
    if profile == "cpu":
        requirements.write_text(cpu_requirements(requirements.read_text(encoding="utf-8"), manifest["cpuWheels"]), encoding="utf-8")
    emit("venv", "Tworzenie osobnego środowiska Python.")
    prepared_runner(pipeline["venv"], cwd=root)
    emit("dependencies", "Pobieranie i instalacja zależności z kontrolą hashy. Pliki są kopiowane, bez hardlinków.")
    prepared_runner(pipeline["dependencies"], cwd=root)
    prepared_runner(pipeline["check"], cwd=root)
    emit("doctor", "Sprawdzanie importów, MCP SDK/pywin32, profilu CPU/CUDA i braku hardlinków.")
    evidence = doctor(root, profile, runner=prepared_runner)
    emit("health", "Uruchamianie silnika z odseparowaną bazą testową, bez modeli.")
    evidence["health"] = health_probe(root)
    if evidence["health"].get("status") != 200 or not evidence["health"].get("owned") or not evidence["health"].get("isolatedData"):
        raise ValueError("Brak prawidłowego potwierdzenia własności i izolacji /health.")
    evidence.update(profile=profile, lock_sha256=manifest["engine"]["lockSha256"], source_archive_sha256=manifest["engine"]["archiveSha256"],
                    dependencies="uv.lock + require-hashes + copy", synthesize_tested=False, build_workspace=workspace)
    atomic_json(root / "python-ready.json", {"independent": True, "python": str(root / ".venv/Scripts/python.exe"), "dependencies": evidence["dependencies"]})
    atomic_json(root / "installation-ready.json", evidence)
    emit("ready", "Kandydat przeszedł doctor i /health. Możesz osobno aktywować nowe środowisko; modele pozostają do pobrania.")
    return evidence


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


def use_source_version(engine):
    """Doctor serves the pinned sources, independently of installed metadata."""
    project = tomllib.loads((engine / "pyproject.toml").read_text(encoding="utf-8-sig")).get("project", {})
    version = project.get("version") if isinstance(project, dict) else None
    if not isinstance(version, str) or not version.strip():
        raise ValueError("Brak wersji w zweryfikowanych źródłach silnika.")
    import core.version as engine_version
    engine_version.APP_VERSION = version
    return version


def doctor_server(root, port, token):
    _start_parent_watchdog(0)
    configure_windows_runtime_paths()
    sys.path[:0] = [str(root / "engine"), str(root / "engine/backend")]
    os.chdir(root / "engine/backend")
    use_source_version(root / "engine")
    import main as backend
    import uvicorn
    class Marked:
        async def __call__(self, scope, receive, send):
            async def marked(message):
                if message["type"] == "http.response.start":
                    message.setdefault("headers", []).append((b"x-seventy-seven-doctor", token.encode("ascii")))
                await send(message)
            await backend.app(scope, receive, marked)
    uvicorn.run(Marked(), host="127.0.0.1", port=port, log_level="warning")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--profile", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--plan", action="store_true")
    parser.add_argument("--doctor-server", action="store_true")
    parser.add_argument("--port", type=int)
    parser.add_argument("--token")
    args = parser.parse_args()
    root = validate_root(args.root)
    if args.doctor_server:
        if not args.port or not args.token:
            raise ValueError("Brak parametrów doctor server.")
        return doctor_server(root, args.port, args.token)
    manifest = json.loads((root / "bootstrap-provenance.json").read_text(encoding="utf-8"))
    if args.plan:
        print(json.dumps(plan(args.profile, manifest), ensure_ascii=False, indent=2)); return
    if os.environ.get("SEVENTY_SEVEN_INSTALLER_OWNED") != "1":
        raise ValueError("Instalację uruchom przyciskiem w aplikacji. Wymagany jest nadzór własnego drzewa procesów.")
    install(root, args.profile, manifest)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("failed", str(error)); raise SystemExit(1)
