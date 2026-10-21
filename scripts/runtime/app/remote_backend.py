"""Desktop-owned remote VoiceStudio transport; credentials never reach the UI.

Mirrors pinned Electron health -> bearer session -> system/info and one-use
WebSocket-ticket contracts. The master key is transient; only a bounded remote
session is stored through the upstream encrypted settings store. Restart starts
in local mode and never silently replays a generation against another server.
"""
from __future__ import annotations

from pathlib import Path as _SourcePath
import sys as _source_sys
_source_layout = _SourcePath(__file__).resolve().parent.parent
if (_source_layout / "app/launcher.py").is_file() and (_source_layout / "install/bootstrap.py").is_file():
    for _source_dir in ("app", "install"):
        _source_sys.path.insert(0, str(_source_layout / _source_dir))


import asyncio
from contextlib import suppress
import json
import math
from pathlib import Path
import re
import time
from urllib.parse import urlencode, urlsplit, urlunsplit
from typing import Any

MAX_JSON = 16 * 1024
SESSION = re.compile(r"ovs_admin_session_[A-Za-z0-9_-]{43}\Z")
TICKET = re.compile(r"ovs_ws_ticket_[A-Za-z0-9_-]{43}\Z")
SECRET = "next.remote.session"
URL_KEY = "next.remote.url"
WS_PATHS = {"/ws/transcribe", "/ws/events", "/ws/tts"}
_manager = None


