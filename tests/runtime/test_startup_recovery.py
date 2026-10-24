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

import io
import json

import launcher
import model_management
import runtime_backup
import tts_extensions

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

    def test_damaged_model_state_files_do_not_stop_the_start(self):
        runtime, data = self.base / "runtime", self.base / "data"
        runtime.mkdir(); data.mkdir()
        default = (self.base / "models").resolve()
        for body in (b"[1, 2]", b'{"path": 5}', b"\xff\xfe{", b"null"):
            (runtime / "model-cache.json").write_bytes(body)
            (data / "environment").write_bytes(b"\xff\xfe\x00")
            self.assertEqual(model_management.selected_model_cache(runtime, data), default)
        (data / "model-downloads.json").write_text(json.dumps(["not", "a", "dict"]), encoding="utf-8")
        self.assertEqual(model_management.ModelManager(runtime, data, catalog=[]).jobs, {})
        (data / "model-downloads.json").write_text(json.dumps({"repo": "text"}), encoding="utf-8")
        self.assertEqual(model_management.ModelManager(runtime, data, catalog=[]).jobs, {})

    def test_fish_health_that_is_not_an_object_means_not_ready(self):
        class Response(io.BytesIO):
            __enter__ = lambda self: self
            __exit__ = lambda self, *args: None
        class Opener:
            def open(self, *_args, **_kwargs):
                return Response(b'["ok"]')
        tts_extensions._fish_probe.clear()
        with patch("urllib.request.build_opener", return_value=Opener()):
            self.assertFalse(tts_extensions.fish_transport_ready({"url": "http://127.0.0.1:8080"}))
        tts_extensions._fish_probe.clear()


class LauncherImportsTests(unittest.TestCase):
    def test_local_imports_of_launcher_name_existing_functions(self):
        """`from <engine module> import name` inside launcher.py must name something that module defines (a wrong module breaks every start)."""
        import ast, importlib
        launcher = Path(__file__).resolve().parents[2] / "scripts/runtime/app/launcher.py"
        app = launcher.parent
        for node in ast.walk(ast.parse(launcher.read_text(encoding="utf-8"))):
            if isinstance(node, ast.ImportFrom) and node.module and (app / f"{node.module}.py").is_file():
                module = importlib.import_module(node.module)
                for alias in node.names:
                    self.assertTrue(hasattr(module, alias.name), f"{node.module} has no {alias.name}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
