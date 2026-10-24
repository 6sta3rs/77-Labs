"""Private preview/cache integration; fixture renderer, no ML or network."""
from __future__ import annotations

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import asyncio
import importlib.util
from pathlib import Path
import os
import sys
import tempfile
import types
import unittest
import unittest.mock
import zipfile
from unittest.mock import patch

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
import preview_cache


def module(name, **values):
    result = types.ModuleType(name)
    result.__dict__.update(values)
    return result


class LicenseRequired(RuntimeError):
    pass


class PreviewTests(unittest.TestCase):
    def test_generation_uses_actual_bundled_archetype_lookup_contract(self):
        source = self.base / "source"
        with zipfile.ZipFile(_runtime_paths.runtime_source("engine.zip")) as archive:
            for name in ("backend/core/archetypes.py", "omnivoice/utils/voice_design.py"):
                target = source / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(name))
        spec = importlib.util.spec_from_file_location("pinned_archetypes", source / "backend/core/archetypes.py")
        actual = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(actual)
        identifier = actual.list_archetypes(featured=True)[0]["id"]
        rendered = []
        async def fixture_renderer(identifier, local=False):
            rendered.append((identifier, local))
        with patch.dict(sys.modules, {"core": module("core", archetypes=actual), "core.archetypes": actual}), patch.object(sys.modules["api.routers.archetypes"], "preview_archetype", fixture_renderer):
            manager = preview_cache.PreviewCache(self.runtime, self.data)
            manager.state = lambda: {}
            asyncio.run(manager.generate(identifier))
        self.assertEqual(rendered, [(identifier, True)])

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="seventy-seven-preview-cache-")
        self.base = Path(self.temporary.name)
        self.runtime, self.data = self.base / "runtime", self.base / "data"
        self.local, self.gallery_dir = self.data / "outputs/archetype_previews", self.data / "voice_gallery_previews/previews"
        for path in (self.runtime, self.local, self.gallery_dir, self.data / "voices", self.data / "tmp", self.runtime / "temp/nested", self.base / "old-app"):
            path.mkdir(parents=True, exist_ok=True)
        (self.local / ("a" * 16 + ".wav")).write_bytes(b"local wav")
        (self.gallery_dir / ("b" * 16 + ".mp3")).write_bytes(b"gallery mp3")
        (self.local / "keep-user-note.txt").write_text("keep")
        (self.data / "voices/reference.wav").write_bytes(b"reference")
        (self.data / "outputs/generated.wav").write_bytes(b"result")
        (self.base / "old-app/omnivoice-temp.wav").write_bytes(b"legacy")
        (self.data / "tmp/work.tmp").write_bytes(b"temporary data")
        (self.runtime / "temp/nested/work.tmp").write_bytes(b"runtime temporary data")
        for old in (self.data / "tmp/work.tmp", self.runtime / "temp/nested/work.tmp"):
            os.utime(old, (1_000_000_000, 1_000_000_000))  # idle long enough to be cleanable
        self.items = [{"id": "fixture_one", "name": "Pierwszy głos", "key": "a" * 16}, {"id": "fixture_two", "name": "Drugi głos", "key": "c" * 16}]
        self.enabled, self.checks, self.fetches, self.renders, self.work_busy, self.reject_license = False, 0, 0, [], False, False
        def status():
            return {"enabled": self.enabled, "featured_cached": len(list(self.gallery_dir.glob("*.mp3"))), "featured_total": 2, "checked_seconds_ago": 0 if self.checks else None, "last_error": None}
        def set_enabled(value):
            self.enabled = value
        async def fetch_featured():
            self.fetches += 1
            return status()
        async def check_for_updates(force=False):
            self.assertTrue(force)
            self.checks += 1
            return status()
        async def render(identifier, local=False):
            if self.reject_license:
                raise LicenseRequired()
            self.renders.append((identifier, local))
            item = next(item for item in self.items if item["id"] == identifier)
            (self.local / (item["key"] + ".wav")).write_bytes(b"fixture generated wav")
        def native(x_native: str | None = Header(default=None)):
            if x_native != "yes":
                raise HTTPException(status_code=403)
        catalog = module("core.archetypes", list_archetypes=lambda **_kw: self.items, get_archetype=lambda identifier: next((item for item in self.items if item["id"] == identifier), None))
        gallery = module("services.gallery", status=status, set_enabled=set_enabled, fetch_featured=fetch_featured, check_for_updates=check_for_updates)
        router = module("api.routers.archetypes", _preview_key=lambda item: item["key"], preview_archetype=render, _renders={})
        imports = {"core": module("core", archetypes=catalog), "core.archetypes": catalog, "services": module("services", gallery=gallery), "services.gallery": gallery, "api.dependencies": module("api.dependencies", require_native_access=native), "api.routers.archetypes": router, "activity": module("activity", backend_work_busy=lambda: self.work_busy)}
        self.imports = patch.dict(sys.modules, imports)
        self.imports.start()
        app = FastAPI()
        async def rejected(_request, _error):
            return JSONResponse(status_code=403, content={"detail": {"code": "model_licence_required", "models": []}})
        app.add_exception_handler(LicenseRequired, rejected)
        app.include_router(preview_cache.create_router(self.runtime, self.data))
        self.client = TestClient(app)
        self.client.__enter__()
        self.client.headers["x-native"] = "yes"

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.imports.stop()
        self.temporary.cleanup()

    def state(self):
        response = self.client.get("/next/preview-cache/state")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_status_reads_real_counts_without_render_or_download(self):
        state = self.state()
        self.assertEqual(state["cache"]["count"], 2)
        self.assertEqual(state["cache"]["bytes"], len(b"local wavgallery mp3"))
        self.assertEqual(state["temporary"]["count"], 2)
        self.assertTrue(state["voices"][0]["cached"])
        self.assertFalse(state["voices"][1]["cached"])
        self.assertEqual((self.renders, self.fetches, self.checks), ([], 0, 0))

    def test_gallery_consent_is_explicit_and_off_preserves_files(self):
        result = self.client.put("/next/preview-cache/gallery", json={"enabled": True})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertTrue(result.json()["gallery"]["enabled"])
        self.assertEqual(self.fetches, 1)
        self.assertEqual(self.client.post("/next/preview-cache/gallery/check").status_code, 200)
        self.assertEqual(self.checks, 1)
        self.client.put("/next/preview-cache/gallery", json={"enabled": False})
        self.assertEqual(self.fetches, 1)
        self.assertEqual(self.state()["cache"]["count"], 2)

    def test_generation_reuses_original_local_renderer_and_updates_status(self):
        result = self.client.post("/next/preview-cache/generate/fixture_two")
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(self.renders, [("fixture_two", True)])
        self.assertEqual(result.json()["state"]["local"]["count"], 2)
        self.assertFalse(result.json()["state"]["generating"])

    def test_license_failure_remains_original_403_and_does_not_render(self):
        self.reject_license = True
        result = self.client.post("/next/preview-cache/generate/fixture_two")
        self.assertEqual(result.status_code, 403)
        self.assertEqual(result.json()["detail"]["code"], "model_licence_required")
        self.assertEqual(self.renders, [])
        self.assertFalse(self.state()["generating"])

    def test_clear_is_audited_and_preserves_reference_outputs_unknown_and_old_files(self):
        audit = self.state()["cache"]
        result = self.client.post("/next/preview-cache/clear", json=audit)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["removed"], 2)
        self.assertEqual(result.json()["state"]["cache"]["count"], 0)
        for file in (self.data / "voices/reference.wav", self.data / "outputs/generated.wav", self.local / "keep-user-note.txt", self.base / "old-app/omnivoice-temp.wav"):
            self.assertTrue(file.is_file())

    def test_changed_inventory_rejects_old_confirmation_before_any_delete(self):
        audit = self.state()["cache"]
        (self.local / ("d" * 16 + ".wav")).write_bytes(b"new cache")
        result = self.client.post("/next/preview-cache/clear", json=audit)
        self.assertEqual(result.status_code, 400)
        self.assertEqual(self.state()["cache"]["count"], 3)

    def test_temporary_cleanup_only_unlinks_audited_private_files(self):
        state = self.state()
        result = self.client.post("/next/preview-cache/temporary/clear", json=state["temporary"])
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["removed"], 2)
        self.assertEqual(result.json()["state"]["temporary"]["count"], 0)
        self.assertEqual(result.json()["state"]["cache"]["count"], 2)
        self.assertTrue((self.runtime / "temp/nested").is_dir())
        self.assertTrue((self.base / "old-app/omnivoice-temp.wav").is_file())

    def test_temporary_audit_skips_fresh_live_files_and_unreadable_entries(self):
        (self.runtime / "temp/in-flight.tmp").write_bytes(b"still being written")
        real = preview_cache.PreviewCache._safe
        def flaky(path):
            if Path(path) == self.data / "tmp/work.tmp":
                raise PermissionError("locked")
            real(path)
        with unittest.mock.patch.object(preview_cache.PreviewCache, "_safe", staticmethod(flaky)):
            self.assertEqual(self.state()["temporary"]["count"], 1)  # only the old nested file
        self.assertEqual(self.state()["temporary"]["count"], 2)  # fresh in-flight file is never listed

    def test_hardlink_cleanup_preserves_other_name_contents(self):
        original = self.data / "voices/reference.wav"
        os.link(original, self.local / ("e" * 16 + ".wav"))
        result = self.client.post("/next/preview-cache/clear", json=self.state()["cache"])
        self.assertEqual(result.status_code, 200)
        self.assertEqual(original.read_bytes(), b"reference")

    def test_busy_native_boundary_and_invalid_voice_are_rejected(self):
        self.work_busy = True
        self.assertEqual(self.client.post("/next/preview-cache/generate/fixture_two").status_code, 400)
        self.assertEqual(self.client.post("/next/preview-cache/clear", json=self.state()["cache"]).status_code, 400)
        self.work_busy = False
        self.assertEqual(self.client.post("/next/preview-cache/generate/missing").status_code, 400)
        self.assertEqual(self.client.get("/next/preview-cache/state", headers={"x-native": "no"}).status_code, 403)
        self.assertEqual(self.renders, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
