"""Explicit built-UI verification fixture: no real backend POST or model.

Own headless Chromium and loopback static server. Application controls are real;
GET metadata and the two explicit selection POST results are labelled fixtures.
"""
import argparse
import functools
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import threading
import time
from urllib.parse import urlparse

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)

ROOT = Path(__file__).resolve().parents[2]
OMNI = "omnivoice"
TARGET = "kittentts"


def run(arguments):
    from playwright.sync_api import sync_playwright
    dist = arguments.dist.resolve(strict=True)
    provenance = json.loads(arguments.build_provenance.read_text(encoding="utf-8"))
    assert provenance.get("sourceClean") is True and provenance.get("sourceCommit")
    assert (dist / "index.html").is_file()
    calls, checks, errors = [], [], []
    state = {"active": OMNI, "postMode": "error"}
    def check(name, passed):
        checks.append({"name": name, "passed": bool(passed)})
        if not passed: raise AssertionError(name)
    def row(engine_id, name, **extra):
        return {"id": engine_id, "display_name": name, "available": False, "installed": None, "weights_check": "not_checked",
                "availability_check": "dependencies_detected", "can_verify": True, "inference_verified": False,
                "hardware_check": "not_checked", "routing_status": "unavailable", "effective_device": "unknown",
                "reason": "QA fixture: wykryto pakiety; nie sprawdzono modelu ani syntezy.", "supports_cloning": True,
                "supported_language_names": ["polish", "english"], **extra}
    rows = [row(OMNI, "OmniVoice QA"), row(TARGET, "KittenTTS QA", supports_cloning=False, supported_language_names=["english"]),
            row("supertonic3", "Model z wymaganą licencją QA", license_required=True, license_accepted=False)]
    def catalog():
        return {"tts": {"active": state["active"], "configured_active": state["active"], "active_model": "k2-fsa/OmniVoice" if state["active"] == OMNI else None,
                        "env_override": False, "availability_mode": "metadata_only", "backends": rows},
                "asr": {"active": "", "configured_active": "auto", "backends": [], "availability_mode": "metadata_only"},
                "llm": {"active": "", "configured_active": "auto", "backends": [], "availability_mode": "metadata_only"}}
    def backend(route):
        request = route.request
        path = urlparse(request.url).path.removeprefix("/backend")
        calls.append({"method": request.method, "path": path, "fixture": True})
        if request.method == "POST" and path == "/engines/select":
            body = request.post_data_json
            check("Explicit selection body uses stock family/backend fields", body == {"family": "tts", "backend_id": TARGET})
            if state["postMode"] == "error":
                route.fulfill(status=400, json={"detail": "QA: nie potwierdzono konfiguracji silnika."})
            else:
                state["active"] = TARGET
                route.fulfill(status=200, json={"active": TARGET, "env_override": False})
            return
        if request.method != "GET":
            raise AssertionError("Unexpected mutation in UI fixture: " + path)
        if path == "/health": data = {"status": "ok", "version": "0.5.7", "device": "fixture"}
        elif path == "/profiles": data = [{"id": "qa-public-fixture", "name": "Jawna próbka QA", "kind": "clone", "language": "Polish"}]
        elif path == "/engines": data = catalog()
        elif path in ["/engines/tts", "/engines/asr", "/engines/llm"]: data = catalog()[path.rsplit("/", 1)[-1]]
        elif path == "/next/integrations/settings": data = {"source": {"sourceVersion": "0.5.7", "generateCapabilities": {"wav_bits": ["16", "24", "32"], "preset_voice": True, "design_recipe": True}}}
        elif path == "/model/status": data = {"status": "idle", "loaded": False, "loading": False}
        else: raise AssertionError("Unexpected GET in UI fixture: " + path)
        route.fulfill(status=200, json=data)

    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *args): pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(dist)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = "http://127.0.0.1:" + str(server.server_port)
    result = {"date": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "sourceCommit": provenance["sourceCommit"],
              "exeSha256": provenance["sha256"], "distIndexSha256": hashlib.sha256((dist / "index.html").read_bytes()).hexdigest(),
              "scope": "Built application UI with explicit GET and POST selection fixtures; no real backend connection", "fixtureOnly": True,
              "url": url, "checks": checks, "requests": calls, "errors": errors, "realBackendRequests": 0}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1440, "height": 1000})
            try:
                def network_guard(route):
                    if urlparse(route.request.url).path.startswith("/backend/"): return backend(route)
                    if route.request.url.startswith(url + "/"): return route.continue_()
                    raise AssertionError("External network is forbidden in UI fixture")
                context.route("**/*", network_guard)
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(url, wait_until="networkidle")
                page.get_by_role("button", name="Nowa narracja", exact=True).last.click()
                page.get_by_role("button", name="Model: OmniVoice QA", exact=True).click()
                target = page.locator(".model-picker-card").filter(has_text="KittenTTS QA")
                target.get_by_role("button", name=re.compile("Sprawdź i wybierz")).wait_for()
                check("Opening metadata picker performs no POST", all(row["method"] == "GET" for row in calls))
                check("Unverified target shows honest readiness and explicit verification", "Biblioteki wykryte" in target.inner_text() and "wymaga sprawdzenia" in target.inner_text())
                check("Unverified target remains selectable despite unknown hardware/weights", target.locator(".model-picker-choice").is_enabled())
                check("Unverified target is not labelled ready or missing weights", "Dostępny silnik" not in target.inner_text() and "Silnik niezainstalowany" not in target.inner_text())
                target.locator(".model-picker-choice").click()
                page.get_by_role("alert").filter(has_text="QA: nie potwierdzono konfiguracji silnika.").wait_for()
                selected = page.locator(".model-picker-selected .model-picker-card-name").all_text_contents()
                result["selection_after_error"] = selected
                check("Stock-shaped POST error is visible and active selection remains unchanged", state["active"] == OMNI and bool(selected) and all(name.strip() == "OmniVoice QA" for name in selected))
                page.screenshot(path=str(arguments.report.with_suffix(".error.png")))
                state["postMode"] = "success"
                target.locator(".model-picker-choice").click()
                page.get_by_role("button", name="Model: KittenTTS QA", exact=True).wait_for()
                check("Explicit success is confirmed by fresh catalogue GET before selecting", state["active"] == TARGET and calls[-1]["method"] == "GET" and calls[-1]["path"] == "/engines")
                page.get_by_role("button", name="Model: KittenTTS QA", exact=True).click()
                target = page.locator(".model-picker-card").filter(has_text="KittenTTS QA")
                check("Selected engine still does not claim tested model inference", "wymaga sprawdzenia" in target.inner_text() and "Dostępny silnik" not in target.inner_text())
                check("Exactly two explicit selection POSTs and no licence/generation calls", [row["path"] for row in calls if row["method"] != "GET"] == ["/engines/select", "/engines/select"])
                check("No uncaught JavaScript errors", not errors)
                page.screenshot(path=str(arguments.report.with_suffix(".success.png")))
                result["passed"] = True
            finally:
                context.close()
                browser.close()
    except Exception as error:
        result["error"] = str(error)
        result["passed"] = False
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=2)
        result["ownBrowserAndServerClosed"] = True
        arguments.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": result["passed"], "checks": len(checks), "error": result.get("error"), "report": str(arguments.report)}, ensure_ascii=True))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--dist", type=Path, required=True)
    parser.add_argument("--build-provenance", type=Path, required=True)
    parser.add_argument("--report", type=Path, default=ROOT / ".tmp/qa/catalogue-verify-ui.json")
    args = parser.parse_args()
    if not args.run: parser.error("Explicit --run after the clean built UI is ready")
    raise SystemExit(0 if run(args)["passed"] else 1)
