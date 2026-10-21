"""Capture public UI in a fresh Chromium profile, with backend access blocked.

Optional QA dependency: pip install playwright; playwright install chromium.
Run a dev server first, then: python scripts/capture_screenshots.py --port 4310
"""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


def capture(port: int) -> None:
    destination = ROOT / "docs/screenshots"
    destination.mkdir(parents=True, exist_ok=True)
    checks = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 960}, device_scale_factor=1)
        page = context.new_page()
        errors, backend_requests = [], []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def deny_backend(route):
            backend_requests.append(route.request.url.split("/backend", 1)[-1])
            route.abort()

        page.route("**/backend/**", deny_backend)
        page.goto(f"http://127.0.0.1:{port}/?demo=tts", wait_until="networkidle")
        expect(page.get_by_text("Fikcyjne głosy i projekty.", exact=False)).to_be_visible()
        expect(page.get_by_role("button", name="Odtwórz nagranie 5", exact=True)).to_be_visible()
        checks.append("Fictional demo and procedural audio loaded")
        page.mouse.move(220, 950)
        page.screenshot(path=str(destination / "studio.png"), animations="disabled")

        page.get_by_role("button", name="Odtwórz nagranie 5", exact=True).click()
        player = page.locator("footer.player")
        expect(player).to_have_attribute("data-playback-state", "playing")
        page.wait_for_function("document.querySelector('audio')?.currentTime > 0.2")
        player.get_by_role("button", name="Wstrzymaj", exact=True).click()
        expect(player).to_have_attribute("data-playback-state", "paused")
        seek = player.get_by_role("slider", name="Pozycja nagrania")
        seek.fill("1.2")
        expect(seek).to_have_value("1.2")
        expect(player.get_by_role("link", name="Pobierz nagranie")).to_have_attribute("href", __import__("re").compile("^blob:"))
        checks.append("Real WAV playback, pause, seek and Blob download link")

        page.get_by_role("button", name="Głosy", exact=True).click()
        expect(page.get_by_role("heading", name="Głosy", exact=True)).to_be_visible()
        expect(page.get_by_text("Anna", exact=True).first).to_be_visible()
        page.mouse.move(220, 950)
        page.screenshot(path=str(destination / "voices.png"), animations="disabled")
        checks.append("Fictional voice library mounted")

        page.get_by_role("button", name="Ustawienia", exact=True).click()
        appearance = page.get_by_role("button", name="Wygląd", exact=True)
        if appearance.count():
            appearance.click()
        expect(page.get_by_role("heading", name="Wygląd", exact=True)).to_be_visible()
        page.mouse.move(220, 950)
        page.screenshot(path=str(destination / "appearance.png"), animations="disabled")
        checks.append("Appearance settings mounted")

        if errors or backend_requests:
            raise AssertionError({"pageErrors": errors, "blockedBackendRequests": backend_requests})
        checks.append("No page errors or private backend requests")
        browser.close()
    report = {"passed": True, "checks": checks, "screenshots": ["studio.png", "voices.png", "appearance.png"], "viewport": {"width": 1440, "height": 960}}
    report_path = ROOT / ".tmp/qa/public-screenshots.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4310)
    capture(parser.parse_args().port)
