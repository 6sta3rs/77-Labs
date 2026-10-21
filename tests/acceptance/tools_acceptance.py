"""Real-inference checks of generation options and built-in tools, on the disposable qa_session backend only.

Usage (runtime .venv python): tools_acceptance.py --profile <QA clone id> [--report path]
Unlike production_acceptance.py every check runs even when an earlier one fails; the report lists all results.
Creates only QA-named profiles/entries in the disposable database and removes the pronunciation entry it adds.
"""
from __future__ import annotations

from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import argparse
import hashlib
import io
import json
import time

import httpx
import numpy as np
import soundfile as sf

TOKEN = "seventy-seven-qa-owned"
TEXT = "Dzień dobry. Sprawdzamy ustawienia generowania mowy w lokalnym studiu."


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--report", type=_SourcePath, default=_runtime_paths.ROOT / ".tmp/qa/tools-acceptance-runtime.json")
    parser.add_argument("--speech-reference", type=_SourcePath, help="Your own short speech WAV for /clean-audio; defaults to the public procedural tone")
    args = parser.parse_args()
    fixture = (args.speech_reference or _runtime_paths.ROOT / "public/demo/interface-tone.wav").read_bytes()
    report = {"scope": "Disposable QA database, local weights, real inference", "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "profile_id": args.profile, "checks": []}
    client = httpx.Client(base_url="http://127.0.0.1:4312", timeout=600,
                          headers={"Origin": "http://tauri.localhost", "X-VoiceStudio-CSRF": "1", "Sec-Fetch-Site": "same-origin"})

    def check(name, fn):
        began = time.monotonic()
        try:
            passed, details = fn()
        except Exception as error:  # every check is reported, none aborts the run
            passed, details = False, {"error": f"{type(error).__name__}: {error}"[:600]}
        row = {"name": name, "passed": bool(passed), "seconds": round(time.monotonic() - began, 2), **details}
        report["checks"].append(row)
        print(json.dumps(row, ensure_ascii=True)[:700], flush=True)
        return row

    def wav(content):
        samples, rate = sf.read(io.BytesIO(content))
        peak = float(np.max(np.abs(samples))) if len(samples) else 0.0
        return {"duration": round(len(samples) / rate, 3), "peak": round(peak, 3), "sha256": hashlib.sha256(content).hexdigest()[:16],
                "ok": len(samples) / rate > 0.1 and peak > 0.001 and bool(np.isfinite(samples).all())}

    def generate(text=TEXT, **extra):
        fields = {"text": text, "profile_id": args.profile, "engine": "omnivoice", "language": "Polish", "speed": "1",
                  "num_step": "16", "effect_preset": "raw", "seed": "42", **{k: str(v) for k, v in extra.items()}}
        return client.post("/generate", data=fields)

    def audio_check(response):
        if response.status_code != 200:
            return False, {"status": response.status_code, "detail": response.text[:300]}
        info = wav(response.content)
        return info.pop("ok"), info

    def json_ok(response):
        return response.status_code == 200, {"status": response.status_code, "body": response.text[:300]}

    owned = client.get("/health")
    assert owned.headers.get("x-voicestudio-next") == TOKEN, "Refusing to run against a non-QA backend"
    assert client.get(f"/profiles/{args.profile}").json()["name"].startswith("QA"), "Profile must be a QA profile"

    # Generation options
    base = check("Generowanie bazowe (seed 42)", lambda: audio_check(generate()))
    again = check("Ten sam seed daje ten sam wynik", lambda: (lambda r: (r.status_code == 200 and wav(r.content)["sha256"] == base.get("sha256"), {"sha256": wav(r.content)["sha256"] if r.status_code == 200 else r.status_code}))(generate()))
    check("Inny seed daje inny wynik", lambda: (lambda r: (r.status_code == 200 and wav(r.content)["sha256"] != base.get("sha256"), {"sha256": wav(r.content)["sha256"] if r.status_code == 200 else r.status_code}))(generate(seed=7)))
    slow = check("Prędkość 0.8 (bez wycinania ciszy)", lambda: audio_check(generate(speed=0.8, postprocess_output="false")))
    fast = check("Prędkość 1.25 (bez wycinania ciszy)", lambda: audio_check(generate(speed=1.25, postprocess_output="false")))
    if slow.get("duration") and fast.get("duration"):
        check("Wolniej = dłużej niż szybciej", lambda: (slow["duration"] > fast["duration"] * 1.2, {"slow": slow["duration"], "fast": fast["duration"]}))
    check("Tagi [laughter] i [pause]", lambda: audio_check(generate("Ha, to było zabawne [laughter]. Teraz chwila ciszy [pause] i koniec.")))
    check("Język angielski", lambda: audio_check(generate("Hello. This is a quick English test of the local studio.", language="English")))
    check("Więcej kroków (32)", lambda: audio_check(generate(num_step=32)))
    presets = client.get("/engines/effects/presets")
    check("Lista presetów efektów", lambda: json_ok(presets))
    try:
        body = presets.json()
        rows = body if isinstance(body, list) else body.get("presets", body)
        names = [row.get("id") or row.get("name") for row in rows] if isinstance(rows, list) else list(rows)
        effect = next((name for name in names if name and name != "raw"), None)
    except Exception:
        effect = None
    if effect:
        check(f"Efekt {effect}", lambda: audio_check(generate(effect_preset=effect)))
    check("Budżet generowania", lambda: json_ok(client.get("/generate/budget")))
    long_text = " ".join(["To jest dłuższy akapit sprawdzający dzielenie tekstu na fragmenty."] * 12)
    check("Długi tekst (~800 znaków)", lambda: audio_check(generate(long_text)))

    # Invalid input must be a clear 4xx, never a 500 or a hang
    check("Pusty tekst → 4xx", lambda: (lambda r: (400 <= r.status_code < 500, {"status": r.status_code, "detail": r.text[:200]}))(generate("   ")))
    check("Nieznany profil → 4xx", lambda: (lambda r: (400 <= r.status_code < 500, {"status": r.status_code, "detail": r.text[:200]}))(client.post("/generate", data={"text": TEXT, "profile_id": "nie-istnieje", "engine": "omnivoice", "language": "Polish", "num_step": "16"})))
    check("Upload pliku nie-audio → 4xx", lambda: (lambda r: (400 <= r.status_code < 500, {"status": r.status_code, "detail": r.text[:200]}))(client.post("/transcribe", files={"audio": ("x.txt", b"not audio", "text/plain")}, data={"mode": "fast"})))

    # Designed voice
    described = check("Opis głosu → cechy", lambda: (lambda r: (r.status_code == 200 and bool(r.json().get("attrs")), {"status": r.status_code, "attrs": r.json().get("attrs") if r.status_code == 200 else r.text[:300]}))(client.post("/design/describe", json={"description": "A female, elderly voice with low pitch"})))
    def design_voice():
        attrs = described.get("attrs") if described.get("passed") else {}
        response = client.post("/profiles", data={"name": "QA projektowany", "kind": "design", "language": "Polish", "vd_states": json.dumps(attrs), "instruct": ", ".join(v for v in attrs.values() if v != "Auto")})
        if response.status_code != 200:
            return False, {"status": response.status_code, "detail": response.text[:300]}
        designed = response.json()["id"]
        result = audio_check(client.post("/generate", data={"text": TEXT, "profile_id": designed, "engine": "omnivoice", "language": "Polish", "num_step": "16", "seed": "42"}))
        return result[0], {"profile": designed, **result[1]}
    check("Głos projektowany: utworzenie i synteza", design_voice)

    # OpenAI-compatible API
    check("/v1/audio/voices", lambda: json_ok(client.get("/v1/audio/voices")))
    speech = client.post("/v1/audio/speech", json={"model": "omnivoice", "input": "Test zgodności z interfejsem OpenAI.", "voice": args.profile, "response_format": "wav", "language": "pl"})
    check("/v1/audio/speech (WAV)", lambda: audio_check(speech))
    if speech.status_code == 200:
        check("/v1/audio/transcriptions", lambda: (lambda r: (r.status_code == 200 and "openai" in r.text.casefold(), {"status": r.status_code, "body": r.text[:300]}))(client.post("/v1/audio/transcriptions", files={"file": ("s.wav", speech.content, "audio/wav")}, data={"model": "whisper-1", "language": "pl"})))

    # Multi-speaker longform (Stories) and audiobook preview
    def longform():
        body = {"chapters": [{"title": "Scena QA", "spans": [{"text": "Pierwszy mówca zaczyna rozmowę.", "voice_id": args.profile, "pause_ms_after": 300},
                                                             {"text": "A drugi głos odpowiada krótko.", "voice_id": design_profile() or args.profile, "pause_ms_after": 0}]}],
                "default_voice": args.profile, "language": "Polish", "format": "wav", "num_step": 16, "seed": 42, "metadata": {"title": "QA wielu mówców"}}
        events = []
        with client.stream("POST", "/longform/render", json=body) as response:
            if response.status_code != 200:
                return False, {"status": response.status_code, "detail": response.read().decode(errors="replace")[:300]}
            for line in response.iter_lines():
                if line.startswith("data:"):
                    events.append(json.loads(line[5:]))
        done = next((event for event in events if event.get("type") == "done"), None)
        errors = [event for event in events if "error" in str(event.get("type"))]
        if not done or errors:
            return False, {"events": [e.get("type") for e in events][-8:], "errors": errors[:2]}
        audio = client.get("/audio/" + done["output"])
        info = wav(audio.content) if audio.status_code == 200 and audio.content[:4] == b"RIFF" else {"ok": audio.status_code == 200 and len(audio.content) > 1000, "bytes": len(audio.content)}
        return info.pop("ok"), {"output": done["output"], **info}

    def design_profile():
        row = next((r for r in report["checks"] if r["name"].startswith("Głos projektowany")), {})
        return row.get("profile")
    check("Wielu mówców (longform/Stories)", longform)
    check("Podgląd rozdziału audiobooka", lambda: (lambda r: (r.status_code == 200 and bool(r.json().get("output")), {"status": r.status_code, "body": r.text[:300]}))(client.post("/audiobook/preview", json={"text": "# Rozdział\n\nKrótki podgląd rozdziału.", "chapter_index": 0, "default_voice": args.profile, "language": "Polish", "num_step": 16})))

    # Audio tools
    def clean():
        response = client.post("/clean-audio", files={"audio": ("test.wav", fixture, "audio/wav")})
        if response.status_code != 200:
            return False, {"status": response.status_code, "detail": response.text[:300]}
        info = wav(response.content)
        return info.pop("ok"), {**info, "conversion": response.headers.get("X-Clean-Conversion")}
    check("Czyszczenie nagrania (/clean-audio)", clean)
    check("Katalog efektów (/tools/effects)", lambda: json_ok(client.get("/tools/effects")))
    check("Wtyczki (/tools/plugins)", lambda: json_ok(client.get("/tools/plugins")))
    check("Wskazówki sposobu mówienia (/tools/direction)", lambda: json_ok(client.post("/tools/direction", json={"text": "urgent and surprised"})))
    check("Dopasowanie tekstu do czasu (/tools/rate-fit)", lambda: json_ok(client.post("/tools/rate-fit", json={"text": TEXT, "slot_seconds": 3.0, "target_lang": "pl"})))
    check("Status znaku wodnego", lambda: json_ok(client.get("/watermark/status")))
    if base.get("passed"):
        check("Detekcja znaku wodnego w wygenerowanym audio", lambda: json_ok(client.post("/watermark/detect", files={"file": ("g.wav", generate().content, "audio/wav")})))

    # Pronunciation dictionary round trip
    def pronunciation():
        created = client.post("/pronunciation", json={"term": "QAxyz", "replacement": "ku a iks", "language": "*"})
        if created.status_code != 200:
            return False, {"status": created.status_code, "detail": created.text[:300]}
        entry = created.json()
        try:
            tested = client.post("/pronunciation/test", json={"text": "Słowo QAxyz w zdaniu."})
            applied = tested.status_code == 200 and "ku a iks" in tested.text
            return applied, {"test": tested.text[:200]}
        finally:
            client.delete(f"/pronunciation/{entry.get('id')}")
    check("Słownik wymowy: dodanie, test, usunięcie", pronunciation)
    check("Tłumaczenie segmentu (/dub/translate)", lambda: (lambda r: (r.status_code == 200 and bool(r.json().get("translated", [{}])[0].get("text")) and not r.json()["translated"][0].get("error"), {"status": r.status_code, "body": r.text[:300]}))(client.post("/dub/translate", json={"segments": [{"id": "qa", "text": "Dzień dobry, jak się masz?"}], "source_lang": "pl", "target_lang": "en", "quality": "fast", "provider": client.get("/engines/translation").json().get("active"), "auto_glossary": False, "reflect": False, "condense": False})))
    check("Historia generowań", lambda: (lambda r: (r.status_code == 200 and len(r.json() if isinstance(r.json(), list) else r.json().get("items", r.json().get("history", []))) > 0, {"status": r.status_code}))(client.get("/history")))
    check("Stan modelu / VRAM", lambda: json_ok(client.get("/model/status")))

    passed = sum(row["passed"] for row in report["checks"])
    report["summary"] = {"passed": passed, "failed": len(report["checks"]) - passed}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("SUMMARY", report["summary"], flush=True)


if __name__ == "__main__":
    main()
