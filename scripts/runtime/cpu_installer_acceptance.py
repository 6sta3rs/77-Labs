"""Prepared acceptance of one REAL clean CPU installation through the built EXE.

NOT a fixture installer. Requires explicit --run after the parent builds/signals.
Downloads Python/dependencies into a new app-data sandbox, never model weights.
First cancels an early candidate; one retry completes a full CPU installation.
No EXE/process is started on import. No clipboard/key injection is used here.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import time
import tomllib
import urllib.request
import uuid
import zipfile

from dictation_desktop_acceptance import Native, _free_port, _owner_module, require_ipc, ipc, wait_for, sandbox_parent, report_destination, verify_cdp_ownership, assert_webview_profile_environment
from model_management import _no_link_ancestors

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)

ROOT = Path(__file__).resolve().parents[2]
OWNER = "Seventy Seven Labs CPU installer acceptance v1"


def sha(path):
    with Path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def guard_snapshot(arguments):
    # Explicit individual artifacts only: no directory traversal or database
    # queries. Only digests/sizes are retained, never private file contents.
    result = []
    for role, paths in (("source", arguments.guard_source), ("data", arguments.guard_data), ("model", arguments.guard_model)):
        for raw in paths:
            path = raw.resolve()
            check(path.is_file(), f"Brak jawnie wskazanego pliku kontrolnego {role}: {path}")
            info = path.stat()
            result.append({"role": role, "path": str(path), "sha256": sha(path), "size": info.st_size, "links": info.st_nlink})
    return result


def compare_guards(baseline):
    result = []
    for item in baseline:
        try:
            after = sha(item["path"]) if Path(item["path"]).is_file() else None
            unchanged = after == item["sha256"] and Path(item["path"]).stat().st_size == item["size"]
            result.append({"role": item["role"], "file": Path(item["path"]).name, "before_sha256": item["sha256"], "after_sha256": after, "unchanged": unchanged})
        except OSError as exc:
            result.append({"role": item["role"], "file": Path(item["path"]).name, "unchanged": False, "error": type(exc).__name__})
    return result


def assert_port_free(port):
    with socket.socket() as stream:
        stream.settimeout(.3)
        check(stream.connect_ex(("127.0.0.1", port)) != 0, f"Port {port} jest zajęty; nie zamknięto cudzego procesu.")


class ExeSession:
    def __init__(self, exe, session, local, roaming, webview, owner, native):
        self.exe, self.session, self.local, self.roaming, self.webview = exe, session, local, roaming, webview
        self.owner, self.native = owner, native
        self.process, self.browser, self.page, self.log = None, None, None, None

    async def start(self, playwright, number):
        port = _free_port()
        environment = dict(os.environ)
        for key in list(environment):
            if key.startswith(("WEBVIEW2_", "OMNIVOICE_", "HF_", "HUGGINGFACE_", "HUGGING_FACE_", "TRANSFORMERS_", "UV_", "PIP_")) or key in {"VOICESTUDIO_NEXT_PYTHON", "PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV", "SEVENTY_SEVEN_INSTALLER_OWNED"}:
                environment.pop(key, None)
        environment.update(LOCALAPPDATA=str(self.local), APPDATA=str(self.roaming), WEBVIEW2_USER_DATA_FOLDER=str(self.webview),
            WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=f"--remote-debugging-port={port} --remote-debugging-address=127.0.0.1 --disable-background-networking --disable-component-update --no-first-run --disable-sync",
            VOICESTUDIO_NEXT_PRELOAD_TTS="0", OMNIVOICE_PRELOAD_CAPTURE_ASR="0", OMNIVOICE_PRELOAD_WATERMARK="0", OMNIVOICE_PRELOAD_TTS_ASR="0",
            OMNIVOICE_MCP_DISABLE="1", HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_IMPLICIT_TOKEN="1")
        check("VOICESTUDIO_NEXT_PYTHON" not in environment, "Wymuszony interpreter uniemożliwiłby prawdziwą aktywację.")
        self.profile_preflight = assert_webview_profile_environment(environment, self.webview, self.session, reuse_owned=number > 1)
        with (self.session / f"webview-profile-preflight-{number}.json").open("x", encoding="utf-8") as proof:
            json.dump(self.profile_preflight, proof, indent=2)
        self.log = (self.session / f"exe-{number}.log").open("wb")
        self.process = self.owner.spawn_owned([str(self.exe)], cwd=str(self.exe.parent), env=environment,
                         stdin=subprocess.PIPE, stdout=self.log, stderr=subprocess.STDOUT)
        async def cdp_ready():
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=.2):
                    return True
            except OSError:
                check(self.process.poll() is None, "EXE zakończył działanie przed połączeniem CDP.")
                return False
        await wait_for(cdp_ready, 45, "Nie utworzono własnego portu CDP.")
        self.root_process = verify_cdp_ownership(self.process, port, self.webview)
        self.browser = await playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
        async def main_page():
            for context in self.browser.contexts:
                for page in context.pages:
                    try:
                        if await page.evaluate("window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label") == "main":
                            return page
                    except Exception:
                        pass
            return None
        self.page = await wait_for(main_page, 20, "Nie znaleziono własnego głównego okna Tauri.")
        guard = """(()=>{window.__qaMicRequests=0;if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{window.__qaMicRequests++;throw new Error('QA: physical microphone disabled');};})();"""
        for context in self.browser.contexts:
            await context.add_init_script(guard)
            for page in context.pages:
                await page.evaluate(guard)
        return self

    async def settings(self):
        page = self.page
        if await page.get_by_role("button", name="Ustawienia", exact=True).count():
            await page.get_by_role("button", name="Ustawienia", exact=True).click()
        await page.get_by_role("button", name="Modele i silnik", exact=True).click()
        panel = page.get_by_role("region", name="Instalacja samodzielnego środowiska", exact=True)
        await panel.wait_for()
        return panel

    def descendants_in(self, candidate):
        import psutil
        if not self.root_process.is_running():
            return []
        found = []
        for process in self.root_process.children(recursive=True):
            try:
                if any(str(candidate).lower() in argument.lower() for argument in process.cmdline()):
                    found.append(process.pid)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        return found

    def owns_listener(self, port):
        import psutil
        if not self.root_process.is_running():
            return False
        owned = {self.process.pid, *(item.pid for item in self.root_process.children(recursive=True))}
        listeners = [item for item in psutil.net_connections(kind="tcp") if item.laddr and item.laddr.port == port and item.status == "LISTEN"]
        return bool(listeners) and all(item.pid in owned for item in listeners)

    async def close(self):
        graceful = self.process is None or self.process.poll() is not None
        if not graceful:
            windows = self.native.owned_windows(self.process.pid)
            window = next((item for item in windows if item["title"] and self.native.user.IsWindowVisible(item["handle"])), None)
            if window:
                self.native.user.PostMessageW(window["handle"], 0x10, 0, 0)
                try:
                    await asyncio.to_thread(self.process.wait, timeout=12)
                    graceful = self.process.returncode == 0
                except subprocess.TimeoutExpired:
                    pass
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                await asyncio.to_thread(self.process.wait, timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill(); await asyncio.to_thread(self.process.wait, timeout=5)
        if self.browser is not None:
            try:
                await asyncio.wait_for(self.browser.close(), 4)
            except Exception:
                pass
        if self.log:
            self.log.close()
        return graceful


def candidate_root(base, value):
    check(isinstance(value, str) and re.fullmatch(r"runtime_[a-f0-9]{1,32}", value), "Nieprawidłowy identyfikator kandydata z produktu.")
    root = base / value
    _no_link_ancestors(root)
    check(root.resolve().parent == base.resolve(), "Kandydat wykracza poza sandbox.")
    marker = load(root / ".installer-owner.json")
    check(marker == {"owner": "Seventy Seven Labs runtime installer v1", "id": value}, "Brak potwierdzonej własności kandydata.")
    return root


def read_backend(path, token=None):
    headers = {"Origin": "http://tauri.localhost", "X-VoiceStudio-CSRF": "1", "Sec-Fetch-Site": "same-origin"}
    if token:
        headers["X-VoiceStudio-Next"] = token
    with urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:4312" + path, headers=headers), timeout=8) as response:
        return json.load(response), response.headers.get("x-voicestudio-next")


async def run_acceptance(arguments):
    from playwright.async_api import async_playwright
    exe, expected_manifest = arguments.exe.resolve(), load(arguments.expected_manifest)
    check(exe.is_file(), "Brak gotowego EXE.")
    source_archive = ROOT / "scripts/runtime/engine.zip"
    check(sha(source_archive) == expected_manifest["engine"]["archiveSha256"], "Źródła i oczekiwany manifest nie pasują do siebie.")
    with zipfile.ZipFile(source_archive) as archive:
        source_version = tomllib.loads(archive.read("pyproject.toml").decode("utf-8-sig"))["project"]["version"]
    check(source_version == arguments.expected_version, "Archiwum nie ma docelowej wersji źródeł; najpierw zakończ build.")
    base = sandbox_parent(arguments.sandbox_base)
    minimum = max(20, arguments.minimum_free_gib)
    free_before = shutil.disk_usage(base).free
    check(free_before >= minimum * 1024 ** 3, f"Za mało miejsca na czysty odbiór: potrzeba {minimum} GiB, dostępne {free_before / 1024**3:.1f} GiB.")
    assert_port_free(4312)
    baseline = await asyncio.to_thread(guard_snapshot, arguments)
    session = Path(tempfile.mkdtemp(prefix="seventy-seven-cpu-install-", dir=base)).resolve()
    arguments.report = report_destination(arguments.report, session)
    session_id = uuid.uuid4().hex
    (session / ".qa-owner.json").write_text(json.dumps({"owner": OWNER, "id": session_id, "exe_sha256": sha(exe)}), encoding="utf-8")
    local, roaming, webview, models = session / "local", session / "roaming", session / "webview2", session / "empty-models"
    appbase = local / "VoiceStudioNext"
    legacy = appbase / "runtime"
    for directory in (legacy, roaming, webview, models):
        directory.mkdir(parents=True, exist_ok=True)
    # Private fixture pointer demonstrates activation's merge/copy behavior;
    # it points at EMPTY own storage, never at a user's model-cache directory.
    (legacy / "model-cache.json").write_text(json.dumps({"path": str(models), "owner": OWNER}), encoding="utf-8")
    (legacy / "preserve.txt").write_text("Own predecessor sentinel; never modify.", encoding="utf-8")
    predecessor_hashes = {name: sha(legacy / name) for name in ("model-cache.json", "preserve.txt")}
    native = Native()
    original_foreground = native.identity(native.user.GetForegroundWindow())
    owner = _owner_module(session)
    report = {"schema": 1, "session": str(session), "session_id": session_id, "exe_sha256": sha(exe), "profile": "cpu",
              "expected_source_version": arguments.expected_version, "free_bytes_before": free_before, "minimum_free_gib": minimum,
              "checks": [], "observations": [], "candidate": None, "cancelled_candidate": None,
              "models_installed": False, "synthesis_performed": False, "physical_microphone_used": False, "cleanup_errors": []}
    instances, current = [], None
    def record(name, passed, detail=None):
        report["checks"].append({"name": name, "passed": bool(passed), **({"detail": detail} if detail is not None else {})})
        check(passed, name + (": " + str(detail) if detail else ""))
    def event(message, **fields):
        print("NEXT_CPU_ACCEPTANCE_EVENT " + json.dumps({"message": message, **fields}, ensure_ascii=False), flush=True)
    last_sample, last_event = None, 0
    async def observe(panel):
        nonlocal last_sample, last_event
        status = await require_ipc(current.page, "installer_status")
        sample = {key: status.get(key) for key in ("state", "phase", "profile", "candidate", "downloadedBytes", "totalBytes", "message")}
        key = (sample["state"], sample["phase"])
        now = time.monotonic()
        if key != last_sample or now - last_event > 15:
            sample["ui"] = (await panel.get_by_role("status").inner_text())[:1200] if await panel.get_by_role("status").count() else ""
            report["observations"].append(sample)
            event(sample["message"], state=sample["state"], phase=sample["phase"], downloadedBytes=sample["downloadedBytes"], freeGiB=round(shutil.disk_usage(session).free / 1024**3, 1))
            last_sample, last_event = key, now
        if sample["phase"] == "uv" and (sample["downloadedBytes"] or 0) > 0:
            report["uv_measured_transfer_observed"] = True
        return status
    try:
        async with async_playwright() as playwright:
            current = ExeSession(exe, session, local, roaming, webview, owner, native)
            instances.append(current)
            await current.start(playwright, 1)
            record("no_python_override_and_cold_stopped", (await require_ipc(current.page, "runtime_status"))["state"] == "stopped")
            panel = await current.settings()
            record("fresh_installer_idle", (await require_ipc(current.page, "installer_status"))["state"] == "idle")
            record("cpu_selected_in_real_ui", "CPU" in await panel.get_by_role("combobox", name="Wariant środowiska").inner_text())
            record("not_ready_activation_button_absent", await panel.get_by_role("button", name="Użyj tego środowiska", exact=True).count() == 0)
            refused = await ipc(current.page, "installer_activate")
            record("native_activation_refused_before_ready", not refused["ok"] and not (appbase / "active-runtime.json").exists())
            await panel.get_by_role("button", name="Pobierz i przygotuj środowisko", exact=True).click()
            first = await wait_for(lambda: _running(current.page), 8, "UI nie uruchomił pierwszego kandydata CPU.")
            record("ui_called_cpu_install", first["profile"] == "cpu" and first["state"] == "running")
            first_root = await wait_for(lambda: _candidate_ready(appbase, first["candidate"]), 8, "Brak własnego katalogu pierwszej próby.")
            record("exe_embedded_manifest_is_current", load(first_root / "bootstrap-provenance.json") == expected_manifest)
            await panel.get_by_role("button", name="Anuluj instalację", exact=True).click()
            cancelled = await wait_for(lambda: _terminal(current.page), 25, "Instalator nie potwierdził anulowania własnego drzewa.")
            record("cancel_has_confirmed_terminal_status", cancelled["state"] == "cancelled")
            record("cancel_did_not_activate_or_mark_ready", not (appbase / "active-runtime.json").exists() and not (first_root / "installation-ready.json").exists())
            record("cancelled_candidate_has_no_live_children", not current.descendants_in(first_root))
            report["cancelled_candidate"] = first_root.name
            record("budget_still_sufficient_for_one_full_install", shutil.disk_usage(session).free >= minimum * 1024**3)
            retry = panel.get_by_role("button", name="Ponów w nowym środowisku", exact=True)
            await retry.wait_for(); await retry.click()
            second = await wait_for(lambda: _running(current.page, first["candidate"]), 8, "UI nie ponowił instalacji.")
            candidate = await wait_for(lambda: _candidate_ready(appbase, second["candidate"]), 8, "Brak własnego kandydata retry.")
            record("retry_uses_new_candidate_preserving_old", candidate != first_root and first_root.is_dir())
            report["candidate"] = candidate.name
            deadline = time.monotonic() + arguments.timeout_minutes * 60
            while True:
                status = await observe(panel)
                if status["state"] not in {"running", "cancelling"}:
                    break
                check(time.monotonic() < deadline, "Przekroczono uzgodniony czas instalacji CPU.")
                check(shutil.disk_usage(session).free >= 2 * 1024**3, "Pozostało mniej niż 2 GiB miejsca; przerwano test i własną instalację.")
                await asyncio.sleep(.15)
            record("full_cpu_candidate_ready", status["state"] == "ready", status["message"])
            record("real_download_progress_was_observed", report.get("uv_measured_transfer_observed", False))
            record("candidate_not_implicitly_activated", not (appbase / "active-runtime.json").exists())
            certificate = load(candidate / "bootstrap-provenance.json")
            ready = load(candidate / "installation-ready.json")
            record("candidate_certificate_matches_build", certificate == expected_manifest)
            record("uv_zip_and_exact_exe_verified", sha(candidate / "downloads/uv.zip") == certificate["uv"]["sha256"] and _uv_exe_matches(candidate))
            record("source_lock_and_archive_match_certificate", sha(candidate / "engine.zip") == certificate["engine"]["archiveSha256"] and sha(candidate / "engine/uv.lock") == certificate["engine"]["lockSha256"] and sha(candidate / "engine/pyproject.toml") == certificate["engine"]["pyprojectSha256"])
            record("cpu_doctor_passed_without_cuda_or_models", ready["profile"] == "cpu" and ready["imports"] == "passed" and ready["cuda"] is None and not ready["cuda_available"] and ready["torch"] == certificate["cpuWheels"]["torch"]["version"] and all(ready["health"].get(key) == value for key, value in {"status": 200, "owned": True, "isolatedData": True, "modelsLoaded": False}.items()) and ready["synthesize_tested"] is False)
            record("doctor_imported_mcp_sdk_and_pywin32", ready.get("mcp_sdk") == "passed" and ready.get("pywin32") == "passed")
            record("doctor_evidence_binds_source_and_lock", ready["source_archive_sha256"] == certificate["engine"]["archiveSha256"] and ready["lock_sha256"] == certificate["engine"]["lockSha256"])
            record("no_model_weights_in_owned_caches", not _model_files(models) and not _model_files(candidate / "doctor-models"))
            await panel.get_by_role("button", name="Użyj tego środowiska", exact=True).click()
            activated = await wait_for(lambda: _activated(current.page), 8, "UI nie aktywował gotowego środowiska.")
            record("activation_persisted_correct_candidate", activated["candidate"] == candidate.name and load(appbase / "active-runtime.json") == {"id": candidate.name, "schema": 1})
            record("activation_preserved_private_empty_cache_pointer", load(candidate / "model-cache.json") == load(legacy / "model-cache.json"))
            record("own_predecessor_files_unchanged", all(sha(legacy / name) == value for name, value in predecessor_hashes.items()))
            await current.page.get_by_role("button", name="Uruchom silnik", exact=True).click()
            running = await wait_for(lambda: _runtime_ready(current.page), 185, "Nowy prywatny Python nie uruchomił silnika.")
            record("first_start_uses_private_python", running.get("source") == "private-python" and running["managed"])
            record("first_backend_listener_is_owned", current.owns_listener(4312))
            health, token = await asyncio.to_thread(read_backend, "/health")
            record("health_uses_source_version", health.get("version") == arguments.expected_version and bool(token))
            model_state, model_token = await asyncio.to_thread(read_backend, "/model/status", token)
            loaded, loaded_token = await asyncio.to_thread(read_backend, "/model/loaded", token)
            record("no_models_loaded_after_activation", not model_state.get("loaded") and not model_state.get("loading") and not loaded.get("models") and model_token == token and loaded_token == token)
            await _stop_runtime(current.page)
            record("first_exe_closes_gracefully", await current.close())
            assert_port_free(4312)
            current = ExeSession(exe, session, local, roaming, webview, owner, native)
            instances.append(current)
            await current.start(playwright, 2)
            record("selection_survives_exe_restart", load(appbase / "active-runtime.json")["id"] == candidate.name and (await require_ipc(current.page, "installer_status"))["state"] == "activated")
            await current.settings()
            await current.page.get_by_role("button", name="Uruchom silnik", exact=True).click()
            restarted = await wait_for(lambda: _runtime_ready(current.page), 185, "Restart EXE nie korzysta z aktywowanego Pythona.")
            record("restarted_exe_uses_private_python", restarted.get("source") == "private-python" and restarted["managed"] and current.owns_listener(4312))
            health2, token2 = await asyncio.to_thread(read_backend, "/health")
            models2, _ = await asyncio.to_thread(read_backend, "/model/status", token2)
            loaded2, _ = await asyncio.to_thread(read_backend, "/model/loaded", token2)
            record("restarted_health_version_and_unloaded_models", health2.get("version") == arguments.expected_version and not models2.get("loaded") and not models2.get("loading") and not loaded2.get("models"))
            record("no_physical_microphone_requested", await current.page.evaluate("window.__qaMicRequests===0"))
            await _stop_runtime(current.page)
            record("restarted_exe_closes_gracefully", await current.close())
            assert_port_free(4312)
            report["ready_evidence"] = ready
    except Exception as exc:
        report["error"] = str(exc)[:1600]
    finally:
        for instance in reversed(instances):
            if instance.process is not None and instance.process.poll() is None:
                try:
                    result = await ipc(instance.page, "installer_status")
                    if result.get("ok") and result.get("value", {}).get("state") in {"running", "cancelling"}:
                        await asyncio.wait_for(ipc(instance.page, "installer_cancel"), 5)
                        await wait_for(lambda: _terminal(instance.page), 20, "Brak potwierdzenia zatrzymania instalacji podczas cleanup.")
                    await asyncio.wait_for(_stop_runtime(instance.page), 12)
                except Exception:
                    pass
                try:
                    await instance.close()
                except Exception as exc:
                    report["cleanup_errors"].append(str(exc))
        # No recursive cleanup: retain cancelled and complete candidates and
        # the exact private selection for inspection. Never touch user files.
        report["guards"] = await asyncio.to_thread(compare_guards, baseline)
        report["guards_unchanged"] = all(item["unchanged"] for item in report["guards"])
        report["free_bytes_after"] = shutil.disk_usage(session).free
        report["webview_profile_preflights"] = [instance.profile_preflight for instance in instances if hasattr(instance, "profile_preflight")]
        report["disk_bytes_used"] = free_before - report["free_bytes_after"]
        live = native.identity(native.user.GetForegroundWindow())
        own_pids = {os.getpid(), *(instance.process.pid for instance in instances if instance.process)}
        if live["pid"] in own_pids and native.matches(original_foreground):
            report["focus_restored"] = bool(native.user.SetForegroundWindow(original_foreground["handle"]))
        else:
            report["focus_restored"] = "skipped_later_user_action_or_target_gone"
        report["passed"] = not report.get("error") and not report["cleanup_errors"] and report["guards_unchanged"] and bool(report["checks"]) and all(item["passed"] for item in report["checks"])
        arguments.report.parent.mkdir(parents=True, exist_ok=True)
        arguments.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


async def _running(page, previous_candidate=None):
    status = await require_ipc(page, "installer_status")
    if previous_candidate and status["candidate"] == previous_candidate:
        return None
    if status["state"] in {"failed", "cancelled"}:
        raise RuntimeError(status["message"])
    return status if status["state"] == "running" else None


def _candidate_ready(base, identifier):
    try:
        root = candidate_root(base, identifier)
        return root if (root / "bootstrap-provenance.json").is_file() else None
    except FileNotFoundError:
        return None


async def _terminal(page):
    status = await require_ipc(page, "installer_status")
    return status if status["state"] not in {"running", "cancelling"} else None


async def _activated(page):
    status = await require_ipc(page, "installer_status")
    return status if status["state"] == "activated" else None


async def _runtime_ready(page):
    status = await require_ipc(page, "runtime_status")
    if status["state"] == "error":
        raise RuntimeError(status["message"])
    return status if status["state"] == "ready" else None


async def _stop_runtime(page):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        result = await ipc(page, "runtime_stop")
        if result["ok"] and result["value"]["state"] == "stopped":
            return
        await asyncio.sleep(.3)
    raise RuntimeError("Nie potwierdzono zatrzymania własnego backendu.")


def _uv_exe_matches(root):
    with zipfile.ZipFile(root / "downloads/uv.zip") as archive:
        items = [item for item in archive.infolist() if Path(item.filename.replace("\\", "/")).name == "uv.exe"]
        return len(items) == 1 and archive.read(items[0]) == (root / "tools/uv.exe").read_bytes()


def _model_files(path):
    return [item for item in path.rglob("*") if item.is_file() and item.suffix.lower() in {".safetensors", ".pt", ".pth", ".onnx", ".gguf", ".bin"}] if path.exists() else []


def main():
    parser = argparse.ArgumentParser(description="Jawny odbiór czystej instalacji CPU przez prawdziwy EXE/CDP.")
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--exe", type=Path, required=True)
    parser.add_argument("--expected-manifest", type=Path, default=ROOT / "scripts/runtime/bootstrap-provenance.json")
    parser.add_argument("--expected-version", default="0.5.7")
    parser.add_argument("--guard-source", type=Path, action="append", default=[ROOT / "scripts/runtime/engine.zip"])
    parser.add_argument("--guard-data", type=Path, action="append", required=True)
    parser.add_argument("--guard-model", type=Path, action="append", required=True)
    parser.add_argument("--sandbox-base", type=Path, default=None)
    parser.add_argument("--minimum-free-gib", type=int, default=28)
    parser.add_argument("--timeout-minutes", type=int, default=90)
    parser.add_argument("--report", type=Path, default=ROOT / ".tmp/qa/cpu-installer-exe.json")
    arguments = parser.parse_args()
    if not arguments.run:
        parser.error("Wymagane jawne --run po nowym buildzie i sygnale rozpoczęcia odbioru.")
    result = asyncio.run(run_acceptance(arguments))
    print(json.dumps({"passed": result["passed"], "checks": len(result["checks"]), "report": str(arguments.report)}, ensure_ascii=False))
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
