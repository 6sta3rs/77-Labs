"""Independent FFprobe verification of generated JS WAV fixtures; no ML imports."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

_QA_OUTPUT = Path(__file__).resolve().parents[1] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)

root = Path(__file__).resolve().parents[1]
report_path = root / ".tmp/qa/wav-format-fixture.json"
report = json.loads(report_path.read_text(encoding="utf-8"))
ffprobe = shutil.which("ffprobe")
if not ffprobe:
    raise RuntimeError("FFprobe is required for independent fixture acceptance")
for row in report["files"]:
    path = root / ".tmp/qa/wav-fixture" / row["filename"]
    assert path.resolve().is_relative_to((root / ".tmp/qa/wav-fixture").resolve())
    raw = subprocess.check_output([ffprobe, "-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels,bits_per_sample,duration_ts", "-of", "json", str(path)])
    stream = json.loads(raw)["streams"][0]
    expected = "pcm_f32le" if row["float"] else "pcm_s" + str(row["bits"]) + "le"
    assert stream["codec_name"] == expected, stream
    assert int(stream["bits_per_sample"]) == row["bits"], stream
    assert int(stream["sample_rate"]) == row["sample_rate"], stream
    assert stream["channels"] == row["channels"], stream
    assert stream["duration_ts"] == row["frames"], stream
    row["independent_stream"] = stream
    row["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
report["independent_decoder"] = "FFprobe PASS: codec, bit depth, sample rate, channels and exact frame count"
report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Independent FFprobe verification PASS for PCM16, PCM24 and FLOAT32 multi-block files")
