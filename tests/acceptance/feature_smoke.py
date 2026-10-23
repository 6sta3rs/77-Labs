"""Real HTTP checks in disposable data/runtime; no model inference/downloads.

Use the existing isolated .venv interpreter. --hold keeps the disposable backend
alive for browser acceptance on port 4312 (up to 15 minutes, Ctrl+C to stop).
Never starts when another process owns that port. Does not import user profiles.
"""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import argparse
import importlib.util
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)


def serve(root):
    spec = importlib.util.spec_from_file_location("next_launcher", _runtime_paths.runtime_source("launcher.py"))
    launcher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(launcher)
    launcher.ROOT = Path(root) / "runtime"
    launcher.PROJECT = launcher.ROOT / "engine"
    launcher.DATA = Path(root) / "data"
    launcher.import_profiles = lambda: None
    launcher.main()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serve")
    parser.add_argument("--hold", action="store_true")
    args = parser.parse_args()
    if args.serve:
        serve(args.serve)
        return
    import httpx
    with socket.socket() as guard:
        guard.bind(("127.0.0.1", 4312))
    repo = Path(__file__).resolve().parents[2]
    checks = []
    def check(name, condition):
        checks.append({"name": name, "passed": bool(condition)})
        if not condition:
            raise AssertionError(name)
    with tempfile.TemporaryDirectory(prefix="voicestudio-feature-smoke-") as folder:
        root = Path(folder)
        (root / "runtime").mkdir()
        shutil.copy2(_runtime_paths.runtime_source("engine.zip"), root / "runtime/engine.zip")
        with (root / "server.log").open("w", encoding="utf-8") as log:
            process = subprocess.Popen([sys.executable, "-u", str(Path(__file__).resolve()), "--serve", folder], env=dict(os.environ, VOICESTUDIO_NEXT_TOKEN="next-feature-smoke"), stdin=subprocess.PIPE, stdout=log, stderr=log, creationflags=0x08000000)
            try:
                with httpx.Client(base_url="http://127.0.0.1:4312", timeout=60) as client:
                    for attempt in range(120):
                        if process.poll() is not None:
                            raise RuntimeError((root / "server.log").read_text(encoding="utf-8")[-4000:])
                        try:
                            response = client.get("/health", timeout=2)
                            if response.status_code == 200:
                                check("Owned disposable backend", response.headers.get("x-voicestudio-next") == "next-feature-smoke")
                                break
                        except (httpx.HTTPError, OSError):
                            pass
                        time.sleep(1)
                    else:
                        raise TimeoutError("Disposable engine did not become ready")
                    def api(method, path, **kwargs):
                        response = client.request(method, path, **kwargs)
                        response.raise_for_status()
                        return response.json()
                    check("Dictionary initially empty", api("GET", "/pronunciation") == [])
                    entry = api("POST", "/pronunciation", json={"term": "API", "replacement": "ej pi aj", "language": "*", "type": "respelling", "enabled": True})
                    check("Create dictionary entry", bool(entry["id"]))
                    dry = api("POST", "/pronunciation/test", json={"text": "API działa", "language": "Polish"})
                    check("Dictionary substitutes using real engine", dry["changed"] and "ej pi aj" in dry["substituted"])
                    api("PUT", f"/pronunciation/{entry['id']}", json={"enabled": False})
                    dry = api("POST", "/pronunciation/test", json={"text": "API działa", "language": "Polish"})
                    check("Disabled pronunciation is not applied", not dry["changed"])
                    exported = api("GET", "/pronunciation/export")
                    result = api("POST", "/pronunciation/import", json={"entries": exported["entries"], "replace": False})
                    check("Dictionary import appends", result["imported"] == 1 and len(api("GET", "/pronunciation")) == 2)
                    api("DELETE", f"/pronunciation/{entry['id']}")
                    check("Delete one dictionary entry", len(api("GET", "/pronunciation")) == 1)
                    check("Batch list contract", isinstance(api("GET", "/batch/jobs"), list))
                    check("History contract", isinstance(api("GET", "/history"), list))
                    catalog = api("GET", "/engines")
                    check("Three engine families", all(isinstance(catalog[key]["backends"], list) for key in ("tts", "asr", "llm")))
                    model_catalog = api("GET", "/models")
                    check("Real model inventory", isinstance(model_catalog["models"], list) and bool(model_catalog["models"]))
                    direction = api("POST", "/tools/direction", json={"text": "urgent"})
                    check("Direction analysis", "tokens" in direction and "instruct_prompt" in direction)
                    with (repo / "public/demo/interface-tone.wav").open("rb") as audio:
                        response = client.post("/convert", files={"audio": ("test.wav", audio, "audio/wav")}, data={"profile_id": "missing-test-profile", "match_duration": "true"})
                    check("Missing conversion profile is rejected", response.status_code == 404)
                    print(json.dumps(checks, ensure_ascii=False), flush=True)
                    (repo / ".tmp/qa/feature-smoke.json").write_text(json.dumps({"scope": "Disposable data, real HTTP, no inference/downloads. Conversion tested only for missing-profile rejection; batch enqueue/render not tested.", "checks": checks}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                    if args.hold:
                        print("DISPOSABLE_BACKEND_READY port=4312 (15 minute limit)", flush=True)
                        deadline = time.monotonic() + 900
                        while time.monotonic() < deadline and process.poll() is None:
                            time.sleep(1)
            finally:
                process.stdin.close()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)
                print("Stopped disposable backend", process.returncode, flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
