"""Private, loopback-only integration settings. No credentials are stored here.

Call apply_environment(DATA) after the launcher's baseline environment and
before importing the backend; mount create_router(...) on its FastAPI app.
Changing settings never mounts MCP in a running lifespan: restart explicitly.
"""

from pathlib import Path as _SourcePath
import sys as _source_sys
_source_layout = _SourcePath(__file__).resolve().parent.parent
if (_source_layout / "app/launcher.py").is_file() and (_source_layout / "install/bootstrap.py").is_file():
    for _source_dir in ("app", "install"):
        _source_sys.path.insert(0, str(_source_layout / _source_dir))

import hashlib
import ast
from importlib import metadata as distribution_metadata
import json
import os
from pathlib import Path
import tempfile
import tomllib


DEFAULTS = {"mcp_enabled": False, "mcp_output_mode": "files"}
MODES = frozenset({"files", "resources", "both"})
BASE_URL = "http://127.0.0.1:4312"
TRUTHY = {"1", "true", "yes", "on"}


def validate_settings(value):
    if not isinstance(value, dict) or set(value) != set(DEFAULTS):
        raise ValueError("Ustawienia integracji mogą zawierać tylko włączenie MCP i tryb zwracania audio.")
    if type(value["mcp_enabled"]) is not bool or not isinstance(value["mcp_output_mode"], str) or value["mcp_output_mode"] not in MODES:
        raise ValueError("Nieprawidłowe ustawienia lokalnego MCP.")
    return {"mcp_enabled": value["mcp_enabled"], "mcp_output_mode": value["mcp_output_mode"]}


def read_settings(data: Path):
    path = data / "integration-settings.json"
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return dict(DEFAULTS)
    except (OSError, ValueError) as error:
        raise ValueError("Nie można odczytać prywatnych ustawień integracji. Zachowano plik bez zmian.") from error
    if not isinstance(raw, dict) or raw.get("schema_version") != 1:
        raise ValueError("Nieobsługiwany format prywatnych ustawień integracji.")
    return validate_settings({key: value for key, value in raw.items() if key != "schema_version"})


def save_settings(data: Path, value):
    validated = validate_settings(value)
    data.mkdir(parents=True, exist_ok=True)
    target = data / "integration-settings.json"
    descriptor, name = tempfile.mkstemp(prefix=".integration-settings-", suffix=".tmp", dir=data)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump({"schema_version": 1, **validated}, handle, ensure_ascii=False, indent=2)
            handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return validated


def apply_environment(data: Path):
    """Apply only known local MCP knobs, keeping broken config fail-closed."""
    try:
        settings = read_settings(data)
    except ValueError:
        # An optional integration must not take TTS down. The settings route
        # reports the invalid file; only an explicit Save replaces it.
        settings = dict(DEFAULTS)
    os.environ.update({
        "OMNIVOICE_MCP_DISABLE": "0" if settings["mcp_enabled"] else "1",
        "OMNIVOICE_MCP_OUTPUT_MODE": settings["mcp_output_mode"],
        "OMNIVOICE_MCP_BASE_PATH": "",  # agents cannot read arbitrary host files
        "OMNIVOICE_API_URL": "",  # in-process MCP calls, never a remote override
        "OMNIVOICE_BIND_HOST": "127.0.0.1",
        "OMNIVOICE_MCP_ALLOWED_HOSTS": "127.0.0.1:4312,localhost:4312" + (",127.0.0.1:4310,localhost:4310" if os.environ.get("VOICESTUDIO_DEV_ORIGINS") == "1" else ""),
    })
    return settings


def use_source_version(engine_path: Path):
    """Set runtime identity from the verified generation, never edit dist-info."""
    project = tomllib.loads((engine_path / "pyproject.toml").read_text(encoding="utf-8-sig")).get("project", {})
    version = project.get("version") if isinstance(project, dict) else None
    if not isinstance(version, str) or not version.strip():
        raise ValueError("Brak wersji w zweryfikowanych źródłach silnika.")
    import core.version as engine_version
    engine_version.APP_VERSION = version
    return version


def generate_capabilities(engine_path: Path):
    """Read the actual prepared source signature; no imports or guessed version."""
    result = {"wav_bits": [], "preset_voice": False, "design_recipe": False}
    try:
        module = ast.parse((engine_path / "backend/api/routers/generation.py").read_text(encoding="utf-8-sig"))
        route = next(node for node in module.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "generate_speech")
        fields = {item.arg: item for item in route.args.args}
        wav = fields.get("wav_bits")
        if wav is not None and ast.unparse(wav.annotation) in {"Literal['16', '24', '32']", 'Literal["16", "24", "32"]'}:
            result["wav_bits"] = ["16", "24", "32"]
        result.update(preset_voice="preset_voice" in fields, design_recipe="design_recipe" in fields)
    except (OSError, SyntaxError, StopIteration, ValueError, TypeError):
        pass
    return result


