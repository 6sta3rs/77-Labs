"""Real inference acceptance on the disposable qa_session backend only.

Requires an explicit QA clone ID; never uses private user profiles. Writes new
public-fixture derivatives and a dated report, without overwriting older tests.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import time

import httpx
import numpy as np
import soundfile as sf

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--mode", choices=["tts", "asr", "book", "dub", "conversion"], required=True)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--speech-reference", type=Path, help="Własna próbka mowy dla konwersji/dubbingu; proceduralny ton nie zawiera słów.")
    args = parser.parse_args()
    if args.mode in {"dub", "conversion"} and args.speech_reference is None:
        parser.error("Ten tryb wymaga jawnego --speech-reference z uprawnionej próbki mowy.")
    repo = Path(__file__).resolve().parents[2]
    fixture = args.speech_reference.resolve(strict=True) if args.speech_reference else repo / "public/demo/interface-tone.wav"
    output = args.output_dir or repo / ".tmp/production-acceptance"
    output.mkdir(parents=True, exist_ok=True)
    report = {"scope": "Disposable QA database, explicitly supplied speech where required, local weights, real inference", "mode": args.mode, "profile_id": args.profile, "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "checks": []}
    began = time.monotonic()

    def record(name, condition, **details):
        report["checks"].append({"name": name, "passed": bool(condition), **details})
        print(json.dumps(report["checks"][-1], ensure_ascii=True), flush=True)
        if not condition:
            raise AssertionError(name)

    def audio(response, name):
        if not response.is_success:
            record(name, False, status=response.status_code, detail=response.text[:1500])
        response.raise_for_status()
        samples, rate = sf.read(io.BytesIO(response.content))
        duration = len(samples) / rate
        peak = float(np.max(np.abs(samples))) if len(samples) else 0
        record(name, duration > 0.1 and peak > 0.001 and np.isfinite(samples).all(), duration=duration, sample_rate=rate, bytes=len(response.content), peak=peak, sha256=hashlib.sha256(response.content).hexdigest())
        (output / f"{args.mode}.wav").write_bytes(response.content)

    with httpx.Client(base_url="http://127.0.0.1:4312", timeout=600,
                      headers={"Origin":"http://tauri.localhost", "X-VoiceStudio-CSRF":"1", "Sec-Fetch-Site":"same-origin"}) as client:
        def api(method, path, **kwargs):
            response = client.request(method, path, **kwargs)
            response.raise_for_status()
            return response.json()

        def stream(path, **kwargs):
            events = []
            with client.stream("POST" if kwargs else "GET", path, **kwargs) as response:
                response.raise_for_status()
                for line in response.iter_lines():
                    if not line.startswith("data:"):
                        continue
                    event = json.loads(line[5:])
                    events.append(event)
                    print("EVENT", json.dumps(event, ensure_ascii=True)[:1000], flush=True)
                    if event.get("type") in {"error", "chapter_error"}:
                        raise RuntimeError(str(event))
            return events

        try:
            health = client.get("/health")
            record("Owned disposable backend", health.headers.get("x-voicestudio-next") == "seventy-seven-qa-owned")
            report["health"] = health.json()
            profile = api("GET", f"/profiles/{args.profile}")
            record("Explicit QA profile", profile["name"].startswith("QA"))
            if args.mode == "tts":
                audio(client.post("/generate", data={"text": "Cześć. Sprawdzamy klonowanie głosu i odtwarzanie nagrania.", "profile_id": args.profile, "engine": "omnivoice", "language": "Polish", "num_step": "16", "seed": "42", "speed": "1"}), "Clone produces a new non-silent WAV")
            elif args.mode == "asr":
                with (output / "tts.wav").open("rb") as source:
                    result = api("POST", "/transcribe", files={"audio": ("qa.wav", source, "audio/wav")}, data={"mode": "fast", "language": "pl"})
                record("Generated speech content", "klon" in result["text"].casefold() and "nagran" in result["text"].casefold(), result=result)
            elif args.mode == "conversion":
                with fixture.open("rb") as source:
                    result = api("POST", "/convert", files={"audio": ("qa.wav", source, "audio/wav")}, data={"profile_id": args.profile, "match_duration": "true"})
                record("Conversion result and transcript", bool(result.get("audio_url")) and bool(result.get("text")), result=result)
                audio(client.get(result["audio_url"]), "ASR to cloned speech returns audio")
            elif args.mode == "book":
                script = "# Rozdział pierwszy\n\nTo jest pierwszy rozdział.\n\n# Rozdział drugi\n\nTo jest drugi rozdział."
                plan = api("POST", "/audiobook/plan", json={"text": script, "default_voice": args.profile})
                record("Two real book chapters", plan["chapter_count"] == 2)
                events = stream("/audiobook", json={"text": script, "default_voice": args.profile, "language": "Polish", "format": "m4b", "num_step": 16, "metadata": {"title": "QA dwa rozdziały", "author": "QA"}})
                done = next((event for event in events if event.get("type") == "done"), {})
                record("Complete two-chapter render", done.get("chapters") == 2 and not done.get("failed_chapters"), done=done)
                response = client.get("/audio/" + done["output"]); response.raise_for_status()
                (output / "book.m4b").write_bytes(response.content)
                record("M4B container downloaded", len(response.content) > 1000 and b"ftyp" in response.content[:64], bytes=len(response.content))
                library = api("GET", "/longform/jobs")["jobs"]
                record("Book persisted in library", any(row["output"] == done["output"] for row in library))
            elif args.mode == "dub":
                with fixture.open("rb") as source:
                    job = api("POST", "/dub/upload", files={"video": ("qa.wav", source, "audio/wav")}, data={"input_type": "audio", "source_lang": "pl"})
                report["job"] = job
                events = stream("/tasks/stream/" + job["task_id"])
                record("Source preparation", any(event.get("type") == "ready" for event in events))
                subtitles = "1\n00:00:00,000 --> 00:00:03,400\nCześć. To jest nowy dubbing.\n"
                imported = api("POST", f"/dub/import-srt/{job['job_id']}", files={"file": ("qa.srt", subtitles.encode(), "text/plain")})
                record("Timed subtitles imported", len(imported["segments"]) == 1)
                segments = [{**row, "profile_id": args.profile, "effect_preset": "raw"} for row in imported["segments"]]
                task = api("POST", f"/dub/generate/{job['job_id']}", json={"segments": segments, "language": "Polish", "language_code": "pl", "num_step": 16, "timing_strategy": "strict_slot"})
                events = stream("/tasks/stream/" + task["task_id"])
                record("Dub render completes", any(event.get("type") == "done" for event in events))
                audio(client.get(f"/dub/download-audio/{job['job_id']}?lang=pl&preserve_bg=false"), "Dub WAV downloaded")
                for format in ("srt", "vtt", "ass"):
                    response = client.get(f"/dub/{format}/{job['job_id']}?lang=pl"); response.raise_for_status()
                    record(f"Dub {format.upper()} export", "dubbing" in response.text, characters=len(response.text))
            report["status"] = "passed"
        except Exception as error:
            report["status"] = "failed"
            report["error"] = str(error)
            raise
        finally:
            report["seconds"] = round(time.monotonic() - began, 2)
            (args.report or repo / f".tmp/qa/production-{args.mode}-runtime.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
