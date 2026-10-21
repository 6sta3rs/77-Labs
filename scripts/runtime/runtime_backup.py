"""One immutable, pre-migration backup per archive SHA for EXISTING Next data.

Standard library only. Called after private environment configuration and before
profile import, backend imports, migrations or writes. Never imports upstream,
models or old VoiceStudio data. No restore/delete/prune operation is provided.
"""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import threading
import time
import uuid

OWNER = "Seventy Seven Labs pre-upgrade backup v1"
EVENT = "NEXT_BACKUP_EVENT "
MARKER_PREFIX = ".archive-"
_LOCK = threading.RLock()
_MODEL_DIRS = {"models", "hf_cache", "hf-cache", "model-cache", "model_cache", "engines", "tts-envs", "sidecars", "sidecar-cache", ".venv", "python", "wheel-cache", "downloads"}
_MODEL_SUFFIXES = {".safetensors", ".pt", ".pth", ".onnx", ".gguf", ".bin", ".ckpt"}


class BackupError(RuntimeError):
    pass


def emit(event):
    print(EVENT + json.dumps(event, ensure_ascii=False), flush=True)


def _is_link(path):
    info = path.lstat()
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & 0x400)


def _no_links(path):
    for current in (path, *path.parents):
        try:
            linked = _is_link(current)  # lstat catches even a broken symlink
        except FileNotFoundError:
            continue
        if linked:
            raise BackupError("Kopia danych nie może prowadzić przez dowiązanie ani junction. Nie rozpoczęto migracji.")


def _data_root(raw):
    requested = Path(raw)
    if not requested.is_absolute():
        raise BackupError("Backup wymaga bezwzględnej ścieżki prywatnych danych Next.")
    _no_links(requested)
    root = requested.resolve()
    if root.name.casefold() != "data":
        raise BackupError("Backup wymaga prywatnego katalogu DATA aplikacji Next.")
    protected = []
    for key in ("APPDATA", "LOCALAPPDATA"):
        if os.environ.get(key):
            appdata = Path(os.environ[key]).resolve()
            protected.extend(appdata / suffix for suffix in ("OmniVoice", "Programs/VoiceStudio"))
    if any(root == old or root.is_relative_to(old) for old in protected):
        raise BackupError("Nie wolno tworzyć tej kopii w starej instalacji ani danych VoiceStudio.")
    return root


