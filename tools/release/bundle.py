"""Build a source-only engine archive; never import or execute upstream code.

Git sources are read from an exact commit, ignoring the working tree. An
unversioned resources directory remains supported, with commit=None rather
than an invented source revision. Always use --output for a release candidate.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tarfile
import tempfile
import tomllib
import zipfile


UPSTREAM = "https://github.com/debpalash/VoiceStudio"
ROOT_FILES = {"LICENSE", "LICENSE-NOTICE.md", "NOTICE", "NOTICE.md", "COPYING", "THIRD_PARTY_NOTICES.md", "README.md", "CHANGELOG.md", "pyproject.toml", "uv.lock", "package.json", "alembic.ini", "config/app.json", "docs/logo.png"}
SOURCE_ROOTS = {"backend", "omnivoice"}
REQUIRED_057_RESOURCES = {"config/app.json", "alembic.ini", "backend/core/app_config.py", "backend/config/models.yaml", "backend/config/model_licenses.json", "backend/migrations/env.py", "backend/migrations/script.py.mako"}
EXCLUDED_DIRS = {".git", ".venv", "venv", "node_modules", "__pycache__", ".pytest_cache", "tests", "test", "outputs", "hf_cache", "prompt_cache", "voice_profiles"}
EXCLUDED_SUFFIXES = {".pyc", ".pyo", ".log", ".db", ".sqlite", ".sqlite3", ".safetensors", ".pt", ".pth", ".ckpt", ".onnx", ".gguf", ".bin"}


def allowed(relative: str) -> bool:
    path = PurePosixPath(relative)
    if path.is_absolute() or any(part in ("", ".", "..") or "\\" in part or ":" in part for part in relative.split("/")):
        return False
    if path.parts[0] not in SOURCE_ROOTS and relative not in ROOT_FILES:
        return False
    if any(part.casefold() in EXCLUDED_DIRS or part.casefold().startswith(".env") for part in path.parts):
        return False
    if path.suffix.lower() in EXCLUDED_SUFFIXES or path.name.casefold().endswith((".db-wal", ".db-shm", ".sqlite-wal", ".sqlite-shm")):
        return False
    return True


def _git(source: Path, *arguments: str) -> bytes:
    return subprocess.check_output(["git", "-C", str(source), *arguments], stderr=subprocess.PIPE)


def read_sources(source: Path, commit: str | None):
    """Return regular source files and exact evidence without running a package."""
    files: dict[str, tuple[bytes, int]] = {}
    excluded = []
    git_source = (source / ".git").exists()
    if git_source:
        if commit is not None and not re.fullmatch(r"[0-9a-fA-F]{40}", commit):
            raise ValueError("Podaj pełny, 40-znakowy SHA commita upstream.")
        revision = _git(source, "rev-parse", "--verify", (commit or "HEAD") + "^{commit}").decode("ascii").strip()
        roots = _git(source, "ls-tree", "--name-only", revision).decode("utf-8").splitlines()
        # Some runtime resources live outside the Python trees. Select their
        # exact pinned paths, not an entire docs/config/private working tree.
        root_files = _git(source, "ls-tree", "-r", "--name-only", revision, "--", *sorted(ROOT_FILES)).decode("utf-8").splitlines()
        selected = sorted(SOURCE_ROOTS.intersection(roots) | set(root_files))
        raw = _git(source, "archive", "--format=tar", revision, "--", *selected)
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
            for member in archive.getmembers():
                if member.isdir():
                    continue
                if not member.isfile():
                    excluded.append(member.name)
                    continue
                if allowed(member.name):
                    incoming = archive.extractfile(member)
                    if incoming is not None:
                        files[member.name] = (incoming.read(), member.mode)
                else:
                    excluded.append(member.name)
        return files, excluded, revision, "git-archive"
    if commit is not None:
        raise ValueError("Nie można potwierdzić commita dla katalogu bez własnego repozytorium Git.")
    for entry in sorted(SOURCE_ROOTS | ROOT_FILES):
        candidate = source / entry
        if not candidate.exists():
            continue
        paths = sorted(candidate.rglob("*")) if candidate.is_dir() else [candidate]
        for path in paths:
            relative = path.relative_to(source).as_posix()
            mode = path.lstat().st_mode
            if not stat.S_ISREG(mode) or path.is_symlink():
                if not path.is_dir():
                    excluded.append(relative)
                continue
            if allowed(relative):
                files[relative] = (path.read_bytes(), stat.S_IMODE(mode))
            else:
                excluded.append(relative)
    return files, excluded, None, "source-directory"


def build_bundle(source: Path, output: Path, *, commit: str | None = None, version: str | None = None, provenance: Path | None = None, upstream: str = UPSTREAM):
    source, output = source.resolve(), output.resolve()
    provenance = (provenance or output.with_name(output.stem + "-provenance.json")).resolve()
    if output == provenance:
        raise ValueError("Archiwum i manifest pochodzenia wymagają osobnych ścieżek.")
    files, excluded, revision, source_kind = read_sources(source, commit)
    required = {"backend/main.py", "backend/core/config.py", "omnivoice/__init__.py", "LICENSE", "README.md", "pyproject.toml", "uv.lock"}
    if missing := required.difference(files):
        raise ValueError("Brak wymaganych źródeł silnika: " + ", ".join(sorted(missing)))
    project = tomllib.loads(files["pyproject.toml"][0].decode("utf-8-sig")).get("project", {})
    detected_version = project.get("version")
    if not isinstance(detected_version, str) or not detected_version:
        raise ValueError("Brak wersji silnika w pyproject.toml.")
    if version is not None and version != detected_version:
        raise ValueError(f"Wersja {version} nie zgadza się ze źródłami {detected_version}.")
    if detected_version != "0.5.6" and "LICENSE-NOTICE.md" not in files:
        raise ValueError("Nowszy pakiet źródeł musi zachować LICENSE-NOTICE.md.")
    # 0.5.7 imports app_config at module load, and silently skips Alembic
    # without its root ini. A syntactically valid Python archive is not enough.
    if match := re.match(r"^(\d+)\.(\d+)\.(\d+)", detected_version):
        if tuple(map(int, match.groups())) >= (0, 5, 7):
            if missing := REQUIRED_057_RESOURCES.difference(files):
                raise ValueError("Brak wymaganych zasobów runtime 0.5.7+: " + ", ".join(sorted(missing)))
            app = json.loads(files["config/app.json"][0].decode("utf-8-sig"))
            if not isinstance(app, dict) or not all(isinstance(app.get(key), str) and app[key].strip() for key in ("productName", "appId")) or not isinstance(app.get("ports"), dict):
                raise ValueError("Nieprawidłowy wymagany manifest config/app.json.")
            ports = [app["ports"].get(key) for key in ("backend", "web", "electronDev")]
            if not all(type(port) is int and 1 <= port <= 65535 for port in ports) or len(set(ports)) != 3 or ports[2] + 1 > 65535 or ports[2] + 1 in ports:
                raise ValueError("Nieprawidłowe porty w wymaganym config/app.json.")
            ini = files["alembic.ini"][0].decode("ascii")
            if not re.search(r"(?m)^script_location\s*=\s*%\(here\)s/backend/migrations\s*$", ini):
                raise ValueError("Nieznany kontrakt script_location w alembic.ini.")
    for parent in (output.parent, provenance.parent):
        parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix=output.name + ".", suffix=".partial", dir=output.parent)
    os.close(handle)
    temporary = Path(temporary_name)
    manifest_temporary = None
    try:
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for relative, (contents, mode) in sorted(files.items()):
                info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | (mode & 0o777)) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, contents, compresslevel=6)
        archive_digest = hashlib.sha256(temporary.read_bytes()).hexdigest()
        manifest = {
            "formatVersion": 2, "upstream": upstream, "version": detected_version,
            "commit": revision, "sourceKind": source_kind, "license": project.get("license", "AGPL-3.0-only"),
            "archiveSha256": archive_digest, "source": f"{upstream}/tree/{revision}" if revision else "unversioned source directory", "files": len(files),
            "uncompressedBytes": sum(len(data) for data, _ in files.values()),
            "notices": sorted(relative for relative in files if relative in ROOT_FILES and ("LICENSE" in relative or "NOTICE" in relative or relative == "COPYING")),
            "excluded": sorted(excluded),
            "sourceFileSha256": {relative: hashlib.sha256(data).hexdigest() for relative, (data, _) in sorted(files.items())},
            "modifications": "Archive sources unchanged. The versioned launcher adapter disables eager TTS preload only in its private extracted generation.",
        }
        descriptor, manifest_name = tempfile.mkstemp(prefix=provenance.name + ".", suffix=".partial", dir=provenance.parent)
        manifest_temporary = Path(manifest_name)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
            stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, output)
        os.replace(manifest_temporary, provenance)
        return manifest
    finally:
        temporary.unlink(missing_ok=True)
        if manifest_temporary is not None:
            manifest_temporary.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Repozytorium upstream albo odrębny katalog resources")
    parser.add_argument("--commit", help="Pełny SHA; źródła pobierane bezpośrednio z tego obiektu Git")
    parser.add_argument("--version", help="Oczekiwana wersja, sprawdzana z pyproject.toml")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[2] / "scripts/runtime/vendor/engine.zip")
    parser.add_argument("--provenance", type=Path)
    parser.add_argument("--upstream", default=UPSTREAM)
    args = parser.parse_args(argv)
    try:
        manifest = build_bundle(args.source, args.output, commit=args.commit, version=args.version, provenance=args.provenance, upstream=args.upstream)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.error(str(error))
    print(f"Bundled {manifest['files']} files / {manifest['version']} / {manifest['commit'] or 'unversioned resources'} / SHA-256 {manifest['archiveSha256']}")


if __name__ == "__main__":
    main()
