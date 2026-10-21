"""Private voice-preview controls, audited cache cleanup and local rendering.

Gallery consent/check and individual renders reuse pinned upstream functions.
Only explicitly listed preview files or dedicated private temporary files are
removable. Never scans the OS-wide omnivoice* population used by the old app.
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
from pathlib import Path
import re
import stat
import threading
import sys


class PreviewCache:
    def __init__(self, runtime: Path, data: Path, *, work_busy=None):
        self.runtime, self.data = Path(runtime).resolve(), Path(data).resolve()
        self.local = self.data / "outputs/archetype_previews"
        self.downloaded = self.data / "voice_gallery_previews/previews"
        self.work_busy = work_busy
        self.lock = threading.RLock()
        self.generating = False

    @staticmethod
    def _safe(path):
        from runtime_backup import _no_links
        _no_links(path)

    def _files(self, temporary=False):
        result = []
        roots = (self.data / "tmp", self.runtime / "temp") if temporary else (self.local, self.downloaded)
        for root in roots:
            self._safe(root)
            if not root.exists():
                continue
            candidates = root.rglob("*") if temporary else root.iterdir()
            for file in candidates:
                self._safe(file)
                info = file.lstat()
                if stat.S_ISDIR(info.st_mode):
                    continue
                if not stat.S_ISREG(info.st_mode):
                    raise ValueError("Cache zawiera plik specjalny. Czyszczenie nie zostało rozpoczęte.")
                if not temporary and not re.fullmatch(r"[0-9a-f]{16}\.(wav|mp3)", file.name):
                    continue
                # Check the extension against the actual upstream owner.
                if not temporary and file.suffix != (".wav" if root == self.local else ".mp3"):
                    continue
                result.append((file, info))
        return sorted(result, key=lambda item: str(item[0]))

    def audit(self, temporary=False):
        files = self._files(temporary)
        entries = [(str(path), info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns) for path, info in files]
        token = hashlib.sha256(json.dumps(entries, separators=(",", ":")).encode()).hexdigest()
        return {"token": token, "count": len(files), "bytes": sum(info.st_size for _, info in files)}, files

    def _idle(self):
        gallery = sys.modules.get("services.gallery")
        refresh = getattr(gallery, "_refresh_task", None)
        archetypes = sys.modules.get("api.routers.archetypes")
        renders = getattr(archetypes, "_renders", {})
        if self.generating or refresh is not None and not refresh.done() or renders or (self.work_busy and self.work_busy()):
            raise ValueError("Zakończ aktywne operacje silnika przed zarządzaniem cache próbek.")

    def state(self):
        from core import archetypes
        from services import gallery
        from api.routers.archetypes import _preview_key
        cache, files = self.audit()
        temporary, _ = self.audit(temporary=True)
        local = [(path, info) for path, info in files if path.parent == self.local]
        downloaded = [(path, info) for path, info in files if path.parent == self.downloaded]
        names = {path.name for path, _ in local}
        items = archetypes.list_archetypes(featured=True)[:100]
        return {"gallery": gallery.status(), "cache": cache, "temporary": temporary,
                "local": {"count": len(local), "bytes": sum(info.st_size for _, info in local)},
                "downloaded": {"count": len(downloaded), "bytes": sum(info.st_size for _, info in downloaded)},
                "generating": self.generating,
                "voices": [{"id": item["id"], "name": item["name"], "cached": _preview_key(item) + ".wav" in names} for item in items]}

    def clear(self, token, count, *, temporary=False):
        with self.lock:
            self._idle()
            audit, files = self.audit(temporary)
            if not isinstance(count, int) or isinstance(count, bool) or count != audit["count"] or token != audit["token"]:
                raise ValueError("Zawartość katalogu zmieniła się od odczytu. Odśwież liczbę plików i potwierdź ponownie.")
            removed, freed, errors = 0, 0, []
            for path, planned in files:
                try:
                    self._safe(path)
                    current = path.stat()
                    if (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns) != (planned.st_dev, planned.st_ino, planned.st_size, planned.st_mtime_ns):
                        raise ValueError("Plik zmienił się po potwierdzeniu.")
                    path.unlink()
                    removed += 1; freed += planned.st_size
                except (OSError, ValueError) as error:
                    errors.append({"file": path.name, "error": str(error)})
            return {"removed": removed, "freed_bytes": freed, "errors": errors, "state": self.state()}

    async def generate(self, identifier):
        from core import archetypes
        from api.routers.archetypes import preview_archetype
        if not isinstance(identifier, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", identifier) or archetypes.get_archetype(identifier) is None:
            raise ValueError("Wybierz głos z katalogu gotowych projektów głosu.")
        with self.lock:
            self._idle(); self.generating = True
        try:
            # Keep stock cache validation, GPU pool, timeout, license checks and
            # atomic WAV publication. No unchecked tensor/model implementation.
            await preview_archetype(identifier, local=True)
        finally:
            self.generating = False
        return {"id": identifier, "state": self.state()}


def create_router(runtime: Path, data: Path):
    from fastapi import APIRouter, Depends, HTTPException
    from pydantic import BaseModel
    from api.dependencies import require_native_access
    from activity import backend_work_busy
    from services import gallery
    manager = PreviewCache(runtime, data, work_busy=backend_work_busy)
    router = APIRouter(prefix="/next/preview-cache", dependencies=[Depends(require_native_access)])
    class ClearBody(BaseModel):
        token: str
        count: int
    class GalleryBody(BaseModel):
        enabled: bool
    globals()["PreviewClearBody"], globals()["PreviewGalleryBody"] = ClearBody, GalleryBody
    def call(function, *args, **kwargs):
        try:
            return function(*args, **kwargs)
        except (OSError, ValueError, RuntimeError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from None
    @router.get("/state")
    def state():
        return call(manager.state)
    @router.put("/gallery")
    async def set_gallery(body: PreviewGalleryBody):
        with manager.lock:
            call(manager._idle); manager.generating = True
        try:
            gallery.set_enabled(body.enabled)
            if body.enabled:
                await gallery.fetch_featured()
        finally:
            manager.generating = False
        return call(manager.state)
    @router.post("/gallery/check")
    async def check_gallery():
        with manager.lock:
            call(manager._idle); manager.generating = True
        try:
            await gallery.check_for_updates(force=True)
        finally:
            manager.generating = False
        return call(manager.state)
    @router.post("/generate/{identifier}")
    async def generate(identifier: str):
        try:
            return await manager.generate(identifier)
        except (ValueError, OSError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from None
    @router.post("/clear")
    def clear(body: PreviewClearBody):
        return call(manager.clear, body.token, body.count)
    @router.post("/temporary/clear")
    def clear_temporary(body: PreviewClearBody):
        return call(manager.clear, body.token, body.count, temporary=True)
    return router
