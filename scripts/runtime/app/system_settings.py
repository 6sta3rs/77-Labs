"""Private settings adapters: never touch the old app or global HF login.

The upstream compute/media/network routes remain the source of behavior. This
adapter only supplies the missing private credential state, so the renderer
never reads a credential back and saving HF does not call huggingface.login.
"""

from pathlib import Path as _SourcePath
import sys as _source_sys
_source_layout = _SourcePath(__file__).resolve().parent.parent
if (_source_layout / "app/launcher.py").is_file() and (_source_layout / "install/bootstrap.py").is_file():
    for _source_dir in ("app", "install"):
        _source_sys.path.insert(0, str(_source_layout / _source_dir))

import asyncio
import hmac
import json
import os
import secrets
from pathlib import Path
from urllib.parse import urlsplit


CREDENTIAL_FIELDS = {
    "GOOGLE_TRANSLATE_API_KEY": ("Google Cloud · klucz API", True),
    "MICROSOFT_API_KEY": ("Microsoft Azure · klucz API", True),
    "MICROSOFT_REGION": ("Microsoft Azure · region", False),
    "MICROSOFT_BASE_URL": ("Microsoft Azure · adres API", False),
    "DEEPL_API_KEY": ("DeepL · klucz API", True),
    "DEEPL_BASE_URL": ("DeepL · adres API", False),
    "AWS_PROFILE": ("AWS · profil", False),
    "AWS_REGION": ("AWS · region", False),
}
# "Zawsze" in the UI: a ten-year idle timeout is never reached by a session.
IDLE_FOREVER_S = 10 * 365 * 24 * 3600
_preload_task = None


def preload_busy() -> bool:
    """True while a user-requested model load runs (counted as work by activity.py)."""
    return _preload_task is not None and not _preload_task.done()


PROXY_KEYS = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy")


def masked(value: str | None) -> str | None:
    return "••••" + value[-4:] if value and len(value) > 8 else "••••" if value else None


def validate_proxy(value: str) -> str:
    value = value.strip()
    if not value:
        return ""
    if any(ord(char) < 32 or char.isspace() for char in value):
        raise ValueError("Adres proxy zawiera niedozwolone znaki.")
    try:
        parsed = urlsplit(value)
        parsed.port
    except ValueError as error:
        raise ValueError("Nieprawidłowy adres lub port proxy.") from error
    if parsed.scheme not in {"http", "https", "socks5", "socks5h"} or not parsed.hostname or parsed.query or parsed.fragment:
        raise ValueError("Podaj adres http://, https:// lub socks5:// bez parametrów i fragmentu.")
    return value


def proxy_state() -> dict:
    value = next((os.environ[key] for key in PROXY_KEYS if os.environ.get(key)), "")
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ""
        if ":" in host:
            host = f"[{host}]"
        address = f"{parsed.scheme}://{host}" + (f":{parsed.port}" if parsed.port else "") if host else ""
    except ValueError:
        address = "Nieprawidłowy adres w konfiguracji"
    return {"set": bool(value), "address": address, "has_credentials": bool(value and "@" in value)}


def apply_environment():
    """Restore a private encrypted proxy before upstream captures env values."""
    from services import settings_store
    from core.config import DB_PATH
    if not Path(DB_PATH).is_file():
        return
    value = settings_store.get_secret("next.proxy")
    # No saved private override: preserve any existing deliberate environment.
    if settings_store.get_text("next.proxy.configured") == "1":
        for key in PROXY_KEYS:
            if value:
                os.environ[key] = value
            else:
                os.environ.pop(key, None)


ADDED_PROVIDERS_KEY = "next.added_llm_providers"


def added_llm_providers() -> list[str]:
    """Providers the user added in "AI i klucze" (keyless local ones have no other 'added' marker)."""
    from services import settings_store
    try:
        value = json.loads(settings_store.get_text(ADDED_PROVIDERS_KEY) or "[]")
    except ValueError:
        return []
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def credential_state() -> dict:
    from services import settings_store
    rows = []
    for key, (label, secret) in CREDENTIAL_FIELDS.items():
        value = (settings_store.get_secret("translation_env." + key) if secret else os.environ.get(key)) or ""
        rows.append({"key": key, "label": label, "secret": secret, "set": bool(value),
                     "masked": masked(value) if secret else None, "value": "" if secret else value})
    token = settings_store.get_hf_token()
    return {"hf": {"set": bool(token), "masked": masked(token), "source": "private-app", "verified": None}, "fields": rows}


