"""Pinned parser/router + real PCM/ffmpeg; deterministic fixture replaces TTS only."""
import asyncio
import contextlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import audiobook_streaming as streaming


class StreamingTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="book-stream-qa-")
        cls.root = Path(cls.temporary.name)
        with zipfile.ZipFile(Path(__file__).with_name("engine.zip")) as bundle:
            bundle.extractall(cls.root / "engine")
        cls.environment = patch.dict(os.environ, {"OMNIVOICE_DATA_DIR": str(cls.root / "data"), "OMNIVOICE_ENV_FILE": str(cls.root / "environment"), "OMNIVOICE_CACHE_DIR": str(cls.root / "models"), "HF_HUB_OFFLINE": "1"})
        cls.environment.start()
        sys.path.insert(0, str(cls.root / "engine/backend"))
        sys.path.insert(0, str(cls.root / "engine"))
        from core.db import init_db
        init_db()
        from api.routers import audiobook
        from services.audiobook import Chapter, Span, ExpressiveOptions, AudiobookPlan
        cls.router, cls.Chapter, cls.Span, cls.Options, cls.Plan = audiobook, Chapter, Span, ExpressiveOptions, AudiobookPlan

    @classmethod
    def tearDownClass(cls):
        cls.environment.stop()
        cls.temporary.cleanup()

    def test_portions_preserve_text_voices_pauses(self):
        chapter = self.Chapter("QA", [self.Span("alfa", "Pierwsze zdanie. " * 120, speed=0.9), self.Span(None, "", pause_ms_after=300), self.Span("beta", "Drugi akapit.\n\nOstatnie zdanie.")])
        options = self.Options(line_gap_ms=100, paragraph_gap_ms=250)
        portions = streaming.chapter_portions(chapter, options)
        self.assertGreater(len(portions), 2)
        self.assertTrue(all(p.char_count <= streaming.PORTION_CHARS for p in portions))
        self.assertEqual(" ".join(" ".join(s.text for p in portions for s in p.spans).split()), " ".join(" ".join(s.text for s in chapter.spans).split()))
        spans = [s for p in portions for s in p.spans]
        self.assertEqual([s.pause_ms_after for s in spans if not s.text], [300])
        self.assertEqual(spans[-1].voice_id, "beta")
        self.assertEqual(spans[-2].pause_ms_after, 250)
        self.assertTrue(all(s.speed == 0.9 for s in spans if s.voice_id == "alfa"))
        self.assertEqual(chapter.spans[0].pause_ms_after, 0, "The stored original plan is untouched.")

    def test_join_wavs_exact_samples_and_parameters(self):
        import numpy as np
        import soundfile as sf
        paths = []
        for i in range(3):
            path = self.root / f"pcm-{i}.wav"
            sf.write(path, np.full(1200, i / 10, dtype="float32"), 24000, subtype="PCM_16")
            paths.append(str(path))
        output = streaming.join_wavs(paths, self.root)
        joined, rate = sf.read(output)
        self.assertEqual(rate, 24000)
        self.assertTrue(np.array_equal(joined, np.concatenate([sf.read(p)[0] for p in paths])))
        sf.write(self.root / "bad-rate.wav", np.zeros(100), 16000)
        with self.assertRaises(ValueError): streaming.join_wavs([paths[0], str(self.root / "bad-rate.wav")], self.root)

    async def test_first_audio_before_second_portion_and_final_mux(self):
        import numpy as np
        import soundfile as sf
        from core.config import OUTPUTS_DIR
        calls, released = [], asyncio.Event()
        original_chapter, original_stream = self.router._run_chapter, self.router._public_longform_stream

        async def synth_fixture(chapter, **kwargs):
            calls.append(chapter)
            if len(calls) == 2:
                await released.wait()
            path = Path(OUTPUTS_DIR) / f"fixture-{len(calls)}.wav"
            sf.write(path, np.full(2400, len(calls) / 100, dtype="float32"), 24000, subtype="PCM_16")
            return str(path), 0.1, False, None

        self.router._run_chapter = synth_fixture
        streaming.install()
        token = streaming._ENABLED.set(True)
        try:
            chapter = self.Chapter("Oryginalny rozdział", [self.Span(None, "To jest zdanie do testu. " * 70)])
            plan = self.Plan([chapter])
            async with contextlib.aclosing(self.router._public_longform_stream(plan, default_voice=None, fmt="m4b", opts=self.Options(), job_type="audiobook")) as events:
                def decode(frame): return json.loads(frame.removeprefix("data:").strip())
                first = decode(await anext(events))
                self.assertEqual(first["type"], "started", first)
                chunk = decode(await asyncio.wait_for(anext(events), 5))
                self.assertEqual(chunk["type"], "audio_chunk", chunk)
                self.assertFalse(released.is_set())
                self.assertEqual(chunk["sequence"], 0)
                self.assertTrue((Path(OUTPUTS_DIR) / chunk["output"]).is_file())
                released.set()
                rest = [decode(frame) async for frame in events]
            chunks = [chunk] + [event for event in rest if event["type"] == "audio_chunk"]
            self.assertEqual([item["sequence"] for item in chunks], list(range(len(chunks))))
            done = rest[-1]
            self.assertEqual(done["type"], "done", rest)
            self.assertEqual(done["chapters"], 1, "Portions must not become final chapter markers.")
            self.assertEqual(done["failed_chapters"], [])
            self.assertTrue((Path(OUTPUTS_DIR) / done["output"]).stat().st_size > 100)
            from services.ffmpeg_utils import find_ffmpeg
            ffprobe = shutil.which("ffprobe") or str(Path(find_ffmpeg()).with_name("ffprobe.exe"))
            probe = subprocess.run([ffprobe, "-v", "error", "-show_chapters", "-of", "json", str(Path(OUTPUTS_DIR) / done["output"])], capture_output=True, check=True)
            chapters = json.loads(probe.stdout)["chapters"]
            self.assertEqual(len(chapters), 1)
            self.assertEqual(chapters[0]["tags"]["title"], chapter.title)
        finally:
            released.set()
            streaming._ENABLED.reset(token)
            self.router._run_chapter, self.router._public_longform_stream = original_chapter, original_stream

    async def test_disconnect_cancels_producer_and_no_next_portion(self):
        original_chapter, original_stream = self.router._run_chapter, self.router._public_longform_stream
        entered, stopped = asyncio.Event(), asyncio.Event()
        async def slow(*args, **kwargs):
            entered.set()
            try: await asyncio.Event().wait()
            finally: stopped.set()
        self.router._run_chapter = slow
        streaming.install()
        token = streaming._ENABLED.set(True)
        try:
            events = self.router._public_longform_stream(self.Plan([self.Chapter("QA", [self.Span(None, "Tekst. " * 200)])]), default_voice=None, fmt="mp3", opts=self.Options(), job_type="audiobook")
            await anext(events)
            await asyncio.wait_for(entered.wait(), 5)
            await events.aclose()
            self.assertTrue(stopped.is_set(), "Closing SSE must finalize the underlying renderer immediately.")
        finally:
            streaming._ENABLED.reset(token)
            self.router._run_chapter, self.router._public_longform_stream = original_chapter, original_stream

    async def test_http_opt_in_and_legacy_are_separate(self):
        import httpx
        import numpy as np
        import soundfile as sf
        from core.config import OUTPUTS_DIR
        from fastapi import FastAPI

        original_chapter, original_stream = self.router._run_chapter, self.router._public_longform_stream
        calls = []
        async def fixture(chapter, **kwargs):
            calls.append(chapter)
            path = Path(OUTPUTS_DIR) / f"http-fixture-{len(calls)}.wav"
            sf.write(path, np.full(2400, 0.05, dtype="float32"), 24000, subtype="PCM_16")
            return str(path), 0.1, False, None
        self.router._run_chapter = fixture
        streaming.install()
        app = FastAPI()
        app.include_router(self.router.router)
        app.add_middleware(streaming.StreamingAudiobooks)
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://qa") as client:
                with patch.object(self.router, "_ensure_active_engine_licence", lambda: None):
                    payload = {"text": "# Rozdział HTTP\n\n" + "Treść testowa. " * 100, "format": "mp3", "line_gap_ms": 100}
                    result = await client.post("/audiobook", json=payload, headers={"X-Next-Audiobook-Stream": "1"})
                    self.assertEqual(result.status_code, 200)
                    events = [json.loads(line[5:]) for line in result.text.splitlines() if line.startswith("data:")]
                    self.assertGreater(sum(e["type"] == "audio_chunk" for e in events), 1)
                    self.assertEqual(events[-1]["type"], "done", events)
                    self.assertFalse(streaming._ENABLED.get(), "Opt-in does not leak into another request.")
                    calls.clear()
                    legacy = await client.post("/audiobook", json=payload)
                    self.assertEqual(legacy.status_code, 200)
                    self.assertNotIn('"type": "audio_chunk"', legacy.text)
                    self.assertEqual(len(calls), 1, "Other clients retain the stock full-chapter rendering.")
        finally:
            self.router._run_chapter, self.router._public_longform_stream = original_chapter, original_stream


if __name__ == "__main__":
    unittest.main(verbosity=2)
