"""Storage integration tests: real SQLite and independent filesystem copies."""
from __future__ import annotations

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths


import hashlib
import json
import importlib.util
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
import sys
import types
from contextlib import closing
from unittest.mock import patch

import storage_settings as storage


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="seventy-seven-storage-test-")
        self.base = Path(self.temporary.name).resolve()
        self.runtime = self.base / "app/runtime"
        self.data = self.base / "app/data"
        self.target = self.base / "new-location/data"
        self.runtime.mkdir(parents=True)
        (self.data / "voices").mkdir(parents=True)
        (self.data / "voices/reference.wav").write_bytes(b"private-reference-audio")
        (self.data / "outputs").mkdir()
        (self.data / "outputs/take.wav").write_bytes(b"generated-audio")
        (self.data / "project.json").write_text(json.dumps({"audio_path": str(self.data / "outputs/take.wav"), "text": str(self.data / "keep-prose")}), encoding="utf8")
        self.db = self.data / "omnivoice.db"
        with closing(sqlite3.connect(self.db)) as db, db:
            db.execute("CREATE TABLE voice_profiles(id TEXT PRIMARY KEY, ref_audio_path TEXT, description TEXT)")
            db.execute("INSERT INTO voice_profiles VALUES(?,?,?)", ("profile", str(self.data / "voices/reference.wav"), str(self.data / "keep-this-prose")))
            db.execute("CREATE TABLE generation_history(id TEXT PRIMARY KEY,audio_path TEXT,state_json TEXT)")
            db.execute("INSERT INTO generation_history VALUES(?,?,?)", ("take", str(self.data / "outputs/take.wav"), json.dumps({"video_path": str(self.data / "outputs/take.wav"), "text": str(self.data / "prose")})))
        self.manager = storage.StorageManager(self.runtime, self.data, work_busy=lambda: False)

    def tearDown(self):
        self.temporary.cleanup()

    def digest(self, path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def test_default_resolver_does_not_write(self):
        self.assertEqual(storage.resolve_data_dir(self.runtime), self.data)
        self.assertFalse((self.runtime / storage.POINTER).exists())

    def test_plan_waits_for_restart_then_copies_rebases_and_activates(self):
        before = self.digest(self.db)
        state = self.manager.relocate(str(self.target))
        self.assertEqual(state["data_dir"], str(self.data))
        self.assertFalse((self.target / "omnivoice.db").exists())
        self.assertEqual(storage.resolve_data_dir(self.runtime), self.data)
        events = []
        active = storage.apply_pending_data_relocation(self.runtime, event_writer=events.append)
        self.assertEqual(active, self.target)
        self.assertEqual(storage.resolve_data_dir(self.runtime), self.target)
        self.assertEqual(self.digest(self.db), before)
        self.assertEqual((self.target / "voices/reference.wav").read_bytes(), b"private-reference-audio")
        self.assertEqual((self.target / "voices/reference.wav").stat().st_nlink, 1)
        self.assertFalse(os.path.samefile(self.target / "voices/reference.wav", self.data / "voices/reference.wav"))
        self.assertEqual(json.loads((self.target / "project.json").read_text()), {"audio_path": str(self.target / "outputs/take.wav"), "text": str(self.data / "keep-prose")})
        with closing(sqlite3.connect(self.target / "omnivoice.db")) as db:
            path, prose = db.execute("SELECT ref_audio_path, description FROM voice_profiles").fetchone()
            self.assertEqual(path, str(self.target / "voices/reference.wav"))
            self.assertEqual(prose, str(self.data / "keep-this-prose"))
            audio_path, raw = db.execute("SELECT audio_path,state_json FROM generation_history").fetchone()
            self.assertEqual(audio_path, str(self.target / "outputs/take.wav"))
            self.assertEqual(json.loads(raw), {"video_path": str(self.target / "outputs/take.wav"), "text": str(self.data / "prose")})
            self.assertEqual(db.execute("PRAGMA quick_check").fetchone()[0], "ok")
        self.assertIsNone(storage._selection(self.runtime)["pending"])
        self.assertTrue(any(event["phase"] == "relocation_complete" for event in events))
        self.assertEqual([event["revision"] for event in events], list(range(1, len(events) + 1)))

    def test_failure_preserves_source_and_partial_destination(self):
        self.manager.relocate(str(self.target))
        def fail_copy(_source, destination, _planned, _progress):
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(b"partial")
            raise OSError("fixture disk failure")
        with patch("runtime_backup._copy_stable", side_effect=fail_copy):
            self.assertEqual(storage.apply_pending_data_relocation(self.runtime, event_writer=lambda _event: None), self.data)
        selection = storage._selection(self.runtime)
        self.assertIn("fixture disk failure", selection["last_error"])
        self.assertIsNone(selection["pending"])
        self.assertEqual(storage.resolve_data_dir(self.runtime), self.data)
        self.assertTrue(self.db.is_file())
        self.assertGreater(len(list(self.target.rglob("*"))), 1)

    def test_activation_write_failure_keeps_process_and_durable_selection_on_source(self):
        self.manager.relocate(str(self.target))
        original_write = storage._write
        activation_failed = False
        def fail_activation_once(path, value):
            nonlocal activation_failed
            if Path(path) == self.runtime / storage.POINTER and value.get("active") == str(self.target) and not activation_failed:
                activation_failed = True
                raise OSError("fixture transient pointer lock")
            return original_write(path, value)
        with patch.object(storage, "_write", side_effect=fail_activation_once):
            active = storage.apply_pending_data_relocation(self.runtime, event_writer=lambda _event: None)
        self.assertTrue(activation_failed)
        self.assertEqual(active, self.data)
        self.assertEqual(storage.resolve_data_dir(self.runtime), active)
        selection = storage._selection(self.runtime)
        self.assertEqual(selection["active"], str(self.data))
        self.assertIn("fixture transient pointer lock", selection["last_error"])
        self.assertIsNone(selection["pending"])
        self.assertTrue((self.target / "omnivoice.db").is_file())

    def test_completion_notification_failure_does_not_roll_back_committed_activation(self):
        self.manager.relocate(str(self.target))
        events = []
        def fail_completion(event):
            events.append(event)
            if event["phase"] == "relocation_complete":
                raise OSError("fixture completed log unavailable")
        active = storage.apply_pending_data_relocation(self.runtime, event_writer=fail_completion)
        self.assertEqual(active, self.target)
        self.assertEqual(storage.resolve_data_dir(self.runtime), active)
        selection = storage._selection(self.runtime)
        self.assertIsNone(selection["last_error"])
        self.assertIsNone(selection["pending"])
        self.assertTrue(self.db.is_file())
        self.assertFalse(any(event["phase"] == "relocation_failed" for event in events))

    def test_target_changed_after_plan_is_never_overwritten(self):
        self.manager.relocate(str(self.target))
        foreign = self.target / "keep.txt"
        foreign.write_text("preserve", encoding="utf8")
        self.assertEqual(storage.apply_pending_data_relocation(self.runtime, event_writer=lambda _event: None), self.data)
        self.assertEqual(foreign.read_text(), "preserve")
        self.assertIn("zawiera dane", storage._selection(self.runtime)["last_error"])

    def test_busy_and_invalid_locations_are_rejected(self):
        busy = storage.StorageManager(self.runtime, self.data, work_busy=lambda: True)
        with self.assertRaisesRegex(ValueError, "aktywne zadania"):
            busy.relocate(str(self.target))
        for path in ("relative/data", str(self.runtime / "data"), str(self.data / "nested/data"), str(self.base / "wrong-name")):
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.manager.relocate(path)

    def test_nonempty_target_and_legacy_data_are_rejected(self):
        self.target.mkdir(parents=True)
        (self.target / "existing.txt").write_text("preserve")
        with self.assertRaisesRegex(ValueError, "pusty"):
            self.manager.relocate(str(self.target))
        old_appdata = self.base / "legacy-appdata"
        with patch.dict(os.environ, {"APPDATA": str(old_appdata)}):
            with self.assertRaisesRegex(ValueError, "starą instalacją"):
                self.manager.relocate(str(old_appdata / "OmniVoice/data"))

    def test_cancel_retains_reservation_without_copying(self):
        self.manager.relocate(str(self.target))
        state = self.manager.cancel_relocation()
        self.assertIsNone(state["pending"])
        self.assertTrue((self.target / storage.MARKER).is_file())
        self.assertEqual(storage.apply_pending_data_relocation(self.runtime, event_writer=lambda _event: None), self.data)
        self.assertFalse((self.target / "omnivoice.db").exists())

    def test_sqlite_backup_contains_committed_wal_and_not_future_writes(self):
        with closing(sqlite3.connect(self.db)) as writer:
            writer.execute("PRAGMA journal_mode=WAL")
            writer.execute("INSERT INTO voice_profiles VALUES('wal','relative.wav','wal transaction')")
            writer.commit()
            result = self.manager.backup()
            backup = Path(result["backups"][0]["path"])
            writer.execute("DELETE FROM voice_profiles WHERE id='wal'")
            writer.commit()
            with closing(sqlite3.connect(backup)) as restored:
                self.assertEqual(restored.execute("SELECT description FROM voice_profiles WHERE id='wal'").fetchone()[0], "wal transaction")
                self.assertEqual(restored.execute("PRAGMA quick_check").fetchone()[0], "ok")
        self.assertEqual(backup.stat().st_nlink, 1)

    def test_failed_manual_backup_is_not_listed_and_leaves_no_temporary(self):
        original = storage._snapshot_database
        def snapshot_then_fail(source, target, progress):
            original(source, target, progress)
            raise ValueError("Kontrola spójności kopii bazy nie powiodła się.")
        with patch.object(storage, "_snapshot_database", side_effect=snapshot_then_fail):
            with self.assertRaisesRegex(ValueError, "spójności"):
                self.manager.backup()
        self.assertEqual(self.manager.backups()["backups"], [])
        self.assertEqual(list((self.data / "backups").iterdir()), [])

    def test_corrupt_pointer_fails_closed_without_writes(self):
        pointer = self.runtime / storage.POINTER
        body = json.dumps({"schema": 1, "owner": "foreign", "active": str(self.target)})
        pointer.write_text(body)
        with self.assertRaisesRegex(ValueError, "Uszkodzony"):
            storage.resolve_data_dir(self.runtime)
        self.assertEqual(pointer.read_text(), body)

    def test_nondefault_data_requires_complete_receipt(self):
        storage._write(self.runtime / storage.POINTER, {"schema": 1, "owner": storage.OWNER, "active": str(self.target)})
        with self.assertRaisesRegex(ValueError, "Brak potwierdzenia"):
            storage.resolve_data_dir(self.runtime)

    def test_hardlinked_reference_is_copied_independently(self):
        original = self.base / "original-voice.wav"
        original.write_bytes(b"original immutable data")
        os.link(original, self.data / "voices/hardlinked.wav")
        self.manager.relocate(str(self.target))
        storage.apply_pending_data_relocation(self.runtime, event_writer=lambda _event: None)
        copied = self.target / "voices/hardlinked.wav"
        copied.write_bytes(b"new private data")
        self.assertEqual(original.read_bytes(), b"original immutable data")
        self.assertEqual((self.data / "voices/hardlinked.wav").read_bytes(), b"original immutable data")

    def test_report_is_cached_and_explicit_refresh_observes_new_files(self):
        first = self.manager.report()
        self.assertFalse(first["cached"])
        self.assertEqual({item["id"] for item in first["categories"]}, {"data", "models", "runtime"})
        size = first["categories"][0]["bytes"]
        (self.data / "new-file").write_bytes(b"1234567")
        self.assertTrue(self.manager.report()["cached"])
        second = self.manager.report(refresh=True)
        self.assertEqual(second["categories"][0]["bytes"], size + 7)
        self.assertTrue(second["logical_bytes"])

    def test_network_device_paths_are_rejected_before_filesystem_inspection(self):
        if os.name != "nt":
            self.skipTest("Windows local-drive contract")
        for raw in (r"\\server\share\data", r"\\?\C:\private\data", r"\\.\C:\private\data"):
            with self.subTest(path=raw), patch.object(storage, "_no_links", side_effect=AssertionError("must not access network")):
                with self.assertRaisesRegex(ValueError, "lokalny katalog"):
                    storage._data_path(self.runtime, raw)

    @unittest.skipUnless(importlib.util.find_spec("fastapi") and importlib.util.find_spec("httpx"), "requires private runtime FastAPI/httpx")
    def test_http_router_validates_auth_body_and_persists_real_operations(self):
        from fastapi import FastAPI, Header, HTTPException
        from fastapi.testclient import TestClient
        import model_management
        def require_admin(x_test_admin: str | None = Header(default=None)):
            if x_test_admin != "allowed":
                raise HTTPException(status_code=403, detail="fixture admin required")
        dependencies = types.ModuleType("api.dependencies")
        dependencies.require_admin = require_admin
        activity = types.ModuleType("activity")
        activity.backend_work_busy = lambda: False
        manager = model_management.ModelManager(self.runtime, self.data, catalog=[])
        with patch.dict(sys.modules, {"api.dependencies": dependencies, "activity": activity}), patch.object(model_management, "_manager", manager):
            app = FastAPI()
            app.include_router(storage.create_router(self.runtime, self.data))
            with TestClient(app) as client:
                for method, path in (("GET", "/state"), ("GET", "/report"), ("GET", "/backups"), ("POST", "/backup"), ("PUT", "/models/reset"), ("DELETE", "/relocation")):
                    self.assertEqual(client.request(method, "/next/storage" + path).status_code, 403)
                client.headers["x-test-admin"] = "allowed"
                self.assertEqual(client.get("/next/storage/state").json()["data_dir"], str(self.data))
                self.assertEqual(client.get("/next/storage/report?refresh=1").status_code, 200)
                self.assertEqual(client.post("/next/storage/relocation", json={}).status_code, 422)
                self.assertEqual(client.post("/next/storage/relocation", json={"path": "relative"}).status_code, 400)
                relocated = client.post("/next/storage/relocation", json={"path": str(self.target)})
                self.assertEqual(relocated.status_code, 200, relocated.text)
                self.assertEqual(relocated.json()["pending"]["destination"], str(self.target))
                self.assertIsNone(client.delete("/next/storage/relocation").json()["pending"])
                backup = client.post("/next/storage/backup")
                self.assertEqual(backup.status_code, 200, backup.text)
                self.assertTrue(Path(backup.json()["backups"][0]["path"]).is_file())
                reset = client.put("/next/storage/models/reset")
                self.assertEqual(reset.status_code, 200, reset.text)
                self.assertEqual(reset.json()["configured"], str(self.runtime.parent / "models"))
                self.assertIn("OMNIVOICE_CACHE_DIR=", (self.data / "environment").read_text())


if __name__ == "__main__":
    unittest.main(verbosity=2)
