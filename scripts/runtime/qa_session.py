"""Disposable, owned backend for UI/inference acceptance using local model weights.

The user database and voice files are never imported. All writes go to --root.
Run with the isolated runtime Python, keep this terminal alive, Enter stops it.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--archive", type=Path, default=Path(__file__).with_name("engine.zip"))
    parser.add_argument("--port", type=int, default=4312)
    parser.add_argument("--serve", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    source = Path(__file__).resolve().parent
    runtime = root / "runtime"
    token = "seventy-seven-qa-owned"
    if args.serve:
        spec = importlib.util.spec_from_file_location("qa_launcher", source / "launcher.py")
        launcher = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(launcher)
        launcher.ROOT = runtime
        launcher.PROJECT = runtime / "engine"
        launcher.DATA = root / "data"
        launcher.PORT = args.port
        launcher.import_profiles = lambda: None
        launcher.main()
        return
    with socket.socket() as guard:
        guard.bind(("127.0.0.1", args.port))
    runtime.mkdir(parents=True, exist_ok=True)
    # The deployed EXE writes these exact support modules beside the launcher.
    # Metadata provenance reads them from ROOT, even when this harness imports
    # launcher.py directly from the working tree.
    for name in ("tts_catalog.py", "tts_extensions.py", "tts_worker.py", "prepare_tts.py"):
        shutil.copy2(source / name, runtime / name)
    shutil.copy2(args.archive.resolve(strict=True), runtime / "engine.zip")
    shutil.copy2(source / "bootstrap-provenance.json", runtime / "runtime-distribution.json")
    provenance = args.archive.resolve().with_name("engine-provenance.json")
    if provenance.is_file():
        shutil.copy2(provenance, runtime / "engine-provenance.json")
    manifest = Path(os.environ["LOCALAPPDATA"]) / "VoiceStudioNext/runtime/model-cache.json"
    if manifest.is_file() and not (runtime / "model-cache.json").exists():
        shutil.copy2(manifest, runtime / "model-cache.json")
    if (root / "server.log").exists():
        shutil.copy2(root / "server.log", root / f"server-previous-{time.time_ns()}.log")
    with (root / "server.log").open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            [sys.executable, "-B", "-u", str(Path(__file__).resolve()), "--root", str(root), "--port", str(args.port), "--serve"],
            env=dict(os.environ, VOICESTUDIO_NEXT_TOKEN=token, PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1", PYTHONNOUSERSITE="1"),
            stdin=subprocess.PIPE, stdout=log, stderr=log, creationflags=0x08000000 if os.name == "nt" else 0,
        )
        try:
            for _ in range(180):
                if process.poll() is not None:
                    raise RuntimeError((root / "server.log").read_text(encoding="utf-8")[-6000:])
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{args.port}/health", timeout=2) as response:
                        assert response.headers.get("x-voicestudio-next") == token, "Foreign backend"
                        print("QA_READY", json.dumps({"pid": process.pid, "root": str(root), "health": json.load(response)}), flush=True)
                    break
                except (urllib.error.URLError, TimeoutError, ConnectionError):
                    time.sleep(1)
            else:
                raise TimeoutError("QA backend startup timeout")
            input("Enter stops only the QA backend.\n")
        finally:
            process.stdin.close()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)
            print("QA_STOPPED", process.returncode, flush=True)


if __name__ == "__main__":
    main()
