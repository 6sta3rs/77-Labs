"""Private storage settings. Relocation copies, verifies, then activates on restart.

The source is retained. No global VoiceStudio directory or shared model/library
file is ever modified. Standard-library path resolution also works before the
backend imports or applies database migrations.
"""
from __future__ import annotations

from pathlib import Path as _SourcePath
import sys as _source_sys
_source_layout = _SourcePath(__file__).resolve().parent.parent
if (_source_layout / "app/launcher.py").is_file() and (_source_layout / "install/bootstrap.py").is_file():
    for _source_dir in ("app", "install"):
        _source_sys.path.insert(0, str(_source_layout / _source_dir))


import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import tempfile
import threading
import time
import uuid
from contextlib import closing, contextmanager

OWNER = "Seventy Seven Labs data storage v1"
POINTER = "storage-location.json"
MARKER = ".seventy-seven-data.json"
_lock = threading.RLock()


@contextmanager
def _selection_lock(runtime):
    from private_environment import _file_lock
    lock = Path(runtime) / ".storage-location.lock"
    _no_links(lock)
    if lock.exists() and lock.stat().st_nlink != 1:
        raise ValueError("Blokada wyboru katalogu danych nie może być współdzielona.")
    with _lock, _file_lock(lock):
        yield


def _no_links(path):
    from runtime_backup import _no_links as check
    check(Path(path))


def _json(path, fallback=None):
    _no_links(path)
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return fallback


def _write(path, value):
    from model_management import _atomic_json
    _no_links(path)
    _atomic_json(Path(path), value)


def _protected(runtime):
    result = [Path(runtime).resolve()]
    for key in ("APPDATA", "LOCALAPPDATA"):
        if os.environ.get(key):
            base = Path(os.environ[key]).resolve()
            result.extend((base / "OmniVoice", base / "Programs/VoiceStudio"))
    from model_management import read_cache_manifest
    manifest = read_cache_manifest(runtime)
    result.extend(Path(manifest[key]).resolve() for key in ("source", "path") if manifest.get(key))
    return result


def _data_path(runtime, raw):
    if not isinstance(raw, str) or not raw.strip() or any(ord(char) < 32 or ord(char) == 127 for char in raw):
        raise ValueError("Podaj pełną ścieżkę prywatnych danych.")
    if os.name == "nt" and (raw.startswith(("\\\\", "//", "\\?", "\\.")) or not re.match(r"^[A-Za-z]:[\\/]", raw)):
        raise ValueError("Wybierz lokalny katalog na dysku, np. D:\\SeventySevenLabs\\data. Ścieżki sieciowe i urządzeń nie są obsługiwane.")
    path = Path(raw).expanduser()
    if not path.is_absolute():
        raise ValueError("Katalog danych wymaga pełnej, bezwzględnej ścieżki.")
    _no_links(path)
    path = path.resolve()
    if path.name.casefold() != "data":
        raise ValueError("Ostatni folder ścieżki musi nazywać się data, np. D:\\SeventySevenLabs\\data.")
    if any(path == item or path.is_relative_to(item) or item.is_relative_to(path) for item in _protected(runtime)):
        raise ValueError("Wybierz osobny katalog poza silnikiem, modelami i starą instalacją VoiceStudio.")
    return path


def _selection(runtime):
    runtime = Path(runtime).resolve()
    value = _json(runtime / POINTER)
    if value is None:
        return {"schema": 1, "owner": OWNER, "active": str(runtime.parent / "data"), "pending": None, "last_error": None}
    if not isinstance(value, dict) or value.get("schema") != 1 or value.get("owner") != OWNER:
        raise ValueError("Uszkodzony plik wyboru danych. Zachowano go bez nadpisania.")
    _data_path(runtime, value.get("active"))
    return value


def resolve_data_dir(runtime: Path) -> Path:
    runtime = Path(runtime).resolve()
    path = _data_path(runtime, _selection(runtime)["active"])
    if path != runtime.parent / "data":
        receipt = _json(path / MARKER, {})
        if receipt.get("owner") != OWNER or receipt.get("schema") != 1 or receipt.get("status") != "complete":
            raise ValueError("Brak potwierdzenia kompletnej kopii aktywnego katalogu danych.")
    return path


