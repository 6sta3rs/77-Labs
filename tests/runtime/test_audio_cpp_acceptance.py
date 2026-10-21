"""No-network fixture checks for the explicit QA acceptance port boundary."""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from audio_cpp_install_acceptance import Api, owned_qa_backend, models_are_unloaded, has_cpu_device


class AudioCppAcceptanceTests(unittest.TestCase):
    def test_real_device_stdout_accepts_backend_colon_index_contract(self):
        text = 'available_devices=3\nVulkan:0 "Fixture IGPU" [IGPU]\nCPU:0 "Fixture CPU" [CPU]\n'
        self.assertTrue(has_cpu_device(text))
        self.assertTrue(has_cpu_device('CPU: 0 "Fixture" [CPU]\r\n'))
        for output in ('Vulkan:0 "Fixture GPU" [GPU]\n', 'CPU:nope "Fixture" [CPU]', 'CPU:0 "Fixture" [GPU]', 'CPU:\n0 "Fixture" [CPU]'):
            with self.subTest(output=output):
                self.assertFalse(has_cpu_device(output))

    def test_model_guard_ignores_system_memory_but_requires_explicit_unloaded_state(self):
        status = {"loaded": False, "loading": False}
        for available in (0.8, 8.0):
            self.assertTrue(models_are_unloaded(status, {"models": [], "count": 0, "system": {"ram_available_gb": available}}))
        self.assertFalse(models_are_unloaded(status, {"models": [{"id": "fixture"}], "count": 1}))
        self.assertFalse(models_are_unloaded({**status, "loading": True}, {"models": [], "count": 0}))
        self.assertFalse(models_are_unloaded({}, {"models": [], "count": 0}))

    def test_port_is_explicit_and_limited(self):
        self.assertEqual(Api("fixture").port, 4312)
        for port in (80, 4314, "4313"):
            with self.subTest(port=port), self.assertRaises(AssertionError):
                Api("fixture", port)

    def test_http_4313_preserves_qa_marker_and_loopback(self):
        response = MagicMock()
        response.headers = {"x-voicestudio-next": "fixture-owned"}
        response.__enter__.return_value = response
        with patch("audio_cpp_install_acceptance.urllib.request.urlopen", return_value=response) as opened, patch("audio_cpp_install_acceptance.json.load", return_value={"ok": True}):
            self.assertEqual(Api("fixture-owned", 4313).call("/health"), {"ok": True})
            request = opened.call_args.args[0]
            self.assertEqual(request.full_url, "http://127.0.0.1:4313/health")
            self.assertEqual(request.get_header("X-voicestudio-next"), "fixture-owned")
        response.headers = {"x-voicestudio-next": "foreign"}
        with patch("audio_cpp_install_acceptance.urllib.request.urlopen", return_value=response), self.assertRaisesRegex(AssertionError, "oznaczonego"):
            Api("fixture-owned", 4313).call("/health")

    def test_listener_requires_exact_port_root_and_owned_qa_script(self):
        root = Path(__file__).resolve().parent
        command = ["python.exe", "qa_session.py", "--root", str(root), "--port", "4313", "--serve"]
        process = SimpleNamespace(cmdline=lambda: command)
        listener = SimpleNamespace(laddr=SimpleNamespace(ip="127.0.0.1", port=4313), pid=72, status="LISTEN")
        psutil = SimpleNamespace(Process=lambda _: process, net_connections=lambda kind: [listener])
        with patch.dict("sys.modules", {"psutil": psutil}):
            self.assertIs(owned_qa_backend(root, 4313), process)
            with self.assertRaises(AssertionError):
                owned_qa_backend(root, 4312)
            command[command.index("--port") + 1] = "4312"
            with self.assertRaisesRegex(AssertionError, "--port"):
                owned_qa_backend(root, 4313)


if __name__ == "__main__":
    unittest.main(verbosity=2)
