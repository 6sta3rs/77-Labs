"""Copy-only native publication, with a real Windows no-delete-sharing handle."""
import ctypes
from ctypes import wintypes
import hashlib
import os
from pathlib import Path
import shutil
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import engine_installation as engines

ROOT = Path(__file__).resolve().parents[2]


class NativePublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="seventy-seven-native-copy-")
        self.root = Path(self.temp.name)
        self.attempt = self.root / ("a" * 32)
        self.attempt.mkdir()
        self.source = self.attempt / "prepared"
        self.source.mkdir()
        (self.source / "audiocpp_server.exe").write_bytes(b"fixture only, never executable")
        (self.source / "audiocpp_cli.exe").write_bytes(b"fixture CLI")
        (self.source / "library.dll").write_bytes(b"fixture dll, never loaded")

    def tearDown(self):
        self.temp.cleanup()

    def test_real_windows_open_image_style_handle_blocks_rename_but_not_verified_copy(self):
        if os.name != "nt":
            self.skipTest("Windows CreateFile sharing regression")
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        kernel.CreateFileW.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.CreateFileW(str(self.source / "library.dll"), 0x80000000, 1 | 2, None, 3, 0x80, None)
        self.assertNotEqual(handle, ctypes.c_void_p(-1).value)
        try:
            with self.assertRaises(PermissionError):
                os.replace(self.source, self.attempt / "rename-would-fail")
            engines._publish_native_copy(self.source, self.attempt / "native", self.attempt)
            self.assertTrue(self.source.is_dir())
            for original in self.source.iterdir():
                copy = self.attempt / "native" / original.name
                self.assertEqual(copy.read_bytes(), original.read_bytes())
                self.assertEqual(copy.stat().st_nlink, 1)
        finally:
            self.assertTrue(kernel.CloseHandle(handle))

    def test_existing_target_and_paths_outside_attempt_are_never_overwritten(self):
        target = self.attempt / "native"
        target.mkdir(); (target / "keep.txt").write_text("preserve")
        with self.assertRaisesRegex(ValueError, "już istnieje"):
            engines._publish_native_copy(self.source, target, self.attempt)
        self.assertEqual((target / "keep.txt").read_text(), "preserve")
        for source, destination in ((self.root, target), (self.source, self.root / "native")):
            with self.subTest(source=source, destination=destination), self.assertRaises(ValueError):
                engines._publish_native_copy(source, destination, self.attempt)

    def test_hardlink_and_reparse_guard_fail_before_target_creation(self):
        os.link(self.source / "library.dll", self.source / "shared.dll")
        with self.assertRaisesRegex(ValueError, "hardlink"):
            engines._publish_native_copy(self.source, self.attempt / "native", self.attempt)
        self.assertFalse((self.attempt / "native").exists())
        with patch("engine_installation._no_link_ancestors", side_effect=ValueError("fixture junction")), self.assertRaisesRegex(ValueError, "junction"):
            engines._publish_native_copy(self.source, self.attempt / "native", self.attempt)

    def test_copy_mismatch_retains_partial_without_success_marker(self):
        def corrupt_copy(_source, output):
            output.write(b"corrupt")
        with patch("engine_installation.shutil.copyfileobj", side_effect=corrupt_copy), self.assertRaisesRegex(ValueError, "Kopia programu"):
            engines._publish_native_copy(self.source, self.attempt / "native", self.attempt)
        self.assertTrue((self.attempt / "native").exists())
        self.assertFalse((self.attempt / engines.MARKER).exists())

    def stock_source(self):
        destination = self.root / "audiocpp_runtime_install.py"
        with zipfile.ZipFile(ROOT / "scripts/runtime/engine.zip") as archive:
            destination.write_bytes(archive.read("backend/services/audiocpp_runtime_install.py"))
        return destination

    def test_exact_stock_ast_runs_in_private_namespace_without_global_replace_patch(self):
        source = self.stock_source()
        target = self.attempt / "native"
        probes = []
        def extract(_archive, destination):
            shutil.copytree(self.source, destination / "bin")
        installer = SimpleNamespace(bootstrap=SimpleNamespace(default_asset=lambda: ("fixture.zip", "0" * 64), default_asset_size=lambda: 1,
            GH_REPO="fixture/never-downloaded", VERSION="fixture", managed_runtime_dir=lambda: target, binary_name=lambda: "audiocpp_server.exe", invalidate=lambda: None),
            Path=Path, os=os, shutil=shutil, tempfile=tempfile, _download=lambda *args: None, _extract=extract,
            subprocess=SimpleNamespace(run=lambda *args, **kwargs: (probes.append(args[0]) or SimpleNamespace(returncode=0))))
        original_replace = os.replace
        install = engines._private_native_install(installer, source, engines._sha(source), self.attempt)
        install()
        self.assertIs(os.replace, original_replace)
        self.assertEqual(len(probes), 1)
        self.assertEqual(probes[0][-1], "--list-devices")
        self.assertEqual((target / "library.dll").read_bytes(), b"fixture dll, never loaded")
        with self.assertRaisesRegex(ValueError, "już istnieje"):
            install()
        self.assertTrue((target / "library.dll").is_file())

    def test_changed_stock_contract_is_rejected_without_execution(self):
        source = self.stock_source()
        source.write_text(source.read_text().replace("os.replace(prepared, target)", "os.rename(prepared, target)"))
        with self.assertRaisesRegex(ValueError, "kontrakt"):
            engines._private_native_install(SimpleNamespace(), source, engines._sha(source), self.attempt)
        with self.assertRaisesRegex(ValueError, "Źródło"):
            engines._private_native_install(SimpleNamespace(), source, "f" * 64, self.attempt)


if __name__ == "__main__":
    unittest.main(verbosity=2)