def emit(event):
    print("NEXT_STORAGE_EVENT " + json.dumps(event, ensure_ascii=False), flush=True)


def _inventory(source):
    files = []
    for directory, dirs, names in os.walk(source, followlinks=False):
        root = Path(directory)
        _no_links(root)
        for name in dirs:
            _no_links(root / name)
        for name in names:
            item = root / name
            _no_links(item)
            info = item.stat()
            if not stat.S_ISREG(info.st_mode):
                raise ValueError("Dane zawierają plik specjalny. Kopia została zatrzymana.")
            if item == source / MARKER:
                continue
            if root == source and name in {"omnivoice.db-wal", "omnivoice.db-shm", "omnivoice.db-journal"}:
                if info.st_nlink != 1:
                    raise ValueError("WAL/SHM bazy nie mogą być współdzielonym hardlinkiem.")
                continue
            files.append((item, item.relative_to(source), info))
    return files


def _snapshot_database(source, target, progress):
    if source.stat().st_nlink != 1:
        raise ValueError("Baza danych nie może być współdzielonym hardlinkiem.")
    with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as incoming, closing(sqlite3.connect(target)) as outgoing:
        incoming.backup(outgoing, pages=128, progress=lambda _status, remaining, total: progress({"phase": "backup_database", "pages_done": total - remaining, "pages_total": total, "message": "Kopiowanie spójnego obrazu prywatnej bazy danych."}))
        if outgoing.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("Kontrola spójności kopii bazy nie powiodła się.")


def _relocated_path(value, source, target):
    if not isinstance(value, str) or not Path(value).is_absolute():
        return value
    original = Path(value)
    try:
        relative = original.relative_to(source)
    except ValueError:
        return value
    # Do not normalize traversal into a previously unrelated location.
    if ".." in relative.parts:
        raise ValueError("Zapisana ścieżka danych zawiera wyjście poza katalog źródłowy.")
    return str(target / relative)


def _rebase_json(value, source, target, key=""):
    if isinstance(value, dict):
        return {name: _rebase_json(child, source, target, name) for name, child in value.items()}
    if isinstance(value, list):
        return [_rebase_json(child, source, target, key) for child in value]
    if key.lower().endswith(("path", "_dir", "directory")) or key.lower() in {"ref_audio", "audio", "video", "output", "input", "file", "filename"}:
        return _relocated_path(value, source, target)
    return value


