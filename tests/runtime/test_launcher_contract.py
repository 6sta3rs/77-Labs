"""Launcher contract without torch: the ownership marker wrapper and the activity middleware around a stub ASGI app.
Offline; nothing from the pinned engine is imported."""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import os
import unittest
from unittest.mock import patch

from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from activity import Activity
from launcher import owned_backend

TOKEN = "per-run-marker"
seen = {}


async def health(request):
    return JSONResponse({"ok": True})


async def slow(request):
    seen["active_during_request"] = activity.active
    return JSONResponse({"ok": True})


async def generate(request):
    return JSONResponse({"generated": True})


stub = Starlette(routes=[Route("/health", health), Route("/slow", slow), Route("/generate", generate, methods=["POST"])])
activity = Activity(stub, TOKEN, lambda: False)
client = TestClient(owned_backend(activity, TOKEN), raise_server_exceptions=True)


class LauncherContractTests(unittest.TestCase):
    def test_every_response_carries_the_marker(self):
        for response in (client.get("/health"), client.get("/missing"), client.post("/generate", data={"text": "x"})):
            self.assertEqual(response.headers.get("x-voicestudio-next"), TOKEN)

    def test_activity_endpoint_needs_the_marker(self):
        denied = client.get("/next/activity")
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(client.get("/next/activity", headers={"X-VoiceStudio-Next": "wrong"}).status_code, 403)
        allowed = client.get("/next/activity", headers={"X-VoiceStudio-Next": TOKEN})
        self.assertEqual(allowed.status_code, 200)
        self.assertIn("busy", allowed.json())

    def test_an_empty_token_never_authorises(self):
        open_activity = Activity(stub, "", lambda: False)
        open_client = TestClient(owned_backend(open_activity, ""))
        self.assertEqual(open_client.get("/next/activity", headers={"X-VoiceStudio-Next": ""}).status_code, 403)

    def test_requests_are_counted_while_they_run_and_released_after(self):
        self.assertEqual(client.get("/slow").status_code, 200)
        self.assertEqual(seen["active_during_request"], 1)
        self.assertEqual(activity.active, 0)

    def test_empty_synthesis_text_is_rejected_before_the_engine(self):
        with patch.dict(os.environ, {"OMNIVOICE_CACHE_DIR": ""}):
            response = client.post("/generate", data={"text": "   "})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.headers.get("x-voicestudio-next"), TOKEN)
        self.assertIn("pusty", response.json()["detail"])

    def test_a_missing_model_folder_fails_fast_with_a_readable_message(self):
        with patch.dict(os.environ, {"OMNIVOICE_CACHE_DIR": os.path.join(os.path.dirname(__file__), "no-such-model-folder")}):
            response = client.post("/generate", data={"text": "x"})
        self.assertEqual(response.status_code, 503)
        self.assertIn("Folder modeli", response.json()["detail"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
