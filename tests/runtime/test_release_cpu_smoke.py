"""Fixture-only release/ready-continuation guards. No EXE, ML, Win32 or HTTP."""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import asyncio
import json
import os
import subprocess
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import AsyncMock, patch
import zipfile

import release_cpu_smoke as smoke

FROZEN_COMMIT = "a" * 40
FROZEN_DEBUG_SHA = "b" * 64


class ReleaseCpuSmokeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="seventy-seven-cpu-install-fixture-")
        self.session = Path(self.temp.name).resolve()
        self.appbase = self.session / "local/VoiceStudioNext"
        self.candidate = self.appbase / "runtime_ab12cd34"
        for directory in (self.candidate, self.session / "roaming", self.session / "webview2", self.session / "empty-models", self.candidate / "doctor-models"):
            directory.mkdir(parents=True, exist_ok=True)
        self.session_id = "1" * 32
        self.report_path = self.session / "cpu-receipt.json"
        self.debug_receipt = self.session / "frozen-debug.json"
        self.manifest_path = self.session / "expected-manifest.json"
        self.write(self.session / ".qa-owner.json", {"owner": smoke.CPU_OWNER, "id": self.session_id, "exe_sha256": FROZEN_DEBUG_SHA})
        self.write(self.session / ".webview-profile-owner.json", {"schema": 1, "owner": "Seventy Seven Labs QA WebView2 profile v1", "profile": str(self.session / "webview2")})
        self.write(self.candidate / ".installer-owner.json", {"owner": "Seventy Seven Labs runtime installer v1", "id": self.candidate.name})
        bootstrap = (smoke.ROOT / "scripts/runtime/install/bootstrap.py").read_bytes()
        (self.candidate / "bootstrap.py").write_bytes(bootstrap)
        for relative, content in (("engine.zip", b"fixture archive not executed"), ("engine/uv.lock", b"fixture lock"), ("engine/pyproject.toml", b"fixture project"), (".venv/Scripts/python.exe", b"fixture not executable"), ("tools/uv.exe", b"fixture uv not executable")):
            path = self.candidate / relative
            path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(content)
        (self.candidate / "downloads").mkdir()
        with zipfile.ZipFile(self.candidate / "downloads/uv.zip", "w") as archive:
            archive.writestr("fixture/uv.exe", b"fixture uv not executable")
        self.certificate = {"cpuWheels": {"torch": {"version": "2.8.0+cpu"}}, "engine": {
            "archiveSha256": smoke.sha(self.candidate / "engine.zip"), "lockSha256": smoke.sha(self.candidate / "engine/uv.lock"),
            "pyprojectSha256": smoke.sha(self.candidate / "engine/pyproject.toml")}, "uv": {"sha256": smoke.sha(self.candidate / "downloads/uv.zip")}}
        self.write(self.manifest_path, self.certificate)
        self.write(self.candidate / "bootstrap-provenance.json", self.certificate)
        self.write(self.candidate / "python-ready.json", {"independent": True, "python": str(self.candidate / ".venv/Scripts/python.exe")})
        self.write(self.candidate / "model-cache.json", {"path": str(self.session / "empty-models"), "owner": smoke.CPU_OWNER})
        self.write(self.appbase / "active-runtime.json", {"schema": 1, "id": self.candidate.name})
        self.ready = {"python": "3.11.14", "profile": "cpu", "imports": "passed", "mcp_sdk": "passed", "pywin32": "passed", "cuda": None,
            "cuda_available": False, "torch": "2.8.0+cpu", "synthesize_tested": False,
            "health": {"status": 200, "owned": True, "isolatedData": True, "modelsLoaded": False},
            "source_archive_sha256": self.certificate["engine"]["archiveSha256"], "lock_sha256": self.certificate["engine"]["lockSha256"]}
        self.write(self.candidate / "installation-ready.json", self.ready)
        self.write(self.debug_receipt, {"sourceCommit": FROZEN_COMMIT, "profile": "debug/custom-protocol", "sourceClean": True,
            "sha256": FROZEN_DEBUG_SHA, "embeddedSourceSha256": {"bootstrap.py": smoke.sha(self.candidate / "bootstrap.py")}, "embeddedSourceCanonicalSha256": {"bootstrap.py": smoke.canonical_python_sha(self.candidate / "bootstrap.py")}})
        self.receipt = {"passed": True, "profile": "cpu", "expected_source_version": "0.5.7", "guards_unchanged": True, "cleanup_errors": [],
            "session": str(self.session), "session_id": self.session_id, "candidate": self.candidate.name, "exe_sha256": FROZEN_DEBUG_SHA,
            "ready_evidence": self.ready, "checks": [{"name": name, "passed": True} for name in sorted(smoke.REQUIRED_CPU_CHECKS)]}
        self.write(self.report_path, self.receipt)

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def write(path, data):
        path.write_text(json.dumps(data), encoding="utf-8")

    def validate(self, **kwargs):
        return smoke.validate_cpu_receipt(self.report_path, debug_receipt=self.debug_receipt, manifest_path=self.manifest_path, **kwargs)

    def continuation_receipt(self):
        self.receipt.update(passed=False, error="Nie potwierdzono zatrzymania własnego backendu.", ready_evidence=None,
                            checks=[{"name": name, "passed": True} for name in sorted(smoke.READY_CPU_CHECKS)])
        self.write(self.report_path, self.receipt)

    def test_completed_own_receipt_and_crlf_equivalent_bootstrap_are_accepted_read_only(self):
        before = self.report_path.read_bytes()
        self.assertEqual(self.validate()["candidate"], self.candidate)
        bootstrap = self.candidate / "bootstrap.py"
        bootstrap.write_bytes(bootstrap.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))
        self.assertEqual(self.validate()["candidate"], self.candidate)
        self.assertEqual(self.report_path.read_bytes(), before)

    def test_failed_release_receipt_is_rejected_before_session_inspection(self):
        self.receipt.update(passed=False, session=str(self.session / "foreign"))
        self.write(self.report_path, self.receipt)
        with patch("release_cpu_smoke.sandbox_parent", side_effect=AssertionError("foreign path was inspected")), self.assertRaisesRegex(AssertionError, "passed=true"):
            self.validate()

    def test_continuation_is_separate_and_requires_all_29_positive_checks_and_exact_failure(self):
        self.continuation_receipt()
        original = self.report_path.read_bytes()
        self.assertEqual(self.validate(ready_continuation=True)["candidate"], self.candidate)
        self.assertEqual(self.report_path.read_bytes(), original)
        with self.assertRaisesRegex(AssertionError, "passed=true"):
            self.validate()
        self.receipt["checks"].pop(); self.write(self.report_path, self.receipt)
        with self.assertRaises(AssertionError):
            self.validate(ready_continuation=True)
        self.continuation_receipt(); self.receipt["error"] = "other failure"; self.write(self.report_path, self.receipt)
        with self.assertRaisesRegex(AssertionError, "wyłącznie"):
            self.validate(ready_continuation=True)

    def test_release_accepts_only_passed_continuation_chain_without_rewriting_original_red(self):
        self.continuation_receipt()
        original = self.report_path.read_bytes()
        names = {f"cycle_{cycle}_{name}" for cycle in (1, 2) for name in (
            "private_python_source", "owned_health_057", "no_models_or_work", "ui_stop_confirmed", "main_closed_gracefully", "own_tree_and_port_drained")}
        names |= {"final_own_processes_and_port_drained", "empty_own_model_caches_preserved", "selection_and_installation_evidence_unchanged", "cpu_install_receipt_unchanged"}
        continued = {"kind": "ready_candidate_continuation_not_fresh_install", "passed": True, "cleanup_errors": [], "session": str(self.session),
            "source_commit": FROZEN_COMMIT, "exe_sha256": FROZEN_DEBUG_SHA, "build_provenance_path": str(self.debug_receipt), "build_provenance_sha256": smoke.sha(self.debug_receipt), "source_cpu_report": str(self.report_path),
            "cpu_report_sha256": smoke.sha(self.report_path), "candidate": self.candidate.name, "ready_evidence": self.ready,
            "checks": [{"name": name, "passed": True} for name in sorted(names)],
            "stop_evidence": [{"via_ui": True, "first_attempt": True, "budget_seconds": 10, "elapsed_seconds": .25} for _ in range(2)]}
        path = self.session / "separate-continuation.json"
        self.write(path, continued)
        context = smoke.validate_cpu_receipt(path, debug_receipt=self.debug_receipt, manifest_path=self.manifest_path)
        self.assertEqual(context["candidate"], self.candidate)
        self.assertFalse(context["cpu_report"]["passed"])
        self.assertEqual(context["passed_continuation_receipt"]["scope"], continued["kind"])
        self.assertEqual(self.report_path.read_bytes(), original)
        continued["passed"] = False; self.write(path, continued)
        with self.assertRaises(AssertionError):
            smoke.validate_cpu_receipt(path, debug_receipt=self.debug_receipt, manifest_path=self.manifest_path)

    def test_owner_debug_version_and_candidate_escape_are_refused(self):
        self.write(self.session / ".qa-owner.json", {"owner": "foreign"})
        with self.assertRaisesRegex(AssertionError, "Znacznik"):
            self.validate()
        self.write(self.session / ".qa-owner.json", {"owner": smoke.CPU_OWNER, "id": self.session_id, "exe_sha256": FROZEN_DEBUG_SHA})
        self.receipt["exe_sha256"] = "0" * 64; self.write(self.report_path, self.receipt)
        with self.assertRaises(AssertionError):
            self.validate()
        self.receipt["exe_sha256"] = FROZEN_DEBUG_SHA
        self.receipt["candidate"] = "../foreign"; self.write(self.report_path, self.receipt)
        with self.assertRaisesRegex(AssertionError, "identyfikator"):
            self.validate()

    def test_foreign_cache_and_missing_doctor_sdk_are_refused_without_fetch(self):
        self.write(self.candidate / "model-cache.json", {"path": str(self.session / "foreign-cache"), "owner": smoke.CPU_OWNER})
        with self.assertRaisesRegex(AssertionError, "Cache kandydata"):
            self.validate()
        self.assertFalse((self.session / "foreign-cache").exists())
        self.write(self.candidate / "model-cache.json", {"path": str(self.session / "empty-models"), "owner": smoke.CPU_OWNER})
        self.continuation_receipt()
        self.ready.pop("mcp_sdk"); self.write(self.candidate / "installation-ready.json", self.ready)
        with self.assertRaisesRegex(AssertionError, "doctora"):
            self.validate(ready_continuation=True)

    def test_nonempty_cache_and_changed_bootstrap_code_are_refused(self):
        (self.session / "empty-models/model.onnx").write_bytes(b"fixture weights never loaded")
        with self.assertRaisesRegex(AssertionError, "cache zawiera"):
            self.validate()
        (self.session / "empty-models/model.onnx").unlink()
        with (self.candidate / "bootstrap.py").open("ab") as source:
            source.write(b"\n# different code receipt\n")
        with self.assertRaisesRegex(AssertionError, "bootstrap z provenance"):
            self.validate()

    def test_existing_logs_are_never_reused(self):
        (self.session / "exe-3.log").write_text("keep")
        (self.session / "webview-profile-preflight-4.json").write_text("keep")
        self.assertEqual(smoke.next_log_number(self.session), 5)

    def test_only_bounded_owned_xet_logs_are_preserved_as_diagnostics(self):
        cache = self.session / "empty-models"
        logs = cache / "xet/logs"; logs.mkdir(parents=True)
        log = logs / "fixture.log"; log.write_bytes(b"x" * 420)
        evidence = smoke.empty_owned_cache(cache)
        self.assertEqual(evidence, {"model_or_config_files": 0, "preserved_xet_diagnostic_logs": 1, "diagnostic_bytes": 420})
        self.assertEqual(log.stat().st_size, 420)
        log.write_bytes(b"x" * (1024 ** 2 + 1))
        with self.assertRaises(AssertionError):
            smoke.empty_owned_cache(cache)

    def test_future_build_provenance_injects_commit_and_sha_without_old_constants(self):
        path = self.session / "new-build.json"
        value = {"sourceCommit": "c" * 40, "sha256": "d" * 64, "sourceClean": True, "profile": "debug/custom-protocol"}
        self.write(path, value)
        self.assertEqual(smoke.build_provenance(path), value)
        with patch("release_cpu_smoke.subprocess.check_output", return_value=b"fixture\r\n") as git:
            self.assertEqual(smoke.bootstrap_expected_sha(value), __import__('hashlib').sha256(b"fixture\n").hexdigest())
            self.assertEqual(git.call_args.args[0], ["git", "show", "c" * 40 + ":scripts/runtime/install/bootstrap.py"])
        value["sourceClean"] = False; self.write(path, value)
        with self.assertRaises(AssertionError):
            smoke.build_provenance(path)

    def test_historical_bootstrap_proof_uses_the_original_committed_path(self):
        value = {"sourceCommit": "c" * 40}
        missing = subprocess.CalledProcessError(128, ["git", "show"])
        with patch("release_cpu_smoke.subprocess.check_output", side_effect=[missing, b"fixture\r\n"]) as git:
            self.assertEqual(smoke.bootstrap_expected_sha(value), __import__('hashlib').sha256(b"fixture\n").hexdigest())
            paths = [call.args[0][-1] for call in git.call_args_list]
            self.assertEqual(paths, ["c" * 40 + ":scripts/runtime/install/bootstrap.py", "c" * 40 + ":scripts/runtime/bootstrap.py"])

    def test_old_process_check_refuses_product_or_same_session_and_keeps_foreign_webview(self):
        product = SimpleNamespace(info={"name": "seventy-seven-labs.exe"})
        python = SimpleNamespace(info={"name": "python.exe"}, cmdline=lambda: [str(self.candidate / "launcher.py")])
        foreign = SimpleNamespace(info={"name": "msedgewebview2.exe"}, cmdline=lambda: ["--user-data-dir=C:/unrelated-not-read"])
        module = SimpleNamespace(process_iter=lambda attrs: [foreign], NoSuchProcess=ProcessLookupError, AccessDenied=PermissionError)
        with patch.dict("sys.modules", {"psutil": module}):
            smoke.no_old_processes(self.session)
            for process in (product, python):
                module.process_iter = lambda attrs: [process]
                with self.assertRaises(AssertionError):
                    smoke.no_old_processes(self.session)

    def test_ipv6_listener_is_refused_even_when_ipv4_connect_probe_is_free(self):
        listener = SimpleNamespace(laddr=SimpleNamespace(ip="::1", port=4312), status="LISTEN")
        module = SimpleNamespace(net_connections=lambda kind: [listener])
        with patch.dict("sys.modules", {"psutil": module}), patch("release_cpu_smoke.assert_port_free"), self.assertRaisesRegex(AssertionError, "IPv4/IPv6"):
            smoke.runtime_port_available()

    def test_exact_stop_error_is_retained_in_continuation_evidence(self):
        report = {}
        async def scenario():
            with patch("release_cpu_smoke.ipc", new=AsyncMock(return_value={"ok": False, "error": "fixture exact native stop error"})):
                with self.assertRaisesRegex(RuntimeError, "fixture exact native stop error"):
                    await smoke.stop_with_evidence(SimpleNamespace(), report, via_ui=False)
        asyncio.run(scenario())
        self.assertEqual(report["stop_evidence"][0]["native_responses"][0]["error"], "fixture exact native stop error")
        self.assertIn("elapsed_seconds", report["stop_evidence"][0])

    def test_stop_first_attempt_budget_is_strictly_below_10s_not_diagnostic_30s(self):
        for elapsed, passes in ((9.99, True), (10, False), (12, False)):
            with self.subTest(elapsed=elapsed):
                report = {}
                async def scenario():
                    response = {"ok": True, "value": {"state": "stopped"}}
                    with patch("release_cpu_smoke.ipc", new=AsyncMock(return_value=response)), patch("release_cpu_smoke.time.perf_counter", side_effect=[100, 100 + elapsed]):
                        if passes:
                            await smoke.stop_with_evidence(SimpleNamespace(), report, via_ui=False)
                        else:
                            with self.assertRaisesRegex(RuntimeError, "poniżej 10 s"):
                                await smoke.stop_with_evidence(SimpleNamespace(), report, via_ui=False)
                asyncio.run(scenario())
                evidence = report["stop_evidence"][0]
                self.assertAlmostEqual(evidence["elapsed_seconds"], elapsed)
                self.assertTrue(evidence["first_attempt"])
                self.assertEqual(evidence["budget_seconds"], 10)
                self.assertEqual(evidence["diagnostic_budget_seconds"], 30)
                self.assertEqual(report["checks"][-1]["passed"], passes)

    def test_historical_stop_transport_imports_after_provenance_refactor(self):
        import runtime_stop_diagnosis as diagnosis
        self.assertEqual(diagnosis.canonical_python_sha, smoke.canonical_python_sha)
        self.assertIsInstance(diagnosis.TRANSPORT_LOGGER, str)
        self.assertIn("__qaRuntimeCalls", diagnosis.TRANSPORT_LOGGER)

    def test_ui_stop_requires_rendered_stopped_and_enabled_start_without_exact_fallback_response(self):
        report, results = {}, []
        states = [
            {"label": "Uruchamianie", "start_enabled": False, "stop_enabled": False},
            {"label": "Zatrzymany", "start_enabled": False, "stop_enabled": False},
            {"label": "Zatrzymany", "start_enabled": True, "stop_enabled": True},
            {"label": "Zatrzymany", "start_enabled": True, "stop_enabled": False},
        ]
        card = SimpleNamespace(evaluate=AsyncMock(side_effect=states), get_by_role=lambda *args, **kwargs: SimpleNamespace(click=AsyncMock()))
        fallback = [{"pending": True, "transport": "postMessage", "exact_response_observed": False}]
        page = SimpleNamespace(locator=lambda selector: card, evaluate=AsyncMock(return_value=fallback))
        async def fixture_wait(predicate, *args):
            for _ in states:
                results.append(await predicate())
            self.assertEqual(results, [False, False, False, True])
        async def scenario():
            with patch("release_cpu_smoke.capture_stop_responses", new=AsyncMock(return_value={"runtime_status_observed": True})), \
                 patch("release_cpu_smoke.ipc", new=AsyncMock(return_value={"ok": True, "value": {"state": "stopped"}})), \
                 patch("release_cpu_smoke.wait_for", new=fixture_wait), \
                 patch("release_cpu_smoke.time.perf_counter", side_effect=[100, 100.5]):
                await smoke.stop_with_evidence(page, report, via_ui=True)
        asyncio.run(scenario())
        evidence = report["stop_evidence"][0]
        self.assertTrue(evidence["ui_stop_rendered"])
        self.assertTrue(evidence["ui"]["start_enabled"])
        self.assertFalse(evidence["exact_response_observed"])
        self.assertTrue(evidence["within_budget"])

    def test_observed_native_error_refuses_ui_stop_even_if_runtime_is_stopped(self):
        report = {}
        card = SimpleNamespace(evaluate=AsyncMock(), get_by_role=lambda *args, **kwargs: SimpleNamespace(click=AsyncMock()))
        page = SimpleNamespace(locator=lambda selector: card, evaluate=AsyncMock(return_value=[{
            "pending": False, "exact_response_observed": True, "ok": False, "error": "native denial fixture"}]))
        async def scenario():
            with patch("release_cpu_smoke.capture_stop_responses", new=AsyncMock(return_value={"runtime_status_observed": True})), \
                 patch("release_cpu_smoke.ipc", new=AsyncMock(return_value={"ok": True, "value": {"state": "stopped"}})):
                with self.assertRaisesRegex(RuntimeError, "native denial fixture"):
                    await smoke.stop_with_evidence(page, report, via_ui=True)
        asyncio.run(scenario())
        self.assertTrue(report["stop_evidence"][0]["exact_response_observed"])
        card.evaluate.assert_not_awaited()


if __name__ == "__main__":
    unittest.main(verbosity=2)