def create_router(runtime: Path, data: Path):
    from fastapi import APIRouter, Depends, HTTPException, Request
    from pydantic import BaseModel, Field
    from api.dependencies import require_admin

    router = APIRouter(prefix="/next/settings", tags=["private-settings"], dependencies=[Depends(require_admin)])

    class TokenBody(BaseModel):
        token: str = Field(min_length=1, max_length=4096)

    class CredentialBody(BaseModel):
        key: str
        value: str = Field(max_length=8192)

    class ProxyBody(BaseModel):
        url: str = Field(max_length=4096)

    class AddedProvidersBody(BaseModel):
        ids: list[str] = Field(max_length=64)

    class IdleBody(BaseModel):
        seconds: int = Field(ge=60, le=IDLE_FOREVER_S)

    class MediaBody(BaseModel):
        tool: str
        path: str = Field(min_length=1, max_length=4096)

    @router.get("/credentials")
    def get_credentials():
        return credential_state()

    @router.put("/hf-token")
    def save_token(body: TokenBody):
        token = body.token.strip()
        if not token.startswith("hf_") or any(char.isspace() for char in token):
            raise HTTPException(400, "Podaj osobisty token Hugging Face zaczynający się od hf_.")
        from services import settings_store, token_resolver
        settings_store.set_hf_token(token)
        token_resolver.invalidate_cache()
        return credential_state()["hf"]

    @router.delete("/hf-token")
    def clear_token():
        from services import settings_store, token_resolver
        settings_store.clear_hf_token()
        token_resolver.invalidate_cache()
        return credential_state()["hf"]

    @router.post("/hf-token/test")
    def test_token():
        from services import settings_store
        from services.hf_auth import canonical_whoami
        token = settings_store.get_hf_token()
        if not token:
            raise HTTPException(400, "Najpierw zapisz prywatny token tej aplikacji.")
        try:
            info = canonical_whoami(token)
        except Exception:
            raise HTTPException(502, "Hugging Face nie potwierdziło tokenu. Sprawdź token i połączenie.") from None
        return {**credential_state()["hf"], "verified": True, "user": (info or {}).get("name")}

    @router.put("/credential")
    async def save_credential(body: CredentialBody):
        if body.key not in CREDENTIAL_FIELDS:
            raise HTTPException(400, "Nieobsługiwane pole poświadczeń.")
        # Reuse the original validation and encrypted SECRET_ENV_KEYS handling.
        from api.routers.system import set_env_var
        await set_env_var({"key": body.key, "value": body.value.strip()})
        return credential_state()

    @router.get("/added-llm-providers")
    def get_added_llm_providers():
        return {"ids": added_llm_providers()}

    @router.put("/added-llm-providers")
    def save_added_llm_providers(body: AddedProvidersBody):
        from services import llm_providers, settings_store
        known = {provider.id for provider in llm_providers.all_providers()} | {"chatgpt"}
        unknown = [item for item in body.ids if item not in known]
        if unknown:
            raise HTTPException(400, "Nieznany dostawca modeli językowych.")
        settings_store.set_text(ADDED_PROVIDERS_KEY, json.dumps(list(dict.fromkeys(body.ids))))
        return {"ids": added_llm_providers()}

    @router.get("/proxy")
    def get_proxy():
        return proxy_state()

    @router.put("/proxy")
    async def save_proxy(body: ProxyBody):
        try:
            value = validate_proxy(body.url)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        from services import settings_store
        from core import prefs
        settings_store.set_secret("next.proxy", value)
        settings_store.set_text("next.proxy.configured", "1")
        for key in PROXY_KEYS:
            prefs.delete("env." + key)
            if value:
                os.environ[key] = value
            else:
                os.environ.pop(key, None)
        return proxy_state()

    @router.put("/model-idle")
    def set_model_idle(body: IdleBody):
        """The engine unloads its voice model after this many idle seconds (read by model_manager every tick)."""
        from core import prefs
        prefs.set_("idle_timeout_seconds", body.seconds)
        return {"seconds": body.seconds, "env_pinned": bool(os.environ.get("OMNIVOICE_IDLE_TIMEOUT_S"))}

    @router.post("/media-tool")
    def set_media_tool(body: MediaBody, request: Request):
        # The native picker knows the per-process ownership marker. The web UI
        # cannot authorize an executable by typing a path into an HTTP form.
        expected = os.environ.get("VOICESTUDIO_NEXT_TOKEN", "")
        supplied = request.headers.get("x-voicestudio-next", "")
        if not expected or not hmac.compare_digest(expected, supplied):
            raise HTTPException(403, "Wybierz plik w natywnym oknie tej aplikacji.")
        if body.tool not in {"ffmpeg", "ffprobe"}:
            raise HTTPException(400, "Nieobsługiwane narzędzie multimedialne.")
        from api.routers.media_tools import media_tools_custom_path, CustomPathRequest
        ticket = secrets.token_hex(32)
        folder = data / ".path-authorizations"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / (ticket + ".json")
        try:
            with path.open("x", encoding="utf-8") as handle:
                json.dump({"token": ticket, "kind": body.tool, "path": body.path}, handle)
            return media_tools_custom_path(body.tool, CustomPathRequest(authorization=ticket))
        except (ValueError, OSError):
            raise HTTPException(400, "Wybrany plik nie jest prawidłowym narzędziem multimedialnym.") from None
        finally:
            path.unlink(missing_ok=True)

    @router.post("/model-preload")
    async def preload_model():
        """Start loading the voice model now. Returns at once; progress is read from /model/status."""
        global _preload_task
        from services import model_manager
        if not preload_busy():
            # A kept reference stops the task from being collected mid-load; preload_model() never raises.
            _preload_task = asyncio.create_task(model_manager.preload_model())
        return {**model_manager.get_model_status(), "running": preload_busy()}

    return router
