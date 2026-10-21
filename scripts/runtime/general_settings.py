"""Read-only update provenance for this app; never installs VoiceStudio binaries.

The independent Tauri app has no signed updater distribution configured. An
explicit check reads public upstream release metadata for comparison only.
This module never writes a runtime, shared library, model, or old installation.
"""
import json
from pathlib import Path
import urllib.error
import urllib.request

RELEASES_URL = "https://api.github.com/repos/debpalash/VoiceStudio/releases?per_page=20"
RELEASE_PAGE = "https://github.com/debpalash/VoiceStudio/releases"
MAX_RESPONSE = 2 * 1024 * 1024


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Serwer metadanych zwrócił nieoczekiwane przekierowanie.")


def check_releases(channel, *, opener=None):
    if channel not in {"stable", "preview"}:
        raise ValueError("Nieprawidłowy kanał wydań źródeł silnika.")
    opener = opener or urllib.request.build_opener(_NoRedirect())
    request = urllib.request.Request(RELEASES_URL, headers={
        "Accept": "application/vnd.github+json", "User-Agent": "SeventySevenLabs-SourceCheck",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with opener.open(request, timeout=12) as response:
        raw = response.read(MAX_RESPONSE + 1)
    if len(raw) > MAX_RESPONSE:
        raise ValueError("Odpowiedź serwera wydań przekroczyła limit.")
    items = json.loads(raw)
    if not isinstance(items, list):
        raise ValueError("Serwer nie zwrócił listy wydań źródeł silnika.")
    releases = []
    for item in items:
        if not isinstance(item, dict) or item.get("draft") or channel == "stable" and item.get("prerelease"):
            continue
        url = item.get("html_url", "")
        if not isinstance(url, str) or not url.startswith(RELEASE_PAGE + "/tag/"):
            continue
        releases.append({
            "tag": str(item.get("tag_name") or "")[:120],
            "name": str(item.get("name") or item.get("tag_name") or "")[:200],
            "published_at": str(item.get("published_at") or "")[:40],
            "prerelease": bool(item.get("prerelease")), "url": url,
            "notes": str(item.get("body") or "")[:16000],
        })
        if len(releases) >= 10:
            break
    return {"channel": channel, "releases": releases, "source": RELEASE_PAGE, "install_supported": False}


def create_router(runtime: Path, data: Path, *, engine_path: Path | None = None):
    from fastapi import APIRouter, Depends, HTTPException
    from pydantic import BaseModel, ConfigDict
    from typing import Literal
    from api.dependencies import require_local
    from integration_settings import source_info

    class CheckBody(BaseModel):
        model_config = ConfigDict(extra="forbid", strict=True)
        channel: Literal["stable", "preview"] = "stable"

    router = APIRouter(prefix="/next/settings", dependencies=[Depends(require_local)])

    @router.get("/update-source")
    def source():
        return {"app": {"name": "Seventy Seven Labs", "updater_configured": False},
                "source": source_info(runtime, engine_path or runtime / "engine"),
                "install_supported": False, "release_page": RELEASE_PAGE}

    @router.post("/update-source/check")
    def check(body: CheckBody):
        try:
            return check_releases(body.channel)
        except (OSError, ValueError, urllib.error.URLError) as error:
            # Do not echo remote response bodies, credentials or local paths.
            raise HTTPException(status_code=502, detail="Nie udało się odczytać publicznej listy wydań VoiceStudio. Sprawdź połączenie z GitHub i spróbuj ponownie.") from error

    return router
