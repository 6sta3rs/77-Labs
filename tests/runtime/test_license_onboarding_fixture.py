"""Own ephemeral fixture HTTP only; no product backend, browser or models."""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

from concurrent.futures import ThreadPoolExecutor
import http.client
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from license_onboarding_fixture import FixtureServer, FixtureState, OMNI, TOKENIZER, fingerprint


class OnboardingFixtureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="seventy-seven-onboarding-fixture-")
        self.dist = Path(self.temp.name) / "dist"
        self.dist.mkdir()
        (self.dist / "index.html").write_text('<html lang="pl"><body>Własny pusty fixture</body></html>', encoding="utf-8")
        (self.dist / "asset.js").write_text("/* TESTFIXTURE */", encoding="utf-8")
        self.server = FixtureServer(self.dist)
        self.thread = threading.Thread(target=lambda: self.server.serve_forever(poll_interval=.01), daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp.cleanup()

    def http(self, path, body=None, *, method=None, headers=None):
        options = {"Content-Type": "application/json", "X-VoiceStudio-CSRF": "1", **(headers or {})}
        request = Request(self.url + path, json.dumps(body).encode() if body is not None else None, options, method=method)
        try:
            response = urlopen(request, timeout=2)
        except HTTPError as error:
            response = error
        with response:
            raw = response.read().decode()
            data = json.loads(raw) if "application/json" in response.headers.get("Content-Type", "") else raw
            return response.status, data

    def control(self, scenario, **kwargs):
        status, state = self.http("/__fixture/control", {"scenario": scenario, **kwargs})
        self.assertEqual(status, 200)
        return state

    def details(self, repo=OMNI):
        status, details = self.http("/backend/models/licenses/details/" + quote(repo, safe=""))
        self.assertEqual(status, 200)
        return details

    def accept(self, repo=OMNI, **body):
        return self.http("/backend/models/licenses/accept", {"repo_id": repo, "fingerprint": self.details(repo)["acceptance"]["fingerprint"], "accepted": True, **body})

    def test_none_get_plan_and_details_do_not_accept_any_model(self):
        status, plan = self.http("/backend/next/models/onboarding")
        self.assertEqual(status, 200)
        self.assertEqual(plan["schema"], 1)
        self.assertEqual(plan["engine"]["id"], "omnivoice")
        self.assertEqual([row["repo_id"] for row in plan["models"]], [OMNI, TOKENIZER])
        self.assertTrue(all(not row["accepted"] and row["required"] for row in plan["models"]))
        self.assertIn("TESTFIXTURE", plan["source"])
        for repo in (OMNI, TOKENIZER):
            details = self.details(repo)
            self.assertEqual(details["history"], [])
            self.assertIn("TESTFIXTURE", details["info"]["license"])
            self.assertIn("TESTFIXTURE", details["info"]["source_url"])
        self.assertEqual(self.server.state.records, {})

    def test_one_explicit_acceptance_only_changes_one_model(self):
        self.assertEqual(self.accept()[0], 200)
        self.assertTrue(self.details()["acceptance"]["accepted"])
        self.assertFalse(self.details(TOKENIZER)["acceptance"]["accepted"])
        self.assertEqual(len(self.details()["history"]), 1)

    def test_fully_accepted_remains_fixture_and_does_not_claim_models_loaded(self):
        self.control("both")
        status, plan = self.http("/backend/next/models/onboarding")
        self.assertTrue(all(row["accepted"] for row in plan["models"]))
        self.assertEqual(status, 200)
        self.assertEqual(self.http("/backend/model/status")[1]["loaded"], False)
        self.assertFalse(self.http("/backend/engines")[1]["tts"]["backends"][0]["inference_verified"])

    def test_postpone_and_reload_equivalent_reads_remain_unaccepted_and_read_only(self):
        for _ in range(3):
            self.http("/")
            self.http("/backend/health")
            self.http("/backend/next/models/onboarding")
        state = self.http("/__fixture/state")[1]
        self.assertTrue(all(not model["accepted"] for model in state["models"]))
        self.assertTrue(all(call["method"] == "GET" for call in state["requests"]))

    def test_changed_fingerprint_rejects_stale_acceptance_without_overwriting_history(self):
        self.control("both")
        old = self.details()["acceptance"]["fingerprint"]
        self.control("changed")
        details = self.details()
        self.assertEqual(details["acceptance"]["state"], "terms_updated")
        self.assertNotEqual(old, details["acceptance"]["fingerprint"])
        status, body = self.http("/backend/models/licenses/accept", {"repo_id": OMNI, "fingerprint": old, "accepted": True})
        self.assertEqual((status, body["detail"]["code"]), (409, "terms_changed"))
        self.assertEqual(len(self.details()["history"]), 1)

    def test_revoke_is_separate_and_does_not_change_dependency(self):
        self.control("both")
        status, state = self.http("/backend/models/licenses/revoke", {"repo_id": OMNI})
        self.assertEqual(status, 200)
        self.assertEqual(state["state"], "withdrawn")
        self.assertTrue(self.details(TOKENIZER)["acceptance"]["accepted"])
        self.assertEqual(len(self.details()["history"]), 2)

    def test_legacy_056_and_stopped_do_not_imply_empty_complete_plan_or_accept(self):
        self.control("legacy056")
        self.assertEqual(self.http("/backend/health")[1]["version"], "0.5.6")
        for path in ("/backend/next/models/onboarding", "/backend/models/licenses/details/" + quote(OMNI, safe="")):
            self.assertEqual(self.http(path)[0], 404)
        self.assertEqual(self.http("/backend/models/licenses/accept", {"repo_id": OMNI})[0], 404)
        self.assertEqual(self.server.state.records, {})
        self.control("stopped")
        self.assertEqual(self.http("/backend/health")[0], 503)
        self.assertEqual(self.http("/backend/next/models/onboarding")[0], 503)
        self.assertEqual(self.server.state.records, {})

    def test_offline_drops_only_fixture_api_connection_control_and_static_remain_reachable(self):
        self.control("offline")
        with self.assertRaises((http.client.RemoteDisconnected, ConnectionError, OSError)):
            self.http("/backend/health")
        self.assertEqual(self.http("/__fixture/state")[0], 200)
        self.assertIn("TESTFIXTURE", self.http("/")[1])

    def test_no_global_accept_unconfirmed_or_unexpected_mutation_is_available(self):
        self.assertEqual(self.accept(accepted=False)[0], 400)
        for path, body in (("/generate", {}), ("/next/models/install", {"repo_id": OMNI}), ("/models/licenses/accept-all", {}), ("/models/licenses/accept", {"repo_id": "other/model", "accepted": True})):
            self.assertIn(self.http("/backend" + path, body)[0], (400, 405))
        self.assertEqual(self.server.state.records, {})

    def test_local_csrf_and_host_guards_reject_cross_origin(self):
        self.assertEqual(self.http("/__fixture/control", {"scenario": "both"}, headers={"Origin": "https://example.invalid"})[0], 403)
        self.assertEqual(self.http("/__fixture/control", {"scenario": "both"}, headers={"X-VoiceStudio-CSRF": "0"})[0], 403)
        self.assertEqual(self.http("/__fixture/state", headers={"Host": "example.invalid"})[0], 403)
        self.assertEqual(self.server.state.records, {})

    def test_delayed_get_returns_original_snapshot_without_blocking_control(self):
        self.control("none", details_delay_ms=150)
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(self.details)
            for _ in range(100):
                if any(call["path"].startswith("/models/licenses/details/") for call in self.server.state.snapshot()["requests"]):
                    break
                time.sleep(.002)
            self.control("both")
            self.assertFalse(pending.result(timeout=2)["acceptance"]["accepted"])
        self.assertTrue(self.details()["acceptance"]["accepted"])

    def test_delayed_onboarding_plan_retains_its_original_generation_for_close_reopen_race(self):
        self.control("none", details_delay_ms=150)
        path = "/backend/next/models/onboarding"
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(lambda: self.http(path))
            for _ in range(100):
                if any(call["path"] == "/next/models/onboarding" for call in self.server.state.snapshot()["requests"]):
                    break
                time.sleep(.002)
            self.control("both")
            status, old_plan = pending.result(timeout=2)
            self.assertEqual(status, 200)
            self.assertTrue(all(not model["accepted"] for model in old_plan["models"]))
        self.assertTrue(all(model["accepted"] for model in self.http(path)[1]["models"]))

    def test_delayed_post_cannot_modify_a_reset_fixture_generation(self):
        self.control("none", decision_delay_ms=150)
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(lambda: self.http("/backend/models/licenses/accept", {"repo_id": OMNI, "fingerprint": fingerprint(OMNI, 1), "accepted": True}))
            for _ in range(100):
                if any(call["method"] == "POST" for call in self.server.state.snapshot()["requests"]):
                    break
                time.sleep(.002)
            self.control("none")
            self.assertEqual(pending.result(timeout=2)[0], 409)
        self.assertEqual(self.server.state.records, {})

    def test_static_scope_banner_and_ram_isolation(self):
        original = (self.dist / "index.html").read_bytes()
        self.assertIn("TESTFIXTURE", self.http("/")[1])
        self.assertEqual((self.dist / "index.html").read_bytes(), original)
        self.assertEqual(self.http("/asset.js")[0], 200)
        for path in ("/../private.json", "/%2e%2e/private.json", "/.env", "/directory/"):
            self.assertEqual(self.http(path)[0], 404)
        self.accept()
        self.assertEqual(FixtureState().records, {})
        self.assertEqual(self.server.state.snapshot()["real_backend_requests"], 0)

    def test_invalid_control_delay_and_repository_do_not_change_state(self):
        for data in ({"scenario": "unknown"}, {"scenario": "both", "delay_ms": 5001}, {"scenario": "both", "delay_ms": True}):
            self.assertEqual(self.http("/__fixture/control", data)[0], 400)
        self.assertEqual(self.http("/backend/models/licenses/details/other%2Fmodel")[0], 404)
        self.assertEqual(self.server.state.records, {})


if __name__ == "__main__":
    unittest.main(verbosity=2)
