"""Read-only pywin32 bootstrap for an isolated Windows interpreter.

The legacy private runtime copied package files without .pth startup hooks.
Restore only pywin32's known interpreter-local paths; never evaluate arbitrary
.pth code, run post-install scripts, edit libraries, or alter the global PATH.
Fresh uv environments normally already include these paths.
"""
import os
from pathlib import Path
import sys
import threading

_DLL_HANDLES = {}
_LOCK = threading.Lock()


def configure_windows_runtime_paths(venv=None):
    if os.name != "nt":
        return {"paths_added": [], "dll_directory_added": False}
    root = Path(venv or sys.prefix).resolve(strict=True)
    site = root / "Lib" / "site-packages"
    if not site.is_dir():
        return {"paths_added": [], "dll_directory_added": False}
    # Resolving a helper directory must never escape this interpreter's tree.
    # Normal dependency-file hardlinks remain read-only and are not modified.
    def private_directory(relative):
        candidate = site / relative
        if not candidate.is_dir():
            return None
        for part in (site, candidate, *candidate.parents):
            if not part.is_relative_to(root):
                break
            attributes = getattr(part.lstat(), "st_file_attributes", 0)
            if part.is_symlink() or attributes & 0x400:
                raise RuntimeError("Katalog zależności Windows nie może być dowiązaniem poza prywatnym runtime.")
        resolved = candidate.resolve(strict=True)
        if not resolved.is_relative_to(root):
            raise RuntimeError("Katalog zależności Windows wykracza poza prywatny interpreter.")
        return resolved
    with _LOCK:
        paths = []
        for relative in ("win32", "win32/lib", "Pythonwin"):
            path = private_directory(relative)
            if path is not None and str(path) not in sys.path:
                sys.path.append(str(path)); paths.append(str(path))
        directory = private_directory("pywin32_system32")
        added = False
        if directory is not None and str(directory) not in _DLL_HANDLES:
            # Retain the handle for the lifetime of this worker/backend.
            _DLL_HANDLES[str(directory)] = os.add_dll_directory(str(directory))
            added = True
        return {"paths_added": paths, "dll_directory_added": added}
