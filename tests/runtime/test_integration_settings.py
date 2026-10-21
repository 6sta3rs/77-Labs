"""Private integration configuration checks; no server, network or model load."""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import hashlib
import json
import os
from pathlib import Path
import tempfile
import types
import sys
import unittest
from unittest.mock import patch

import integration_settings as integrations


class IntegrationSettingsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="seventy-seven-integrations-")
        self.root = Path(self.temporary.name)
        self.data = self.root / "data"
        self.runtime = self.root / "runtime"
        self.engine = self.runtime / "engines/fixture"
        self.engine.mkdir(parents=True)

    def tearDown(self):
        self.temporary.cleanup()

    def test_defaults_are_disabled_and_read_does_not_create_data(self):
        self.assertEqual(integrations.read_settings(self.data), {"mcp_enabled": False, "mcp_output_mode": "files"})
        self.assertFalse(self.data.exists())

    def test_native_mcp_origin_is_exact_idempotent_and_keeps_host_protection(self):
        security = types.SimpleNamespace(enable_dns_rebinding_protection=True, allowed_hosts=["127.0.0.1:4312"], allowed_origins=["http://127.0.0.1:4310"])
        app = types.SimpleNamespace(state=types.SimpleNamespace(mcp_transport_security=security))
        self.assertTrue(integrations.configure_local_mcp_origin(app))
        self.assertTrue(integrations.configure_local_mcp_origin(app))
        self.assertEqual(security.allowed_origins, ["http://127.0.0.1:4310", "http://tauri.localhost"])
        self.assertEqual(security.allowed_hosts, ["127.0.0.1:4312"])
        self.assertTrue(security.enable_dns_rebinding_protection)

    def test_native_origin_hook_never_mounts_disabled_mcp_or_accepts_disabled_dns_guard(self):
        self.assertFalse(integrations.configure_local_mcp_origin(types.SimpleNamespace(state=types.SimpleNamespace())))
        security = types.SimpleNamespace(enable_dns_rebinding_protection=False, allowed_origins=[])
        with self.assertRaises(RuntimeError):
            integrations.configure_local_mcp_origin(types.SimpleNamespace(state=types.SimpleNamespace(mcp_transport_security=security)))
        self.assertEqual(security.allowed_origins, [])

    def test_explicit_save_roundtrip_is_private_and_does_not_change_running_flags(self):
        settings = {"mcp_enabled": True, "mcp_output_mode": "files"}
        with patch.dict(os.environ, {"OMNIVOICE_MCP_DISABLE": "1"}):
            integrations.save_settings(self.data, settings)
            self.assertEqual(os.environ["OMNIVOICE_MCP_DISABLE"], "1")
        self.assertEqual(integrations.read_settings(self.data), settings)
        self.assertEqual(list(self.data.iterdir()), [self.data / "integration-settings.json"])

    def test_extra_credentials_and_invalid_types_are_rejected_before_write(self):
        for value in ({"mcp_enabled": True, "mcp_output_mode": "files", "api_key": "dummy-not-a-real-key"},
                      {"mcp_enabled": "true", "mcp_output_mode": "files"},
                      {"mcp_enabled": True, "mcp_output_mode": ["files"]},
                      {"mcp_enabled": True, "mcp_output_mode": "remote"}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                integrations.save_settings(self.data, value)
        self.assertFalse(self.data.exists())

    def test_corrupt_file_disables_mcp_without_overwriting_file_or_starting_service(self):
        self.data.mkdir()
        path = self.data / "integration-settings.json"
        path.write_text('{"schema_version":1,"mcp_enabled":true,"mcp_output_mode":[]}', encoding="utf-8")
        original = path.read_bytes()
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(integrations.apply_environment(self.data)["mcp_enabled"])
            self.assertEqual(os.environ["OMNIVOICE_MCP_DISABLE"], "1")
            self.assertTrue(integrations.integration_state(self.data)["configuration_error"])
        self.assertEqual(path.read_bytes(), original)

    def test_environment_allows_only_loopback_and_no_host_file_base_or_remote_override(self):
        integrations.save_settings(self.data, {"mcp_enabled": True, "mcp_output_mode": "both"})
        with patch.dict(os.environ, {"OMNIVOICE_API_URL": "https://example.invalid", "OMNIVOICE_MCP_BASE_PATH": "C:/private", "OMNIVOICE_MCP_ALLOWED_HOSTS": "0.0.0.0:4312"}, clear=True):
            integrations.apply_environment(self.data)
            self.assertEqual(os.environ["OMNIVOICE_MCP_DISABLE"], "0")
            self.assertEqual(os.environ["OMNIVOICE_MCP_OUTPUT_MODE"], "both")
            self.assertEqual(os.environ["OMNIVOICE_API_URL"], "")
            self.assertEqual(os.environ["OMNIVOICE_MCP_BASE_PATH"], "")
            hosts = os.environ["OMNIVOICE_MCP_ALLOWED_HOSTS"].split(",")
            self.assertEqual(set(hosts), {"127.0.0.1:4312", "localhost:4312", "127.0.0.1:4310", "localhost:4310"})

    def test_pending_restart_and_mount_are_distinct_from_successful_protocol_test(self):
        integrations.save_settings(self.data, {"mcp_enabled": True, "mcp_output_mode": "files"})
        with patch.dict(os.environ, {"OMNIVOICE_MCP_DISABLE": "1"}, clear=True):
            pending = integrations.integration_state(self.data, mounted=False)
            self.assertTrue(pending["restart_required"])
            self.assertFalse(pending["effective"]["mounted"])
            integrations.apply_environment(self.data)
            effective = integrations.integration_state(self.data, mounted=True, session_task_active=True)
            self.assertFalse(effective["restart_required"])
            self.assertTrue(effective["effective"]["mounted"])
            self.assertNotIn("protocol_test_passed", effective)

    def test_diagnostic_evidence_matches_active_hash_and_omits_secrets_and_paths(self):
        archive = b"public engine fixture"
        digest = hashlib.sha256(archive).hexdigest()
        (self.runtime / "engine.zip").write_bytes(archive)
        (self.engine / "pyproject.toml").write_text("[project]\nversion='0.5.7'\n", encoding="utf-8")
        (self.engine / "LICENSE").write_text("fixture notice", encoding="utf-8")
        (self.runtime / "engine-provenance.json").write_text(json.dumps({"archiveSha256": digest, "commit": "f" * 40, "source": "C:/private/source"}), encoding="utf-8")
        with patch.dict(os.environ, {"OMNIVOICE_API_KEY": "dummy-private-key-never-output"}):
            evidence = integrations.source_info(self.runtime, self.engine)
        self.assertEqual(evidence["commit"], "f" * 40)
        self.assertEqual(evidence["archive_sha256"], digest)
        self.assertEqual(evidence["notices"], ["LICENSE"])
        text = json.dumps(evidence)
        self.assertNotIn("dummy-private-key-never-output", text)
        self.assertNotIn("C:/private/source", text)
        (self.runtime / "engine-provenance.json").write_text(json.dumps({"archiveSha256": "a" * 64, "commit": "f" * 40}), encoding="utf-8")
        self.assertIsNone(integrations.source_info(self.runtime, self.engine)["commit"])

    def test_runtime_identity_uses_pinned_source_without_editing_installed_distribution(self):
        pyproject = self.engine / "pyproject.toml"
        pyproject.write_text("[project]\nversion='0.5.7'\n", encoding="utf-8")
        core = types.ModuleType("core"); core.__path__ = []
        version_module = types.ModuleType("core.version"); version_module.APP_VERSION = "0.5.6"
        core.version = version_module
        with patch.dict(sys.modules, {"core": core, "core.version": version_module}), patch.object(integrations.distribution_metadata, "version", return_value="0.5.6"):
            self.assertEqual(integrations.use_source_version(self.engine), "0.5.7")
            self.assertEqual(version_module.APP_VERSION, "0.5.7")
            evidence = integrations.source_info(self.runtime, self.engine)
        self.assertEqual(evidence["sourceVersion"], "0.5.7")
        self.assertEqual(evidence["installedDistributionVersion"], "0.5.6")
        self.assertEqual(pyproject.read_text(encoding="utf-8"), "[project]\nversion='0.5.7'\n")

    def test_generate_features_require_actual_source_contract_not_a_version_number(self):
        route = self.engine / "backend/api/routers/generation.py"
        route.parent.mkdir(parents=True)
        route.write_text("async def generate_speech(text, wav_bits: Literal['16','24','32'] = Form('16'), preset_voice=None, design_recipe=None):\n    pass\n", encoding="utf-8")
        expected = {"wav_bits": ["16", "24", "32"], "preset_voice": True, "design_recipe": True}
        self.assertEqual(integrations.generate_capabilities(self.engine), expected)
        route.write_text("async def generate_speech(text):\n    pass\n", encoding="utf-8")
        self.assertEqual(integrations.generate_capabilities(self.engine), {"wav_bits": [], "preset_voice": False, "design_recipe": False})
        route.write_text("async def generate_speech(wav_bits: int = 16):\n    pass\n", encoding="utf-8")
        self.assertEqual(integrations.generate_capabilities(self.engine)["wav_bits"], [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