def _sha(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def _write_new(path, value):
    _no_links(path)
    # Exclusive creation is intentional: a corrupt/partial marker never gets
    # silently replaced. Incomplete backups remain available for inspection.
    try:
        with path.open("x", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n"); stream.flush(); os.fsync(stream.fileno())
    except FileExistsError as exc:
        raise BackupError("Plik kopii lub jej znacznika już istnieje. Zachowano go bez nadpisania.") from exc


@contextmanager
def _locked(backups):
    path = backups / ".runtime-backup.lock"
    _no_links(path)
    if path.exists() and path.stat().st_nlink > 1:
        raise BackupError("Plik blokady backupu jest współdzielony. Nie rozpoczęto migracji.")
    with _LOCK, path.open("a+b") as stream:
        if stream.tell() == 0:
            stream.write(b"0"); stream.flush()
        stream.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                deadline = time.monotonic() + 10
                while True:
                    try:
                        msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                        break
                    except OSError as exc:
                        if time.monotonic() >= deadline:
                            raise BackupError("Inny proces tworzy kopię danych. Poczekaj na jego zakończenie i uruchom silnik ponownie.") from exc
                        time.sleep(.1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
            yield
        finally:
            stream.seek(0)
            if os.name == "nt":
                try:
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                except OSError:
                    pass
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def _inventory(data):
    files, excluded = [], []
    for directory, dirs, names in os.walk(data, topdown=True, followlinks=False):
        current = Path(directory)
        for name in list(dirs):
            path = current / name
            relative = path.relative_to(data)
            if relative.parts[0].casefold() == "backups" or relative.parts[0].casefold() in _MODEL_DIRS:
                dirs.remove(name); excluded.append({"path": str(relative), "reason": "backup-or-model-storage"})
                continue  # never follow an excluded cache junction either
            _no_links(path)
        for name in names:
            path = current / name
            relative = path.relative_to(data)
            if current == data and (name == "omnivoice.db" or name in {"omnivoice.db-wal", "omnivoice.db-shm", "omnivoice.db-journal"}):
                continue  # transactional snapshot, not a raw copy of WAL files
            if path.suffix.casefold() in _MODEL_SUFFIXES:
                excluded.append({"path": str(relative), "reason": "model-artifact"}); continue
            _no_links(path)
            info = path.stat()
            if not stat.S_ISREG(info.st_mode):
                raise BackupError("Dane zawierają plik specjalny. Nie rozpoczęto migracji.")
            files.append((path, relative, info))
    return files, excluded


def _same_file_state(left, right):
    return (left.st_dev, left.st_ino, left.st_size, left.st_mtime_ns) == (right.st_dev, right.st_ino, right.st_size, right.st_mtime_ns)


def _copy_stable(source, destination, planned, progress):
    _no_links(source); _no_links(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    hasher = hashlib.sha256()
    copied = 0
    with source.open("rb") as incoming, destination.open("xb") as outgoing:
        if not _same_file_state(planned, os.fstat(incoming.fileno())):
            raise BackupError("Pliki danych zmieniły się podczas backupu. Zamknij inne okno studia i ponów start; migracja nie została rozpoczęta.")
        while block := incoming.read(1024 * 1024):
            outgoing.write(block); hasher.update(block); copied += len(block); progress(len(block))
        outgoing.flush(); os.fsync(outgoing.fileno())
    if copied != planned.st_size or not _same_file_state(planned, source.stat()):
        raise BackupError("Plik źródłowy zmienił się podczas kopii. Zachowano niedokończony backup; nie rozpoczęto migracji.")
    shutil.copystat(source, destination, follow_symlinks=False)
    if destination.stat().st_nlink != 1 or _sha(destination) != hasher.hexdigest():
        raise BackupError("Nie potwierdzono niezależnej kopii pliku. Nie rozpoczęto migracji.")
    return {"bytes": copied, "sha256": hasher.hexdigest()}


def _read_existing_marker(data, marker, archive_sha):
    try:
        _no_links(marker)
        value = json.loads(marker.read_text(encoding="utf-8"))
        identifier = value["backup_id"]
        if value.get("schema") != 1 or value.get("owner") != OWNER or value.get("archive_sha256") != archive_sha or not re.fullmatch(r"backup-[0-9TZ-]+-[a-f0-9]{12}-[a-f0-9]{12}", identifier):
            raise ValueError("bad marker")
        backup = data / "backups" / identifier
        _no_links(backup)
        manifest = backup / "backup-manifest.json"
        _no_links(manifest)
        if _sha(manifest) != value["manifest_sha256"]:
            raise ValueError("manifest mismatch")
        details = json.loads(manifest.read_text(encoding="utf-8"))
        if details.get("schema") != 1 or details.get("complete") is not True or details.get("owner") != OWNER or details.get("archive_sha256") != archive_sha or details.get("backup_id") != identifier:
            raise ValueError("incomplete manifest")
        for relative, evidence in details["files"].items():
            raw = Path(relative)
            if not relative or relative.startswith(("/", "\\")) or raw.is_absolute() or ".." in raw.parts or "\\" in relative or ":" in relative:
                raise ValueError("unsafe backup member")
            file = backup / "data" / raw
            _no_links(file)
            if not file.resolve().is_relative_to((backup / "data").resolve()):
                raise ValueError("backup member escaped its data root")
            if not file.is_file() or file.stat().st_size != evidence["bytes"]:
                raise ValueError("missing backup data")
        database = backup / "data/omnivoice.db"
        if _sha(database) != details["files"]["omnivoice.db"]["sha256"]:
            raise ValueError("database checksum mismatch")
        return {"status": "already_backed_up", "archive_sha256": archive_sha, "backup_id": identifier, "backup_dir": str(backup), "files": len(details["files"])}
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise BackupError("Znacznik istniejącej kopii danych jest uszkodzony lub kopia jest niekompletna. Zachowano ją bez nadpisania. Zweryfikuj DATA/backups przed uruchomieniem migracji.") from exc


def backup_before_upgrade(data: Path, archive_sha256: str, *, previous_archive_sha256: str | None = None,
                          event_writer=emit, disk_usage=shutil.disk_usage, on_snapshot=None):
    """Return only after a complete backup or a valid prior receipt.

    Exceptions MUST stop the launcher before migrations. Existing data is never
    restored/edited here. previous_archive_sha256 is provenance only, optional.
    on_snapshot is a fixture seam; production callers should leave it unset.
    """
    if not isinstance(archive_sha256, str) or not re.fullmatch(r"[a-f0-9]{64}", archive_sha256):
        raise BackupError("Brak prawidłowego SHA-256 nowego archiwum; nie rozpoczęto migracji.")
    if previous_archive_sha256 is not None and not re.fullmatch(r"[a-f0-9]{64}", previous_archive_sha256):
        raise BackupError("Nieprawidłowy SHA poprzedniego archiwum.")
    data = _data_root(data)
    database = data / "omnivoice.db"
    _no_links(database)
    if not database.exists():
        return {"status": "no_database", "archive_sha256": archive_sha256}
    if not database.is_file() or database.stat().st_nlink != 1:
        raise BackupError("Baza Next musi być niezależnym plikiem, bez współdzielonych hardlinków. Nie rozpoczęto migracji.")
    # SQLite may access live WAL/SHM even through a read-only main connection.
    # Validate those paths BEFORE it opens the database; never follow a link
    # into the old application or share its mutable lock/read-mark pages.
    for suffix in ("-wal", "-shm", "-journal"):
        auxiliary = data / ("omnivoice.db" + suffix)
        _no_links(auxiliary)
        if auxiliary.exists() and (not auxiliary.is_file() or auxiliary.stat().st_nlink != 1):
            raise BackupError("Pliki WAL/SHM bazy muszą należeć wyłącznie do danych Next. Nie rozpoczęto migracji.")
    backups = data / "backups"
    _no_links(backups)
    try:
        backups.mkdir(exist_ok=True)
    except OSError as exc:
        raise BackupError("Nie można przygotować katalogu kopii danych. Sprawdź wolne miejsce i uprawnienia; nie rozpoczęto migracji.") from exc
    marker = backups / (MARKER_PREFIX + archive_sha256 + ".json")
    with _locked(backups):
        if marker.exists():
            return _read_existing_marker(data, marker, archive_sha256)
        event_writer({"phase": "backup_plan", "message": "Przygotowanie spójnej kopii istniejących danych przed aktualizacją.", "archive_sha256": archive_sha256})
        try:
            planned, excluded = _inventory(data)
            source = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=5)
        except (OSError, sqlite3.Error) as exc:
            raise BackupError("Nie można odczytać danych do kopii. Zamknij inne okno studia i sprawdź uprawnienia; nie rozpoczęto migracji.") from exc
        backup = None
        try:
            source.execute("BEGIN")
            source.execute("SELECT name FROM sqlite_master LIMIT 1").fetchone()  # establish the WAL read snapshot
            pages = source.execute("PRAGMA page_count").fetchone()[0]
            page_size = source.execute("PRAGMA page_size").fetchone()[0]
            logical_db = pages * page_size
            payload = logical_db + sum(info.st_size for _, _, info in planned)
            required = payload + max(64 * 1024**2, payload // 10)
            free = disk_usage(data).free
            if free < required:
                raise BackupError(f"Za mało miejsca na kopię danych: potrzeba {required} bajtów z zapasem, dostępne {free}. Zwolnij miejsce przed aktualizacją; nie rozpoczęto migracji.")
            identifier = "backup-" + time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + archive_sha256[:12] + "-" + uuid.uuid4().hex[:12]
            backup = backups / identifier
            _no_links(backup)
            backup.mkdir(mode=0o700)
            target = backup / "data"
            target.mkdir()
            _write_new(backup / ".backup-owner.json", {"owner": OWNER, "backup_id": identifier, "archive_sha256": archive_sha256})
            if on_snapshot:
                on_snapshot()
            destination_path = target / "omnivoice.db"
            with destination_path.open("xb"):
                pass
            destination = sqlite3.connect(destination_path)
            last_emit = 0.0
            database_deadline = time.monotonic() + 120
            def database_progress(status, remaining, total):
                nonlocal last_emit
                if time.monotonic() > database_deadline:
                    raise BackupError("SQLite nie udostępnił spójnej kopii w ciągu 2 minut. Zamknij inne okna studia i ponów start; nie rozpoczęto migracji.")
                if time.monotonic() - last_emit > .25 or remaining == 0:
                    event_writer({"phase": "backup_database", "message": "Kopia transakcyjna SQLite, z uwzględnieniem WAL.", "copied_pages": total - remaining, "total_pages": total})
                    last_emit = time.monotonic()
            try:
                source.backup(destination, pages=128, progress=database_progress, sleep=.05)
                destination.execute("PRAGMA journal_mode=DELETE").fetchone()
                if destination.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                    raise BackupError("SQLite nie potwierdził integralności kopii. Nie rozpoczęto migracji.")
                destination.commit()
            finally:
                destination.close()
            files = {"omnivoice.db": {"bytes": destination_path.stat().st_size, "sha256": _sha(destination_path), "method": "sqlite-backup-api"}}
            copied_bytes, total_bytes = 0, sum(info.st_size for _, _, info in planned)
            def copied(amount):
                nonlocal copied_bytes, last_emit
                copied_bytes += amount
                if time.monotonic() - last_emit > .25 or copied_bytes == total_bytes:
                    event_writer({"phase": "backup_files", "message": "Kopiowanie nagrań, profili i ustawień bez modeli.", "copied_bytes": copied_bytes, "total_bytes": total_bytes})
                    last_emit = time.monotonic()
            for path, relative, info in planned:
                files[relative.as_posix()] = _copy_stable(path, target / relative, info, copied)
            manifest = {"schema": 1, "owner": OWNER, "backup_id": identifier, "complete": True, "archive_sha256": archive_sha256,
                        "previous_archive_sha256": previous_archive_sha256, "created_at": time.time(), "source_data": str(data),
                        "database_snapshot": "SQLite backup API with held read transaction; standalone DELETE journal snapshot",
                        "files": files, "excluded": excluded, "models_included": False}
            _write_new(backup / "backup-manifest.json", manifest)
            _write_new(marker, {"schema": 1, "owner": OWNER, "archive_sha256": archive_sha256, "backup_id": identifier,
                                "manifest_sha256": _sha(backup / "backup-manifest.json")})
            event_writer({"phase": "backup_complete", "message": "Spójna kopia danych została zapisana. Można rozpocząć migrację prywatnego silnika.", "backup_id": identifier, "files": len(files), "copied_bytes": copied_bytes + files["omnivoice.db"]["bytes"]})
            return {"status": "created", "archive_sha256": archive_sha256, "backup_id": identifier, "backup_dir": str(backup), "files": len(files)}
        except (OSError, sqlite3.Error) as exc:
            raise BackupError("Nie udało się utworzyć pełnej kopii danych. Nie rozpoczęto migracji; częściowy katalog kopii pozostawiono do inspekcji. " + type(exc).__name__) from exc
        finally:
            source.close()
