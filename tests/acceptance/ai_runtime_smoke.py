"""Verify the embedded launcher AI router on a free port and isolated test data."""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

from pathlib import Path
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)

repository = _runtime_paths.ROOT / "scripts/runtime/app"
runtime = Path(os.environ["LOCALAPPDATA"]) / "VoiceStudioNext/runtime"
with socket.socket() as guard:
    guard.bind(("127.0.0.1", 0))
    port = guard.getsockname()[1]

with tempfile.TemporaryDirectory(prefix="voicestudio-ai-runtime-") as directory:
    data = Path(directory) / "data"
    data.mkdir()
    # The test never imports private voices or history into its empty database.
    (data / "profiles-import.json").write_text('{"test":true}', encoding="utf-8")
    worker = (
        "import sys; from pathlib import Path; "
        f"sys.path.insert(0, {str(repository)!r}); import launcher; "
        f"launcher.ROOT=Path({str(runtime)!r}); launcher.PROJECT=launcher.ROOT/'engine'; "
        f"launcher.DATA=Path({str(data)!r}); launcher.PORT={port}; launcher.main()"
    )
    evidence = {"port": port, "isolatedData": True, "synthesis": False}
    environment = dict(os.environ, VOICESTUDIO_NEXT_TOKEN="ai-runtime-smoke", PYTHONUTF8="1")
    with (Path(directory) / "engine.log").open("w", encoding="utf-8") as log:
        child = subprocess.Popen([sys.executable, "-u", "-c", worker], cwd=runtime,
                                 stdin=subprocess.PIPE, stdout=log, stderr=log, env=environment,
                                 **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}))
        try:
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                if child.poll() is not None:
                    raise RuntimeError("Isolated backend exited: " + (Path(directory) / "engine.log").read_text(encoding="utf-8")[-3000:])
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as response:
                        assert response.headers.get("x-voicestudio-next") == "ai-runtime-smoke"
                        evidence["ownedHealth"] = response.status == 200
                    break
                except (OSError, TimeoutError):
                    time.sleep(.5)
            else:
                raise RuntimeError("Isolated backend did not become ready")
            request = urllib.request.Request(f"http://127.0.0.1:{port}/ai/status", headers={"X-VoiceStudio-AI": "1"})
            with urllib.request.urlopen(request, timeout=40) as response:
                status = json.load(response)
                assert status["connected"] and status["authMode"] == "chatgpt"
                evidence.update(aiRouter=True, chatgptConnected=True, defaultModel=status["defaultModel"])
        finally:
            child.stdin.close()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
            evidence["ownedProcessStopped"] = child.poll() is not None
    with socket.socket() as guard:
        guard.bind(("127.0.0.1", port))
        evidence["portReleased"] = True
    output = _runtime_paths.ROOT / ".tmp/qa/ai-runtime.json"
    output.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    print(json.dumps(evidence))