def _rebase_database(database, source, target):
    """Rewrite typed local file references in the COPY only; preserve prose."""
    with closing(sqlite3.connect(database)) as connection, connection:
        tables = [item[0] for item in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        for table in tables:
            quoted_table = '"' + table.replace('"', '""') + '"'
            columns = connection.execute(f"PRAGMA table_info({quoted_table})").fetchall()
            for info in columns:
                name = info[1]
                path_field, json_field = name.endswith("_path"), name.endswith("_json")
                if not path_field and not json_field:
                    continue
                quoted = '"' + name.replace('"', '""') + '"'
                # The upstream tables use ordinary rowid tables. WITHOUT ROWID
                # extensions are left untouched rather than guessed at.
                try:
                    rows = connection.execute(f"SELECT rowid, {quoted} FROM {quoted_table} WHERE typeof({quoted})='text'").fetchall()
                except sqlite3.OperationalError as error:
                    if "rowid" in str(error):
                        continue
                    raise
                for rowid, value in rows:
                    if path_field:
                        updated = _relocated_path(value, source, target)
                    else:
                        try:
                            decoded = json.loads(value)
                        except ValueError:
                            continue
                        rebased = _rebase_json(decoded, source, target)
                        updated = value if decoded == rebased else json.dumps(rebased, ensure_ascii=False)
                    if value != updated:
                        connection.execute(f"UPDATE {quoted_table} SET {quoted}=? WHERE rowid=?", (updated, rowid))
        if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("Nie potwierdzono spójności bazy po zmianie ścieżek prywatnej kopii.")


def apply_pending_data_relocation(runtime: Path, *, event_writer=emit) -> Path:
    """Call only at process startup, before upstream/data imports or migration."""
    runtime = Path(runtime).resolve()
    with _selection_lock(runtime):
        selection = _selection(runtime)
        source = resolve_data_dir(runtime)
        pending = selection.get("pending")
        if not pending:
            return source
        revision = 0
        def notify(event):
            nonlocal revision
            revision += 1
            event_writer({**event, "revision": revision})
        try:
            if not isinstance(pending, dict) or not re.fullmatch(r"[a-f0-9]{32}", pending.get("id", "")):
                raise ValueError("Nieprawidłowy plan przeniesienia danych.")
            target = _data_path(runtime, pending.get("destination"))
            if pending.get("source") != str(source) or target == source or target.is_relative_to(source) or source.is_relative_to(target):
                raise ValueError("Plan przeniesienia nie odpowiada bieżącym danym.")
            if not source.is_dir() or not (source / "omnivoice.db").is_file():
                raise ValueError("Brak źródłowej prywatnej bazy danych. Nie aktywowano pustej lokalizacji.")
            marker = _json(target / MARKER, {})
            if marker.get("owner") != OWNER or marker.get("id") != pending["id"] or marker.get("status") != "reserved" or any(item.name != MARKER for item in target.iterdir()):
                raise ValueError("Katalog docelowy zmienił się lub zawiera dane. Zachowano go bez nadpisania.")
            files = _inventory(source)
            total = sum(info.st_size for _, _, info in files)
            if shutil.disk_usage(target).free < total + max(64 * 1024 ** 2, total // 20):
                raise ValueError("Brak miejsca na niezależną kopię danych z zapasem. Dotychczasowe dane pozostają aktywne.")
            copied = 0
            def progress(amount):
                nonlocal copied
                copied += amount
                notify({"phase": "copy_files", "bytes_done": copied, "bytes_total": total, "message": "Kopiowanie danych do nowego katalogu; źródło pozostaje zachowane."})
            from runtime_backup import _copy_stable, _sha
            evidence = {}
            for item, relative, info in files:
                destination = target / relative
                if item == source / "omnivoice.db":
                    _snapshot_database(item, destination, notify)
                    _rebase_database(destination, source, target)
                    evidence[relative.as_posix()] = {"bytes": destination.stat().st_size, "sha256": _sha(destination)}
                    progress(info.st_size)
                else:
                    evidence[relative.as_posix()] = _copy_stable(item, destination, info, progress)
                    if destination.suffix.lower() == ".json" and relative.parts[0].lower() != "backups" and info.st_size <= 32 * 1024 ** 2:
                        try:
                            value = json.loads(destination.read_text(encoding="utf-8"))
                        except (UnicodeError, ValueError):
                            continue
                        rebased = _rebase_json(value, source, target)
                        if rebased != value:
                            _write(destination, rebased)
                            evidence[relative.as_posix()] = {"bytes": destination.stat().st_size, "sha256": _sha(destination)}
            _write(target / MARKER, {"schema": 1, "owner": OWNER, "id": pending["id"], "status": "complete", "source": str(source), "completed_at": time.time(), "files": evidence})
            activated = {**selection, "active": str(target), "pending": None, "last_error": None, "last_relocation": {"source": str(source), "destination": str(target), "completed_at": time.time(), "files": len(evidence), "source_retained": True}}
            # Keep the original selection immutable until the atomic pointer
            # write commits. Failure recovery must never publish the target
            # while returning the source to the running Python process.
            _write(runtime / POINTER, activated)
        except Exception as error:
            failed = {**selection, "pending": None, "last_error": f"Nie przeniesiono danych: {error}"}
            _write(runtime / POINTER, failed)
            try:
                notify({"phase": "relocation_failed", "message": failed["last_error"]})
            except Exception:
                pass  # Durable selection, not the log sink, owns recovery.
            return source
        # Activation is now durable. An unavailable progress/log sink cannot
        # roll the process back onto the old database after the native reader
        # has already selected the verified new copy.
        try:
            notify({"phase": "relocation_complete", "message": "Sprawdzono kopię i aktywowano nowy katalog danych. Źródło pozostaje zachowane.", "bytes_done": copied, "bytes_total": total})
        except Exception:
            pass
        return target


class StorageManager:
    def __init__(self, runtime: Path, data: Path, *, work_busy=None):
        self.runtime, self.data = Path(runtime).resolve(), Path(data).resolve()
        self.work_busy = work_busy
        self._report = None
        self._report_at = 0

    def _idle(self):
        from model_management import busy
        if busy() or (self.work_busy and self.work_busy()):
            raise ValueError("Zakończ aktywne zadania i pobieranie modeli przed zmianą danych lub kopią bazy.")

    def state(self):
        selection = _selection(self.runtime)
        from model_management import selected_model_cache
        return {"data_dir": str(self.data), "pending": selection.get("pending"), "last_error": selection.get("last_error"), "last_relocation": selection.get("last_relocation"), "model_default": str(self.runtime.parent / "models"), "model_configured": str(selected_model_cache(self.runtime, self.data)), "frontend_storage": "IndexedDB"}

    def relocate(self, raw):
        with _selection_lock(self.runtime):
            self._idle()
            selection = _selection(self.runtime)
            if selection.get("pending"):
                raise ValueError("Istnieje plan przeniesienia. Zastosuj go restartem lub anuluj przed kolejną zmianą.")
            target = _data_path(self.runtime, raw)
            from model_management import selected_model_cache
            cache = selected_model_cache(self.runtime, self.data)
            for item in (self.data, cache):
                if target == item or target.is_relative_to(item) or item.is_relative_to(target):
                    raise ValueError("Wybierz osobny katalog poza dotychczasowymi danymi i cache modeli.")
            if target.exists() and (not target.is_dir() or any(target.iterdir())):
                raise ValueError("Katalog docelowy musi być pusty. Istniejące dane nie zostaną nadpisane.")
            target.mkdir(parents=True, exist_ok=True)
            handle, probe = tempfile.mkstemp(prefix=".storage-write-", dir=target)
            os.close(handle); Path(probe).unlink()
            identifier = uuid.uuid4().hex
            _write(target / MARKER, {"schema": 1, "owner": OWNER, "id": identifier, "status": "reserved"})
            selection.update(pending={"id": identifier, "source": str(self.data), "destination": str(target), "requested_at": time.time()}, last_error=None)
            _write(self.runtime / POINTER, selection)
            return self.state()

    def cancel_relocation(self):
        with _selection_lock(self.runtime):
            selection = _selection(self.runtime)
            selection["pending"] = None
            _write(self.runtime / POINTER, selection)
            return self.state()

    def backups(self):
        result = []
        paths = list(self.data.glob("omnivoice.db.backup-*"))
        paths += list((self.data / "backups").glob("*/backup-manifest.json"))
        paths += list((self.data / "backups").glob("manual-*.db"))
        for item in paths:
            _no_links(item)
            if not item.is_file() or item.name.endswith((".reserve", ".part")) or ".part-" in item.name:
                continue
            info = item.stat()
            if item.name == "backup-manifest.json":
                value = _json(item, {})
                if not value.get("complete"):
                    continue
                size = sum(file.get("bytes", 0) for file in value.get("files", {}).values())
                kind = "Kopia danych przed aktualizacją"
            else:
                size, kind = info.st_size, "Kopia bazy danych"
            result.append({"path": str(item.parent if item.name == "backup-manifest.json" else item), "bytes": size, "created_at": info.st_mtime, "kind": kind})
        return {"backups": sorted(result, key=lambda item: item["created_at"], reverse=True)}

    def backup(self):
        with _lock:
            self._idle()
            source = self.data / "omnivoice.db"
            _no_links(source)
            for suffix in ("-wal", "-shm", "-journal"):
                auxiliary = Path(str(source) + suffix)
                _no_links(auxiliary)
                if auxiliary.exists() and auxiliary.stat().st_nlink != 1:
                    raise ValueError("Pliki WAL/SHM bazy nie mogą być współdzielone.")
            if not source.is_file():
                raise ValueError("Prywatna baza danych jeszcze nie istnieje.")
            directory = self.data / "backups"
            _no_links(directory)
            directory.mkdir(exist_ok=True)
            if shutil.disk_usage(directory).free < source.stat().st_size + 64 * 1024 ** 2:
                raise ValueError("Brak miejsca na kopię bazy z zapasem.")
            target = directory / f"manual-{time.strftime('%Y%m%dT%H%M%S')}-{uuid.uuid4().hex[:12]}.db"
            # Snapshot under a name backups() skips (.part); publish only after quick_check.
            temporary = target.with_name(target.name + ".part")
            try:
                _snapshot_database(source, temporary, lambda _event: None)
                os.replace(temporary, target)
            except BaseException:
                temporary.unlink(missing_ok=True)
                raise
            self._report = None
            return self.backups()

    def report(self, refresh=False):
        with _lock:
            if not refresh and self._report and time.monotonic() - self._report_at < 300:
                return {**self._report, "cached": True}
            from model_management import selected_model_cache
            cache = selected_model_cache(self.runtime, self.data)
            entries = [("data", "Głosy, projekty i nagrania silnika", self.data), ("models", "Cache modeli", cache), ("runtime", "Prywatny silnik i biblioteki", self.runtime)]
            categories, volumes = [], {}
            for identifier, label, path in entries:
                size, complete, errors = _directory_size(path, time.monotonic() + 3)
                categories.append({"id": identifier, "label": label, "path": str(path), "bytes": size, "complete": complete, "errors": errors})
                anchor = path
                while not anchor.exists() and anchor.parent != anchor:
                    anchor = anchor.parent
                try:
                    device = anchor.stat().st_dev
                    if device not in volumes:
                        usage = shutil.disk_usage(anchor)
                        volumes[device] = {"path": str(anchor.anchor), "total_bytes": usage.total, "free_bytes": usage.free, "used_bytes": usage.used, "low_space": usage.free < 5 * 1024 ** 3}
                except OSError:
                    pass
            self._report = {"generated_at": time.time(), "categories": categories, "volumes": list(volumes.values()), "logical_bytes": True}
            self._report_at = time.monotonic()
            return {**self._report, "cached": False}


def _directory_size(path, deadline):
    total, complete, errors = 0, True, []
    if not path.exists():
        return total, complete, errors
    try:
        _no_links(path)
    except (OSError, RuntimeError):
        return total, False, ["Katalog prowadzi przez dowiązanie; pomiar pominięto."]
    def onerror(_error):
        nonlocal complete
        complete = False
        if len(errors) < 3:
            errors.append("Nie można odczytać części katalogu.")
    for directory, dirs, files in os.walk(path, followlinks=False, onerror=onerror):
        if time.monotonic() > deadline:
            return total, False, errors + ["Przekroczono czas pomiaru; pokazano częściowy rozmiar."]
        for name in list(dirs):
            item = Path(directory) / name
            try:
                _no_links(item)
            except (OSError, RuntimeError):
                dirs.remove(name); onerror(None)
        for name in files:
            if time.monotonic() > deadline:
                return total, False, errors + ["Przekroczono czas pomiaru; pokazano częściowy rozmiar."]
            try:
                item = Path(directory) / name
                info = item.lstat()
                if not stat.S_ISLNK(info.st_mode) and not getattr(info, "st_file_attributes", 0) & 0x400:
                    total += info.st_size
            except OSError:
                onerror(None)
    return total, complete, errors


def create_router(runtime: Path, data: Path):
    from fastapi import APIRouter, Depends, HTTPException
    from pydantic import BaseModel
    from api.dependencies import require_admin
    from activity import backend_work_busy
    manager = StorageManager(runtime, data, work_busy=backend_work_busy)
    router = APIRouter(prefix="/next/storage", dependencies=[Depends(require_admin)])
    class RelocationBody(BaseModel):
        path: str
    globals()["RelocationBody"] = RelocationBody
    def call(function, *args):
        try:
            return function(*args)
        except (ValueError, OSError, RuntimeError, sqlite3.Error) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
    @router.get("/state")
    def state():
        return call(manager.state)
    @router.get("/report")
    def report(refresh: bool = False):
        return call(manager.report, refresh)
    @router.post("/relocation")
    def relocate(body: RelocationBody):
        return call(manager.relocate, body.path)
    @router.delete("/relocation")
    def cancel():
        return call(manager.cancel_relocation)
    @router.get("/backups")
    def backups():
        return call(manager.backups)
    @router.post("/backup")
    def backup():
        return call(manager.backup)
    @router.put("/models/reset")
    def reset_models():
        from model_management import _manager
        if _manager is None:
            raise HTTPException(status_code=503, detail="Menedżer modeli jeszcze nie jest gotowy.")
        return call(_manager.set_storage, str(Path(runtime).parent / "models"))
    return router
