"""Private, desktop-owned VoiceStudio Next backend. Embedded in the Tauri EXE."""

from pathlib import Path as _SourcePath
import sys as _source_sys
_source_layout = _SourcePath(__file__).resolve().parent.parent
if (_source_layout / "app/launcher.py").is_file() and (_source_layout / "install/bootstrap.py").is_file():
    for _source_dir in ("app", "install"):
        _source_sys.path.insert(0, str(_source_layout / _source_dir))

import sys
sys.dont_write_bytecode = True
from pathlib import Path
import json
import os
import shutil
import sqlite3
import zipfile


ROOT = Path(__file__).resolve().parent
PROJECT = ROOT / "engine"
DATA = ROOT.parent / "data"
PORT = 4312


def stage(name):
    """Tell the supervisor which pre-server startup stage began (read from engine.log)."""
    print("NEXT_STARTUP_EVENT " + json.dumps({"stage": name}), flush=True)


def prepare_engine():
    """Publish one immutable source generation; never overwrite an old engine.

    The archive digest and adapter version select the generation. A partial
    extraction stays in a private staging directory and cannot become PROJECT.
    This function imports no upstream modules and never migrates a database.
    """
    import ast
    import hashlib
    import stat
    import tempfile
    import time
    import tomllib

    global PROJECT
    adapter_version = 3
    contracts = {
        "direct-preload": "app.state.preload_task = asyncio.create_task(preload_model())",
        "reconcile-preload": "app.state.preload_task = asyncio.create_task(_preload_after_reconcile())",
    }
    required = {"backend/main.py", "backend/core/config.py", "omnivoice/__init__.py", "LICENSE", "pyproject.toml", "uv.lock"}

    def digest_file(path):
        with open(path, "rb") as handle:
            return hashlib.file_digest(handle, "sha256").hexdigest()

    def safe_member(name):
        parts = name.rstrip("/").split("/")
        if not parts or any(not part or part in (".", "..") or ":" in part or "\\" in part or any(ord(char) < 32 for char in part) for part in parts):
            raise RuntimeError("Archiwum silnika zawiera niebezpieczną ścieżkę.")
        return "/".join(parts)

    def verify_generation(path, expected_digest, expected_names):
        if path.is_symlink() or not path.is_dir():
            return False
        try:
            manifest = json.loads((path / ".engine-ready.json").read_text(encoding="utf-8"))
            hashes = manifest.get("fileSha256", {})
            if manifest.get("adapterVersion") != adapter_version or manifest.get("archiveSha256") != expected_digest or manifest.get("preloadContract") not in contracts or set(hashes) != expected_names:
                return False
            for relative, expected in hashes.items():
                item = path / safe_member(relative)
                if item.is_symlink() or not item.resolve().is_relative_to(path.resolve()) or not item.is_file() or digest_file(item) != expected:
                    return False
            return True
        except (OSError, ValueError, TypeError, AttributeError, RuntimeError):
            return False

    generations = ROOT / "engines"
    if generations.is_symlink():
        raise RuntimeError("Katalog wersji silnika nie może być dowiązaniem.")
    generations.mkdir(parents=True, exist_ok=True)
    staging = None
    # Hash and extract the SAME open file, even if an updater replaces its name.
    source_bundle = ROOT.parent / "vendor/engine.zip"
    default_bundle = ROOT / "engine.zip"
    if not default_bundle.is_file() and source_bundle.is_file():
        default_bundle = source_bundle
    bundle = Path(os.environ.get("VOICESTUDIO_NEXT_BUNDLE", str(default_bundle)))
    with open(bundle, "rb") as source:
        archive_digest = hashlib.file_digest(source, "sha256").hexdigest()
        source.seek(0)
        with zipfile.ZipFile(source) as archive:
            files = []
            seen = set()
            for info in archive.infolist():
                # ZipInfo normalizes Windows backslashes while reading. Check
                # the original archive spelling, including NUL/control bytes.
                relative = safe_member(info.orig_filename)
                mode = info.external_attr >> 16
                if stat.S_ISLNK(mode) or stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
                    raise RuntimeError("Archiwum silnika zawiera dowiązanie lub plik specjalny.")
                if info.is_dir():
                    continue
                if relative.casefold() in seen:
                    raise RuntimeError("Archiwum silnika zawiera powtórzoną nazwę pliku.")
                seen.add(relative.casefold())
                files.append((info, relative))
            names = {relative for _, relative in files}
            if not required.issubset(names) or len(files) > 20000 or sum(info.file_size for info, _ in files) > 512 * 1024 * 1024:
                raise RuntimeError("Niepełne lub zbyt duże archiwum źródeł silnika.")
            generation_key = f"engine-{archive_digest[:20]}-a{adapter_version}"
            pointer = generations / f".{generation_key}.json"
            destination = generations / generation_key
            if pointer.exists():
                selection = json.loads(pointer.read_text(encoding="utf-8"))
                name = selection.get("generation", "")
                if not isinstance(name, str) or not name.startswith(generation_key + "-") or name != Path(name).name or any(char in name for char in "/\\:"):
                    raise RuntimeError("Nieprawidłowy plik wyboru wersji silnika. Zachowano go bez zmian.")
                destination = generations / name
            if destination.exists():
                if not verify_generation(destination, archive_digest, names):
                    raise RuntimeError("Istniejąca wersja silnika jest niekompletna lub zmieniona. Zachowano ją bez nadpisania; odtwórz tę wersję z archiwum przed startem.")
                PROJECT = destination
                return PROJECT
            try:
                # Windows indexers may hold directory handles without
                # FILE_SHARE_DELETE. Never rename this observed directory:
                # publish its unique name through a tiny atomic pointer.
                staging = Path(tempfile.mkdtemp(prefix=generation_key + "-", dir=generations)).resolve()
                for info, relative in files:
                    target = staging / relative
                    if not target.resolve().is_relative_to(staging):
                        raise RuntimeError("Niebezpieczna ścieżka podczas rozpakowywania silnika.")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(info) as incoming, open(target, "xb") as outgoing:
                        shutil.copyfileobj(incoming, outgoing)
                main = staging / "backend/main.py"
                body = main.read_text(encoding="utf-8-sig")
                matching = [(name, expression) for name, expression in contracts.items() if body.count(expression) == 1]
                if len(matching) != 1 or "VOICESTUDIO_NEXT_PRELOAD_TTS" in body:
                    raise RuntimeError("Nieznany kontrakt rozruchu silnika (Bundled engine preload contract changed).")
                contract, expression = matching[0]
                body = body.replace(expression, expression + " if _env_flag('VOICESTUDIO_NEXT_PRELOAD_TTS', default=False) else None")
                # The private runtime must not search parent folders for a
                # global .env. The explicit app-owned file is loaded below too.
                if "dotenv.load_dotenv()" in body:
                    body = body.replace("dotenv.load_dotenv()", "dotenv.load_dotenv(os.environ['OMNIVOICE_ENV_FILE'], override=False) if os.environ.get('OMNIVOICE_ENV_FILE') else None")
                ast.parse(body, filename="backend/main.py")
                main.write_text(body, encoding="utf-8", newline="\n")
                metadata = tomllib.loads((staging / "pyproject.toml").read_text(encoding="utf-8-sig"))
                manifest = {"formatVersion": 1, "archiveSha256": archive_digest, "adapterVersion": adapter_version,
                            "preloadContract": contract, "version": metadata.get("project", {}).get("version"),
                            "fileSha256": {relative: digest_file(staging / relative) for _, relative in files}}
                (staging / ".engine-ready.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
                if not verify_generation(staging, archive_digest, names):
                    raise RuntimeError("Nie udało się potwierdzić kompletności nowej wersji silnika.")
                descriptor, temporary_name = tempfile.mkstemp(prefix=f".{generation_key}.", suffix=".tmp", dir=generations)
                temporary_pointer = Path(temporary_name)
                try:
                    with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
                        json.dump({"generation": staging.name, "archiveSha256": archive_digest, "adapterVersion": adapter_version}, handle)
                        handle.flush(); os.fsync(handle.fileno())
                    # All our file handles are closed. Bound transient AV /
                    # sharing violations; never replace a whole source tree.
                    for attempt, delay in enumerate((0.05, 0.1, 0.2, 0.4, 0.8, 1.0)):
                        try:
                            os.replace(temporary_pointer, pointer)
                            break
                        except OSError as error:
                            if getattr(error, "winerror", None) not in (5, 32, 33) or attempt == 5:
                                raise
                            time.sleep(delay)
                finally:
                    temporary_pointer.unlink(missing_ok=True)
                PROJECT = staging
                staging = None  # published and immutable; cleanup must not remove it
                return PROJECT
            finally:
                # Delete only our checked staging directory, never an old engine.
                if staging is not None and staging.exists() and staging.parent == generations.resolve() and staging.name.startswith(generation_key + "-") and not staging.is_symlink():
                    shutil.rmtree(staging, ignore_errors=True)


def configure_environment():
    DATA.mkdir(parents=True, exist_ok=True)
    from runtime_backup import _no_links
    temporary = ROOT / "temp"
    _no_links(temporary)
    temporary.mkdir(parents=True, exist_ok=True)
    os.environ["TEMP"] = os.environ["TMP"] = str(temporary)
    import tempfile
    tempfile.tempdir = None
    # Bytecode goes to a private prefix, never into the immutable engine generations
    # or hardlinked site-packages; recompiling ~25k sources on every start is waste.
    pycache = ROOT / "pycache"
    _no_links(pycache)
    pycache.mkdir(parents=True, exist_ok=True)
    sys.pycache_prefix = str(pycache)
    sys.dont_write_bytecode = False
    from model_management import selected_model_cache
    model_cache = selected_model_cache(ROOT, DATA)
    # No global .env, app settings, mutable model caches, or auth are inherited.
    for key in list(os.environ):
        if key.startswith(("OMNIVOICE_", "HF_", "HUGGINGFACE_")):
            del os.environ[key]
    os.environ.update({
        "OMNIVOICE_DATA_DIR": str(DATA),
        "OMNIVOICE_ENV_FILE": str(DATA / "environment"),
        "OMNIVOICE_PORT": str(PORT),
        "OMNIVOICE_CACHE_DIR": str(model_cache),
        "HF_HOME": str(DATA / "hf-auth"),
        "HF_TOKEN_PATH": str(DATA / "hf-auth" / "token"),
        "HF_STORED_TOKENS_PATH": str(DATA / "hf-auth" / "stored_tokens"),
        "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
        "OMNIVOICE_PRELOAD_CAPTURE_ASR": "0", "OMNIVOICE_PRELOAD_WATERMARK": "0",
        "OMNIVOICE_PRELOAD_TTS_ASR": "0", "OMNIVOICE_MCP_DISABLE": "1",
        "OMNIVOICE_STARTUP_WATCHDOG_S": "120",
        "OMNIVOICE_ALLOWED_ORIGINS": "http://tauri.localhost,tauri://localhost" + (",http://127.0.0.1:4310,http://localhost:4310" if os.environ.get("VOICESTUDIO_DEV_ORIGINS") == "1" else ""),
        "OMNIVOICE_DESKTOP_CONTAINED": "1",
        # The engine ships opt-in PostHog analytics with an upstream destination; this app never sends it.
        "OMNIVOICE_ANALYTICS_DISABLED": "1",
        "PYTHONPYCACHEPREFIX": str(pycache), "PYTHONUTF8": "1",
    })
    os.environ.pop("PYTHONDONTWRITEBYTECODE", None)
    # imageio validates its own ffmpeg with an unbounded `-version` call (one start
    # hung >120 s on an AV scan). The explicit path skips that check; the engine's
    # own probe of the same file still runs with a 10 s timeout.
    ffmpeg = sorted((Path(sys.prefix) / "Lib" / "site-packages" / "imageio_ffmpeg" / "binaries").glob("ffmpeg-*.exe"))
    if ffmpeg:
        os.environ["IMAGEIO_FFMPEG_EXE"] = str(ffmpeg[-1])
    os.chdir(PROJECT / "backend")
    sys.path.insert(0, str(PROJECT))
    sys.path.insert(0, str(PROJECT / "backend"))


def import_profiles():
    """One-time, read-only transaction on old DB; copy only voice profile data.

    Other history/projects/outputs are not silently imported with broken links.
    The old app can remain open: SQLite supplies a consistent read snapshot.
    """
    marker = DATA / "profiles-import.json"
    in_progress = DATA / ".profiles-import-started"
    if marker.exists() or ((DATA / "omnivoice.db").exists() and not in_progress.exists()):
        return
    old_data = Path(os.environ["APPDATA"]) / "OmniVoice"
    old_db = old_data / "omnivoice.db"
    if not old_db.is_file():
        marker.write_text(json.dumps({"count": 0, "source": None}), encoding="utf-8")
        return
    in_progress.write_text(str(old_db), encoding="utf-8")
    from core.db import init_db
    init_db()
    count = 0
    source = sqlite3.connect(old_db.as_uri() + "?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    destination = sqlite3.connect(DATA / "omnivoice.db")
    try:
        source.execute("BEGIN")
        fields = {row[1] for row in destination.execute("PRAGMA table_info(voice_profiles)")}
        for row in source.execute("SELECT * FROM voice_profiles"):
            record = {key: row[key] for key in row.keys() if key in fields}
            for field in ("ref_audio_path", "locked_audio_path", "consent_audio_path"):
                raw = record.get(field)
                if not raw:
                    continue
                original = Path(raw)
                original = original if original.is_absolute() else old_data / "voices" / original
                original = original.resolve()
                if not original.is_relative_to((old_data / "voices").resolve()):
                    # Do not retain a writable reference into the old application.
                    record[field] = ""
                    continue
                relative = original.relative_to((old_data / "voices").resolve())
                target = DATA / "voices" / relative
                if original.is_file():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(original, target)
                    record[field] = str(relative)
                else:
                    record[field] = ""
            names = list(record)
            destination.execute(f"INSERT OR IGNORE INTO voice_profiles ({','.join(names)}) VALUES ({','.join('?' for _ in names)})", [record[key] for key in names])
            count += 1
        destination.commit()
    finally:
        source.close()
        destination.close()
    marker.write_text(json.dumps({"count": count, "source": str(old_db), "scope": "voice_profiles and referenced voice files only"}, indent=2), encoding="utf-8")
    in_progress.unlink(missing_ok=True)
    print(f"Imported {count} voice profiles into private Next data directory", flush=True)


def owned_backend(app, token):
    """ASGI wrapper that stamps every HTTP response with the per-run ownership marker (a marker, not an access control)."""
    class OwnedBackend:
        async def __call__(self, scope, receive, send):
            async def marked(message):
                if message["type"] == "http.response.start":
                    message.setdefault("headers", []).append((b"x-voicestudio-next", token.encode("ascii")))
                await send(message)
            await app(scope, receive, marked)
    return OwnedBackend()


def resolve_data_or_default():
    from storage_settings import apply_pending_data_relocation
    try:
        return apply_pending_data_relocation(ROOT)
    except (ValueError, OSError, RuntimeError) as error:
        # A damaged pointer file must not block the engine for good; it is left untouched.
        print(f"Nie udało się odczytać wybranej lokalizacji danych ({error}). Uruchamiam z domyślnym katalogiem danych; plik wyboru zachowano bez zmian.", flush=True)
        return ROOT.parent / "data"


def backup_with_recovery(data, archive_sha256):
    """Back up; an unreadable receipt of an earlier backup is moved aside and the backup redone."""
    from runtime_backup import StaleMarkerError, backup_before_upgrade, move_marker_aside
    try:
        return backup_before_upgrade(data, archive_sha256)
    except StaleMarkerError as error:
        aside = move_marker_aside(data, archive_sha256)
        print(f"{error} Znacznik przeniesiono do {aside.name}; tworzę nową kopię.", flush=True)
        return backup_before_upgrade(data, archive_sha256)


def main():
    global DATA
    DATA = resolve_data_or_default()
    stage("engine_files")
    prepare_engine()
    configure_environment()
    stage("backup")
    source_manifest = json.loads((PROJECT / ".engine-ready.json").read_text(encoding="utf-8"))
    backup_with_recovery(DATA, source_manifest["archiveSha256"])
    stage("modules")
    from windows_runtime_paths import configure_windows_runtime_paths
    configure_windows_runtime_paths()
    from integration_settings import apply_environment as apply_integration_environment
    apply_integration_environment(DATA)
    from integration_settings import use_source_version
    use_source_version(PROJECT)
    from tts_extensions import register as register_tts_extensions
    register_tts_extensions(ROOT)
    import_profiles()
    from system_settings import apply_environment as apply_system_environment
    apply_system_environment()
    import main as backend
    from audiobook_streaming import StreamingAudiobooks
    backend.app.add_middleware(StreamingAudiobooks)
    from engine_catalogue_metadata import configure_engine_catalogue
    configure_engine_catalogue(backend.app, engine_path=PROJECT, runtime_root=ROOT, data_dir=DATA, startup_module=backend)
    from integration_settings import configure_local_mcp_origin
    configure_local_mcp_origin(backend.app)
    from ai_tagging import create_router
    backend.app.include_router(create_router(DATA))
    from model_management import create_router as create_model_router
    backend.app.include_router(create_model_router(ROOT, DATA, engine_path=PROJECT))
    from storage_settings import create_router as create_storage_router
    backend.app.include_router(create_storage_router(ROOT, DATA))
    from system_settings import create_router as create_system_settings_router
    backend.app.include_router(create_system_settings_router(ROOT, DATA))
    from general_settings import create_router as create_general_settings_router
    backend.app.include_router(create_general_settings_router(ROOT, DATA, engine_path=PROJECT))
    from remote_backend import create_router as create_remote_backend_router
    backend.app.include_router(create_remote_backend_router(DATA))
    from preview_cache import create_router as create_preview_cache_router
    backend.app.include_router(create_preview_cache_router(ROOT, DATA))
    from integration_settings import create_router as create_integration_router
    backend.app.include_router(create_integration_router(ROOT, DATA, engine_path=PROJECT))
    from engine_installation import create_router as create_engine_installation_router
    from activity import backend_work_busy
    backend.app.include_router(create_engine_installation_router(
        ROOT, DATA, engine_path=PROJECT,
        distribution_manifest=ROOT / "runtime-distribution.json", work_busy=backend_work_busy))
    from tts_extensions import create_router as create_tts_router
    backend.app.include_router(create_tts_router(ROOT))
    import uvicorn
    stage("server")
    # A per-launch marker prevents treating a foreign listener as our backend.
    token = os.environ.get("VOICESTUDIO_NEXT_TOKEN", "")
    from activity import Activity, backend_work_busy
    activity = Activity(backend.app, token, backend_work_busy)
    from remote_backend import ConnectionModeGuard
    connection_guard = ConnectionModeGuard(activity)

    uvicorn.run(owned_backend(connection_guard, token), host="127.0.0.1", port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
