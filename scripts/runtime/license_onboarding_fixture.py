"""Loopback-only, RAM-only TESTFIXTURE for collaborative onboarding review.

No product imports, proxy, real backend, model, database or browser. Start only
with explicit --serve --dist <built dist>. /__fixture controls only this process.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import socket
import threading
import time
from urllib.parse import unquote, urlsplit

OMNI = "k2-fsa/OmniVoice"
TOKENIZER = "eustlb/higgs-audio-v2-tokenizer"
REPOS = (OMNI, TOKENIZER)
SCENARIOS = ("none", "omni-only", "both", "stopped", "offline", "legacy056", "changed", "revoked")
MAX_BODY = 16 * 1024
BANNER = '<aside style="position:fixed;z-index:2147483647;bottom:0;left:0;right:0;padding:9px;background:#742311;color:white;font:14px sans-serif;text-align:center;pointer-events:none">TESTFIXTURE — fikcyjny backend i zgody wyłącznie w RAM. <a style="color:white;text-decoration:underline;pointer-events:auto" href="/__fixture" target="_blank">Panel scenariuszy QA</a></aside>'


def fingerprint(repo: str, revision: int) -> str:
    return "v2:" + hashlib.sha256(f"TESTFIXTURE|{repo}|{revision}".encode()).hexdigest()


class FixtureState:
    def __init__(self, scenario="none"):
        self.lock = threading.RLock()
        self.generation = 0
        self.calls = []
        self.configure({"scenario": scenario})

    def configure(self, data):
        scenario = data.get("scenario", "none")
        if scenario not in SCENARIOS:
            raise ValueError("Nieznany scenariusz TESTFIXTURE.")
        delays = [data.get(name, data.get("delay_ms", 0)) for name in ("details_delay_ms", "decision_delay_ms")]
        if any(type(value) is not int or not 0 <= value <= 5000 for value in delays):
            raise ValueError("Opóźnienie TESTFIXTURE musi wynosić 0–5000 ms.")
        with self.lock:
            self.generation += 1
            self.scenario = scenario
            self.details_delay_ms, self.decision_delay_ms = delays
            self.revision = 2 if scenario == "changed" else 1
            self.records = {}
            accepted = REPOS if scenario in ("both", "changed", "revoked") else (OMNI,) if scenario == "omni-only" else ()
            for repo in accepted:
                self._decision(repo, "accepted", fingerprint(repo, 1))
            if scenario == "revoked":
                self._decision(OMNI, "withdrawn", fingerprint(OMNI, 1))
            return self.snapshot()

    def _decision(self, repo, action, current):
        entry = {"action": action, "fingerprint": current, "at": datetime.now(timezone.utc).isoformat(), "app_version": "TESTFIXTURE-0.5.7"}
        record = self.records.setdefault(repo, {"history": []})
        record["last"] = entry
        record["history"].append(entry)

    def acceptance(self, repo):
        record = self.records.get(repo)
        last = record["last"] if record else None
        current = fingerprint(repo, self.revision)
        state = "not_accepted" if not last else "withdrawn" if last["action"] == "withdrawn" else "accepted" if last["fingerprint"] == current else "terms_updated"
        return {"repo_id": repo, "license": "TESTFIXTURE — fikcyjne warunki OmniVoice" if repo == OMNI else "TESTFIXTURE — NOASSERTION",
                "category": "noncommercial" if repo == OMNI else "unknown", "required": True, "accepted": state == "accepted", "state": state,
                "fingerprint": current, "last_action": deepcopy(last), "accepted_at": last["at"] if state == "accepted" else None,
                "changed_fields": ["notes"] if state == "terms_updated" else []}

    def details(self, repo):
        fake_name = "OmniVoice" if repo == OMNI else "tokenizer"
        acceptance = self.acceptance(repo)
        return {"repo_id": repo, "acceptance": acceptance, "history": deepcopy(self.records.get(repo, {}).get("history", [])),
                "info": {"license": acceptance["license"], "credit": "TESTFIXTURE — fikcyjni autorzy, wyłącznie kontrola UI",
                         "source_url": "https://huggingface.co/TESTFIXTURE/" + fake_name,
                         "evidence_url": "https://huggingface.co/TESTFIXTURE/" + fake_name + "/blob/main/TESTFIXTURE-LICENSE",
                         "notes": f"TESTFIXTURE — to nie są rzeczywiste warunki ani zgoda użytkownika. Wersja fikcyjnych warunków {self.revision}.",
                         "license_category": acceptance["category"], "review_status": "TESTFIXTURE", "commercial_inference": "restricted" if repo == OMNI else "unknown",
                         "commercial_outputs": "unknown", "component_closure": "incomplete", "readiness": "TESTFIXTURE — bez weryfikacji modelu",
                         "registry_version": "TESTFIXTURE-v2", "evidence_revision": f"TESTFIXTURE-{self.revision}", "runtime_revision": "TESTFIXTURE",
                         "blockers": ["TESTFIXTURE — brak rzeczywistego backendu i modeli"]}}

    def snapshot(self):
        with self.lock:
            return {"fixture": "TESTFIXTURE", "scope": "RAM only; never proxies to a real backend", "scenario": self.scenario, "generation": self.generation,
                    "details_delay_ms": self.details_delay_ms, "decision_delay_ms": self.decision_delay_ms,
                    "models": [self.acceptance(repo) for repo in REPOS], "requests": deepcopy(self.calls), "real_backend_requests": 0}

    def catalogue(self):
        return {"tts": {"active": "omnivoice", "configured_active": "omnivoice", "active_model": OMNI, "env_override": False, "availability_mode": "metadata_only",
                        "backends": [{"id": "omnivoice", "display_name": "OmniVoice TESTFIXTURE", "available": False, "installed": None, "supports_cloning": True,
                                      "supported_language_names": ["polish", "english"], "availability_check": "dependencies_detected", "can_verify": True,
                                      "weights_check": "not_checked", "hardware_check": "not_checked", "inference_verified": False, "routing_status": "unavailable",
                                      "reason": "TESTFIXTURE — brak prawdziwych modeli i syntezy."}]},
                "asr": {"active": "", "configured_active": "auto", "backends": []}, "llm": {"active": "", "configured_active": "auto", "backends": []}}

    def get(self, path):
        if path == "/health":
            return 200, {"status": "ok", "version": "0.5.6" if self.scenario == "legacy056" else "0.5.7", "device": "TESTFIXTURE", "fixture": "TESTFIXTURE"}
        if path.startswith("/models/licenses/"):
            if self.scenario == "legacy056":
                return 404, {"detail": "TESTFIXTURE — 0.5.6 nie udostępnia nowego kontraktu zgód."}
            for action in ("details", "acceptance"):
                prefix = "/models/licenses/" + action + "/"
                if path.startswith(prefix):
                    repo = unquote(path[len(prefix):])
                    if repo not in REPOS:
                        return 404, {"detail": "TESTFIXTURE — nieznany model."}
                    return 200, self.details(repo) if action == "details" else self.acceptance(repo)
        if path == "/next/models/onboarding":
            if self.scenario == "legacy056":
                return 404, {"detail": "TESTFIXTURE — 0.5.6 nie udostępnia nowego kontraktu zgód."}
            return 200, {"schema": 1, "engine": {"id": "omnivoice", "label": "OmniVoice TESTFIXTURE", "model_id": OMNI},
                         "models": [self.acceptance(repo) for repo in REPOS], "source": "TESTFIXTURE — fikcyjny rejestr i stan wyłącznie w RAM"}
        if path == "/engines":
            return 200, self.catalogue()
        if path in ("/engines/tts", "/engines/asr", "/engines/llm"):
            return 200, self.catalogue()[path.rsplit("/", 1)[1]]
        if path == "/profiles":
            return 200, []
        if path == "/next/integrations/settings":
            return 200, {"source": {"sourceVersion": "0.5.6" if self.scenario == "legacy056" else "0.5.7", "version": "TESTFIXTURE",
                                    "commit": "TESTFIXTURE", "upstream": "TESTFIXTURE", "generateCapabilities": {"wav_bits": [], "preset_voice": False, "design_recipe": False}}}
        if path in ("/model/status", "/model/loaded"):
            return 200, {"status": "idle", "loaded": False, "loading": False, "models": [], "count": 0, "fixture": "TESTFIXTURE"}
        if path == "/next/models/jobs":
            return 200, {"jobs": [], "storage": {"configured": "TESTFIXTURE", "effective": "TESTFIXTURE", "restart_required": False, "inference_offline": True, "active_downloads": 0}}
        if path == "/api/settings/hf-token/state":
            return 200, {"active": None, "sources": []}
        if path == "/models":
            return 200, {"models": [{"repo_id": OMNI, "role": "tts", "name": "OmniVoice TESTFIXTURE", "installed": False, "curated": True, "dependencies": [{"repo_id": TOKENIZER}]}], "disk_free_gb": 0}
        if path == "/next/tts/status":
            return 200, {"engines": []}
        if path == "/next/engine-runtimes/catalog":
            return 200, {"engines": [], "scope": "TESTFIXTURE"}
        if path == "/next/engine-runtimes/jobs":
            return 200, {"jobs": []}
        return 404, {"detail": "TESTFIXTURE — nieobsługiwana ścieżka tylko do odczytu.", "path": path}

    def mutate(self, path, body):
        if path not in ("/models/licenses/accept", "/models/licenses/revoke"):
            return 405, {"detail": "TESTFIXTURE — zabronione: generowanie, instalowanie i inne operacje są niedostępne."}
        repo = body.get("repo_id")
        if repo not in REPOS:
            return 400, {"detail": {"code": "invalid_repo", "fixture": "TESTFIXTURE"}}
        if path.endswith("/accept"):
            if body.get("accepted") is not True:
                return 400, {"detail": {"code": "acceptance_required", "fixture": "TESTFIXTURE"}}
            if body.get("fingerprint") != fingerprint(repo, self.revision):
                return 409, {"detail": {"code": "terms_changed", "fixture": "TESTFIXTURE"}}
            action = "accepted"
        else:
            action = "withdrawn"
        self._decision(repo, action, fingerprint(repo, self.revision))
        return 200, self.acceptance(repo)


CONTROL_HTML = """<!doctype html><html lang="pl"><meta charset="utf-8"><title>TESTFIXTURE — onboarding</title>
<style>body{font:16px/1.6 system-ui;max-width:1000px;margin:30px auto;padding:20px;background:#141414;color:#eee}button,select,input{font:inherit;padding:8px;margin:6px}a{color:#b7d8ff}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#202020;padding:16px}</style>
<h1>TESTFIXTURE — test pierwszego uruchomienia</h1><p>Oddzielny serwer na loopback. Wszystkie decyzje są fikcyjne i zapisane tylko w RAM tego procesu. Brak dostępu do prawdziwego silnika, modeli, tokenów i baz.</p>
<p><a href="/" target="_blank">Otwórz aplikację testową</a> · <button onclick="refresh()">Odśwież stan / żądania</button></p>
<label>Scenariusz <select id="scenario">SCENARIO_OPTIONS</select></label><br>
<label>Opóźnienie odczytu warunków (ms) <input id="details" type="number" value="0" min="0" max="5000"></label><br>
<label>Opóźnienie decyzji (ms) <input id="decision" type="number" value="0" min="0" max="5000"></label><br>
<button onclick="configure()">Ustaw fikcyjny scenariusz (resetuje zgody RAM)</button>
<p>Po zmianie scenariusza wróć do aplikacji i odśwież stronę albo jej stan. Pamięć localStorage aplikacji zachowuje się niezależnie: kontroluj „Później” i ponowne wejście bez czyszczenia danych rzeczywistej aplikacji.</p><pre id="state"></pre>
<script>
async function refresh(){const r=await fetch('/__fixture/state');document.getElementById('state').textContent=JSON.stringify(await r.json(),null,2)}
async function configure(){await fetch('/__fixture/control',{method:'POST',headers:{'Content-Type':'application/json','X-VoiceStudio-CSRF':'1'},body:JSON.stringify({scenario:document.getElementById('scenario').value,details_delay_ms:Number(document.getElementById('details').value),decision_delay_ms:Number(document.getElementById('decision').value)})});await refresh()}
refresh()
</script></html>""".replace("SCENARIO_OPTIONS", "".join(f'<option value="{name}">{name}</option>' for name in SCENARIOS))


class FixtureServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, dist: Path, *, scenario="none", port=0):
        self.dist = Path(dist).resolve(strict=True)
        if self.dist.name != "dist" or not (self.dist / "index.html").is_file():
            raise ValueError("Wskaż jawny katalog dist zawierający index.html.")
        self.state = FixtureState(scenario)
        super().__init__(("127.0.0.1", port), FixtureHandler)


class FixtureHandler(BaseHTTPRequestHandler):
    server: FixtureServer

    def log_message(self, *args):
        pass  # Never log request headers, bodies, query strings or credentials.

    def send(self, status, payload, content_type="application/json; charset=utf-8"):
        data = json.dumps(payload, ensure_ascii=False).encode() if isinstance(payload, (dict, list)) else payload.encode() if isinstance(payload, str) else payload
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-SeventySeven-Fixture", "TESTFIXTURE")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # An aborted renderer may intentionally ignore a late fixture reply.

    def valid_host(self):
        expected = f"127.0.0.1:{self.server.server_port}"
        if self.headers.get("Host") != expected:
            self.send(403, {"detail": "TESTFIXTURE — dozwolony wyłącznie własny loopback Host."})
            return False
        return True

    def body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY or self.headers.get_content_type() != "application/json":
                raise ValueError()
            value = json.loads(self.rfile.read(length))
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except (ValueError, json.JSONDecodeError):
            self.send(400, {"detail": "TESTFIXTURE — wymagany mały obiekt JSON."})
            return None

    def do_GET(self):
        if not self.valid_host():
            return
        path = urlsplit(self.path).path
        if path == "/__fixture":
            return self.send(200, CONTROL_HTML, "text/html; charset=utf-8")
        if path == "/__fixture/state":
            return self.send(200, self.server.state.snapshot())
        if path.startswith("/backend/"):
            return self.api("GET", path[len("/backend"):])
        # Serve only the explicitly supplied dist, never the repo, hidden files
        # or a link escaping it. No directory listing or backend proxy exists.
        decoded = unquote(path).lstrip("/") or "index.html"
        if any(part.startswith(".") for part in Path(decoded).parts) or "\\" in decoded:
            return self.send(404, {"detail": "TESTFIXTURE — niedostępny plik."})
        target = (self.server.dist / decoded).resolve()
        if not target.is_relative_to(self.server.dist) or not target.is_file():
            return self.send(404, {"detail": "TESTFIXTURE — brak pliku w dist."})
        if target.name == "index.html":
            text = target.read_text(encoding="utf-8")
            return self.send(200, text.replace("</body>", BANNER + "</body>") if "</body>" in text else text + BANNER, "text/html; charset=utf-8")
        return self.send(200, target.read_bytes(), mimetypes.guess_type(str(target))[0] or "application/octet-stream")

    def do_POST(self):
        if not self.valid_host():
            return
        origin = self.headers.get("Origin")
        if self.headers.get("X-VoiceStudio-CSRF") != "1" or origin not in (None, f"http://127.0.0.1:{self.server.server_port}"):
            return self.send(403, {"detail": "TESTFIXTURE — wymagane własne jawne żądanie CSRF."})
        body = self.body()
        if body is None:
            return
        path = urlsplit(self.path).path
        if path in ("/__fixture/control", "/__fixture/configure"):
            try:
                return self.send(200, self.server.state.configure(body))
            except ValueError as error:
                return self.send(400, {"detail": str(error)})
        if path.startswith("/backend/"):
            return self.api("POST", path[len("/backend"):], body)
        return self.send(405, {"detail": "TESTFIXTURE — niedostępna operacja."})

    def api(self, method, path, body=None):
        state = self.server.state
        with state.lock:
            state.calls.append({"method": method, "path": path, "fixture": "TESTFIXTURE"})
            state.calls = state.calls[-500:]
            scenario, generation = state.scenario, state.generation
            review_read = path.startswith("/models/licenses/") or path == "/next/models/onboarding"
            delay = state.details_delay_ms if method == "GET" and review_read else state.decision_delay_ms if method == "POST" else 0
            reply = state.get(path) if method == "GET" and scenario not in ("offline", "stopped") else None
        if scenario == "offline":
            self.close_connection = True
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            return
        if scenario == "stopped":
            return self.send(503, {"detail": "TESTFIXTURE — backend zatrzymany."})
        if scenario == "legacy056" and (path.startswith("/models/licenses/") or path == "/next/models/onboarding"):
            return self.send(404, {"detail": "TESTFIXTURE — brak kontraktu zgód w 0.5.6."})
        if delay:
            time.sleep(delay / 1000)  # Bounded, fixture-only, never under state lock.
        if method == "POST":
            with state.lock:
                reply = (409, {"detail": {"code": "fixture_state_changed"}}) if generation != state.generation else state.mutate(path, body)
        return self.send(*reply)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--dist", type=Path, required=True)
    parser.add_argument("--scenario", choices=SCENARIOS, default="none")
    args = parser.parse_args()
    if not args.serve:
        parser.error("Uruchomienie wymaga jawnego --serve; brak działania przy imporcie.")
    server = FixtureServer(args.dist, scenario=args.scenario)
    print(json.dumps({"fixture": "TESTFIXTURE", "app": f"http://127.0.0.1:{server.server_port}/", "controls": f"http://127.0.0.1:{server.server_port}/__fixture", "storage": "RAM only", "real_backend_requests": 0}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
