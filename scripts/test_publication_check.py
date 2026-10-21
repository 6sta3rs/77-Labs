"""Isolated scanner regressions; synthetic files only, no app/runtime access."""
from __future__ import annotations

import base64
import contextlib
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import wave
import zipfile

import publication_check as subject


def tone() -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8000)
        output.writeframes(b"\0\0" * 80)
    return buffer.getvalue()


def archive(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as output:
        for name, data in files.items():
            output.writestr(name, data)
    return buffer.getvalue()


class PublicationCheckTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="public-audit-fixture-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.patch = patch.object(subject, "ROOT", self.root)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        (self.root / "docs").mkdir()
        self.media = tone()
        self.upstream = archive({"backend/sample.wav": b"RIFF\0\0\0\0WAVEfixture"})
        self.manifest = {
            "audio": {"public/demo/tone.wav": {"sha256": hashlib.sha256(self.media).hexdigest()}},
            "upstreamArchive": {"path": "scripts/runtime/engine.zip", "sha256": hashlib.sha256(self.upstream).hexdigest()},
        }
        self.write_manifest()

    def write_manifest(self):
        (self.root / "docs/public-assets.json").write_text(json.dumps(self.manifest), encoding="utf-8")

    def audit(self, data: bytes, path: str = "fixture.txt", deny: list[str] | None = None):
        result = subject.Audit(deny or [])
        result.content("fixture", data, path)
        return result

    def git(self, *arguments: str, data: bytes | None = None) -> bytes:
        return subprocess.check_output(["git", "-C", str(self.root), *arguments], input=data, stderr=subprocess.PIPE)

    def initialize_git(self):
        self.git("init", "-q")
        self.git("config", "user.name", subject.ANONYMOUS[0])
        self.git("config", "user.email", subject.ANONYMOUS[1])
        (self.root / "README.md").write_text("Public synthetic fixture\n", encoding="utf-8")
        self.git("add", "README.md")
        self.git("-c", "core.hooksPath=", "commit", "-qm", "Public fixture")

    def test_private_media_and_databases_are_detected_without_extensions(self):
        samples = [b"RIFF\x10\0\0\0WAVEfixture", b"fLaCfixture", b"ID3fixture", b"\xff\xfbfixture", b"SQLite format 3\0fixture"]
        for data in samples:
            for path in ("fixture.bin", ""):
                with self.subTest(header=data[:4].hex(), path=path):
                    self.assertTrue(self.audit(data, path).errors)

    def test_database_credentials_and_unapproved_media_suffixes(self):
        for path in ("private.db", "private.sqlite3", ".env", "credentials.json", "private.wav"):
            with self.subTest(path=path):
                self.assertTrue(self.audit(b"fixture", path).errors)

    def test_deny_matches_binary_utf8_utf16_and_filenames(self):
        denied = "PrivateFixtureUser"
        for encoding in ("utf-8", "utf-16-le", "utf-16-be"):
            with self.subTest(encoding=encoding):
                self.assertTrue(self.audit(b"\0" + denied.encode(encoding), deny=[denied]).errors)
        result = subject.Audit([denied])
        result.content(denied + ".txt", b"generic", denied + ".txt")
        self.assertTrue(result.errors)
        self.assertNotIn(denied, " ".join(result.errors))

    def test_tokens_personal_paths_and_embedded_audio_in_utf8_and_utf16(self):
        samples = ["sk-" + "A" * 40, "C:/" + "Users/PrivateFixtureUser/Documents/input.txt",
                   "data:audio/wav;base64," + base64.b64encode(self.media).decode(),
                   "-----BEGIN " + "PRIVATE KEY-----\nfixture"]
        for text in samples:
            for encoding in ("utf-8", "utf-16-le", "utf-16-be"):
                with self.subTest(sample=samples.index(text), encoding=encoding):
                    self.assertTrue(self.audit(text.encode(encoding)).errors)

    def test_upstream_examples_and_generic_public_text_are_allowed(self):
        text = "Example C:/Users/First Last/input.wav and data:audio/wav;base64,..."
        self.assertFalse(self.audit(text.encode()).errors)
        self.assertFalse(self.audit(b"Ordinary public text").errors)

    def test_approved_tone_and_exact_pinned_archive_are_allowed_without_paths(self):
        for path in ("public/demo/tone.wav", ""):
            self.assertFalse(self.audit(self.media, path).errors)
        for path in ("scripts/runtime/engine.zip", ""):
            result = self.audit(self.upstream, path)
            self.assertFalse(result.errors)
            self.assertEqual(result.archives, 1)
        self.assertTrue(self.audit(self.upstream + b"modified", "fixture.bin").errors)

    def test_pinned_archive_still_checks_private_content_and_member_paths(self):
        for files in ({"backend/private.db": b"SQLite format 3\0fixture"},
                      {"../escape.txt": b"fixture"}, {"backend/secret.txt": b"PrivateFixtureUser"}):
            data = archive(files)
            self.manifest["upstreamArchive"]["sha256"] = hashlib.sha256(data).hexdigest()
            self.write_manifest()
            self.assertTrue(self.audit(data, "", ["PrivateFixtureUser"]).errors)

    def test_nested_media_exemption_does_not_apply_to_an_ordinary_copy(self):
        result = self.audit(self.upstream, "scripts/runtime/engine.zip")
        self.assertFalse(result.errors)
        result.content("ordinary copy", b"RIFF\0\0\0\0WAVEfixture", "backend/sample.wav")
        self.assertTrue(result.errors)

    def test_corrupt_pinned_archive_is_a_failure(self):
        data = b"PK\x03\x04not-a-valid-archive"
        self.manifest["upstreamArchive"]["sha256"] = hashlib.sha256(data).hexdigest()
        self.write_manifest()
        self.assertTrue(self.audit(data, "").errors)

    def test_all_git_objects_include_orphans_trees_and_staged_data(self):
        self.initialize_git()
        self.assertFalse(subject.Audit([]).history(True) == 0)
        clean = subject.Audit([])
        clean.history(True)
        self.assertFalse(clean.errors)
        blob = self.git("hash-object", "-w", "--stdin", data=b"RIFF\0\0\0\0WAVEprivate").decode().strip()
        self.git("mktree", data=("100644 blob " + blob + "\tprivate.wav\n").encode())
        orphan = subject.Audit([])
        orphan.history(True)
        self.assertTrue(orphan.errors)
        self.git("update-index", "--add", "--cacheinfo", "100644", blob, "private.wav")
        indexed = subject.Audit([])
        indexed.history(True)
        self.assertTrue(indexed.errors)

    def test_neutral_identity_checks_commits_and_annotated_tags(self):
        self.initialize_git()
        self.git("-c", "user.name=PrivateFixtureUser", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=", "tag", "-am", "Synthetic tag", "v-fixture")
        result = subject.Audit([])
        result.history(True)
        self.assertTrue(any("identity" in error for error in result.errors))
        allowed = subject.Audit([])
        allowed.history(False)
        self.assertFalse(allowed.errors)

    def test_anonymous_audit_requires_a_git_repository(self):
        result = subject.Audit([])
        result.history(True)
        self.assertTrue(result.errors)

    def test_git_replacement_refs_cannot_hide_original_private_blobs(self):
        self.initialize_git()
        private_blob = self.git("hash-object", "-w", "--stdin", data=b"SQLite format 3\0fixture").decode().strip()
        public_blob = self.git("hash-object", "-w", "--stdin", data=b"Generic public fixture").decode().strip()
        self.git("replace", private_blob, public_blob)
        result = subject.Audit([])
        result.history(True)
        self.assertTrue(any("database container" in error for error in result.errors))

    def test_linked_directories_require_review_without_following_them(self):
        with tempfile.TemporaryDirectory(prefix="public-audit-linked-") as other:
            linked = self.root / "linked-directory"
            try:
                linked.symlink_to(Path(other), target_is_directory=True)
            except OSError:
                self.skipTest("Directory symlinks are unavailable for this account")
            result = subject.Audit([])
            result.tree()
            self.assertTrue(any("linked directory" in error for error in result.errors))

    def test_deny_file_cannot_be_inside_public_root(self):
        path = self.root / "private-deny.json"
        path.write_text('["PrivateFixtureUser"]', encoding="utf-8")
        with patch("sys.argv", ["publication_check", "--deny-file", str(path)]), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                subject.main()
        self.assertEqual(raised.exception.code, 2)

    def test_json_and_git_errors_fail_closed(self):
        manifest = self.root / "docs/public-assets.json"
        manifest.write_text("{", encoding="utf-8")
        with patch("sys.argv", ["publication_check"]), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(subject.main(), 1)
        self.write_manifest()
        (self.root / ".git").mkdir()
        with patch("sys.argv", ["publication_check"]), patch.object(subject, "git", side_effect=subprocess.CalledProcessError(1, ["git"])), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(subject.main(), 1)

    def test_invalid_manifest_schema_fails_closed(self):
        for data in ([], {"audio": [], "upstreamArchive": {}}, {"audio": {}, "upstreamArchive": {"path": 1, "sha256": None}}):
            (self.root / "docs/public-assets.json").write_text(json.dumps(data), encoding="utf-8")
            with patch("sys.argv", ["publication_check"]), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(subject.main(), 1)

    def test_unreadable_directory_cannot_be_silently_skipped(self):
        def denied_walk(*arguments, **options):
            options["onerror"](PermissionError("Synthetic unreadable directory"))
            return iter(())

        with patch("sys.argv", ["publication_check"]), patch.object(subject.os, "walk", side_effect=denied_walk), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(subject.main(), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
