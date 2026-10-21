"""Serialize updates to this application's environment file, preserving other keys."""
from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path
import re
import tempfile
import threading

_lock = threading.RLock()


@contextmanager
def _file_lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as stream:
        if stream.tell() == 0:
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == "nt":
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def update_private_environment(data: Path, changes: dict[str, str], *, allowed_keys: set[str]):
    """Merge ONLY caller-allowlisted keys; returns the updated values.

    All writers must use this helper. The advisory lock survives atomic inode
    replacement because it belongs to a separate, stable lock file. Existing
    comments, unrelated keys and order are retained. No process env is changed.
    """
    for key, value in changes.items():
        if key not in allowed_keys or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
            raise ValueError("Niedozwolone ustawienie środowiska.")
        if not isinstance(value, str) or any(ord(ch) < 32 for ch in value) or re.search(r"\s#", value):
            raise ValueError("Wartość środowiska zawiera niedozwolony znak.")
    data = Path(data)
    # Never follow a junction/symlink for these app-owned writes.
    from model_management import _no_link_ancestors
    _no_link_ancestors(data / "environment")
    _no_link_ancestors(data / ".environment.lock")
    lock_path = data / ".environment.lock"
    if lock_path.exists() and lock_path.stat().st_nlink > 1:
        raise ValueError("Plik blokady ustawień nie może być współdzielonym hardlinkiem.")
    with _lock, _file_lock(data / ".environment.lock"):
        target = data / "environment"
        try:
            lines = target.read_text(encoding="utf-8").splitlines()
        except FileNotFoundError:
            lines = []
        lines = [line for line in lines if line.partition("=")[0].strip() not in changes]
        lines.extend(f"{key}={value}" for key, value in changes.items())
        fd, temporary = tempfile.mkstemp(prefix="environment.", suffix=".tmp", dir=data)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
                stream.write("\n".join(lines) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
        finally:
            Path(temporary).unlink(missing_ok=True)
    return dict(changes)
