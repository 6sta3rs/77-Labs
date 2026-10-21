"""Temporary WAL databases and public-style fixture bytes only. No user backup."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import runtime_backup as backup

SHA_A = "a" * 64
SHA_B = "b" * 64


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class RuntimeBackupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="seventy-seven-backup-tests-")
        self.root = Path(self.temporary.name)
        self.data = self.root / "data"
        self.data.mkdir()
        self.database = self.data / "omnivoice.db"
        self.writer = sqlite3.connect(self.database)
        self.writer.execute("PRAGMA journal_mode=WAL")
        self.writer.execute("PRAGMA wal_autocheckpoint=0")
        self.writer.execute("CREATE TABLE voice_profiles(id TEXT PRIMARY KEY, name TEXT, ref_audio_path TEXT)")
        self.writer.execute("INSERT INTO voice_profiles VALUES('QA','before','voices/reference.wav')")
        self.writer.commit()
        (self.data / "voices").mkdir()
        (self.data / "voices/reference.wav").write_bytes(b"RIFF public-style QA fixture only, not playable")
        (self.data / "prefs.json").write_text('{"theme":"fixture","token":"fixture-not-a-secret"}', encoding="utf-8")
        (self.data / "environment").write_text("OMNIVOICE_CACHE_DIR=D:/fixture/models\nOTHER=keep\n", encoding="utf-8")
        (self.data / "models").mkdir()
        (self.data / "models/never-copy.bin").write_bytes(b"fixture model excluded")
        (self.data / "voices/not-a-profile-model.safetensors").write_bytes(b"fixture model excluded")
        self.events = []

    def tearDown(self):
        self.writer.close()
        self.temporary.cleanup()

    def run_backup(self, sha=SHA_A, **options):
        return backup.backup_before_upgrade(self.data, sha, event_writer=self.events.append, **options)

    def test_wal_snapshot_profiles_audio_and_settings_are_standalone_copies(self):
        source_db_before = digest(self.database)
        wal = self.data / "omnivoice.db-wal"
        self.assertTrue(wal.is_file() and wal.stat().st_size > 0)
        result = self.run_backup()
        self.assertEqual(result["status"], "created")
        destination = Path(result["backup_dir"]) / "data"
        reader = sqlite3.connect(destination / "omnivoice.db")
        try:
            self.assertEqual(reader.execute("SELECT * FROM voice_profiles").fetchall(), [("QA", "before", "voices/reference.wav")])
            self.assertEqual(reader.execute("PRAGMA quick_check").fetchone()[0], "ok")
            self.assertEqual(reader.execute("PRAGMA journal_mode").fetchone()[0], "delete")
        finally:
            reader.close()
        for relative in ("voices/reference.wav", "prefs.json", "environment"):
            self.assertEqual((destination / relative).read_bytes(), (self.data / relative).read_bytes())
            self.assertEqual((destination / relative).stat().st_nlink, 1)
        self.assertEqual(digest(self.database), source_db_before, "Read-only backup must not checkpoint or rewrite the source main DB")
        self.assertFalse((destination / "omnivoice.db-wal").exists())
        self.assertFalse((destination / "omnivoice.db-shm").exists())
        self.assertFalse((destination / "models").exists())
        self.assertFalse((destination / "voices/not-a-profile-model.safetensors").exists())
        self.assertEqual(self.events[-1]["phase"], "backup_complete")
        self.assertTrue(any(event["phase"] == "backup_database" and event["copied_pages"] > 0 for event in self.events))
        self.assertTrue(any(event["phase"] == "backup_files" and event["copied_bytes"] > 0 for event in self.events))

    def test_read_transaction_keeps_one_wal_snapshot_during_concurrent_commit(self):
        def later_commit():
            self.writer.execute("UPDATE voice_profiles SET name='after' WHERE id='QA'")
            self.writer.commit()
        result = self.run_backup(on_snapshot=later_commit)
        reader = sqlite3.connect(Path(result["backup_dir"]) / "data/omnivoice.db")
        try:
            self.assertEqual(reader.execute("SELECT name FROM voice_profiles").fetchone()[0], "before")
            self.assertEqual(self.writer.execute("SELECT name FROM voice_profiles").fetchone()[0], "after")
        finally:
            reader.close()

    def test_idempotence_preserves_first_snapshot_and_new_version_gets_new_backup(self):
        first = self.run_backup()
        manifest = Path(first["backup_dir"]) / "backup-manifest.json"
        fingerprint = digest(manifest)
        self.writer.execute("UPDATE voice_profiles SET name='later'"); self.writer.commit()
        again = self.run_backup()
        self.assertEqual(again["status"], "already_backed_up")
        self.assertEqual(again["backup_id"], first["backup_id"])
        self.assertEqual(digest(manifest), fingerprint)
        second = self.run_backup(SHA_B, previous_archive_sha256=SHA_A)
        self.assertNotEqual(first["backup_id"], second["backup_id"])
        self.assertEqual(digest(manifest), fingerprint)
        details = json.loads((Path(second["backup_dir"]) / "backup-manifest.json").read_text())
        self.assertEqual(details["previous_archive_sha256"], SHA_A)
        self.assertTrue(details["complete"])

    def test_corrupt_marker_is_never_replaced_and_existing_backup_is_preserved(self):
        first = self.run_backup()
        manifest = Path(first["backup_dir"]) / "backup-manifest.json"
        fingerprint = digest(manifest)
        marker = self.data / "backups" / (backup.MARKER_PREFIX + SHA_A + ".json")
        marker.write_bytes(b"{broken marker fixture")
        before = sorted(path.name for path in (self.data / "backups").iterdir())
        with self.assertRaisesRegex(backup.BackupError, "Znacznik"):
            self.run_backup()
        self.assertEqual(marker.read_bytes(), b"{broken marker fixture")
        self.assertEqual(digest(manifest), fingerprint)
        self.assertEqual(sorted(path.name for path in (self.data / "backups").iterdir()), before)

    def test_missing_backup_audio_blocks_start_instead_of_overwriting(self):
        first = self.run_backup()
        (Path(first["backup_dir"]) / "data/voices/reference.wav").unlink()
        with self.assertRaisesRegex(backup.BackupError, "niekompletna"):
            self.run_backup()

    def test_no_database_is_noop_without_creating_backups(self):
        empty = self.root / "new-install/data"
        result = backup.backup_before_upgrade(empty, SHA_A, event_writer=self.events.append)
        self.assertEqual(result["status"], "no_database")
        self.assertFalse(empty.exists())
        self.assertEqual(self.events, [])

    def test_low_disk_refuses_before_snapshot_or_migration(self):
        invoked = []
        before = digest(self.database)
        with self.assertRaisesRegex(backup.BackupError, "Za mało miejsca"):
            self.run_backup(disk_usage=lambda _: SimpleNamespace(free=0), on_snapshot=lambda: invoked.append("not allowed"))
        self.assertEqual(invoked, [])
        self.assertEqual(digest(self.database), before)
        self.assertEqual(list((self.data / "backups").glob("backup-*")), [])
        self.assertFalse((self.data / "backups" / (backup.MARKER_PREFIX + SHA_A + ".json")).exists())

    def test_invalid_sha_relative_path_and_old_voicestudio_data_are_refused(self):
        for value in ("", "../old", "g" * 64):
            with self.subTest(value=value), self.assertRaises(backup.BackupError):
                self.run_backup(value)
        with self.assertRaises(backup.BackupError):
            backup.backup_before_upgrade(Path("relative/data"), SHA_A)
        old = self.root / "fake-roaming/OmniVoice/data"
        old.mkdir(parents=True)
        with patch.dict(os.environ, {"APPDATA": str(self.root / "fake-roaming")}):
            with self.assertRaisesRegex(backup.BackupError, "starej"):
                backup.backup_before_upgrade(old, SHA_A)
        self.assertFalse((old / "backups").exists())

    def test_junction_flag_is_refused_without_following_it(self):
        real = backup._is_link
        with patch("runtime_backup._is_link", side_effect=lambda path: path == self.data / "voices" or real(path)):
            with self.assertRaisesRegex(backup.BackupError, "junction"):
                self.run_backup()
        self.assertEqual(list((self.data / "backups").glob("backup-*")), [])

    def test_source_database_hardlink_is_refused_but_audio_is_copied_independently(self):
        alias = self.root / "db-alias.sqlite"
        os.link(self.database, alias)
        with self.assertRaisesRegex(backup.BackupError, "hardlink"):
            self.run_backup()
        alias.unlink()
        original = self.root / "immutable-audio.wav"
        original.write_bytes(b"own fixture shared audio")
        os.link(original, self.data / "voices/hardlinked.wav")
        result = self.run_backup()
        copy = Path(result["backup_dir"]) / "data/voices/hardlinked.wav"
        self.assertEqual(copy.read_bytes(), original.read_bytes())
        self.assertEqual(copy.stat().st_nlink, 1)
        self.assertEqual(original.stat().st_nlink, 2)

    def test_changing_file_keeps_incomplete_backup_without_success_marker(self):
        def changed():
            (self.data / "prefs.json").write_text('{"theme":"changed after snapshot"}', encoding="utf-8")
        with self.assertRaisesRegex(backup.BackupError, "zmieniły się"):
            self.run_backup(on_snapshot=changed)
        directories = list((self.data / "backups").glob("backup-*"))
        self.assertEqual(len(directories), 1)
        self.assertFalse((directories[0] / "backup-manifest.json").exists())
        self.assertFalse((self.data / "backups" / (backup.MARKER_PREFIX + SHA_A + ".json")).exists())

    def test_linked_sqlite_wal_is_refused_before_opening_or_creating_backup(self):
        real = backup._is_link
        with patch("runtime_backup._is_link", side_effect=lambda path: path == self.data / "omnivoice.db-wal" or real(path)):
            with self.assertRaisesRegex(backup.BackupError, "junction"):
                self.run_backup()
        self.assertFalse((self.data / "backups").exists())

    def test_marker_with_rooted_member_cannot_read_outside_backup(self):
        first = self.run_backup()
        manifest = Path(first["backup_dir"]) / "backup-manifest.json"
        details = json.loads(manifest.read_text())
        details["files"]["/outside-owned-backup.txt"] = {"bytes": 0, "sha256": "0" * 64}
        manifest.write_text(json.dumps(details), encoding="utf-8")
        marker = self.data / "backups" / (backup.MARKER_PREFIX + SHA_A + ".json")
        receipt = json.loads(marker.read_text()); receipt["manifest_sha256"] = digest(manifest)
        marker.write_text(json.dumps(receipt), encoding="utf-8")
        with self.assertRaisesRegex(backup.BackupError, "Znacznik"):
            self.run_backup()


if __name__ == "__main__":
    unittest.main(verbosity=2)
