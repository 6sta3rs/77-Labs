"""The launcher keeps the engine's product analytics off: no destination is reachable even after an opt-in.
Offline: loads core/analytics.py from the pinned engine archive with a stub preference store; nothing is sent."""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
import zipfile
from unittest.mock import patch

import launcher


def engine_analytics_enabled(opted_in: bool) -> bool:
    """`core.analytics.enabled()` of the pinned engine, with `core.prefs` replaced by a stub (it is imported lazily)."""
    with zipfile.ZipFile(_runtime_paths.runtime_source("engine.zip")) as archive:
        source = archive.read("backend/core/analytics.py").decode("utf-8")
    prefs = types.ModuleType("core.prefs")
    prefs.get = lambda key, default=None: opted_in if key == "analytics_enabled" else default
    core = types.ModuleType("core")
    core.prefs = prefs
    module = types.ModuleType("engine_analytics_under_test")
    with patch.dict("sys.modules", {"core": core, "core.prefs": prefs}):
        exec(compile(source, "core/analytics.py", "exec"), module.__dict__)
        return module.enabled()


class AnalyticsSwitchTests(unittest.TestCase):
    def test_launcher_sets_the_kill_switch_for_the_engine(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=False):
            os.environ.pop("OMNIVOICE_ANALYTICS_DISABLED", None)
            root = Path(folder) / "runtime"
            (root / "engine/backend").mkdir(parents=True)
            previous = launcher.ROOT, launcher.DATA, launcher.PROJECT, os.getcwd(), list(sys.path), tempfile.tempdir
            launcher.ROOT, launcher.DATA, launcher.PROJECT = root, Path(folder) / "data", root / "engine"
            try:
                launcher.configure_environment()
                self.assertEqual(os.environ.get("OMNIVOICE_ANALYTICS_DISABLED"), "1")
            finally:
                os.chdir(previous[3])
                launcher.ROOT, launcher.DATA, launcher.PROJECT = previous[:3]
                sys.path[:] = previous[4]
                tempfile.tempdir = previous[5]

    def test_engine_default_is_off_and_the_switch_outranks_an_opt_in(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("OMNIVOICE_ANALYTICS_DISABLED", None)
            self.assertFalse(engine_analytics_enabled(opted_in=False), "no opt-in, no analytics")
            self.assertTrue(engine_analytics_enabled(opted_in=True), "control: the engine alone sends after an opt-in")
            os.environ["OMNIVOICE_ANALYTICS_DISABLED"] = "1"
            self.assertFalse(engine_analytics_enabled(opted_in=True), "the kill switch outranks the opt-in")


if __name__ == "__main__":
    unittest.main(verbosity=2)
