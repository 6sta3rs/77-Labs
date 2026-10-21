"""Owned Release/WebView acceptance, with new data and an explicit interpreter.

Uses the repository's documented native CDP workflow. No microphone, account,
model download, inference, licence acceptance, old database or shared writes.
"""
from __future__ import annotations
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import tempfile
import time
import uuid
from contextlib import closing

from dictation_desktop_acceptance import Native, ipc, require_ipc

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)

ROOT = Path(__file__).resolve().parents[2]


async def acceptance(args):
    from playwright.async_api import async_playwright, expect
    import psutil
    with socket.socket() as guard:
        guard.bind(("127.0.0.1", 4312))
    with socket.socket() as guard:
        guard.bind(("127.0.0.1", 0)); port = guard.getsockname()[1]
    exe, python = args.exe.resolve(strict=True), args.runtime_python.resolve(strict=True)
    # The production LocalAppData path is short. Do not turn this acceptance
    # into an unrelated MAX_PATH test by nesting it under the repository.
    session = Path(tempfile.gettempdir()).resolve() / ("sqa-" + uuid.uuid4().hex[:8])
    session.mkdir(parents=True)
    local, roaming, profile = session / "L", session / "R", session / "W"
    for path in (local, roaming, profile): path.mkdir()
    env = dict(os.environ)
    for key in list(env):
        if key.startswith(("OMNIVOICE_", "HF_", "HUGGINGFACE_", "WEBVIEW2_")) or key in {"PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV"}:
            env.pop(key, None)
    env.update(LOCALAPPDATA=str(local), APPDATA=str(roaming), VOICESTUDIO_NEXT_PYTHON=str(python),
               VOICESTUDIO_NEXT_PRELOAD_TTS="0",
               WEBVIEW2_USER_DATA_FOLDER=str(profile), PYTHONDONTWRITEBYTECODE="1",
               WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=f"--remote-debugging-port={port} --remote-debugging-address=127.0.0.1 --disable-background-networking --disable-component-update --no-first-run --disable-sync")
    report = {"exe_sha256": hashlib.sha256(exe.read_bytes()).hexdigest(), "exe": str(exe), "session": str(session),
              "configured_interpreter": True, "fresh_cpu_install": False, "inference": False, "checks": [], "completed": False}
    def check(name, passed, **details):
        report["checks"].append({"name": name, "passed": bool(passed), **details})
        print(json.dumps(report["checks"][-1], ensure_ascii=True), flush=True)
        if not passed: raise AssertionError(name)
    native, browser, process, page = Native(), None, None, None
    errors = []
    async def ready(target=None):
        deadline = time.monotonic() + 185
        while time.monotonic() < deadline:
            status = await require_ipc(page, "runtime_status")
            if status["state"] == "ready" and (target is None or Path(status.get("dataDir", "")).resolve() == target.resolve()):
                return status
            if status["state"] == "error": raise RuntimeError(status["message"])
            if target is not None:
                failures = await page.locator(".storage-settings [role=alert]").all_text_contents()
                if failures: raise RuntimeError("Storage UI: " + " | ".join(failures))
            await asyncio.sleep(.25)
        raise TimeoutError("Owned runtime did not confirm ready data location")
    async def defer_licences():
        button = page.get_by_role("button", name="Odłóż przegląd warunków", exact=True)
        for _ in range(20):
            if await button.is_visible(): await button.evaluate("element=>element.click()"); return
            await asyncio.sleep(.1)
    try:
        with (session / "desktop.log").open("wb") as log:
            process = subprocess.Popen([str(exe)], cwd=exe.parent, env=env, stdin=subprocess.PIPE, stdout=log, stderr=log, creationflags=0x08000000)
            async with async_playwright() as driver:
                for _ in range(160):
                    if process.poll() is not None: raise RuntimeError("Owned EXE exited before CDP")
                    try:
                        with socket.create_connection(("127.0.0.1", port), timeout=.2): break
                    except OSError: await asyncio.sleep(.1)
                browser = await driver.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
                context = browser.contexts[0]
                for _ in range(100):
                    if context.pages: break
                    await asyncio.sleep(.1)
                page = context.pages[0]
                page.on("pageerror", lambda error: errors.append(str(error)))
                await page.add_locator_handler(page.get_by_role("button", name="Odłóż przegląd warunków", exact=True), lambda locator: locator.evaluate("element=>element.click()"))
                page.set_default_timeout(30000)
                await page.wait_for_selector(".settings-trigger")
                initial = await require_ipc(page, "runtime_status")
                children = psutil.Process(process.pid).children(recursive=True)
                python_children = [{"pid": child.pid, "name": child.name()} for child in children if "python" in child.name().lower()]
                check("cold_window_does_not_start_python", initial["state"] == "stopped" and not python_children, status=initial, python_children=python_children)
                await defer_licences()
                await page.get_by_role("button", name="Ustawienia", exact=True).evaluate("element=>element.click()")
                check("all_settings_render_in_release", await page.locator(".settings-navigation nav button").count() == 20)
                await page.locator(".settings-runtime-notice").get_by_role("button", name="Uruchom silnik", exact=True).evaluate("element=>element.click()")
                status = await ready()
                check("owned_runtime_ready_with_new_data", status["managed"] and Path(status["dataDir"]).resolve().is_relative_to(local.resolve()), source=status.get("source"))
                if args.source_root:
                    deployed = local / "VoiceStudioNext/runtime"
                    modules = ("launcher.py", "preview_cache.py", "model_management.py", "storage_settings.py", "remote_backend.py", "activity.py", "system_settings.py")
                    matches = {}
                    for name in modules:
                        canonical = lambda path: hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
                        matches[name] = canonical(deployed / name) == canonical(args.source_root / "scripts/runtime" / name)
                    check("exe_embeds_the_frozen_settings_source", all(matches.values()), modules=matches)
                await defer_licences()
                if await page.locator(".settings-navigation nav button").count() == 0:
                    await page.get_by_role("button", name="Ustawienia", exact=True).evaluate("element=>element.click()")
                await page.locator(".settings-navigation nav").wait_for()
                check("settings_accessible_after_engine_start", await page.locator(".settings-navigation nav button").count() == 20)
                profiles = await require_ipc(page, "library_profiles")
                check("native_profiles_read_private_database", isinstance(profiles, list))
                labels = await page.locator(".settings-navigation nav button").all_text_contents()
                for label in labels:
                    await page.locator(".settings-navigation nav").get_by_role("button", name=label.strip(), exact=True).evaluate("element=>element.click()")
                    await asyncio.sleep(.25)
                check("twenty_sections_mount_without_page_errors", len(labels) == 20 and not errors, sections=len(labels), errors=errors)
                await page.locator(".settings-navigation nav").get_by_role("button", name="Przechowywanie", exact=True).evaluate("element=>element.click()")
                await page.locator("#storage-data-path").wait_for()
                destination = session / "relocated" / "data"
                destination.parent.mkdir()
                source = Path(status["dataDir"])
                await page.locator("#storage-data-path").fill(str(destination))
                await page.get_by_role("button", name="Zaplanuj kopię i zmianę katalogu", exact=True).evaluate("element=>element.click()")
                restart = page.get_by_role("button", name="Zastosuj zmiany i uruchom silnik ponownie", exact=True)
                await restart.wait_for()
                await expect(restart).to_be_enabled()
                report["restart_attempts"] = []
                for attempt in range(6):
                    await expect(restart).to_be_enabled()
                    await restart.evaluate("element=>element.click()")
                    try:
                        after = await ready(destination)
                        report["restart_attempts"].append({"attempt": attempt + 1, "activated": True})
                        break
                    except RuntimeError as restart_error:
                        # A deliberate Stop must refuse live work or missing
                        # idle proof. Record that refusal; retry like a user,
                        # without forcing termination or bypassing the guard.
                        detail = str(restart_error)
                        report["restart_attempts"].append({"attempt": attempt + 1, "activated": False, "detail": detail})
                        if attempt == 5 or not any(text in detail for text in ("Silnik pracuje lub", "Poczekaj na zakończenie zadań silnika")):
                            raise
                        await asyncio.sleep(2)
                check("desktop_restarts_and_activates_copied_data", Path(after["dataDir"]).resolve() == destination.resolve())
                check("relocation_preserves_source_database", (source / "omnivoice.db").is_file() and (destination / "omnivoice.db").is_file())
                with closing(sqlite3.connect((destination / "omnivoice.db").as_uri() + "?mode=ro", uri=True)) as database:
                    check("copied_sqlite_is_consistent", database.execute("PRAGMA quick_check").fetchone()[0] == "ok")
                copied_profiles = await require_ipc(page, "library_profiles")
                check("rust_reads_the_activated_copy", [row["id"] for row in copied_profiles] == [row["id"] for row in profiles])
                proof_id, proof_name = "qa-destination-proof", "QA destination database only"
                with closing(sqlite3.connect(destination / "omnivoice.db")) as database:
                    database.execute("INSERT INTO voice_profiles(id,name,created_at) VALUES(?,?,?)", (proof_id, proof_name, time.time()))
                    database.commit()
                distinguished = await require_ipc(page, "library_profiles")
                check("native_reader_observes_destination_only_row", any(row.get("id") == proof_id and row.get("name") == proof_name for row in distinguished))
                with closing(sqlite3.connect((source / "omnivoice.db").as_uri() + "?mode=ro", uri=True)) as database:
                    check("source_does_not_contain_destination_proof", database.execute("SELECT count(*) FROM voice_profiles WHERE id=?", (proof_id,)).fetchone()[0] == 0)
                # The destination also appears in the pending-plan notice.
                # Require the active-location field, not any matching text.
                activated = page.locator('[aria-labelledby="storage-data-title"] > p > code').first
                await expect(activated).to_have_text(str(destination))
                await expect(page.get_by_role("button", name="Anuluj plan przeniesienia", exact=True)).to_have_count(0)
                check("storage_ui_reads_activated_location", (await activated.text_content()) == str(destination))
                await page.screenshot(path=str(session / "storage-after-relocation.png"))
                report["stop_attempts"] = []
                for _ in range(30):
                    result = await ipc(page, "runtime_stop")
                    report["stop_attempts"].append(result)
                    stopped = result.get("value", {}) if result.get("ok") else {}
                    if stopped.get("state") == "stopped": break
                    await asyncio.sleep(.2)
                check("owned_runtime_stops", stopped.get("state") == "stopped")
                check("no_native_page_errors", not errors, errors=errors)
                windows = native.owned_windows(process.pid)
                for window in windows:
                    if native.matches(window) and native.user.IsWindowVisible(window["handle"]):
                        native.user.PostMessageW(window["handle"], 0x10, 0, 0); break
                await asyncio.to_thread(process.wait, timeout=15)
                check("owned_exe_closes_gracefully", process.returncode == 0)
                report["completed"] = True
    except BaseException as error:
        report["error"] = type(error).__name__ + ": " + str(error)
        if page is not None and process is not None and process.poll() is None:
            from cpu_installer_acceptance import read_backend
            report["failure_diagnostics"] = []
            for delay in (0, 2):
                await asyncio.sleep(delay)
                try:
                    _, token = await asyncio.to_thread(read_backend, "/health")
                    activity, _ = await asyncio.to_thread(read_backend, "/next/activity?threads=1", token)
                    report["failure_diagnostics"].append({"after_seconds": delay, "activity": activity})
                    print(json.dumps({"diagnostic_busy": activity.get("busy"), "reason": activity.get("reason"), "requests": activity.get("diagnostics", {}).get("active_requests")}), flush=True)
                except Exception as diagnostic_error:
                    report["failure_diagnostics"].append({"after_seconds": delay, "error": str(diagnostic_error)})
        raise
    finally:
        if process and process.poll() is None:
            descendants = psutil.Process(process.pid).children(recursive=True)
            for child in reversed(descendants):
                try: child.terminate()
                except psutil.NoSuchProcess: pass
            process.terminate()
            try: process.wait(timeout=8)
            except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--exe", required=True, type=Path)
    parser.add_argument("--runtime-python", required=True, type=Path)
    parser.add_argument("--source-root", type=Path)
    parser.add_argument("--report", type=Path, default=ROOT / ".tmp/qa/settings-desktop.json")
    arguments = parser.parse_args()
    if not arguments.run: parser.error("Pass --run to start only the owned EXE in new QA directories.")
    asyncio.run(acceptance(arguments))
