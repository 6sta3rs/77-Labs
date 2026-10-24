"""A damaged data-location pointer or a stale backup marker must not block the engine for good.
Temporary directories only; nothing from the pinned engine is imported."""

from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import launcher
import runtime_backup

SHA = "a" * 64


class StartupRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="seventy-seven-recovery-")
        self.base = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)

    def test_corrupt_pointer_falls_back_to_default_data_and_is_kept(self):
        runtime = self.base / "runtime"
        runtime.mkdir()
        pointer = runtime / "storage-location.json"
        pointer.write_text("{not json", encoding="utf-8")
        with patch.object(launcher, "ROOT", runtime):
            self.assertEqual(launcher.resolve_data_or_default(), runtime.resolve().parent / "data")
        self.assertEqual(pointer.read_text(encoding="utf-8"), "{not json")

    def test_stale_marker_is_moved_aside_and_backup_redone(self):
        data = self.base / "data"
        data.mkdir()
        with closing(sqlite3.connect(data / "omnivoice.db")) as connection, connection:
            connection.execute("CREATE TABLE voice_profiles(id TEXT)")
        first = runtime_backup.backup_before_upgrade(data, SHA, event_writer=lambda event: None)
        marker = data / "backups" / (runtime_backup.MARKER_PREFIX + SHA + ".json")
        marker.write_text("{broken", encoding="utf-8")
        result = launcher.backup_with_recovery(data, SHA)
        self.assertEqual(result["status"], "created")
        self.assertNotEqual(result["backup_id"], first["backup_id"])
        self.assertEqual(len(list((data / "backups").glob(marker.name + ".stale-*"))), 1)
        self.assertTrue(Path(first["backup_dir"]).is_dir())


if __name__ == "__main__":
    unittest.main(verbosity=2)
