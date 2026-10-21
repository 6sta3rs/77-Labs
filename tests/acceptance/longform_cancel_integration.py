"""Explicit owned-QA cancel/resume acceptance; uses real GPU only when invoked.

Requires the disposable qa_session.py server and its exact ownership marker.
Never starts/stops the backend or accesses the user's database. Reads a
baseline JSON made by the reproduction, resumes its own two-chapter manifest,
stops at the first chapter, waits on Activity's physical barrier and resumes.
"""
from __future__ import annotations

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths


import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
import time
import urllib.request

import httpx

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)


BASE = "http://127.0.0.1:4312"
TOKEN = "seventy-seven-qa-owned"


def read(path):
    request = urllib.request.Request(BASE + path, headers={"x-voicestudio-next": TOKEN})
    with urllib.request.urlopen(request, timeout=90) as response:
        if response.headers.get("x-voicestudio-next") != TOKEN:
            raise RuntimeError("Refusing a backend without the exact QA ownership marker")
        return json.load(response)


def resume(job_id, *, stop_first=False):
    events = []
    started = time.monotonic()
    with httpx.Client(timeout=600) as client:
        with client.stream("POST", f"{BASE}/audiobook/resume/{job_id}") as response:
            if response.headers.get("x-voicestudio-next") != TOKEN:
                raise RuntimeError("Foreign backend")
            response.raise_for_status()
            for line in response.iter_lines():
                if not line.startswith("data: "):
                    continue
                event = json.loads(line[6:])
                events.append({**event, "observed_after_s": round(time.monotonic() - started, 3)})
                print("LONGFORM_EVENT", json.dumps(event, ensure_ascii=True), flush=True)
                if event.get("type") in {"chapter_error", "error"}:
                    raise RuntimeError(f"Render failed: {event}")
                if stop_first and event.get("type") == "chapter":
                    break
    return events


def wait_drained(job_id, timeout=180):
    samples = []
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        activity = read("/next/activity")
        sample = {"activity": activity, "job": read("/jobs/" + job_id), "observed_at": time.time()}
        samples.append(sample)
        print("LONGFORM_DRAIN", json.dumps(sample, ensure_ascii=True), flush=True)
        if not activity["busy"]:
            if sample["job"]["status"] != "cancelled":
                raise AssertionError("Idle without authoritative cancelled job")
            physical = activity.get("physical")
            if not physical or physical["gpu_running"] or physical["gpu_queued"] or physical["model_loading"]:
                raise AssertionError("Missing/invalid physical drain proof")
            return samples
        if activity["reason"] in {"interrupted-request", "longform-proof-error"}:
            raise AssertionError(f"Sticky/unknown cancellation debt: {activity}")
        time.sleep(0.25)
    raise TimeoutError("Longform did not drain; backend remains untouched")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, default=Path(".tmp/longform-cancel/before.json"))
    parser.add_argument("--qa-root", type=Path, default=Path(".tmp/production-session"))
    parser.add_argument("--report", type=Path, default=Path(".tmp/qa/longform-cancel-runtime.json"))
    args = parser.parse_args()
    baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
    baseline.pop("ownership", None)
    health = read("/health")
    assert baseline["profile"] == "3d7a9e9c", "Unexpected profile"
    family = read("/engines/tts")
    assert family["active"] == "omnivoice", "QA engine changed since the baseline"
    profile = next((row for row in read("/profiles") if row["id"] == baseline["profile"]), None)
    assert profile and profile.get("ref_text"), "Owned QA profile/reference is unavailable"
    reference_name = profile["ref_audio_path"]
    assert Path(reference_name).name == reference_name, "Unexpected QA reference path"
    reference = args.qa_root / "data/voices" / reference_name
    reference_sha = hashlib.sha256(reference.read_bytes()).hexdigest()
    manifest = next((job for job in read("/audiobook/jobs")["jobs"] if job["job_id"] == baseline["job_id"]), None)
    assert manifest is not None, "The owned baseline manifest is no longer resumable"
    checks = subprocess.run([sys.executable, str(_runtime_paths.runtime_source("activity_check.py"))], capture_output=True, text=True, encoding="utf-8", timeout=30, check=True)
    report = {"ownership_marker_verified": True, "health": health, "profile": baseline["profile"], "baseline": baseline,
              "after_fix_executed": True, "reference_sha256": reference_sha, "engine": family["active"],
              "activity_unit_tests": {"exit_code": checks.returncode, "summary": checks.stderr[-500:]},
              "limits": ["Disposable QA database only", "Four-step functional render, not a subjective voice-quality test", "Native runtime_stop not directly invoked; activity protocol eligibility is tested"]}
    args.report.parent.mkdir(parents=True, exist_ok=True)

    def save():
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    try:
        report["after_cancel_events"] = resume(baseline["job_id"], stop_first=True)
        new_id = next(event["job_id"] for event in report["after_cancel_events"] if event["type"] == "started")
        first = next(event for event in report["after_cancel_events"] if event["type"] == "chapter")
        assert first["index"] == 0 and first["cached"], "First completed chapter was regenerated"
        report["cancelled_job_id"] = new_id
        save()
        report["drain_samples"] = wait_drained(new_id)
        report["resumable_after_cancel"] = next(job for job in read("/audiobook/jobs")["jobs"] if job["job_id"] == new_id)
        save()
        report["final_resume_events"] = resume(new_id)
        done = next(event for event in report["final_resume_events"] if event["type"] == "done")
        chapters = [event for event in report["final_resume_events"] if event["type"] == "chapter"]
        assert done["chapters"] == 2 and not done.get("failed_chapters"), "Resume did not complete two chapters"
        assert chapters[0]["index"] == 0 and chapters[0]["cached"], "Resume lost the completed chapter cache"
        final_id = next(event["job_id"] for event in report["final_resume_events"] if event["type"] == "started")
        report["final_job"] = read("/jobs/" + final_id)
        assert report["final_job"]["status"] == "done"
        output = args.qa_root / "data/outputs" / done["output"]
        assert output.parent.resolve() == (args.qa_root / "data/outputs").resolve() and output.is_file()
        raw = output.read_bytes()
        assert len(raw) > 1000 and (raw.startswith(b"ID3") or raw[0] == 0xFF), "Output is not a plausible MP3"
        report["output"] = {"name": output.name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "duration_s": done["duration_s"]}
        report["final_activity"] = read("/next/activity")
        report["passed"] = not report["final_activity"]["busy"]
        assert report["passed"], "Backend still busy after successful resume"
    except Exception as error:
        report["passed"] = False; report["failure"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        save()
    print("LONGFORM_CANCEL_RESUME_PASS", args.report, flush=True)


if __name__ == "__main__":
    main()
