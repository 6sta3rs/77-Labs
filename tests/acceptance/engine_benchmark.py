"""Measure a real cold start + generations + stop of the private engine, exactly as the EXE spawns it.

Usage: python tests/acceptance/engine_benchmark.py <label> --profile ID [--runs 3]
Writes .tmp/qa/engine-benchmark-<label>.json. Uses the user's private data dir
(profiles, model cache) and adds history rows like the app would; audio itself is not saved.
"""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

# Same modules runtime.rs writes before every start (TTS_EXTENSIONS included).
MODULES = ["launcher.py", "audiobook_streaming.py", "ai_tagging.py", "activity.py", "model_management.py",
           "integration_settings.py", "storage_settings.py", "system_settings.py", "general_settings.py",
           "remote_backend.py", "preview_cache.py", "private_environment.py", "engine_installation.py",
           "windows_runtime_paths.py", "runtime_backup.py", "engine_catalogue_metadata.py",
           "tts_catalog.py", "tts_extensions.py", "tts_worker.py", "prepare_tts.py"]
RESOURCES = {"runtime-distribution.json": "bootstrap-provenance.json", "engine-provenance.json": "engine-provenance.json"}
URL = "http://127.0.0.1:4312"
TEXT = "Cześć. To jest pomiar szybkości lokalnego silnika mowy. Sprawdzamy, ile trwa pierwsze i kolejne generowanie."


def log_events(text):
    """Timestamps of key engine log lines plus render traces, as offsets from the first engine line."""
    stamp = lambda line: datetime.strptime(line[:23], "%Y-%m-%d %H:%M:%S,%f").timestamp()
    events, traces = {}, []
    for line in text.splitlines():
        if not re.match(r"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d{3} ", line):
            continue
        for key, needle in (("watchdog_armed", "Startup watchdog armed"), ("media_tools", "media-tool directory"),
                            ("profiles_reconciled", "Startup performance selections"), ("startup_complete", "Deferred startup complete"),
                            ("torch_import", "Importing PyTorch"), ("model_load_begin", "Loading VoiceStudio model on device"),
                            ("model_loaded", "VoiceStudio model loaded successfully"), ("watermark_loaded", "AudioSeal generator loaded"),
                            ("unclean_previous", "ended uncleanly")):
            if needle in line and key not in events:
                events[key] = stamp(line)
        if "render trace" in line:
            traces.append(line.split("render trace ", 1)[1])
        if "[next-diag]" in line:
            traces.append(line.split("[next-diag] ", 1)[1])
    return events, traces


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("label")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--profile", required=True, help="ID of your own voice profile")
    args = parser.parse_args()
    root = Path(os.environ["LOCALAPPDATA"]) / "VoiceStudioNext" / "runtime"
    with socket.socket() as guard:
        guard.bind(("127.0.0.1", 4312))  # refuse to run next to another engine
    for name in MODULES:
        shutil.copy2(_runtime_paths.runtime_source(name), root / name)
    for target, source in RESOURCES.items():
        shutil.copy2(_runtime_paths.runtime_source(source), root / target)
    print("COPIED", len(MODULES), "modules", flush=True)
    log_path = root / f"bench-{args.label}.log"
    token = f"bench-{args.label}-{os.getpid()}"
    env = {k: v for k, v in os.environ.items() if k not in ("PYTHONPATH", "PYTHONHOME")}
    env.update(VOICESTUDIO_NEXT_TOKEN=token, PYTHONDONTWRITEBYTECODE="1", PYTHONNOUSERSITE="1", PYTHONUTF8="1",
               VOICESTUDIO_NEXT_BUNDLE=str(_runtime_paths.runtime_source("engine.zip")))
    result = {"label": args.label, "date": datetime.now().isoformat(timespec="seconds"), "text": TEXT, "profile": args.profile,
              "steps": 16, "seed": 42, "modelCacheOnline": Path(json.loads((root / "model-cache.json").read_text(encoding="utf-8"))["path"]).is_dir()}
    began = time.monotonic()
    wall_start = time.time()
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen([str(root / ".venv" / "Scripts" / "python.exe"), "-B", "-u", str(root / "launcher.py")], cwd=root, env=env,
                                   stdin=subprocess.PIPE, stdout=log, stderr=log, creationflags=0x08000000)
        try:
            deadline = began + 300
            while True:
                if process.poll() is not None:
                    raise RuntimeError(f"engine exited ({process.returncode}); see {log_path}")
                if time.monotonic() > deadline:
                    raise RuntimeError("startup > 300 s")
                try:
                    with urllib.request.urlopen(URL + "/health", timeout=2) as response:
                        if response.headers.get("x-voicestudio-next") == token:
                            break
                except (urllib.error.URLError, TimeoutError, ConnectionError):
                    pass
                time.sleep(0.5)
            result["healthSeconds"] = round(time.monotonic() - began, 1)
            print("HEALTH", result["healthSeconds"], flush=True)
            runs = []
            for index in range(args.runs):
                fields = {"text": TEXT, "profile_id": args.profile, "engine": "omnivoice", "language": "Polish", "speed": "1",
                          "num_step": "16", "effect_preset": "raw", "seed": "42"}
                request = urllib.request.Request(URL + "/generate", urllib.parse.urlencode(fields).encode(),
                                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
                started = time.monotonic()
                try:
                    with urllib.request.urlopen(request, timeout=600) as response:
                        audio = response.read()
                        runs.append({"seconds": round(time.monotonic() - started, 1), "status": response.status, "bytes": len(audio),
                                     "audio": response.headers.get("Content-Type", "").startswith("audio/")})
                except urllib.error.HTTPError as error:
                    runs.append({"seconds": round(time.monotonic() - started, 1), "status": error.code, "detail": error.read().decode(errors="replace")[:300]})
                print("GENERATE", index + 1, runs[-1], flush=True)
            result["generations"] = runs
        finally:
            stop = time.monotonic()
            process.stdin.close()  # the same graceful signal runtime.rs sends first
            try:
                process.wait(timeout=15)
                result["stop"] = {"graceful": True, "seconds": round(time.monotonic() - stop, 1), "exitCode": process.returncode}
            except subprocess.TimeoutExpired:
                subprocess.run(["taskkill.exe", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
                process.wait(timeout=10)
                result["stop"] = {"graceful": False, "seconds": round(time.monotonic() - stop, 1), "exitCode": process.returncode}
            print("STOP", result["stop"], flush=True)
    events, traces = log_events(log_path.read_text(encoding="utf-8", errors="replace"))
    result["logOffsetsSeconds"] = {key: round(value - wall_start, 1) for key, value in events.items()}
    result["renderTraces"] = traces
    output = _runtime_paths.ROOT / ".tmp/qa" / f"engine-benchmark-{args.label}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("WROTE", output, flush=True)


if __name__ == "__main__":
    main()
