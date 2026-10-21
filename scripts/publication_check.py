"""Check the public tree, all Git objects and the pinned upstream source archive.

No external packages or model/runtime access. Private deny strings can be supplied
from a local JSON file, so the strings themselves never enter the public project.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {".git", "node_modules", ".tmp", "dist", "target", "__pycache__", ".venv"}
PRIVATE_SUFFIXES = {".db", ".sqlite", ".sqlite3", ".pfx", ".p12", ".key", ".pem"}
MEDIA_SUFFIXES = {".wav", ".mp3", ".m4a", ".m4b", ".flac", ".ogg", ".opus", ".mp4", ".mov", ".webm"}
ANONYMOUS = ("Seventy Seven Labs contributors", "contributors@example.invalid")
TOKEN = re.compile(r"\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{32,}|hf_[A-Za-z0-9]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16})\b")
EMBEDDED_AUDIO = re.compile(r"data:audio/[^;,\s]+(?:;[^,\s]+)*;base64,[A-Za-z0-9+/]{64,}", re.I)
PERSONAL_HOME = re.compile(r"[A-Za-z]:[/\\]{1,2}Users[/\\]{1,2}([^/\\\s\"'`]+)", re.I)
EXAMPLE_USERS = {"Alice", "Bob", "Public", "Default", "User", "Example", "private-user", "First"}
PRIVATE_KEYS = tuple("-----BEGIN " + kind + " PRIVATE KEY-----" for kind in ("RSA", "EC", "OPENSSH")) + ("-----BEGIN " + "PRIVATE KEY-----",)


def git(*arguments: str, input_data: bytes | None = None) -> bytes:
    # Replacement refs must not substitute a harmless object for a private one.
    return subprocess.check_output(["git", "--no-replace-objects", *arguments], cwd=ROOT, input=input_data, stderr=subprocess.PIPE)


def parse_git_batch(data: bytes, expected: dict[str, tuple[str, int]]) -> dict[str, tuple[str, bytes]]:
    """Read exact cat-file frames; missing, truncated or extra bytes fail closed."""
    objects = {}
    position = 0
    for oid, (kind, size) in expected.items():
        newline = data.find(b"\n", position)
        if newline < 0 or newline - position > 256:
            raise ValueError("Missing or invalid Git batch header")
        header = data[position:newline].split(b" ")
        if header != [oid.encode("ascii"), kind.encode("ascii"), str(size).encode("ascii")]:
            raise ValueError("Git batch object identity/type/size mismatch")
        start = newline + 1
        end = start + size
        if size < 0 or end >= len(data) or data[end:end + 1] != b"\n":
            raise ValueError("Truncated or invalid Git batch payload")
        objects[oid] = (kind, data[start:end])
        position = end + 1
    if position != len(data):
        raise ValueError("Unexpected trailing Git batch data")
    return objects


def read_git_objects() -> dict[str, tuple[str, bytes]]:
    """Two Git processes cover every loose/packed object, including orphans."""
    inventory = git("cat-file", "--batch-all-objects", "--batch-check=%(objectname) %(objecttype) %(objectsize)")
    expected = {}
    for row in inventory.splitlines():
        fields = row.split(b" ")
        if (len(fields) != 3 or not re.fullmatch(rb"(?:[0-9a-f]{40}|[0-9a-f]{64})", fields[0])
                or fields[1] not in {b"blob", b"commit", b"tag", b"tree"}
                or not re.fullmatch(rb"[0-9]{1,20}", fields[2])):
            raise ValueError("Invalid Git object inventory")
        oid, kind, size = fields[0].decode("ascii"), fields[1].decode("ascii"), int(fields[2])
        if oid in expected:
            raise ValueError("Duplicate Git object inventory entry")
        expected[oid] = (kind, size)
    if not expected:
        return {}
    request = ("\n".join(expected) + "\n").encode("ascii")
    # check_output/communicate drains stdout while feeding stdin, avoiding the
    # two-pipe deadlock from manually writing a large batch before reading it.
    return parse_git_batch(git("cat-file", "--batch", input_data=request), expected)


def tree_entries(data: bytes, hash_bytes: int):
    """Parse raw tree names/OIDs without spawning ls-tree for every tree."""
    position = 0
    while position < len(data):
        space = data.find(b" ", position)
        nul = data.find(b"\0", space + 1) if space >= 0 else -1
        if space < 0 or nul < 0 or nul + 1 + hash_bytes > len(data):
            raise ValueError("Truncated Git tree entry")
        mode, filename = data[position:space], data[space + 1:nul]
        if (mode not in {b"40000", b"040000", b"100644", b"100755", b"120000", b"160000"}
                or not filename or filename in {b".", b".."} or b"/" in filename):
            raise ValueError("Invalid Git tree entry")
        child_oid = data[nul + 1:nul + 1 + hash_bytes].hex()
        yield mode, filename.decode("utf-8", errors="replace"), child_oid
        position = nul + 1 + hash_bytes


def binary_kind(data: bytes) -> str | None:
    """Identify common private media/database containers independently of names."""
    if data.startswith(b"SQLite format 3\0") or data[:4] in {b"\x37\x7f\x06\x82", b"\x37\x7f\x06\x83"}:
        return "database"
    if ((data[:4] in {b"RIFF", b"RF64", b"BW64"} and data[8:12] == b"WAVE")
            or data.startswith((b"fLaC", b"OggS", b"ID3", b"caff", b"\x1a\x45\xdf\xa3"))
            or (len(data) >= 2 and data[0] == 0xFF and data[1] & 0xE0 == 0xE0)
            or (len(data) >= 12 and data[4:8] == b"ftyp")
            or (data[:4] == b"FORM" and data[8:12] in {b"AIFF", b"AIFC"})):
        return "media"
    return None


class Audit:
    def __init__(self, deny: list[str]):
        self.errors: set[str] = set()
        self.deny = [value.casefold() for value in deny if value.strip()]
        self.deny_bytes = [value.encode(encoding).lower() for value in self.deny
                           for encoding in ("utf-8", "utf-16-le", "utf-16-be")]
        self.checked: set[tuple[str, str, bool]] = set()
        self.archives = 0
        manifest = json.loads((ROOT / "docs/public-assets.json").read_text("utf-8"))
        if (not isinstance(manifest, dict) or not isinstance(manifest.get("audio"), dict)
                or not isinstance(manifest.get("upstreamArchive"), dict)):
            raise ValueError("Invalid public asset manifest structure")
        self.media = manifest["audio"]
        self.archive = manifest["upstreamArchive"]
        if (any(not isinstance(path, str) or not isinstance(item, dict)
                or not isinstance(item.get("sha256"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) for path, item in self.media.items())
                or not isinstance(self.archive.get("path"), str)
                or not isinstance(self.archive.get("sha256"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", self.archive["sha256"])):
            raise ValueError("Invalid public asset manifest entries")

    def error(self, label: str, message: str) -> None:
        # Do not print the matched secret or private string.
        for value in self.deny:
            label = re.sub(re.escape(value), "[private]", label, flags=re.I)
        label = TOKEN.sub("[secret]", label)
        self.errors.add(f"{label}: {message}")

    def content(self, label: str, data: bytes, path: str = "", nested: bool = False) -> None:
        digest = hashlib.sha256(data).hexdigest()
        key = (path, digest, nested)
        if key in self.checked:
            return
        self.checked.add(key)
        name = PurePosixPath(path)
        # These checks precede all archive, binary and text decoding returns.
        lowered_data = data.lower() if self.deny_bytes else b""
        if any(value in lowered_data for value in self.deny_bytes) or any(value in path.casefold() for value in self.deny):
            self.error(label, "private deny string detected")
        approved_media = any(item.get("sha256") == digest for item in self.media.values())
        kind = binary_kind(data)
        if kind == "database":
            self.error(label, "private database container detected")
        elif kind == "media" and not nested and not approved_media:
            self.error(label, "unapproved audio/video container detected")
        if path:
            if any(part.casefold() in SKIP_DIRS for part in name.parts):
                self.error(label, "generated/private directory is tracked")
            basename = name.name.casefold()
            if name.suffix.lower() in PRIVATE_SUFFIXES or basename in {"auth.json", "credentials.json"} or (basename.startswith(".env") and basename != ".env.example"):
                self.error(label, "private database/credentials file")
            if not nested and name.suffix.lower() in MEDIA_SUFFIXES and not approved_media:
                self.error(label, "audio/video is not the approved procedural fixture")
        archive_magic = data.startswith((b"PK\x03\x04", b"PK\x05\x06", b"7z\xbc\xaf\x27\x1c", b"\x1f\x8b"))
        if not nested and (name.suffix.lower() in {".zip", ".7z", ".tar", ".gz"} or archive_magic or digest == self.archive["sha256"]):
            if digest != self.archive["sha256"]:
                self.error(label, "unapproved or modified archive")
                return
            self.archives += 1
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    for member in archive.infolist():
                        if member.is_dir():
                            continue
                        member_path = PurePosixPath(member.filename)
                        if member_path.is_absolute() or ".." in member_path.parts or "\\" in member.filename or ":" in member.filename:
                            self.error(label, "archive member escapes root")
                            continue
                        self.content(label + "!" + member.filename, archive.read(member), member.filename, True)
            except (OSError, RuntimeError, ValueError, zipfile.BadZipFile):
                self.error(label, "pinned archive could not be fully inspected")
            return
        # Replacement decoding still exposes ASCII secrets in otherwise binary
        # data. UTF-16 text must not disappear merely because it contains NULs.
        texts = [data.decode("utf-8-sig", errors="replace")]
        if b"\0" in data or data.startswith((b"\xff\xfe", b"\xfe\xff")):
            texts.extend(data.decode(encoding, errors="replace") for encoding in ("utf-16-le", "utf-16-be"))
        for text in texts:
            lowered = text.casefold()
            if any(value in lowered for value in self.deny):
                self.error(label, "private deny string detected")
            if TOKEN.search(text) or any(marker in text for marker in PRIVATE_KEYS):
                self.error(label, "possible secret detected")
            if EMBEDDED_AUDIO.search(text):
                self.error(label, "embedded audio data URI detected")
            for match in PERSONAL_HOME.finditer(text):
                if match[1] not in EXAMPLE_USERS and not match[1].startswith(("<", "%", "$", "{")):
                    self.error(label, "absolute personal home path detected")

    def tree(self) -> int:
        count = 0
        def unreadable_directory(error: OSError) -> None:
            raise error

        for parent, directories, files in os.walk(ROOT, onerror=unreadable_directory):
            retained = []
            for directory in directories:
                if directory in SKIP_DIRS:
                    continue
                candidate = Path(parent) / directory
                if candidate.is_symlink() or getattr(candidate, "is_junction", lambda: False)():
                    self.error(candidate.relative_to(ROOT).as_posix(), "linked directory requires manual review")
                else:
                    retained.append(directory)
            directories[:] = retained
            for filename in files:
                if filename == ".git":  # Linked worktree metadata; history() checks its objects.
                    continue
                path = Path(parent) / filename
                relative = path.relative_to(ROOT).as_posix()
                if path.is_symlink():
                    self.error(relative, "symlink requires manual review")
                    continue
                self.content(relative, path.read_bytes(), relative)
                count += 1
        return count

    def history(self, require_anonymous: bool) -> int:
        if not (ROOT / ".git").exists():
            if require_anonymous:
                self.error("Git", "anonymous identity audit requires an initialized repository")
            return 0
        refs = git("for-each-ref", "--format=%(refname)").decode().splitlines()
        for ref in refs:
            self.content("Git ref", ref.encode("utf-8"))
        if any(ref.startswith(("refs/t3/", "refs/original/", "refs/stash", "refs/replace/")) for ref in refs):
            self.error("Git refs", "private checkpoint, rewrite backup or stash ref")
        paths: dict[str, set[str]] = {}
        for row in git("rev-list", "--objects", "--all").decode("utf-8").splitlines():
            oid, _, path = row.partition(" ")
            if path:
                paths.setdefault(oid, set()).add(path)
        # Index OIDs refer to the same all-object batch: do not start a process
        # per staged filename. Preserve all conflict stages instead of selecting
        # an arbitrary stage with git show :path.
        indexed = []
        for row in git("ls-files", "--stage", "-z").split(b"\0"):
            if not row:
                continue
            metadata, separator, filename = row.partition(b"\t")
            fields = metadata.split(b" ")
            if not separator or len(fields) != 3 or fields[2] not in {b"0", b"1", b"2", b"3"}:
                raise ValueError("Invalid Git index entry")
            mode, oid, stage = fields
            if not re.fullmatch(rb"(?:[0-9a-f]{40}|[0-9a-f]{64})", oid):
                raise ValueError("Invalid Git index object identity")
            path = filename.decode("utf-8", errors="replace")
            object_id = oid.decode("ascii")
            if mode in {b"120000", b"160000"}:
                self.error("Index " + path, "symlink/submodule requires manual review")
            indexed.append((path, object_id, mode))
            paths.setdefault(object_id, set()).add(path)
        # Includes unreachable objects; a forgotten private blob must not hide
        # behind a clean branch tip or reflog-only commit.
        objects = read_git_objects()
        # rev-list names only reachable objects, often under one of several
        # names. Read every tree, including orphaned trees, to retain filename
        # protection for forgotten .db/.env files and private directories.
        for oid, (kind, data) in objects.items():
            if kind == "tree":
                for mode, filename, child_oid in tree_entries(data, len(oid) // 2):
                    if mode in {b"120000", b"160000"}:
                        self.error("Git " + child_oid[:10], "symlink/submodule requires manual review")
                    if mode != b"160000" and child_oid not in objects:
                        raise ValueError("Git tree references a missing object")
                    known = paths.setdefault(child_oid, set())
                    # A known full path already exercises this basename. Keep
                    # other aliases (.env/.db/etc.) and all orphan tree names.
                    if not any(PurePosixPath(path).name == filename for path in known):
                        known.add(filename)
        for oid, (kind, data) in objects.items():
            for path in paths.get(oid, {""}):
                self.content("Git " + oid[:10] + (" " + path if path else ""), data, path)
            if require_anonymous and kind in {"commit", "tag"}:
                for field in ((b"author ", b"committer ") if kind == "commit" else (b"tagger ",)):
                    line = next((line for line in data.splitlines() if line.startswith(field)), b"")
                    expected = (ANONYMOUS[0] + " <" + ANONYMOUS[1] + ">").encode()
                    if not line[len(field):].startswith(expected + b" "):
                        self.error("Git " + oid[:10], "author/committer/tagger is not the public anonymous identity")
        for path, oid, mode in indexed:
            if mode == b"160000":
                continue  # Reported above; a submodule's store is external.
            if oid not in objects or objects[oid][0] != "blob":
                raise ValueError("Git index references a missing or non-blob object")
            self.content("Index " + path, objects[oid][1], path)
        return len(objects)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--deny-file", type=Path, help="Local JSON array of private strings, kept outside the published tree")
    parser.add_argument("--require-anonymous", action="store_true", help="Initial public release: check every author and committer")
    options = parser.parse_args()
    try:
        deny_path = options.deny_file.resolve(strict=True) if options.deny_file else None
        if deny_path is not None and deny_path.is_relative_to(ROOT.resolve()):
            parser.error("--deny-file must be kept outside the public repository")
        deny = json.loads(deny_path.read_text("utf-8")) if deny_path else []
        if not isinstance(deny, list) or any(not isinstance(value, str) for value in deny):
            parser.error("--deny-file must contain a JSON array of strings")
        audit = Audit(deny)
        files = audit.tree()
        objects = audit.history(options.require_anonymous)
    except (OSError, ValueError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        print("FAIL audit could not complete (" + type(error).__name__ + ")")
        print(json.dumps({"result": "FAIL", "complete": False}))
        return 1
    for error in sorted(audit.errors):
        print("FAIL " + error)
    print(json.dumps({"result": "FAIL" if audit.errors else "PASS", "files": files, "gitObjects": objects, "pinnedArchivesChecked": audit.archives, "findings": len(audit.errors)}))
    return 1 if audit.errors else 0


if __name__ == "__main__":
    sys.exit(main())