def source_info(runtime: Path, engine_path: Path):
    """Expose version/hash evidence, never private paths or environment contents."""
    try:
        marker = json.loads((engine_path / ".engine-ready.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        marker = {}
    if not isinstance(marker, dict):
        marker = {}
    digest = marker.get("archiveSha256")
    if not isinstance(digest, str) or len(digest) != 64:
        try:
            with (runtime / "engine.zip").open("rb") as handle:
                digest = hashlib.file_digest(handle, "sha256").hexdigest()
        except OSError:
            digest = None
    try:
        provenance = json.loads((runtime / "engine-provenance.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        provenance = {}
    if not isinstance(provenance, dict):
        provenance = {}
    commit = provenance.get("commit") if provenance.get("archiveSha256") == digest else None
    if not isinstance(commit, str) or len(commit) != 40 or any(char not in "0123456789abcdefABCDEF" for char in commit):
        commit = None
    try:
        project = tomllib.loads((engine_path / "pyproject.toml").read_text(encoding="utf-8-sig")).get("project", {})
        version = project.get("version") if isinstance(project, dict) else None
    except (OSError, ValueError):
        version = None
    try:
        installed = distribution_metadata.version("omnivoice")
    except distribution_metadata.PackageNotFoundError:
        installed = None
    return {"version": version, "sourceVersion": version, "installedDistributionVersion": installed, "generateCapabilities": generate_capabilities(engine_path), "commit": commit, "archive_sha256": digest,
            "upstream": "https://github.com/debpalash/VoiceStudio", "notices": [name for name in ("LICENSE", "LICENSE-NOTICE.md") if (engine_path / name).is_file()]}


def integration_state(data: Path, *, mounted=False, session_task_active=False):
    error = ""
    try:
        configured = read_settings(data)
    except ValueError as cause:
        configured = dict(DEFAULTS); error = str(cause)
    requested = os.environ.get("OMNIVOICE_MCP_DISABLE", "1").strip().lower() not in TRUTHY
    mode = os.environ.get("OMNIVOICE_MCP_OUTPUT_MODE", "resources")
    if mode not in MODES:
        mode = "resources"
    effective = {"mcp_enabled": requested, "mcp_output_mode": mode, "mounted": bool(mounted), "session_task_active": bool(session_task_active)}
    restart = configured["mcp_enabled"] != requested or configured["mcp_enabled"] and configured["mcp_output_mode"] != mode
    return {"settings": configured, "effective": effective, "restart_required": bool(restart), "configuration_error": error, "base_url": BASE_URL,
            "scope": "loopback", "local_api_key_required": False}


def create_router(runtime: Path, data: Path, *, engine_path: Path | None = None):
    from fastapi import APIRouter, Depends, HTTPException, Request
    from pydantic import BaseModel, ConfigDict
    from typing import Literal
    from api.dependencies import require_local

    class IntegrationBody(BaseModel):
        model_config = ConfigDict(extra="forbid", strict=True)
        mcp_enabled: bool
        mcp_output_mode: Literal["files", "resources", "both"]

    router = APIRouter(prefix="/next/integrations", dependencies=[Depends(require_local)])
    engine = engine_path or runtime / "engine"

    def state(request: Request):
        mounted = any(getattr(route, "path", None) == "/mcp" for route in request.app.routes)
        task = getattr(request.app.state, "mcp_task", None)
        result = integration_state(data, mounted=mounted, session_task_active=bool(task is not None and not task.done()))
        result["source"] = source_info(runtime, engine)
        # Network state includes a PIN in the stock route. Do not fetch or
        # return that route's payload to this local-only panel.
        try:
            from services.network_share import get_state
            result["network_sharing_enabled"] = bool(get_state().enabled)
        except (ImportError, AttributeError):
            result["network_sharing_enabled"] = None
        return result

    @router.get("/settings")
    def get_settings(request: Request):
        return state(request)

    @router.put("/settings")
    def update_settings(body: IntegrationBody, request: Request):
        try:
            save_settings(data, body.model_dump())
        except (OSError, ValueError) as cause:
            raise HTTPException(status_code=400, detail="Nie udało się zapisać prywatnych ustawień integracji.") from cause
        return state(request)

    return router


def _apply_local_mcp_origin(app):
    security = getattr(app.state, "mcp_transport_security", None)
    if security is None:
        return False  # MCP disabled/unavailable; never mount it implicitly.
    if not security.enable_dns_rebinding_protection:
        raise RuntimeError("Lokalne MCP wymaga włączonej ochrony DNS rebinding.")
    origin = "http://tauri.localhost"
    if origin not in security.allowed_origins:
        security.allowed_origins.append(origin)
    return True


class _LocalMcpOrigin:
    def __init__(self, app, backend):
        self.app, self.backend = app, backend

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if scope.get("type") == "http" and (path == "/mcp" or path.startswith("/mcp/")):
            _apply_local_mcp_origin(self.backend)
        await self.app(scope, receive, send)


def configure_local_mcp_origin(app):
    """Allow the packaged renderer's exact Origin, preserving DNS protection.

    0.5.7 creates MCP during deferred startup, after the launcher imports main.
    Install a per-app guard before lifespan so the exact Origin is also applied
    immediately before later MCP requests. Never mount or enable MCP here.
    """
    if hasattr(app, "add_middleware") and not getattr(app.state, "next_local_mcp_origin_guard", False):
        app.add_middleware(_LocalMcpOrigin, backend=app)
        app.state.next_local_mcp_origin_guard = True
    return _apply_local_mcp_origin(app)
