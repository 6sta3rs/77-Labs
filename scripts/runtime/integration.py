"""Owned backend session for manual/UI integration and one short TTS check.

The parent terminal keeps stdin open. Send Enter to stop only this child.
"""
from pathlib import Path
import argparse
import json
import os
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request


_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--run", action="store_true", help="Jawnie uruchom prywatny silnik i jedną syntezę.")
parser.add_argument("--profile", required=True, help="Identyfikator własnego profilu wybranego do testu.")
parser.add_argument("--output-dir", type=Path, default=_QA_OUTPUT / "integration")
args = parser.parse_args()
if not args.run:
    parser.error("Uruchomienie syntezy wymaga --run i jawnego --profile.")

root = Path(os.environ["LOCALAPPDATA"]) / "VoiceStudioNext" / "runtime"
repository = Path(__file__).resolve().parent
output = args.output_dir.resolve()
output.mkdir(parents=True, exist_ok=True)
with socket.socket() as guard:
    guard.bind(("127.0.0.1", 4312))
shutil.copy2(repository / "launcher.py", root / "launcher.py")
shutil.copy2(repository / "ai_tagging.py", root / "ai_tagging.py")
shutil.copy2(repository / "activity.py", root / "activity.py")
shutil.copy2(repository / "model_management.py", root / "model_management.py")
environment = dict(os.environ, VOICESTUDIO_NEXT_TOKEN="next-ui-integration-owned", PYTHONUTF8="1")
with (root / "integration.log").open("w", encoding="utf-8") as log:
    process = subprocess.Popen([str(root / ".venv" / "Scripts" / "python.exe"), "-u", str(root / "launcher.py")], cwd=root, env=environment, stdin=subprocess.PIPE, stdout=log, stderr=log, creationflags=0x08000000)
    (root / "integration-owner.json").write_text(json.dumps({"pid": process.pid, "ownerPid": os.getpid(), "token": environment["VOICESTUDIO_NEXT_TOKEN"], "script": str(root / "launcher.py"), "log": str(root / "integration.log")}, indent=2), encoding="utf-8")
    print("OWNED_BACKEND_PID", process.pid, flush=True)
    try:
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f"Private backend exited ({process.returncode}); see integration.log")
            try:
                with urllib.request.urlopen("http://127.0.0.1:4312/health", timeout=2) as response:
                    assert response.headers.get("x-voicestudio-next") == environment["VOICESTUDIO_NEXT_TOKEN"]
                    print("HEALTH", response.read().decode(), flush=True)
                break
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                time.sleep(1)
        else:
            raise RuntimeError("Private backend startup timeout")
        with urllib.request.urlopen("http://127.0.0.1:4312/profiles", timeout=3) as response:
            profiles = json.load(response)
        profile = next((profile for profile in profiles if profile["id"] == args.profile), None)
        if profile is None:
            raise RuntimeError("Nie znaleziono jawnie wybranego profilu testowego.")
        fields = {"text": "Cześć. To jest test nowego studia głosu.", "profile_id": profile["id"], "engine": "omnivoice", "language": "Polish", "speed": "1", "num_step": "16", "seed": "42"}
        request = urllib.request.Request("http://127.0.0.1:4312/generate", urllib.parse.urlencode(fields).encode(), headers={"Content-Type": "application/x-www-form-urlencoded"})
        began = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=240) as response:
                audio = response.read()
                if not response.headers.get("Content-Type", "").startswith("audio/"):
                    raise RuntimeError("Generation did not return audio")
                (output / "tts-integration.wav").write_bytes(audio)
                import soundfile as sf
                import numpy as np
                samples, sample_rate = sf.read(output / "tts-integration.wav")
                metadata = {"status": "ok", "engine": "omnivoice", "profileId": profile["id"], "profileName": profile["name"], "text": fields["text"], "steps": 16, "speed": 1, "seed": 42, "duration": len(samples) / sample_rate, "sampleRate": sample_rate, "bytes": len(audio), "peak": float(np.max(np.abs(samples))), "requestSeconds": time.monotonic() - began, "httpStatus": response.status, "audioId": response.headers.get("X-Audio-Id"), "privateDataDir": str(root.parent / "data"), "modelCache": json.loads((root / "model-cache.json").read_text(encoding="utf-8"))["path"]}
                (output / "tts-integration.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
                print("GENERATION", json.dumps(metadata, ensure_ascii=True), flush=True)
        except Exception as error:
            detail = error.read().decode(errors="replace") if isinstance(error, urllib.error.HTTPError) else str(error)
            (output / "tts-integration.json").write_text(json.dumps({"status": "error", "message": detail, "requestSeconds": time.monotonic() - began}, ensure_ascii=False, indent=2), encoding="utf-8")
            print("GENERATION_ERROR", detail, flush=True)
        print("BACKEND_READY_FOR_UI. Send Enter to this session to stop owned backend.", flush=True)
        input()
    finally:
        process.stdin.close()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)
        print("OWNED_BACKEND_STOPPED", process.returncode, flush=True)
