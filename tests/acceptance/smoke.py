"""Start the private engine, check ownership/health/voices, then stop it.

No synthesis, model loads or downloads. Does not touch any foreign process.
"""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

from pathlib import Path
import json
import os
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request


root = Path(os.environ["LOCALAPPDATA"]) / "VoiceStudioNext" / "runtime"
repository = _runtime_paths.ROOT / "scripts/runtime/app"
with socket.socket() as guard:
    guard.bind(("127.0.0.1", 4312))
for name in ("launcher.py", "ai_tagging.py", "activity.py", "model_management.py", "engine.zip"):
    shutil.copy2(_runtime_paths.runtime_source(name), root / name)
environment = dict(os.environ, VOICESTUDIO_NEXT_TOKEN="next-runtime-smoke-test", PYTHONUTF8="1")
with (root / "smoke.log").open("w", encoding="utf-8") as log:
    process = subprocess.Popen([str(root / ".venv" / "Scripts" / "python.exe"), "-u", str(root / "launcher.py")], cwd=root, env=environment, stdin=subprocess.PIPE, stdout=log, stderr=log, creationflags=0x08000000)
    try:
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f"Private backend exited ({process.returncode}); see {root / 'smoke.log'}")
            try:
                with urllib.request.urlopen("http://127.0.0.1:4312/health", timeout=2) as response:
                    assert response.headers.get("x-voicestudio-next") == "next-runtime-smoke-test"
                    print("health:", response.read().decode(), flush=True)
                with urllib.request.urlopen("http://127.0.0.1:4312/profiles", timeout=3) as response:
                    profiles = json.load(response)
                    print("profiles:", len(profiles), flush=True)
                break
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                time.sleep(1)
        else:
            raise RuntimeError("Private backend did not become ready within 180s")
    finally:
        process.stdin.close()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)
        print("own process stopped:", process.returncode, flush=True)
with socket.socket() as guard:
    guard.bind(("127.0.0.1", 4312))
print("port released", flush=True)
