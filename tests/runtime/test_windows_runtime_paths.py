"""Read-only bootstrap checks. No model imports, downloads or user data."""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import windows_runtime_paths as subject


class WindowsRuntimePathsTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "Windows interpreter-local bootstrap")
    def test_known_private_paths_are_added_once_without_evaluating_pth(self):
        with tempfile.TemporaryDirectory(prefix="seventy-seven-win32-paths-") as temporary:
            root = Path(temporary)
            site = root / "Lib/site-packages"
            for relative in ("win32/lib", "Pythonwin", "pywin32_system32"):
                (site / relative).mkdir(parents=True)
            (site / "untrusted.pth").write_text("import this_must_never_execute", encoding="utf-8")
            original = list(sys.path)
            handles = {}
            try:
                with patch.object(subject, "_DLL_HANDLES", handles), patch.object(subject.os, "add_dll_directory", return_value=object()) as add_dll:
                    first = subject.configure_windows_runtime_paths(root)
                    self.assertEqual(len(first["paths_added"]), 3)
                    self.assertTrue(first["dll_directory_added"])
                    self.assertTrue(all(Path(path).is_relative_to(root) for path in first["paths_added"]))
                    self.assertEqual(subject.configure_windows_runtime_paths(root), {"paths_added": [], "dll_directory_added": False})
                    add_dll.assert_called_once()
                    self.assertNotIn("this_must_never_execute", sys.modules)
            finally:
                sys.path[:] = original

    @unittest.skipUnless(os.name == "nt", "Windows junction boundary")
    def test_interpreter_dependency_junction_is_rejected_without_reading_it(self):
        with tempfile.TemporaryDirectory(prefix="seventy-seven-win32-boundary-") as temporary:
            root = Path(temporary)
            site = root / "venv/Lib/site-packages"; site.mkdir(parents=True)
            outside = root / "outside"; outside.mkdir()
            link = site / "win32"
            created = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(outside)], capture_output=True)
            self.assertEqual(created.returncode, 0)
            try:
                with self.assertRaises(RuntimeError): subject.configure_windows_runtime_paths(root / "venv")
            finally:
                link.rmdir()

    @unittest.skipUnless(os.name == "nt", "Real installed Windows MCP dependency import")
    def test_real_private_mcp_import_succeeds_without_importing_ml_or_changing_packages(self):
        self.assertIn(".venv", Path(sys.executable).parts)
        script = "\n".join([
            "import sys,json,hashlib",
            "from pathlib import Path",
            f"sys.path.insert(0,{str(Path(subject.__file__).parent)!r})",
            "import windows_runtime_paths",
            "root=Path(sys.prefix)/'Lib/site-packages'",
            "files=[root/'win32/lib/pywintypes.py',root/'pywin32_system32/pywintypes311.dll']",
            "hashes=lambda:[hashlib.sha256(path.read_bytes()).hexdigest() for path in files]",
            "before=hashes()",
            "windows_runtime_paths.configure_windows_runtime_paths()",
            "from mcp.server.fastmcp import FastMCP",
            "import pywintypes",
            "assert hashes()==before",
            "assert 'torch' not in sys.modules and 'numpy' not in sys.modules",
            "print(json.dumps(dict(mcp_import=True,pywintypes=Path(pywintypes.__file__).name,packages_unchanged=True,ml_imported=False)))",
        ])
        result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=30,
                                env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONUTF8="1"),
                                creationflags=0x08000000)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)["packages_unchanged"])

    @unittest.skipUnless(os.name == "nt", "Real SDK transport guard")
    def test_real_mcp_guard_accepts_only_exact_native_origin_and_rejects_external_origin(self):
        script = "\n".join([
            "import sys,asyncio",
            f"sys.path.insert(0,{str(Path(subject.__file__).parent)!r})",
            "from windows_runtime_paths import configure_windows_runtime_paths",
            "configure_windows_runtime_paths()",
            "from integration_settings import configure_local_mcp_origin",
            "from mcp.server.transport_security import TransportSecuritySettings,TransportSecurityMiddleware",
            "from starlette.requests import HTTPConnection",
            "from types import SimpleNamespace",
            "security=TransportSecuritySettings(enable_dns_rebinding_protection=True,allowed_hosts=['127.0.0.1:4312'],allowed_origins=['http://127.0.0.1:4310'])",
            "app=SimpleNamespace(state=SimpleNamespace(mcp_transport_security=security))",
            "configure_local_mcp_origin(app)",
            "guard=TransportSecurityMiddleware(security)",
            "def validate(origin):",
            " request=HTTPConnection(dict(type='http',headers=[(b'host',b'127.0.0.1:4312'),(b'origin',origin.encode()),(b'content-type',b'application/json')]))",
            " return asyncio.run(guard.validate_request(request,is_post=True))",
            "assert validate('http://tauri.localhost') is None",
            "assert validate('https://external.example').status_code==403",
            "assert validate('http://tauri.localhost.external.example').status_code==403",
            "assert security.enable_dns_rebinding_protection",
            "assert security.allowed_hosts==['127.0.0.1:4312']",
            "assert 'torch' not in sys.modules and 'numpy' not in sys.modules",
        ])
        result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=30,
                                env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONUTF8="1"), creationflags=0x08000000)
        self.assertEqual(result.returncode, 0, result.stderr)

    @unittest.skipUnless(os.name == "nt", "Real deferred-mount SDK transport guard")
    def test_native_origin_hook_handles_mcp_security_created_after_backend_import(self):
        script = "\n".join([
            "import sys",
            f"sys.path.insert(0,{str(Path(subject.__file__).parent)!r})",
            "from windows_runtime_paths import configure_windows_runtime_paths",
            "configure_windows_runtime_paths()",
            "from integration_settings import configure_local_mcp_origin",
            "from mcp.server.transport_security import TransportSecuritySettings,TransportSecurityMiddleware",
            "from fastapi import FastAPI,Request",
            "from fastapi.testclient import TestClient",
            "app=FastAPI()",
            "configure_local_mcp_origin(app)",
            "security=TransportSecuritySettings(enable_dns_rebinding_protection=True,allowed_hosts=['127.0.0.1:4312'],allowed_origins=['http://127.0.0.1:4310'])",
            "app.state.mcp_transport_security=security",
            "guard=TransportSecurityMiddleware(security)",
            "@app.post('/mcp')",
            "async def endpoint(request:Request):",
            " result=await guard.validate_request(request,is_post=True)",
            " return result if result is not None else {'ready':True}",
            "with TestClient(app) as client:",
            " native=client.post('/mcp',json={},headers={'Host':'127.0.0.1:4312','Origin':'http://tauri.localhost'})",
            " assert native.status_code==200,(native.status_code,native.text)",
            " external=client.post('/mcp',json={},headers={'Host':'127.0.0.1:4312','Origin':'https://external.example'})",
            " assert external.status_code==403",
            "assert security.enable_dns_rebinding_protection and security.allowed_hosts==['127.0.0.1:4312']",
            "assert 'torch' not in sys.modules and 'numpy' not in sys.modules",
        ])
        result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=30,
                                env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONUTF8="1"), creationflags=0x08000000)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__": unittest.main(verbosity=2)
