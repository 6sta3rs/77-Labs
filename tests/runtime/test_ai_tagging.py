"""Offline contract tests; no subscription calls or user settings writes."""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from ai_tagging import Settings, TAGS, allowed_tags, create_router, enhance, read_settings, save_settings, validate_cleaned, validate_output


class TaggingTests(unittest.TestCase):
    def assert_rejected(self, before, after, allowed=TAGS):
        with self.assertRaises(HTTPException) as result:
            validate_output(before, after, allowed)
        self.assertEqual(result.exception.status_code, 422)

    def test_insertions_and_multiple_speakers(self):
        result = ["Pierwszy. [pause] Dalej.", "[sigh] Drugi.", ""]
        self.assertEqual(validate_output(["Pierwszy. Dalej.", "Drugi.", ""], result, TAGS), result)

    def test_original_annotations_stay_at_their_positions(self):
        self.assert_rejected(["A [sigh] B."], ["[sigh] A B."])

    def test_empty_speaker_must_stay_empty(self):
        self.assert_rejected(["A.", ""], ["A.", "[sigh]"])

    def test_missing_original_tag(self):
        self.assert_rejected(["A [pause] B."], ["A B."])

    def test_elevenlabs_tag_rejected(self):
        self.assert_rejected(["Tekst."], ["[thoughtful] Tekst."])

    def test_original_literal_annotation_preserved(self):
        self.assertEqual(validate_output(["[uwaga] Tekst."], ["[uwaga] [pause] Tekst."], TAGS), ["[uwaga] [pause] Tekst."])

    def test_word_change_rejected(self):
        self.assert_rejected(["Kot śpi."], ["[pause] Pies śpi."])

    def test_punctuation_change_rejected(self):
        self.assert_rejected(["Tak."], ["Tak!"])

    def test_word_boundary_change_rejected(self):
        self.assert_rejected(["a by"], ["aby"])

    def test_broken_response_rejected(self):
        for output in (None, {}, [1], [], ["A", "B"]):
            self.assert_rejected(["A"], output)

    def test_only_pauses_when_reactions_disabled(self):
        allowed = allowed_tags(Settings(reactions=False))
        self.assert_rejected(["Tekst."], ["[sigh] Tekst."], allowed)
        self.assertEqual(allowed, TAGS[:2])

    def test_clean_text_accepts_only_deletions(self):
        source = "Rozdział 1\n\n12\nTo był przy-\nkład zdania, które\nciągnie się dalej.\nKsiążka o kotach   13"
        cleaned = "# Rozdział 1\n\nTo był przykład zdania, które ciągnie się dalej."
        self.assertEqual(validate_cleaned(source, cleaned), cleaned)
        for bad in ("To był przykład zdania, które ciągnie się dalej i coś nowego.", "To był inny przykład.", "Rozdział", ""):
            with self.assertRaises(HTTPException):
                validate_cleaned(source, bad)

    def test_size_limit(self):
        self.assert_rejected(["a" * 10000], ["[pause]" + "a" * 10000])

    def test_disabled_never_contacts_codex(self):
        with patch("ai_tagging.connection_status") as status:
            with self.assertRaises(HTTPException) as result:
                enhance(["Tekst."], Settings(enabled=False))
            self.assertEqual(result.exception.status_code, 409)
            status.assert_not_called()

    def test_router_guards_and_settings_roundtrip(self):
        app = FastAPI()
        app.include_router(create_router())
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"LOCALAPPDATA": directory}):
            with TestClient(app) as client:
                self.assertEqual(client.get("/ai/settings").status_code, 403)
                headers = {"X-VoiceStudio-AI": "1", "Origin": "https://foreign.example"}
                self.assertEqual(client.get("/ai/settings", headers=headers).status_code, 403)
                # The Vite dev origin is rejected in production mode and accepted only with the dev flag.
                headers["Origin"] = "http://127.0.0.1:4310"
                self.assertEqual(client.get("/ai/settings", headers=headers).status_code, 403)
                with patch.dict(os.environ, {"VOICESTUDIO_DEV_ORIGINS": "1"}):
                    self.assertEqual(client.get("/ai/settings", headers=headers).json()["enabled"], True)
                headers["Origin"] = "http://127.0.0.1:4312"
                self.assertEqual(client.get("/ai/settings", headers=headers).json()["enabled"], True)
                settings = Settings(reactions=False, intensity="subtle")
                response = client.put("/ai/settings", headers=headers, json=settings.model_dump())
                self.assertEqual(response.status_code, 200)
                self.assertEqual(read_settings(), settings)
                self.assertEqual(client.post("/ai/enhance-dialogue", headers=headers, json={"dialogue_blocks": []}).status_code, 422)
                saved = Path(directory) / "VoiceStudioNext/data/ai-tagging.json"
                self.assertNotIn("token", saved.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
