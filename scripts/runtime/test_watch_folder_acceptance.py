"""Pure fixture guards only. No EXE, browser, model or native API starts."""
import hashlib
import io
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import wave

import watch_folder_acceptance as subject


class WatchAcceptanceTests(unittest.TestCase):
    def test_second_owned_version_changes_container_without_modifying_public_speech(self):
        path = subject.ROOT / "public/demo/interface-tone.wav"
        original = path.read_bytes(); baseline = hashlib.sha256(original).hexdigest()
        changed = subject.second_version(original)
        self.assertNotEqual(changed, original)
        with wave.open(io.BytesIO(original), "rb") as first, wave.open(io.BytesIO(changed), "rb") as second:
            self.assertEqual(first.getparams(), second.getparams())
            self.assertEqual(first.readframes(first.getnframes()), second.readframes(second.getnframes()))
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), baseline)

    def test_atomic_fixture_updates_only_explicit_owned_folder(self):
        with tempfile.TemporaryDirectory(prefix="seventy-seven-watch-guard-") as temporary:
            root = Path(temporary); folder = root / "watched"; folder.mkdir()
            outside = root / "outside.wav"; outside.write_bytes(b"keep")
            with self.assertRaises(ValueError): subject.atomic_fixture(outside, b"refused", folder)
            self.assertEqual(outside.read_bytes(), b"keep")
            destination = folder / "owned.wav"
            subject.atomic_fixture(destination, b"first-own-copy", folder)
            subject.atomic_fixture(destination, b"second-own-copy", folder)
            self.assertEqual(destination.read_bytes(), b"second-own-copy")
            self.assertEqual([path.name for path in folder.iterdir()], ["owned.wav"])

    def test_backend_guard_detects_python_and_install_helpers_only_in_owned_tree(self):
        class Gone(Exception): pass
        fixture = SimpleNamespace(NoSuchProcess=Gone)
        def current(names):
            return SimpleNamespace(root_process=SimpleNamespace(children=lambda recursive: [SimpleNamespace(name=lambda value=name: value) for name in names]))
        with patch.dict("sys.modules", {"psutil": fixture}):
            self.assertTrue(subject.no_backend_children(current(["msedgewebview2.exe", "seventy-seven-labs.exe"])))
            for name in ("python.exe", "pythonw.exe", "uv.exe", "ffmpeg.exe"):
                self.assertFalse(subject.no_backend_children(current(["msedgewebview2.exe", name])))


if __name__ == "__main__": unittest.main(verbosity=2)
