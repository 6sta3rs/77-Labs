"""Browser acceptance against disposable QA data. Needs Python Playwright.

Creates one named QA clone from the public fixture. No microphone is recorded.
Uses a new temporary browser context, never the user's browser profile.
"""
from pathlib import Path
import json
import time
from playwright.sync_api import sync_playwright, expect

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)

repo = Path(__file__).resolve().parents[2]
checks = []
def check(name, condition, **details):
    checks.append({"name": name, "passed": bool(condition), **details})
    print(json.dumps(checks[-1], ensure_ascii=True), flush=True)
    if not condition:
        raise AssertionError(name)

with sync_playwright() as driver:
    browser = driver.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    completed = False
    failure = ''
    try:
        page.goto('http://127.0.0.1:4310', wait_until='domcontentloaded', timeout=90000)
        response = context.request.get('http://127.0.0.1:4310/backend/health')
        check('Owned QA backend', response.headers.get('x-voicestudio-next') == 'seventy-seven-qa-owned')
        page.get_by_role('button', name='Dodaj głos', exact=True).click()
        form = page.locator('.voice-clone-form')
        expect(form).to_be_visible()
        name = 'QA klon z formularza ' + str(int(time.time()))
        form.get_by_label('Nazwa głosu', exact=True).fill(name)
        form.get_by_role('combobox', name='Język nagrania', exact=True).click()
        page.get_by_role('option', name='Angielski', exact=True).click()
        form.get_by_label('Nagranie referencyjne', exact=True).set_input_files(str(repo / 'public/demo/interface-tone.wav'))
        form.get_by_label('Tekst wypowiedziany w próbce', exact=True).fill('Cześć. To jest test nowego studia głosu.')
        expect(form.locator('audio')).to_be_visible()
        form.locator('audio').evaluate('(audio)=>audio.play()')
        page.wait_for_function("document.querySelector('.voice-clone-form audio')?.currentTime > 0.05")
        duration = form.locator('audio').evaluate('(audio)=>{audio.pause();return audio.duration}')
        check('Reference audio plays and has real duration', 3 < duration < 4, duration=duration)
        expect(form.get_by_label('Tekst wypowiedziany w próbce', exact=True)).to_have_value('Cześć. To jest test nowego studia głosu.')
        form.get_by_role('button', name='Zapisz klon głosu', exact=True).click()
        expect(form).not_to_be_visible(timeout=60000)
        profiles = context.request.get('http://127.0.0.1:4310/backend/profiles').json()
        created = next(row for row in profiles if row['name'] == name)
        check('Clone saved through actual UI in selected language', created['language'] == 'English', id=created['id'])
        page.get_by_role('button', name='Głosy', exact=True).first.click()
        manager = page.get_by_role('region', name='Projektowanie i zarządzanie głosami')
        # HTML section has an accessible name but may use generic role in older engines.
        manager = page.locator('.voice-manager')
        expect(manager.get_by_role('combobox', name='Profil do edycji', exact=True)).to_be_enabled()
        picker = manager.get_by_role('combobox', name='Profil do edycji', exact=True)
        picker.scroll_into_view_if_needed()
        page.wait_for_timeout(150)
        picker.click()
        print('PROFILE_OPTIONS', page.get_by_role('option').all_text_contents(), flush=True)
        page.get_by_role('option', name=name, exact=True).click()
        manager.get_by_role('button', name='Wczytaj próbkę głosu', exact=True).click()
        sample = manager.locator('audio')
        expect(sample).to_be_visible(timeout=30000)
        sample.evaluate('(audio)=>audio.play()')
        page.wait_for_function("document.querySelector('.voice-manager audio')?.currentTime > 0.05")
        sample.evaluate('(audio)=>{audio.pause();audio.currentTime=1}')
        check('Stored clone reference plays and seeks', sample.evaluate('(audio)=>audio.currentTime') > 0.9)
        with page.expect_download() as downloaded:
            manager.get_by_role('link', name='Pobierz próbkę', exact=True).click()
        file = downloaded.value
        check('Sample download contains actual WAV', Path(file.path()).read_bytes()[:4] == b'RIFF')
        page.reload(wait_until='domcontentloaded')
        profiles = context.request.get('http://127.0.0.1:4310/backend/profiles').json()
        check('Clone persists after reopening UI', any(row['id'] == created['id'] for row in profiles))
        page.get_by_role('button', name='Audiobooki', exact=True).first.click()
        expect(page.get_by_text('QA dwa rozdziały', exact=True).first).to_be_visible(timeout=30000)
        check('Real finished audiobook visible in product library', True)
        page.get_by_role('button', name='Dubbing', exact=True).first.click()
        page.get_by_role('button', name='Adres materiału', exact=True).click()
        expect(page.get_by_label('Adres materiału do dubbingu', exact=True)).to_be_visible()
        check('URL ingestion control is reachable', True)
        check('No uncaught browser errors', not errors, errors=errors)
        check('No horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        completed = True
    except Exception as error:
        failure = str(error)
        (repo / '.tmp/ui-failure.html').write_text(page.content(), encoding='utf-8')
        page.screenshot(path=str(repo / '.tmp/ui-failure.png'))
        raise
    finally:
        (repo / '.tmp/qa/voice-production-ui.json').write_text(json.dumps({"status": "passed" if completed else "failed", "error": failure, "scope": "Temporary browser context and disposable QA database. Upload/clone/reference playback/seek/download/reload and production views. Physical microphone and subjective voice similarity not tested.", "checks": checks}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        context.close(); browser.close()
