"""Select animation and native keyboard acceptance: python tests/acceptance/select-ui-check.py."""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import json
import sys
from playwright.sync_api import sync_playwright, expect


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1100, "height": 900})
    page.goto(sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4310/inputy.html', wait_until='networkidle')
    trigger = page.locator('#control-4 [role="combobox"]').first
    expect(trigger).to_be_visible()
    popup = page.locator('.vs-select-popup')
    checks = []

    def check(name, condition):
        checks.append({"name": name, "passed": bool(condition)})
        assert condition, name

    def opacity_samples(action):
        return page.evaluate('''async action => {
            if(action==='open') document.querySelector('#control-4 [role="combobox"]').click();
            else document.querySelector('[role="listbox"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
            await Promise.resolve();
            const popup=document.querySelector('.vs-select-popup');
            const inert=popup?.inert && popup.getAttribute('aria-hidden')==='true';
            const values=[];
            for(let i=0;i<12;i++){const e=document.querySelector('.vs-select-popup');values.push(e?Number(getComputedStyle(e).opacity):0);await new Promise(requestAnimationFrame)}
            return {values,inert};
        }''', action)

    trigger.scroll_into_view_if_needed()
    # Drain the scroll event before opening; Select intentionally closes on page scroll.
    page.evaluate('async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)}')
    check('opening has intermediate opacity', any(0 < x < 1 for x in opacity_samples('open')['values']))
    check('open state and list focus', trigger.get_attribute('aria-expanded') == 'true' and page.locator('[role="listbox"]').evaluate('e=>e===document.activeElement'))
    check('chevron rotates', trigger.locator('.vs-control-chevron').evaluate("e=>getComputedStyle(e).transform.startsWith('matrix(-1')"))
    page.keyboard.press('End')
    closing = opacity_samples('enter')
    check('keyboard selects last option', trigger.inner_text().strip() == 'Automatycznie')
    check('closing popup immediately inert', closing['inert'])
    check('closing has intermediate opacity', any(0 < x < 1 for x in closing['values']))
    expect(popup).to_have_count(0)
    check('selection restores trigger focus', trigger.evaluate('e=>e===document.activeElement'))
    trigger.click()
    page.keyboard.press('Home')
    page.keyboard.press('Enter')
    expect(popup).to_have_count(0)
    check('Home selects first option', trigger.inner_text().strip() == 'Polski')
    trigger.click()
    page.keyboard.press('Escape')
    expect(popup).to_have_count(0)
    check('Escape closes and restores focus', trigger.evaluate('e=>e===document.activeElement'))
    trigger.click()
    page.keyboard.press('Tab')
    expect(popup).to_have_count(0)
    check('Tab moves focus onward', not trigger.evaluate('e=>e===document.activeElement'))
    trigger.click()
    page.locator('#control-4 h2').click()
    expect(popup).to_have_count(0)
    check('outside click closes', trigger.get_attribute('aria-expanded') == 'false')
    trigger.evaluate('''async e=>{
        for(let i=0;i<6;i++){e.click();await new Promise(r=>setTimeout(r,25))}
    }''')
    expect(popup).to_have_count(0)
    check('rapid reopening cleans popup', trigger.get_attribute('aria-expanded') == 'false')
    disabled = page.locator('#control-4 [role="combobox"]:disabled')
    check('disabled selector remains disabled', disabled.count() == 1 and disabled.is_disabled())
    page.emulate_media(reduced_motion='reduce')
    trigger.click()
    check('system reduced motion', popup.evaluate('e=>e.getAnimations().length===0') and trigger.locator('.vs-control-chevron').evaluate("e=>getComputedStyle(e).transitionDuration==='0s'"))
    page.keyboard.press('Escape')
    expect(popup).to_have_count(0)
    page.emulate_media(reduced_motion='no-preference')
    page.locator('#control-6 [role="switch"]').nth(1).click()
    trigger.click()
    check('application reduced motion', popup.evaluate('e=>e.getAnimations().length===0'))
    page.keyboard.press('Escape')
    expect(popup).to_have_count(0)
    page.set_viewport_size({'width': 390, 'height': 844})
    trigger.scroll_into_view_if_needed()
    page.evaluate('async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)}')
    trigger.click()
    box=popup.bounding_box()
    check('mobile popup stays in viewport', box['x']>=0 and box['x']+box['width']<=390 and box['y']>=0 and box['y']+box['height']<=844)
    page.keyboard.press('Escape')
    expect(popup).to_have_count(0)
    browser.close()
    print(json.dumps({'passed':len(checks),'checks':checks},indent=2))
