"""Isolated smoke of the built EXE over CDP: the window starts, the settings pages mount (at least 12), Settings -> Silnik renders, no page errors.
Usage: python tests/acceptance/exe_smoke.py <exe> <out-dir> [--baseline-seconds N] [--max-factor 1.5] [--busy-port]
--busy-port occupies 127.0.0.1:4312 first, presses "Uruchom silnik" and expects the Polish "jest zajęty" message within 5 s.
Fresh LOCALAPPDATA/APPDATA/WebView profile in %TEMP%; no engine start, no synthesis, no network use by this script.
It reports the cold start (process start until the app has mounted) and fails when a baseline is given and exceeded by the factor.
Needs: Windows with WebView2, `pip install playwright` (it connects to the running WebView2, no browser download needed).
"""
import asyncio, json, os, socket, subprocess, sys, tempfile, time, uuid
from pathlib import Path


async def main(exe: Path, out: Path, baseline=None, factor=1.5, busy=False):
    from playwright.async_api import async_playwright
    out.mkdir(parents=True, exist_ok=True)
    with socket.socket() as guard:
        guard.bind(("127.0.0.1", 0)); port = guard.getsockname()[1]
    session = Path(tempfile.gettempdir()).resolve() / ("sqa-" + uuid.uuid4().hex[:8])
    local, roaming, profile = session / "L", session / "R", session / "W"
    for p in (local, roaming, profile): p.mkdir(parents=True)
    env = dict(os.environ)
    for key in list(env):
        if key.startswith(("OMNIVOICE_", "HF_", "HUGGINGFACE_", "WEBVIEW2_")) or key in {"PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV"}:
            env.pop(key, None)
    env.update(LOCALAPPDATA=str(local), APPDATA=str(roaming), VOICESTUDIO_NEXT_PRELOAD_TTS="0",
               WEBVIEW2_USER_DATA_FOLDER=str(profile),
               WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=f"--remote-debugging-port={port} --remote-debugging-address=127.0.0.1 --no-first-run")
    report = {"checks": []}
    errors = []
    def check(name, passed, **d):
        report["checks"].append({"name": name, "passed": bool(passed), **d}); print(json.dumps(report["checks"][-1], ensure_ascii=True), flush=True)
    blocker = None
    if busy:
        blocker = socket.socket(); blocker.bind(("127.0.0.1", 4312)); blocker.listen(1)
    started = time.monotonic()
    process = subprocess.Popen([str(exe)], cwd=exe.parent, env=env, stdin=subprocess.PIPE,
                               stdout=(out / "desktop.log").open("wb"), stderr=subprocess.STDOUT, creationflags=0x08000000)
    try:
        async with async_playwright() as driver:
            for _ in range(200):
                if process.poll() is not None: raise RuntimeError("EXE exited before CDP")
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=.2): break
                except OSError: await asyncio.sleep(.1)
            browser = await driver.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
            context = browser.contexts[0]
            for _ in range(100):
                if context.pages: break
                await asyncio.sleep(.1)
            page = context.pages[0]
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.set_default_timeout(30000)
            await page.wait_for_selector(".settings-trigger")
            cold = round(time.monotonic() - started, 2)
            check("window_starts_and_app_mounts", True, title=await page.title(), url=page.url, cold_start_seconds=cold)
            if baseline: check("cold_start_within_baseline", cold <= baseline * factor, cold_start_seconds=cold, baseline_seconds=baseline, max_factor=factor)
            try:
                await page.get_by_role("button", name="Odłóż przegląd warunków", exact=True).evaluate("e=>e.click()", timeout=3000)
            except Exception:  # the licence review banner is optional
                pass
            await page.get_by_role("button", name="Ustawienia", exact=True).evaluate("e=>e.click()")
            await page.locator(".settings-navigation nav").wait_for()
            labels = [t.strip() for t in await page.locator(".settings-navigation nav button").all_text_contents()]
            check("settings_navigation_renders", len(labels) >= 12, count=len(labels), labels=labels)
            await page.locator(".settings-navigation nav").get_by_role("button", name="Silnik", exact=True).evaluate("e=>e.click()")
            await asyncio.sleep(1.5)
            await page.screenshot(path=str(out / "settings-engine.png"))
            check("engine_page_opens", await page.locator("main, .settings-page, section").count() > 0)
            for label in labels:
                await page.locator(".settings-navigation nav").get_by_role("button", name=label, exact=True).evaluate("e=>e.click()")
                await asyncio.sleep(.2)
            check("all_settings_pages_mount_without_errors", not errors, errors=errors)
            if busy:
                await page.locator(".settings-navigation nav").get_by_role("button", name="Silnik", exact=True).evaluate("e=>e.click()")
                pressed = time.monotonic()
                await page.get_by_role("button", name="Uruchom silnik", exact=True).first.evaluate("e=>e.click()")
                await page.get_by_text("jest zajęty").first.wait_for(timeout=5000)
                check("busy_port_message_within_5_seconds", True, seconds=round(time.monotonic() - pressed, 2))
    finally:
        (out / "report.json").write_text(json.dumps(report, indent=1, ensure_ascii=True), encoding="utf8")
        if blocker: blocker.close()
        process.terminate()
        try: process.wait(10)
        except Exception: process.kill()
    ok = all(c["passed"] for c in report["checks"])
    print("RESULT", "PASS" if ok else "FAIL")
    return ok


def option(name, default=None):
    return float(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default


result = asyncio.run(main(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve(), option("--baseline-seconds"), option("--max-factor", 1.5), "--busy-port" in sys.argv))
sys.exit(0 if result else 1)
