"""Built Polish UI + intercepted multipart/GET fixtures; never contacts ASR/LLM.

Own headless Chromium, temporary browser profile and loopback static server.
The WAV is the repository's public QA sample; all backend calls are intercepted.
"""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import argparse
from email.parser import BytesParser
from email.policy import default
import functools
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import threading
import time
from urllib.parse import urlparse

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)

ROOT = Path(__file__).resolve().parents[2]
KEY = "seventy-seven-labs.transcriptions.v1"
RAW = "Yyy, myślę. To działa, działa."
REFINED = "Myślę, że to działa."
SEGMENTS = [{"start": 0.25, "end": 1.5, "text": "Yyy, myślę."},
            {"start": 1.7, "end": 3.2, "text": "To działa, działa."}]


def run(args):
    from playwright.sync_api import sync_playwright
    dist = args.dist.resolve(strict=True)
    assert (dist / "index.html").is_file()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    calls, checks, errors = [], [], []
    state = {"mode": "original", "untimed": False}

    def check(name, passed):
        checks.append({"name": name, "passed": bool(passed)})
        if not passed:
            raise AssertionError(name)

    def backend(route):
        request = route.request
        path = urlparse(request.url).path.removeprefix("/backend")
        entry = {"method": request.method, "path": path, "fixture": True}
        calls.append(entry)
        if request.method == "POST" and path == "/transcribe":
            packet = ("Content-Type: " + request.headers["content-type"] + "\r\n\r\n").encode() + request.post_data_buffer
            parts = BytesParser(policy=default).parsebytes(packet)
            fields = {part.get_param("name", header="content-disposition"): part.get_payload(decode=True).decode("utf-8")
                      for part in parts.iter_parts() if not part.get_filename()}
            entry["fields"] = fields
            if state["mode"] == "error":
                route.fulfill(status=503, json={"detail": "QA: redakcja transkrypcji jest niedostępna."})
                return
            data = {"text": RAW, "segments": [] if state["untimed"] else SEGMENTS, "language": "pl"}
            if state["mode"] == "suggested":
                data["refined_text"] = REFINED
            if state["mode"] == "unavailable":
                data["refinement_unavailable"] = True
            route.fulfill(status=200, json=data)
            return
        if request.method != "GET":
            errors.append("Unexpected fixture mutation: " + path)
            route.abort()
            return
        if path == "/health":
            data = {"status": "ok", "version": "0.5.7", "device": "fixture"}
        elif path == "/profiles":
            data = []
        elif path == "/engines":
            data = {family: {"active": "", "backends": []} for family in ["tts", "asr", "llm"]}
        elif path.startswith("/engines/"):
            data = {"active": "", "backends": []}
        elif path == "/model/status":
            data = {"status": "idle", "loaded": False, "loading": False}
        elif path == "/dictation/readiness":
            data = {"ready": True}
        elif path == "/next/integrations/settings":
            data = {"source": {"sourceVersion": "0.5.7", "generateCapabilities": {"wav_bits": ["16"], "preset_voice": False, "design_recipe": False}}}
        else:
            errors.append("Unexpected fixture GET: " + path)
            route.fulfill(status=503, json={"detail": "QA fixture: unsupported read"})
            return
        route.fulfill(status=200, json=data)

    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *values):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(dist)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}"
    result = {"date": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "fixtureOnly": True,
              "scope": "Built UI, controlled HTTP response fixtures, no real backend/ASR/LLM/provider configuration",
              "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "workingTreeBuild": True, "sourceSha256": {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
              for name in ["src/lib/platform/api.ts", "src/lib/tools/transcription/transcription.ts", "src/lib/tools/transcription/TranscriptionWorkspace.svelte"]},
              "distIndexSha256": hashlib.sha256((dist / "index.html").read_bytes()).hexdigest(),
              "checks": checks, "requests": calls, "errors": errors, "realBackendRequests": 0}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
            try:
                def guard(route):
                    if route.request.url.startswith(url + "/backend/"):
                        return backend(route)
                    if route.request.url.startswith(url + "/"):
                        return route.continue_()
                    errors.append("Blocked request outside own fixture origin")
                    route.abort()
                context.route("**/*", guard)
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))

                def navigate():
                    page.keyboard.press("Control+k")
                    page.get_by_role("textbox", name="Szukaj ekranu").fill("Mowa na tekst")
                    page.get_by_role("dialog", name="Szukaj").get_by_role("button", name="Mowa na tekst", exact=True).click()
                    page.get_by_role("heading", name="Mowa na tekst", exact=True).wait_for()

                def upload(name):
                    page.get_by_label("Nagranie do transkrypcji").set_input_files({"name": name, "mimeType": "audio/wav", "buffer": (ROOT / "public/demo/interface-tone.wav").read_bytes()})

                def download(name):
                    with page.expect_download() as pending:
                        page.get_by_role("button", name=name, exact=True).click()
                    return Path(pending.value.path()).read_text(encoding="utf-8")

                def saved():
                    page.get_by_text("Zapisano na tym urządzeniu.", exact=True).first.wait_for()

                page.goto(url, wait_until="networkidle")
                navigate()
                switch = page.get_by_role("switch", name="Redakcja transkrypcji przez LLM")
                check("Refinement starts explicitly OFF", switch.get_attribute("aria-checked") == "false")
                page.screenshot(path=str(args.report.with_suffix(".before.png")))
                upload("original.wav")
                page.get_by_role("button", name="Przepisz nagranie", exact=True).click()
                page.get_by_label("Tekst segmentu 1", exact=True).wait_for()
                check("Default multipart requests refine=false", [row for row in calls if row["method"] == "POST"][-1]["fields"]["refine"] == "false")
                switch.click()
                state["mode"] = "suggested"
                upload("redakcja.wav")
                page.get_by_role("button", name="Przepisz nagranie", exact=True).click()
                page.get_by_label("Propozycja po redakcji", exact=True).wait_for()
                check("Opt-in sends refine=true and shows exact original/suggestion", [row for row in calls if row["method"] == "POST"][-1]["fields"]["refine"] == "true" and page.get_by_label("Oryginał rozpoznania", exact=True).input_value() == RAW and page.get_by_label("Propozycja po redakcji", exact=True).input_value() == REFINED)
                check("A suggestion does not replace TXT before explicit approval", download("Tekst TXT") == "Yyy, myślę.\nTo działa, działa.")
                page.get_by_role("button", name="Użyj redakcji w TXT i edytorze", exact=True).click()
                saved()
                check("Explicit approval changes downloaded TXT", download("Tekst TXT po redakcji") == REFINED)
                page.get_by_label("Tekst segmentu 1", exact=True).fill("Ręczna poprawka segmentu.")
                saved()
                subtitles = download("Napisy SRT")
                check("Subtitle export retains edited cues and original alignment", "00:00:00,250 --> 00:00:01,500\nRęczna poprawka segmentu." in subtitles and REFINED not in subtitles)
                page.get_by_role("button", name="Cofnij użycie redakcji", exact=True).click()
                saved()
                check("Undo preserves manual segment edits", download("Tekst TXT") == "Ręczna poprawka segmentu.\nTo działa, działa.")

                state["untimed"] = True
                upload("redakcja-bez-czasow.wav")
                page.get_by_role("button", name="Przepisz nagranie", exact=True).click()
                page.get_by_label("Propozycja po redakcji", exact=True).wait_for()
                main = page.get_by_role("textbox", name="Transkrypcja", exact=True)
                before_apply = "  Ręczna poprawka przed użyciem.\nZachowaj spacje.  "
                after_apply = before_apply + "\nPoprawka po użyciu."
                main.fill(before_apply)
                saved()
                page.get_by_role("button", name="Użyj redakcji w TXT i edytorze", exact=True).click()
                main.fill(after_apply)
                saved()
                check("Applying never overwrites manual TXT edits", main.input_value() == after_apply and download("Tekst TXT po redakcji") == REFINED)
                page.screenshot(path=str(args.report.with_suffix(".after.png")))
                page.reload(wait_until="networkidle")
                navigate()
                check("Reload resets future request refinement to OFF", page.get_by_role("switch", name="Redakcja transkrypcji przez LLM").get_attribute("aria-checked") == "false")
                page.get_by_role("tab", name="Historia").click()
                page.locator(".tool-workspace-history-item").filter(has_text="redakcja-bez-czasow.wav").get_by_role("button", name="Otwórz wynik", exact=True).click()
                check("History restores applied decision, exact original and later manual edits", page.get_by_role("textbox", name="Transkrypcja", exact=True).input_value() == after_apply and page.get_by_label("Oryginał rozpoznania", exact=True).input_value() == RAW and download("Tekst TXT po redakcji") == REFINED)
                page.get_by_role("button", name="Cofnij użycie redakcji", exact=True).click()
                saved()
                check("Undo after reload returns the exact current edited text", download("Tekst TXT") == after_apply)
                check("Untimed redaction never invents subtitles", not page.get_by_role("button", name="Napisy SRT", exact=True).is_enabled())
                page.get_by_role("switch", name="Redakcja transkrypcji przez LLM").click()
                for mode, notice in [("original", "Może to oznaczać brak zmian albo niedostępną"), ("unavailable", "Redakcja LLM jest niedostępna.")]:
                    state["mode"] = mode
                    upload(mode + ".wav")
                    page.get_by_role("button", name="Przepisz nagranie", exact=True).click()
                    page.get_by_text(notice, exact=False).wait_for()
                    check("Readable pass-through: " + mode, page.get_by_role("textbox", name="Transkrypcja", exact=True).input_value() == RAW)
                state["mode"] = "error"
                upload("error.wav")
                page.get_by_role("button", name="Przepisz nagranie", exact=True).click()
                page.get_by_role("alert").filter(has_text="QA: redakcja transkrypcji jest niedostępna.").wait_for()
                check("HTTP error is readable and previous history remains", len(page.evaluate("key => JSON.parse(localStorage.getItem(key)).results", KEY)) >= 5)
                check("Only transcribe POSTs, no settings/provider/license mutations", all(row["path"] == "/transcribe" for row in calls if row["method"] != "GET"))
                check("No uncaught JavaScript errors or unexpected requests", not errors)
                result["passed"] = True
            finally:
                context.close()
                browser.close()
    except Exception as error:
        result.update(passed=False, error=str(error))
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        result["ownBrowserAndServerClosed"] = True
        args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": result["passed"], "checks": len(checks), "error": result.get("error"), "report": str(args.report)}, ensure_ascii=True))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--dist", type=Path, required=True)
    parser.add_argument("--report", type=Path, default=ROOT / ".tmp/qa/transcription-refinement-ui.json")
    arguments = parser.parse_args()
    if not arguments.run:
        parser.error("Explicit --run after building the controlled UI")
    raise SystemExit(0 if run(arguments)["passed"] else 1)