class ConnectionModeGuard:
    """Reject a stale local choice if another window selected remote meanwhile."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if scope["type"] == "http" and path != "/health" and not path.startswith("/next/"):
            mode = dict(scope.get("headers", [])).get(b"x-voicestudio-next-mode")
            if mode == b"local" and connected():
                body = json.dumps({"detail": "Wybrane połączenie silnika zmieniło się w innym oknie. Operacja nie została uruchomiona. Odśwież stan i spróbuj ponownie."}, ensure_ascii=False).encode()
                await send({"type": "http.response.start", "status": 409, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)
REQUEST_HEADERS = {"content-type", "accept", "range", "if-none-match", "if-modified-since"}
RESPONSE_HEADERS = {"content-type", "content-disposition", "content-length", "content-encoding", "cache-control", "etag", "last-modified", "accept-ranges", "content-range", "x-audio-duration", "x-audio-id"}


class RemoteError(ValueError):
    def __init__(self, message, *, status=400, kind="invalid"):
        super().__init__(message)
        self.status, self.kind = status, kind


def normalize_url(raw):
    if not isinstance(raw, str) or len(raw) > 2048 or any(ord(char) < 33 or ord(char) == 127 or char == "\\" for char in raw.strip()):
        raise RemoteError("Podaj prawidłowy adres HTTP lub HTTPS silnika.")
    try:
        parsed = urlsplit(raw.strip())
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError()
        _ = parsed.port
        if any(part in {".", ".."} for part in parsed.path.split("/")) or "%" in parsed.path:
            raise ValueError()
    except ValueError:
        raise RemoteError("Podaj adres HTTP lub HTTPS bez loginu, hasła, zapytania i fragmentu.") from None
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def remote_path(raw):
    value = raw.lstrip("/")
    if not value or not re.fullmatch(r"[A-Za-z0-9_./-]+", value) or any(part in {"", ".", ".."} for part in value.split("/")) or value.split("/")[0] == "next":
        raise RemoteError("Nieprawidłowa trasa zdalnego silnika.")
    return value


def _session(value, url):
    if not isinstance(value, dict) or value.get("url") != url or not SESSION.fullmatch(str(value.get("token", ""))):
        return None
    expiry = value.get("expires_at")
    if not isinstance(expiry, (int, float)) or isinstance(expiry, bool) or not math.isfinite(expiry) or not time.time() < expiry <= time.time() + 9 * 3600:
        return None
    return value


def _headers(session):
    return {"Authorization": "Bearer " + session["token"]} if session else {}


async def _object(client, method, url, *, headers=None, body=None, expected=200):
    import httpx
    try:
        # One deadline covers headers AND the bounded body. Redirects and
        # environment proxies are never used for credential exchange.
        async with asyncio.timeout(5):
            async with client.stream(method, url, headers=headers, json=body) as response:
                if response.status_code != expected:
                    kind = "auth" if response.status_code in {401, 403} else "http"
                    raise RemoteError("Serwer odrzucił uwierzytelnienie. Wprowadź klucz administratora ponownie." if kind == "auth" else f"Zdalny silnik odpowiedział HTTP {response.status_code}.", status=401 if kind == "auth" else 502, kind=kind)
                data = bytearray()
                async for part in response.aiter_bytes():
                    if len(data) + len(part) > MAX_JSON:
                        raise RemoteError("Odpowiedź serwera nie odpowiada kontraktowi VoiceStudio.", status=502, kind="wrong_port")
                    data.extend(part)
                try:
                    result = json.loads(data)
                except ValueError:
                    raise RemoteError("Podany adres nie zwrócił odpowiedzi silnika VoiceStudio.", status=502, kind="wrong_port") from None
                if not isinstance(result, dict):
                    raise RemoteError("Nieprawidłowa odpowiedź zdalnego silnika.", status=502, kind="wrong_port")
                return result
    except RemoteError:
        raise
    except (TimeoutError, httpx.TimeoutException):
        raise RemoteError("Upłynął czas połączenia ze zdalnym silnikiem.", status=504, kind="timeout") from None
    except httpx.HTTPError:
        raise RemoteError("Nie można połączyć się ze zdalnym silnikiem. Sprawdź adres, port i certyfikat TLS.", status=502, kind="network") from None


class RemoteBackend:
    def __init__(self, *, store=None, client_factory=None, websocket_connect=None):
        if store is None:
            from services import settings_store
            store = settings_store
        self.store = store
        self.client_factory = client_factory
        self.websocket_connect = websocket_connect
        self.active = False
        self.target = ""
        self.session = None
        self.detail = ""
        self.error = ""
        self.blocked = False
        self.lock = asyncio.Lock()
        self.transfers = 0

    def acquire(self):
        self.transfers += 1
        released = False
        def release():
            nonlocal released
            if not released:
                released = True
                self.transfers -= 1
        return release

    def client(self, *, streaming=False):
        if self.client_factory:
            return self.client_factory()
        import httpx
        return httpx.AsyncClient(follow_redirects=False, trust_env=False, timeout=httpx.Timeout(connect=5, read=600 if streaming else 5, write=600 if streaming else 5, pool=5))

    def saved_url(self):
        raw = self.store.get_text(URL_KEY, "") or ""
        if not raw:
            return ""
        try:
            return normalize_url(raw)
        except RemoteError:
            return ""

    def saved_session(self, target):
        raw = self.store.get_secret(SECRET)
        try:
            return _session(json.loads(raw), target) if raw else None
        except (TypeError, ValueError):
            return None

    def state(self):
        if self.active and self.session and not _session(self.session, self.target):
            self.session = None
            self.blocked = True
            self.error = "Sesja zdalnego silnika wygasła. Połącz się ponownie; żądania nie zostały przeniesione do lokalnego silnika."
        session = self.session or self.saved_session(self.saved_url())
        return {"active": self.active, "url": self.target if self.active else self.saved_url(), "authenticated": bool(self.active and self.session), "session_available": bool(session), "session_expires_at": session.get("expires_at") if session else None, "detail": self.detail, "error": self.error, "active_transfers": self.transfers}

    async def probe(self, raw, master=""):
        target = normalize_url(raw)
        if not isinstance(master, str) or len(master) > 8192 or any(ord(char) < 32 or ord(char) == 127 for char in master):
            raise RemoteError("Nieprawidłowy klucz administratora.", status=400, kind="auth")
        session = self.saved_session(target) if not master.strip() else None
        async with self.client() as client:
            health = await _object(client, "GET", target + "/health")
            if health.get("status") != "ok" or not isinstance(health.get("version"), str) or not isinstance(health.get("device"), str):
                raise RemoteError("Podany adres nie jest portem API VoiceStudio. Sprawdź port backendu.", status=502, kind="wrong_port")
            if master.strip():
                payload = await _object(client, "POST", target + "/api/auth/session", headers={"Authorization": "Bearer " + master.strip()}, body={"transport": "bearer"}, expected=201)
                expiry = payload.get("expires_in")
                if not isinstance(expiry, (float, int)) or isinstance(expiry, bool) or not math.isfinite(expiry) or not 0 < expiry <= 9 * 3600 or not SESSION.fullmatch(str(payload.get("token", ""))):
                    raise RemoteError("Serwer zwrócił nieprawidłową sesję administratora.", status=502, kind="auth")
                session = {"url": target, "token": payload["token"], "expires_at": time.time() + expiry}
            info = await _object(client, "GET", target + "/system/info", headers=_headers(session))
            if not isinstance(info.get("app_version"), str):
                raise RemoteError("Serwer nie zwrócił informacji VoiceStudio. Sprawdź adres i port API.", status=502, kind="wrong_port")
        # Server-controlled descriptions are reduced to the minimum useful
        # shape, bounded, and cannot reflect the submitted secret/session.
        version, device = health["version"], health["device"]
        for secret in (master, session["token"] if session else ""):
            if secret:
                version = version.replace(secret, "[ukryto]"); device = device.replace(secret, "[ukryto]")
        version = re.sub(r"[^A-Za-z0-9.+_-]", "", version)[:40]
        device = re.sub(r"[^A-Za-z0-9 .:_+-]", "", device)[:80]
        return target, session, f"VoiceStudio {version} · {device}"

    async def test(self, raw, master=""):
        target, session, detail = await self.probe(raw, master)
        if session and master.strip():
            with suppress(Exception):
                async with self.client() as client:
                    await client.delete(target + "/api/auth/session", headers=_headers(session))
        return {"ok": True, "url": target, "detail": detail, "active": self.active}

    async def connect(self, raw, master=""):
        async with self.lock:
            if self.transfers:
                raise RemoteError("Zakończ aktywne operacje przed zmianą zdalnego serwera.", status=409, kind="busy")
            target, session, detail = await self.probe(raw, master)
            if self.transfers:
                # An operation may have started on the previous server while
                # the health/session/info round-trip was awaiting network IO.
                # Do not persist a new target or revoke the old in-use session.
                if session and master.strip():
                    with suppress(Exception):
                        async with self.client() as client:
                            async with asyncio.timeout(5):
                                await client.delete(target + "/api/auth/session", headers=_headers(session))
                raise RemoteError("Podczas testu połączenia rozpoczęto operację. Zakończ ją przed zmianą serwera.", status=409, kind="busy")
            # Persist only after all health/session/info checks passed.
            self.store.set_secret(SECRET, json.dumps(session) if session else "")
            self.store.set_text(URL_KEY, target)
            self.target, self.session, self.detail, self.error = target, session, detail, ""
            self.blocked = False
            self.active = True
            return self.state()

    async def local(self):
        async with self.lock:
            if self.transfers:
                raise RemoteError("Zakończ aktywne operacje lub dyktowanie przed przełączeniem na lokalny silnik.", status=409, kind="busy")
            target, session = self.target, self.session
            self.active = False; self.target = ""; self.session = None; self.detail = ""; self.error = ""
            self.blocked = False
            self.store.set_secret(SECRET, "")
            if target and session:
                # Local mode is selected even when an unreachable server
                # cannot acknowledge revocation. Its absolute expiry remains.
                with suppress(Exception):
                    async with self.client() as client:
                        async with asyncio.timeout(5):
                            await client.delete(target + "/api/auth/session", headers=_headers(session))
            return self.state()

    def connection(self):
        self.state()
        if not self.active:
            raise RemoteError("Zdalny silnik nie jest połączony. Wybierz Połącz albo Użyj lokalnego silnika.", status=409, kind="inactive")
        if self.blocked:
            raise RemoteError("Sesja zdalnego silnika wygasła lub została unieważniona. Połącz się ponownie albo jawnie wybierz lokalny silnik.", status=409, kind="expired")
        return self.target, self.session

    async def websocket_url(self, path, parameters):
        if path not in WS_PATHS:
            raise RemoteError("Nieobsługiwana trasa WebSocket.")
        target, session = self.connection()
        query = list(parameters)
        if any(key.lower() in {"api_key", "token", "authorization", "ws_ticket", "key"} for key, _value in query):
            raise RemoteError("Dane logowania nie mogą znajdować się w adresie WebSocket.")
        if session:
            async with self.client() as client:
                payload = await _object(client, "POST", target + "/api/auth/ws-ticket", headers=_headers(session), body={"path": path}, expected=201)
            expiry = payload.get("expires_in")
            if not TICKET.fullmatch(str(payload.get("ticket", ""))) or not isinstance(expiry, (int, float)) or isinstance(expiry, bool) or not math.isfinite(expiry) or not 0 < expiry <= 60:
                raise RemoteError("Serwer zwrócił nieprawidłowy jednorazowy bilet WebSocket.", status=502, kind="auth")
            query.append(("ws_ticket", payload["ticket"]))
        parsed = urlsplit(target + path)
        return urlunsplit(("wss" if parsed.scheme == "https" else "ws", parsed.netloc, parsed.path, urlencode(query), ""))


def busy():
    return bool(_manager and _manager.transfers)


def connected():
    return bool(_manager and _manager.active)


def create_router(data: Path):
    global _manager
    from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket
    from fastapi.responses import StreamingResponse
    from pydantic import BaseModel
    from api.dependencies import require_native_access
    globals()["Request"], globals()["WebSocket"] = Request, WebSocket
    manager = RemoteBackend()
    _manager = manager
    router = APIRouter(prefix="/next/remote")
    class ConnectionBody(BaseModel):
        # Validate inside probe with fixed public errors. A Pydantic length
        # error would reflect the complete submitted credential as `input`.
        url: Any = ""
        key: Any = ""
    globals()["RemoteConnectionBody"] = ConnectionBody
    def public_error(error):
        return HTTPException(status_code=error.status, detail=str(error))
    @router.get("/state", dependencies=[Depends(require_native_access)])
    def state():
        return manager.state()
    @router.post("/test", dependencies=[Depends(require_native_access)])
    async def test(body: RemoteConnectionBody):
        try:
            return await manager.test(body.url, body.key)
        except RemoteError as error:
            raise public_error(error) from None
        finally:
            body.key = ""
    @router.post("/connect", dependencies=[Depends(require_native_access)])
    async def connect(body: RemoteConnectionBody):
        try:
            return await manager.connect(body.url, body.key)
        except RemoteError as error:
            raise public_error(error) from None
        finally:
            body.key = ""
    @router.post("/local", dependencies=[Depends(require_native_access)])
    async def local():
        try:
            return await manager.local()
        except RemoteError as error:
            raise public_error(error) from None
    @router.api_route("/proxy/{path:path}", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], dependencies=[Depends(require_native_access)])
    async def proxy(path: str, request: Request):
        import httpx
        release = lambda: None
        try:
            route = remote_path(path)
            target, session = manager.connection()
            if any(key.lower() in {"api_key", "token", "authorization", "ws_ticket"} for key, _value in request.query_params.multi_items()):
                raise RemoteError("Nie przekazuj danych logowania w adresie żądania.")
            url = target + "/" + route
            headers = {name: value for name, value in request.headers.items() if name.lower() in REQUEST_HEADERS}
            headers.update(_headers(session)); headers["X-VoiceStudio-CSRF"] = "1"; headers["Accept-Encoding"] = "identity"
            client = manager.client(streaming=True)
            release = manager.acquire()
            outbound = client.build_request(request.method, url, params=request.query_params.multi_items(), headers=headers, content=request.stream())
            try:
                response = await client.send(outbound, stream=True)
            except BaseException:
                await client.aclose()
                raise
            # Never relay redirects: their Location could expose credentials or
            # send an upload somewhere the user did not configure.
            if 300 <= response.status_code < 400 and response.status_code != 304:
                await response.aclose(); await client.aclose()
                raise RemoteError("Zdalny silnik przekierował żądanie. Podaj jego docelowy adres w ustawieniach.", status=502, kind="http")
            if response.status_code in {401, 403} and session:
                manager.blocked = True; manager.session = None
                manager.error = "Serwer unieważnił sesję. Połącz się ponownie; wybrany tryb zdalny pozostaje aktywny."
                manager.store.set_secret(SECRET, "")
            async def stream():
                try:
                    async for chunk in response.aiter_raw():
                        yield chunk
                finally:
                    try:
                        await response.aclose(); await client.aclose()
                    finally:
                        release()
            outgoing = {name: value for name, value in response.headers.items() if name.lower() in RESPONSE_HEADERS}
            return StreamingResponse(stream(), status_code=response.status_code, headers=outgoing)
        except RemoteError as error:
            release()
            raise public_error(error) from None
        except httpx.TimeoutException:
            release()
            raise HTTPException(status_code=504, detail="Zdalny silnik nie odpowiedział na czas.") from None
        except httpx.HTTPError:
            release()
            raise HTTPException(status_code=502, detail="Połączenie ze zdalnym silnikiem zostało przerwane.") from None
        except BaseException:
            release()
            raise
    @router.websocket("/ws")
    async def websocket(local: WebSocket):
        from core.auth import is_loopback
        from starlette.websockets import WebSocketDisconnect
        # An HTTP admin session from another machine must never acquire the
        # desktop proxy's encrypted remote credentials.
        origin = local.headers.get("origin")
        allowed = {"http://tauri.localhost", "https://tauri.localhost", "tauri://localhost", "http://127.0.0.1:4310", "http://localhost:4310"}
        if not is_loopback(local.client.host if local.client else None) or (origin is not None and origin not in allowed):
            await local.close(code=1008)
            return
        release = manager.acquire()
        try:
            path = local.query_params.get("path", "/ws/transcribe")
            parameters = [(key, value) for key, value in local.query_params.multi_items() if key != "path"]
            url = await manager.websocket_url(path, parameters)
            if manager.websocket_connect:
                connector = manager.websocket_connect
            else:
                from websockets.asyncio.client import connect as connector
            # No browser Origin/Cookie/Authorization is forwarded. The URL
            # carries only the server-issued one-use ticket, never a session.
            async with connector(url, open_timeout=5, max_size=8 * 1024 ** 2, max_queue=8, proxy=None) as remote:
                await local.accept()
                async def upload():
                    while True:
                        frame = await local.receive()
                        if frame["type"] == "websocket.disconnect":
                            return
                        if frame.get("bytes") is not None:
                            await remote.send(frame["bytes"])
                        elif frame.get("text") is not None:
                            await remote.send(frame["text"])
                async def download():
                    async for frame in remote:
                        if isinstance(frame, bytes):
                            await local.send_bytes(frame)
                        else:
                            await local.send_text(frame)
                tasks = [asyncio.create_task(upload()), asyncio.create_task(download())]
                try:
                    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                    for task in done:
                        task.result()
                finally:
                    for task in tasks:
                        task.cancel()
                    await asyncio.gather(*tasks, return_exceptions=True)
        except Exception:
            with suppress(Exception):
                await local.close(code=1011, reason="Nie udało się połączyć ze zdalnym dyktowaniem. Sprawdź sesję i adres silnika.")
        finally:
            release()
            with suppress(Exception):
                await local.close(code=1000)
    return router
