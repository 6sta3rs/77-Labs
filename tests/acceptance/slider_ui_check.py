"""Real slider acceptance in an isolated Chromium context; requires Python Playwright.

Run against the dev gallery: python tests/acceptance/slider_ui_check.py
"""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import json
from playwright.sync_api import sync_playwright, expect


def run():
    checks = []

    def check(name, passed):
        checks.append({"name": name, "passed": bool(passed)})
        assert passed, name

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1100, "height": 900})
        page.goto("http://127.0.0.1:4310/inputy", wait_until="networkidle")
        sliders = page.locator("#control-5 .vs-slider")
        collapsed = sliders.nth(1)
        check("collapsed value stays plain", collapsed.locator('.vs-slider-inline-value').evaluate("e=>getComputedStyle(e).borderRadius === '0px' && getComputedStyle(e).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(e).padding === '0px'"))
        check("collapsed panel inert and zero height", collapsed.locator('.vs-slider-panel-shell').evaluate("e=>e.inert && e.getBoundingClientRect().height === 0"))
        for action in ['expand', 'collapse']:
            heights = collapsed.evaluate("""async e => {
                const panel=e.querySelector('.vs-slider-panel-shell');
                const heights=[panel.getBoundingClientRect().height];
                e.querySelector('button').click();
                for(let i=0;i<20;i++){await new Promise(requestAnimationFrame);heights.push(panel.getBoundingClientRect().height)}
                return heights;
            }""")
            low, high = min(heights), max(heights)
            check(action + " has intermediate heights", any(low+1 < h < high-1 for h in heights))
        check("rapid reversal settles closed", collapsed.evaluate("""async e => {
            for(let i=0;i<6;i++){e.querySelector('button').click();await new Promise(r=>setTimeout(r,30))}
            await new Promise(r=>setTimeout(r,250));
            const panel=e.querySelector('.vs-slider-panel-shell');
            return panel.inert && panel.getBoundingClientRect().height === 0;
        }"""))
        check("collapsed range cannot receive focus", collapsed.locator('input').evaluate("e=>{e.focus();return document.activeElement !== e}"))
        speed = sliders.nth(2)
        track = speed.locator("input")
        speed.scroll_into_view_if_needed()
        check("default inline value", speed.locator(".vs-slider-inline-value").inner_text() == "1.00\u00d7")
        disclosure = sliders.nth(0).locator("button")
        disclosure.hover()
        check("transparent header on real hover", disclosure.evaluate("e=>getComputedStyle(e).backgroundColor") == "rgba(0, 0, 0, 0)")
        track.focus()
        track.press("Home")
        check("native Home and inline sync", track.input_value() == "0.5" and speed.locator(".vs-slider-inline-value").inner_text() == "0.50\u00d7")
        bubble = page.locator(".vs-slider-value")
        bubble.wait_for(state="visible")
        page.wait_for_timeout(120)
        check("short transform transition", bubble.evaluate("e=>getComputedStyle(e).transitionProperty === 'transform' && parseFloat(getComputedStyle(e).transitionDuration)>0 && parseFloat(getComputedStyle(e).transitionDuration)<=0.1"))
        positions = track.evaluate("""async e => {
          const bubble=document.querySelector('.vs-slider-value');
          const x=()=>bubble.getBoundingClientRect().left;
          const samples=[x()];
          e.value=e.max; e.dispatchEvent(new Event('input',{bubbles:true}));
          for(let i=0;i<12;i++){await new Promise(requestAnimationFrame);samples.push(x())}
          return samples;
        }""")
        check("motion has intermediate frames", any(positions[0]+1 < x < positions[-1]-1 for x in positions))
        check("motion is monotonic", all(b >= a-0.1 for a, b in zip(positions, positions[1:])))
        check("tooltip and inline reflect maximum", bubble.inner_text() == "2.00\u00d7" and speed.locator(".vs-slider-inline-value").inner_text() == "2.00\u00d7")
        track.press("ArrowLeft")
        check("native keyboard step", track.input_value() == "1.95")
        track.press("Escape")
        opacity = bubble.evaluate("""async e => {
            const values=[]; for(let i=0;i<12;i++){values.push(Number(getComputedStyle(e).opacity));await new Promise(requestAnimationFrame)} return values;
        }""")
        check("tooltip fades out through intermediate opacity", any(0 < v < 1 for v in opacity))
        expect(bubble).to_have_count(0)
        check("Escape dismisses tooltip", bubble.count() == 0)
        check("Escape preserves inline", speed.locator(".vs-slider-inline-value").inner_text() == "1.95\u00d7")
        rect = track.bounding_box()
        page.mouse.move(rect['x']+rect['width']/2, rect['y']+rect['height']/2)
        page.mouse.down()
        page.mouse.move(rect['x']+rect['width']*.75, rect['y']+rect['height']/2, steps=20)
        page.mouse.up()
        check("real pointer drag updates value", 1.5 < float(track.input_value()) < 1.8)
        check("drag inline and tooltip agree", speed.locator(".vs-slider-inline-value").inner_text() == bubble.inner_text())
        sliders.nth(3).locator("input").hover()
        expect(bubble).to_have_count(0)
        check("right-only variant has no tooltip", bubble.count() == 0 and sliders.nth(3).locator(".vs-slider-inline-value").is_visible())
        tooltip_only = sliders.nth(1)
        tooltip_only.locator("button").click()
        expect(bubble).to_have_count(0)
        check("tooltip-only expanded has no inline", tooltip_only.locator(".vs-slider-inline-value").count() == 0)
        page.wait_for_timeout(250)
        tooltip_only.locator("input").hover()
        opacity = bubble.evaluate("""async e => {
            const values=[]; for(let i=0;i<12;i++){values.push(Number(getComputedStyle(e).opacity));await new Promise(requestAnimationFrame)} return values;
        }""")
        check("tooltip fades in through intermediate opacity", any(0 < v < 1 for v in opacity))
        check("tooltip-only hover shows value", bubble.is_visible())
        tooltip_only.locator("button").click()
        expect(bubble).to_have_count(0)
        check("collapsed summary and tooltip cleanup", tooltip_only.locator(".vs-slider-inline-value").inner_text() == "75%" and bubble.count() == 0)
        check("disabled input and readable value", sliders.nth(4).locator("input").is_disabled() and sliders.nth(4).locator(".vs-slider-inline-value").inner_text() == "40")
        track.hover()
        page.emulate_media(reduced_motion="reduce")
        check("system reduced motion", bubble.evaluate("e=>getComputedStyle(e).transitionDuration") == "0s")
        page.emulate_media(reduced_motion="no-preference")
        page.locator('#control-6 [role="switch"]').nth(1).click()
        track.hover()
        check("application reduced motion", bubble.evaluate("e=>parseFloat(getComputedStyle(e).transitionDuration)") == 0)
        page.set_viewport_size({"width": 390, "height": 844})
        for key in ["Home", "End"]:
            track.press(key)
            page.wait_for_timeout(100)
            box = bubble.bounding_box()
            check("mobile tooltip bounds " + key, box['x'] >= 0 and box['x'] + box['width'] <= 390)
        check("mobile no overflow", page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        browser.close()
    print(json.dumps({"passed": len(checks), "checks": checks}, indent=2))


if __name__ == "__main__":
    run()
