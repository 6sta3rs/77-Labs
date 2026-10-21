"""Real loopback HTTP/SSE/upload/download/WebSocket remote transport fixture."""
from __future__ import annotations

import asyncio
from contextlib import closing
import json
import os
from pathlib import Path
import socket
import sqlite3
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import patch

from cryptography.fernet import Fernet
from fastapi import FastAPI, Header, HTTPException, Request, WebSocket
from fastapi.responses import RedirectResponse, Response, StreamingResponse
from fastapi.testclient import TestClient
import uvicorn
import remote_backend as transport


class ConnectionGuardTests(unittest.IsolatedAsyncioTestCase):
    async def test_another_window_cannot_turn_a_local_request_into_local_inference(self):
        called, messages = [], []
        async def app(scope, receive, send):
            called.append(scope["path"])
        async def send(message):
            messages.append(message)
        guard = transport.ConnectionModeGuard(app)
        scope = {"type": "http", "path": "/generate", "headers": [(b"x-voicestudio-next-mode", b"local")]}
        with patch.object(transport, "_manager", types.SimpleNamespace(active=True)):
            await guard(scope, None, send)
            self.assertEqual(messages[0]["status"], 409)
            self.assertEqual(called, [])
            await guard({**scope, "path": "/next/remote/state"}, None, send)
            self.assertEqual(called, ["/next/remote/state"])

import remote_backend as remote

MASTER = "fixture-master-never-persist-this"
TOKEN = "ovs_admin_session_" + "a" * 43
TICKET = "ovs_ws_ticket_" + "b" * 43


class EncryptedStore:
    def __init__(self, path):
        self.path, self.cipher = path, Fernet(Fernet.generate_key())
        with closing(sqlite3.connect(path)) as db, db:
            db.execute("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)")
    def get_text(self, key, default=None):
        with closing(sqlite3.connect(self.path)) as db:
            row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
            return row[0] if row else default
    def set_text(self, key, value):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("INSERT OR REPLACE INTO settings VALUES(?,?)", (key, value))
    def get_secret(self, key):
        value = self.get_text("secret." + key)
        return self.cipher.decrypt(value.encode()).decode() if value else None
    def set_secret(self, key, value):
        self.set_text("secret." + key, self.cipher.encrypt(value.encode()).decode() if value else "")


class RemoteFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.requests, cls.tickets, cls.sessions = [], set(), set()
        cls.app = app = FastAPI()
        def authenticated(authorization):
            if authorization != "Bearer " + TOKEN or TOKEN not in cls.sessions:
                raise HTTPException(status_code=401, detail="fixture unauthorized")
        @app.get("/studio/health")
        async def health():
            return {"status": "ok", "version": "0.5.7", "device": "fixture CPU"}
        @app.post("/studio/api/auth/session", status_code=201)
        async def session(request: Request, authorization: str | None = Header(default=None)):
            if authorization != "Bearer " + MASTER:
                raise HTTPException(status_code=401, detail="never expose " + str(authorization))
            cls.assert_body = await request.json()
            cls.sessions.add(TOKEN)
            return {"token": TOKEN, "expires_in": 300}
        @app.delete("/studio/api/auth/session", status_code=204)
        async def revoke(authorization: str | None = Header(default=None)):
            authenticated(authorization); cls.sessions.discard(TOKEN)
            return Response(status_code=204)
        @app.get("/studio/system/info")
        async def info(authorization: str | None = Header(default=None)):
            authenticated(authorization)
            return {"app_version": "0.5.7"}
        @app.post("/studio/api/auth/ws-ticket", status_code=201)
        async def ticket(request: Request, authorization: str | None = Header(default=None)):
            authenticated(authorization)
            path = (await request.json())["path"]
            cls.tickets.add((TICKET, path))
            return {"ticket": TICKET, "expires_in": 30}
        @app.api_route("/studio/echo", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
        async def echo(request: Request, authorization: str | None = Header(default=None)):
            authenticated(authorization)
            body = await request.body()
            cls.requests.append({"method": request.method, "query": request.url.query, "headers": dict(request.headers), "body": body})
            return Response(body, media_type=request.headers.get("content-type", "application/octet-stream"), headers={"Set-Cookie": "do-not-relay=secret", "X-Audio-Duration": "1.25", "X-Audio-Id": "fixture-take", "Content-Disposition": 'attachment; filename="fixture.wav"'})
        @app.get("/studio/events")
        async def events(authorization: str | None = Header(default=None)):
            authenticated(authorization)
            async def stream():
                yield b'data: {"type":"started"}\n\n'
                await asyncio.sleep(.01)
                yield b'data: {"type":"complete"}\n\n'
            return StreamingResponse(stream(), media_type="text/event-stream")
        @app.get("/studio/redirect")
        async def redirect():
            return RedirectResponse("http://example.invalid/forbidden")
        @app.websocket("/studio/ws/transcribe")
        async def dictation(websocket: WebSocket):
            ticket = websocket.query_params.get("ws_ticket")
            pair = (ticket, "/ws/transcribe")
            if pair not in cls.tickets:
                await websocket.close(code=1008)
                return
            cls.tickets.remove(pair)
            await websocket.accept()
            frame = await websocket.receive_bytes()
            await websocket.send_json({"type": "final", "text": "fixture transcript", "bytes": len(frame)})
            await websocket.close(code=1000)
        cls.socket = socket.socket()
        cls.socket.bind(("127.0.0.1", 0))
        cls.url = "http://127.0.0.1:" + str(cls.socket.getsockname()[1]) + "/studio"
        cls.server = uvicorn.Server(uvicorn.Config(app, log_level="critical", lifespan="off", access_log=False))
        cls.thread = threading.Thread(target=lambda: cls.server.run(sockets=[cls.socket]), daemon=True)
        cls.thread.start()
        deadline = time.monotonic() + 30
        while not cls.server.started and time.monotonic() < deadline:
            time.sleep(.02)
        if not cls.server.started:
            cls.server.should_exit = True
            cls.thread.join(1)
            cls.socket.close()
            raise RuntimeError("fixture failed to start")

    @classmethod
    def tearDownClass(cls):
        cls.server.should_exit = True
        cls.thread.join(5)
        cls.socket.close()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="seventy-seven-remote-test-")
        self.base = Path(self.temporary.name)
        self.store = EncryptedStore(self.base / "settings.db")
        dependencies = types.ModuleType("api.dependencies")
        def require_native_access(x_test_native: str | None = Header(default=None)):
            if x_test_native != "allowed":
                raise HTTPException(status_code=403, detail="native required")
        dependencies.require_native_access = require_native_access
        services = types.ModuleType("services")
        services.settings_store = self.store
        auth = types.ModuleType("core.auth")
        auth.is_loopback = lambda host: host == "testclient"
        self.patches = patch.dict(sys.modules, {"api.dependencies": dependencies, "services": services, "core.auth": auth})
        self.patches.start()
        app = FastAPI()
        app.include_router(remote.create_router(self.base))
        self.client = TestClient(app)
        self.client.__enter__()
        self.client.headers["x-test-native"] = "allowed"

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.patches.stop()
        self.temporary.cleanup()

    def connect(self):
        response = self.client.post("/next/remote/connect", json={"url": self.url, "key": MASTER})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["active"])
        self.assertNotIn(MASTER, response.text)
        self.assertNotIn(TOKEN, response.text)
        return response.json()

    def test_probe_does_not_select_or_persist_credentials(self):
        response = self.client.post("/next/remote/test", json={"url": self.url, "key": MASTER})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()["active"])
        self.assertIsNone(self.store.get_secret(remote.SECRET))
        self.assertEqual(self.store.get_text(remote.URL_KEY, ""), "")

    def test_connection_stores_only_encrypted_expiring_session_and_restart_is_local(self):
        result = self.connect()
        self.assertTrue(result["authenticated"])
        contents = (self.base / "settings.db").read_bytes()
        self.assertNotIn(MASTER.encode(), contents)
        self.assertNotIn(TOKEN.encode(), contents)
        self.assertEqual(json.loads(self.store.get_secret(remote.SECRET))["token"], TOKEN)
        restarted = remote.RemoteBackend(store=self.store)
        self.assertFalse(restarted.state()["active"])
        self.assertTrue(restarted.state()["session_available"])
        self.assertEqual(RemoteFixtureTests.assert_body, {"transport": "bearer"})

    def test_bad_key_or_wrong_port_does_not_activate_or_reflect_credentials(self):
        for key, url in ((MASTER + "wrong", self.url), (MASTER, self.url + "/wrong-port")):
            response = self.client.post("/next/remote/connect", json={"url": url, "key": key})
            self.assertGreaterEqual(response.status_code, 400)
            self.assertNotIn(MASTER, response.text)
            self.assertFalse(self.client.get("/next/remote/state").json()["active"])

    def test_http_methods_upload_download_headers_and_sse_are_relayed(self):
        self.connect()
        data = b"RIFF-fixture-audio" * 10000
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            response = self.client.request(method, "/next/remote/proxy/echo?format=wav", content=data, headers={"Content-Type": "audio/wav", "Authorization": "Bearer local-secret", "Cookie": "private-cookie=must-not-forward", "Origin": "http://127.0.0.1:4310"})
            self.assertEqual(response.status_code, 200, response.text[:100])
            self.assertEqual(response.content, data)
            self.assertEqual(response.headers["x-audio-duration"], "1.25")
            self.assertNotIn("set-cookie", response.headers)
            seen = self.requests[-1]
            self.assertEqual(seen["method"], method)
            self.assertEqual(seen["headers"]["authorization"], "Bearer " + TOKEN)
            self.assertNotIn("cookie", seen["headers"])
            self.assertNotIn("origin", seen["headers"])
            self.assertEqual(seen["query"], "format=wav")
        response = self.client.get("/next/remote/proxy/events")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/event-stream", response.headers["content-type"])
        self.assertEqual(response.content.count(b"data:"), 2)

    def test_redirect_and_nested_private_routes_are_blocked(self):
        self.connect()
        response = self.client.get("/next/remote/proxy/redirect")
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("location", response.headers)
        for path in ("next/remote/state", "http:evil", "echo?api_key=forbidden"):
            self.assertEqual(self.client.get("/next/remote/proxy/" + path).status_code, 400)

    def test_local_always_recovers_and_revokes_remote_session(self):
        self.connect()
        response = self.client.post("/next/remote/local")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["active"])
        self.assertIsNone(self.store.get_secret(remote.SECRET))
        self.assertNotIn(TOKEN, self.sessions)
        self.assertEqual(self.client.get("/next/remote/proxy/echo").status_code, 409)

    def test_one_use_ticket_relays_binary_dictation_and_text_transcript(self):
        self.connect()
        with self.client.websocket_connect("/next/remote/ws?path=/ws/transcribe&pcm=1&sr=16000&model=fixture", headers={"origin": "http://127.0.0.1:4310"}) as websocket:
            websocket.send_bytes(b"\x00\x01" * 160)
            result = websocket.receive_json()
            self.assertEqual(result, {"type": "final", "text": "fixture transcript", "bytes": 320})
        self.assertNotIn((TICKET, "/ws/transcribe"), self.tickets)

    def test_local_admin_boundary_and_websocket_origin_are_enforced(self):
        headers = {"x-test-native": "rejected"}
        for method, path in (("GET", "/state"), ("POST", "/test"), ("POST", "/connect"), ("POST", "/local"), ("GET", "/proxy/echo")):
            response = self.client.request(method, "/next/remote" + path, headers=headers, json={"url": self.url})
            self.assertEqual(response.status_code, 403)
        from starlette.websockets import WebSocketDisconnect
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect("/next/remote/ws", headers={"origin": "https://untrusted.invalid"}):
                pass

    def test_invalid_secret_is_not_reflected_by_validation(self):
        long_secret = MASTER * 300
        response = self.client.post("/next/remote/connect", json={"url": self.url, "key": long_secret})
        self.assertEqual(response.status_code, 400)
        self.assertNotIn(MASTER, response.text)

    def test_expired_session_keeps_remote_selection_and_blocks_instead_of_falling_back(self):
        self.connect()
        remote._manager.session["expires_at"] = time.time() - 1
        count = len(self.requests)
        state = self.client.get("/next/remote/state").json()
        self.assertTrue(state["active"])
        self.assertFalse(state["authenticated"])
        self.assertIn("wygasła", state["error"])
        self.assertEqual(self.client.post("/next/remote/proxy/echo", content=b"do not reroute").status_code, 409)
        self.assertEqual(len(self.requests), count)
        self.assertFalse(self.client.post("/next/remote/local").json()["active"])

    def test_local_switch_waits_for_physical_transfer_release(self):
        self.connect()
        release = remote._manager.acquire()
        try:
            response = self.client.post("/next/remote/local")
            self.assertEqual(response.status_code, 409)
            self.assertTrue(self.client.get("/next/remote/state").json()["active"])
        finally:
            release()
        self.assertFalse(self.client.post("/next/remote/local").json()["active"])

    def test_connect_rechecks_transfers_after_delayed_probe_and_revokes_only_new_session(self):
        manager = remote.RemoteBackend(store=self.store)
        previous_url = "http://old.fixture/studio"
        previous = {"url": previous_url, "token": "ovs_admin_session_" + "z" * 43, "expires_at": time.time() + 300}
        manager.target, manager.session, manager.active = previous_url, previous, True
        self.store.set_text(remote.URL_KEY, previous_url)
        self.store.set_secret(remote.SECRET, json.dumps(previous))
        self.sessions.add(TOKEN)
        async def race():
            started, resume = asyncio.Event(), asyncio.Event()
            async def delayed_probe(_url, _master):
                started.set()
                await resume.wait()
                return self.url, {"url": self.url, "token": TOKEN, "expires_at": time.time() + 300}, "new fixture"
            with patch.object(manager, "probe", delayed_probe):
                task = asyncio.create_task(manager.connect(self.url, MASTER))
                await started.wait()
                release = manager.acquire()
                try:
                    resume.set()
                    with self.assertRaises(remote.RemoteError) as rejected:
                        await task
                    self.assertEqual(rejected.exception.status, 409)
                finally:
                    release()
        asyncio.run(race())
        self.assertEqual(manager.target, previous_url)
        self.assertEqual(manager.session, previous)
        self.assertTrue(manager.active)
        self.assertEqual(self.store.get_text(remote.URL_KEY), previous_url)
        self.assertEqual(json.loads(self.store.get_secret(remote.SECRET)), previous)
        self.assertNotIn(TOKEN, self.sessions)


class RemoteValidationTests(unittest.TestCase):
    def test_urls_and_proxy_paths_reject_credential_and_traversal_confusion(self):
        for url in ("ftp://host", "http://u:p@host", "https://host?token=secret", "https://host#secret", "https://host/../escape", "https://host/%2e%2e/escape", "http://host\\evil"):
            with self.subTest(url=url), self.assertRaises(remote.RemoteError):
                remote.normalize_url(url)
        self.assertEqual(remote.normalize_url("https://host/studio/"), "https://host/studio")
        for path in ("../health", "next/remote/state", "https://host/health", "a//b", "a%2fb"):
            with self.subTest(path=path), self.assertRaises(remote.RemoteError):
                remote.remote_path(path)


if __name__ == "__main__":
    unittest.main(verbosity=2)
