"""Export-only acceptance on explicit QA fixture. Never synthesizes or ingests.

Uses the already generated QA 5810621e audio through its normal download API.
The NEW video job is a clearly marked service fixture inserted only in the
disposable QA database, because the public API cannot attach an existing track
to another video job. This is NOT full upload/prep/ASR/translation/TTS dubbing.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import uuid
from model_management import _no_link_ancestors

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)


ROOT = Path(__file__).resolve().parents[2]
QA = ROOT / ".tmp/candidate-session/data"
OUT = ROOT / ".tmp/dub-export-acceptance"
TEXT = ["Zażółć gęślą jaźń.", "Kontrolowany eksport QA."]


def main():
    import httpx
    _no_link_ancestors(QA)
    assert QA.resolve().is_relative_to((ROOT / '.tmp/candidate-session').resolve())
    OUT.mkdir(exist_ok=True)
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    assert ffmpeg and ffprobe
    report = {"at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "scope": __doc__, "checks": [], "inference_performed": False, "upload_prepare_tested": False}
    def check(name, condition, **detail):
        report["checks"].append({"name": name, "passed": bool(condition), **detail})
        assert condition, name
    def command(args):
        return subprocess.run(args, capture_output=True, check=True, timeout=35, creationflags=0x08000000 if sys.platform == "win32" else 0).stdout
    def probe(path):
        return json.loads(command([ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)]))
    def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
    def row():
        with sqlite3.connect((QA / "omnivoice.db").as_uri() + "?mode=ro", uri=True) as db:
            return db.execute("SELECT job_data FROM dub_history WHERE id='5810621e'").fetchone()[0]
    original_row = row()
    report["original_job_data_sha256"] = hashlib.sha256(original_row.encode()).hexdigest()
    original_track = QA / "dub_jobs/5810621e/dubbed_pl.wav"
    original_track_hash = sha(original_track)
    headers = {"Origin": "http://tauri.localhost", "Sec-Fetch-Site": "same-origin", "X-VoiceStudio-CSRF": "1"}
    try:
        with httpx.Client(base_url="http://127.0.0.1:4312", headers=headers, timeout=45) as client:
            health = client.get("/health"); check("Owned disposable QA backend", health.headers.get("x-voicestudio-next") == "seventy-seven-qa-owned")
            report["health"] = health.json()
            source = client.get("/dub/download-audio/5810621e", params={"lang": "pl", "preserve_bg": "false"}); source.raise_for_status()
            check("Existing generated QA track is reusable through its normal audio download API", hashlib.sha256(source.content).hexdigest() == original_track_hash, sha256=original_track_hash)
            job_id = "qa-export-" + uuid.uuid4().hex[:10]
            job_dir = QA / "dub_jobs" / job_id; job_dir.mkdir()
            report["fixture_job_id"] = job_id
            reused = job_dir / "reused-qa.wav"; reused.write_bytes(source.content)
            video = job_dir / "original.mp4"
            public = ROOT / "public/demo/interface-tone.wav"
            command([ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x202b38:s=640x360:r=12:d=3.43", "-i", str(public), "-t", "3.43", "-c:v", "libx264", "-preset", "ultrafast", "-threads", "1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", str(video)])
            segments = [{"id": i, "start": start, "end": end, "text": text, "text_original": text, "speaker_id": "Speaker 1"} for i, (start, end, text) in enumerate([(0.2, 1.7, TEXT[0]), (1.8, 3.2, TEXT[1])])]
            fixture = {"fixture_export_only": True, "fixture_audio_reuse_job": "5810621e", "video_path": str(video), "audio_path": str(reused), "vocals_path": str(reused), "no_vocals_path": None, "thumb_path": None, "duration": 3.43, "filename": "QA controlled export.mp4", "input_type": "video", "source_lang": "pl", "segments": segments, "scene_cuts": [], "timing_strategy": "strict_slot", "language": "Polish", "language_code": "pl", "dubbed_tracks": {"pl": {"path": str(reused), "language": "Polish", "language_code": "pl", "duration": 3.43, "timing_strategy": "strict_slot", "source_segments": segments}}}
            with sqlite3.connect(QA / "omnivoice.db") as db:
                db.execute("INSERT INTO dub_history(id,filename,duration,segments_count,language,language_code,tracks,job_data,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", (job_id, fixture["filename"], 3.43, 2, "Polish", "pl", '["pl"]', json.dumps(fixture, ensure_ascii=False), "explicit-export-fixture", time.time()))
            for burn in (False, True):
                response = client.get("/dub/download/" + job_id, params={"preserve_bg": "false", "include_tracks": "pl", "default_track": "pl", "burn_subs": str(burn).lower()})
                response.raise_for_status()
                path = OUT / ("burned.mp4" if burn else "plain.mp4"); path.write_bytes(response.content)
                media = probe(path); streams = media["streams"]
                check("Burned MP4 export" if burn else "Plain MP4 export", any(s["codec_name"] == "h264" for s in streams) and len([s for s in streams if s["codec_type"] == "audio"]) == 1 and float(media["format"]["duration"]) >= 3.4, bytes=path.stat().st_size, sha256=sha(path), streams=[{"type": s["codec_type"], "codec": s["codec_name"], "default": s.get("disposition", {}).get("default")} for s in streams], duration=media["format"]["duration"])
            srt = f"1\n00:00:00,200 --> 00:00:01,700\n{TEXT[0]}\n\n2\n00:00:01,800 --> 00:00:03,200\n{TEXT[1]}\n"
            imported = client.post("/dub/import-srt/" + job_id, files={"file": ("QA-captions.srt", srt.encode("utf-8"), "text/plain")}); imported.raise_for_status()
            check("Actual SRT import works without ASR on an existing prepared service fixture", len(imported.json()["segments"]) == 2)
            for extension in ("srt", "vtt", "ass"):
                response = client.get(f"/dub/{extension}/{job_id}", params={"lang": "pl"}); response.raise_for_status()
                (OUT / ("captions." + extension)).write_bytes(response.content)
                text = re.sub(r"\{[^}]*\}", "", response.text) if extension == "ass" else response.text
                check(extension.upper() + " export preserves Polish captions", all(item in text for item in TEXT), bytes=len(response.content))
            report["activity_after"] = client.get("/next/activity", headers={"x-voicestudio-next": "seventy-seven-qa-owned"}).json()
        counts = {}
        for name in ("plain", "burned"):
            pixels = command([ffmpeg, "-v", "error", "-ss", "0.8", "-i", str(OUT / (name + ".mp4")), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"])
            counts[name] = sum(value > 180 for value in pixels)
        check("Subtitle burn changes actual pixels rather than only metadata", counts["plain"] == 0 and counts["burned"] > 100, bright_pixels=counts)
        command([ffmpeg, "-y", "-v", "error", "-ss", "0.8", "-i", str(OUT / "burned.mp4"), "-frames:v", "1", str(OUT / "burned-frame.png")])
        check("Original generated QA job and audio remain unchanged", row() == original_row and sha(original_track) == original_track_hash)
        check("No Torch or NumPy imported by acceptance client", "torch" not in sys.modules and "numpy" not in sys.modules)
        report["passed"] = True
    except Exception as error:
        report["passed"] = False; report["error"] = str(error); raise
    finally:
        report["limits"] = ["New fixture job inserted only in QA; not a full normal upload/prep/render", "Normal uncached ingest tries Demucs; no skip flag in upload contract, so that flow was not executed", "No public API attaches an old generated track to another video job", "No TTS, ASR, Demucs, watermark or license action invoked"]
        (ROOT / ".tmp/qa/dub-export-runtime.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"passed": report["passed"], "checks": len(report["checks"]), "job": report.get("fixture_job_id"), "error": report.get("error")}, ensure_ascii=False))


def offline_finish():
    """Validate already downloaded artifacts without borrowing a live QA port."""
    target = ROOT / ".tmp/qa/dub-export-runtime.json"
    _no_link_ancestors(QA)
    report = json.loads(target.read_text(encoding="utf-8"))
    ffmpeg = shutil.which("ffmpeg"); assert ffmpeg
    content = (OUT / "captions.ass").read_text(encoding="utf-8")
    plain = re.sub(r"\{[^}]*\}", "", content)
    check = next(item for item in report["checks"] if item["name"] == "ASS export preserves Polish captions")
    check.update(passed=all(text in plain for text in TEXT), validation="Dialogue text after removing valid ASS override/karaoke tags")
    assert check["passed"]
    report["harness_correction"] = "Initial literal substring check rejected valid ASS karaoke tags between words; semantic text check now preserves both Polish captions. No product export was regenerated."
    counts = {}
    for name in ("plain", "burned"):
        pixels = subprocess.run([ffmpeg, "-v", "error", "-ss", "0.8", "-i", str(OUT / (name + ".mp4")), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True, timeout=15, creationflags=0x08000000 if sys.platform == "win32" else 0).stdout
        counts[name] = sum(value > 180 for value in pixels)
    assert counts["plain"] == 0 and counts["burned"] > 100
    report["checks"].append({"name": "Subtitle burn changes actual video pixels", "passed": True, "bright_pixels": counts})
    subprocess.run([ffmpeg, "-y", "-v", "error", "-ss", "0.8", "-i", str(OUT / "burned.mp4"), "-frames:v", "1", str(OUT / "burned-frame.png")], capture_output=True, check=True, timeout=15, creationflags=0x08000000 if sys.platform == "win32" else 0)
    with sqlite3.connect((QA / "omnivoice.db").as_uri() + "?mode=ro", uri=True) as db:
        current = db.execute("SELECT job_data FROM dub_history WHERE id='5810621e'").fetchone()[0]
    with sqlite3.connect((ROOT / ".tmp/production-session/data/omnivoice.db").as_uri() + "?mode=ro", uri=True) as db:
        legacy = db.execute("SELECT job_data FROM dub_history WHERE id='5810621e'").fetchone()[0]
    same_row = current == legacy
    audio_hash = hashlib.sha256((QA / "dub_jobs/5810621e/dubbed_pl.wav").read_bytes()).hexdigest()
    baseline_hash = report["checks"][1]["sha256"]
    assert same_row and audio_hash == baseline_hash
    report["checks"].append({"name": "Original QA job matches its read-only pre-migration QA copy and audio hash is unchanged", "passed": True, "job_data_sha256": hashlib.sha256(current.encode()).hexdigest(), "audio_sha256": audio_hash})
    report["checks"].append({"name": "Offline artifact validation imports no Torch or NumPy", "passed": "torch" not in sys.modules and "numpy" not in sys.modules})
    report.pop("error", None); report["passed"] = all(item["passed"] for item in report["checks"])
    report["artifacts"] = ".tmp/dub-export-acceptance (plain/burned MP4, PNG frame, SRT/VTT/ASS)"
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "checks": len(report["checks"]), "bright_pixels": counts}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--offline-finish", action="store_true")
    args = parser.parse_args()
    if args.offline_finish: offline_finish()
    elif args.run: main()
    else: parser.error("Use explicit --run for owned QA, or --offline-finish for existing artifacts only.")
