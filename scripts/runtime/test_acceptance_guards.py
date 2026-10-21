"""Pure fixture checks: no EXE, browser, Win32 API, clipboard or private reads."""
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from dictation_desktop_acceptance import ROOT, Native, report_destination, sandbox_parent, verify_cdp_ownership, assert_webview_profile_environment

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)


class AcceptanceGuardTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="seventy-seven-acceptance-guards-")
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def test_os_click_refuses_foreign_pid_before_focus_or_mouse_change(self):
        native = Native.__new__(Native)
        native.user = MagicMock()
        with self.assertRaisesRegex(RuntimeError, "nie należy"):
            native.click_owned_client({"pid": 999}, 20, 20, {20})
        native.user.ShowWindow.assert_not_called()
        native.user.SetCursorPos.assert_not_called()
        native.user.mouse_event.assert_not_called()

    def test_os_click_refuses_point_over_another_root_without_cursor_change(self):
        native = Native.__new__(Native)
        native.user = MagicMock()
        native.user.GetAsyncKeyState.return_value = 0
        native.user.GetCursorPos.return_value = 1
        native.user.ClientToScreen.return_value = 1
        native.user.GetAncestor.return_value = 999
        with patch.object(native, "focus_owned") as focus:
            with self.assertRaisesRegex(RuntimeError, "Punkt kliknięcia"):
                native.click_owned_client({"pid": 20, "handle": 123}, 20, 20, {20})
            focus.assert_called_once_with({"pid": 20, "handle": 123}, {20})
        native.user.SetCursorPos.assert_not_called()
        native.user.mouse_event.assert_not_called()

    def psutil_fixture(self, *, listener_pid=20, address="127.0.0.1", profile="expected-profile"):
        child = SimpleNamespace(pid=20, cmdline=lambda: ["owned-webview.exe", "--user-data-dir=" + profile])
        root = SimpleNamespace(children=lambda recursive: [child])
        listener = SimpleNamespace(pid=listener_pid, status="LISTEN", laddr=SimpleNamespace(port=9433, ip=address))
        return SimpleNamespace(Process=lambda _: root, net_connections=lambda kind: [listener])

    def test_cdp_accepts_only_owned_loopback_listener_with_dedicated_profile(self):
        with patch.dict("sys.modules", {"psutil": self.psutil_fixture()}):
            self.assertIsNotNone(verify_cdp_ownership(SimpleNamespace(pid=10), 9433, Path("expected-profile")))
        for values in ({"listener_pid": 999}, {"address": "0.0.0.0"}, {"profile": "foreign-profile"}):
            with self.subTest(values=values), patch.dict("sys.modules", {"psutil": self.psutil_fixture(**values)}), self.assertRaises(RuntimeError):
                verify_cdp_ownership(SimpleNamespace(pid=10), 9433, Path("expected-profile"))

    def test_sandbox_rejects_repo_and_known_real_app_data_roots(self):
        own_appdata = self.root / "fake-real-appdata"
        existing_app = own_appdata / "VoiceStudioNext"
        existing_app.mkdir(parents=True)
        with patch.dict(os.environ, {"LOCALAPPDATA": str(own_appdata), "APPDATA": str(own_appdata)}):
            self.assertEqual(sandbox_parent(self.root), self.root.resolve())
            for path in (ROOT, existing_app):
                with self.subTest(path=path), self.assertRaises(ValueError):
                    sandbox_parent(path)

    def test_sandbox_checks_reparse_guard_before_resolving(self):
        with patch("dictation_desktop_acceptance._no_link_ancestors", side_effect=ValueError("fixture junction")) as guard:
            with self.assertRaisesRegex(ValueError, "fixture junction"):
                sandbox_parent(self.root)
            guard.assert_called_once_with(self.root)

    def test_report_cannot_overwrite_arbitrary_external_file(self):
        session = self.root / "owned-session"
        session.mkdir()
        self.assertEqual(report_destination(session / "result.json", session), session / "result.json")
        self.assertEqual(report_destination(ROOT / ".tmp/qa/fixture-result.json", session), ROOT / ".tmp/qa/fixture-result.json")
        for path in (self.root / "unrelated.json", session / "result.db", ROOT / "README.md"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                report_destination(path, session)

    def test_profile_override_is_required_before_spawn_not_just_fake_localappdata(self):
        profile = self.root / "webview2"; profile.mkdir()
        with self.assertRaises(ValueError):
            assert_webview_profile_environment({"LOCALAPPDATA": str(self.root)}, profile, self.root)
        foreign = self.root / "foreign-profile"
        with self.assertRaises(ValueError):
            assert_webview_profile_environment({"WEBVIEW2_USER_DATA_FOLDER": str(foreign)}, profile, self.root)
        self.assertFalse(foreign.exists(), "Rejecting a path must not create/read a foreign profile")
        proof = assert_webview_profile_environment({"WEBVIEW2_USER_DATA_FOLDER": str(profile)}, profile, self.root)
        self.assertTrue(proof["validated_before_process_creation"])

    def test_first_profile_must_be_empty_and_restart_requires_own_receipt(self):
        profile = self.root / "webview2"; profile.mkdir()
        env = {"WEBVIEW2_USER_DATA_FOLDER": str(profile)}
        with self.assertRaises(ValueError):
            assert_webview_profile_environment(env, profile, self.root, reuse_owned=True)
        assert_webview_profile_environment(env, profile, self.root)
        (profile / "fixture-profile-data").write_text("own fixture, not a browser profile")
        proof = assert_webview_profile_environment(env, profile, self.root, reuse_owned=True)
        self.assertTrue(proof["reusing_owned_profile"])
        with self.assertRaises(ValueError):
            assert_webview_profile_environment(env, profile, self.root)

    def test_conflicting_chromium_profile_argument_is_refused_before_spawn(self):
        profile = self.root / "webview2"; profile.mkdir()
        with self.assertRaises(ValueError):
            assert_webview_profile_environment({"WEBVIEW2_USER_DATA_FOLDER": str(profile), "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": "--user-data-dir=foreign"}, profile, self.root)


if __name__ == "__main__":
    unittest.main(verbosity=2)
