"""Browser acceptance against an owned RAM-only TESTFIXTURE, never a real backend.

Requires a Python environment with Playwright/Chromium already installed.
Build the app first, then pass --dist. No dependencies are installed by this script.
"""
import argparse
import json
import hashlib
from pathlib import Path
import sys
import threading
import time
sys.path.insert(0, str(Path('scripts/runtime').resolve()))
from license_onboarding_fixture import FixtureServer, OMNI, TOKENIZER
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dist', type=Path, default=root/'dist')
parser.add_argument('--output', type=Path, default=root/'.tmp/license-onboarding-ui.json')
args = parser.parse_args()
output = args.output.resolve(); output.parent.mkdir(parents=True, exist_ok=True)
report = {'fixture': 'TESTFIXTURE', 'real_backend_requests': 0, 'checks': [], 'errors': [], 'ui_snapshots': []}
def check(name, passed, detail=None):
    report['checks'].append({'name': name, 'passed': bool(passed), 'detail': detail})
    if not passed: raise AssertionError(name)

dist = args.dist.resolve()
report['dist'] = str(dist)
report['dist_index_sha256'] = hashlib.sha256((dist/'index.html').read_bytes()).hexdigest()
server = FixtureServer(dist)
thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
url = f'http://127.0.0.1:{server.server_port}/'
report['origin'] = url
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 900})
        page = context.new_page(); page.set_default_timeout(30000)
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(url) else route.abort())
        dialog = page.locator('dialog.license-onboarding')
        checkbox = dialog.get_by_role('checkbox')
        save = dialog.get_by_role('button', name='Zapisz moje potwierdzenie dla tego modelu', exact=True)
        def snapshot(name):
            report['ui_snapshots'].append({'name':name, 'dialog': dialog.inner_text() if dialog.count() else None,
                'focus':page.evaluate('({tag:document.activeElement?.tagName,text:document.activeElement?.textContent?.slice(0,100)})'),
                'models':server.state.snapshot()['models']})
        def configure(scenario, clear=True, **options):
            server.state.configure({'scenario': scenario, **options})
            if clear and page.url.startswith(url): page.evaluate("localStorage.removeItem('voicestudio.license-onboarding.v1')")
            page.goto(url)
        def models(): return {m['repo_id']:m for m in server.state.snapshot()['models']}
        def posts(start): return [c for c in server.state.snapshot()['requests'][start:] if c['method']=='POST']

        configure('stopped')
        expect(dialog.get_by_role('button', name='Sprawdź modele i warunki',exact=True)).to_be_visible()
        check('Stopped welcome opens without a plan/details request', not any('/models/' in c['path'] for c in server.state.calls))
        check('Welcome has no checkbox', checkbox.count()==0)
        dialog.get_by_role('button',name='Sprawdź modele i warunki',exact=True).click()
        expect(dialog.get_by_role('alert')).to_be_visible()
        check('Stopped server gives error, no completed state', not dialog.locator('.complete').count())
        snapshot('stopped')

        start=len(server.state.calls); configure('none')
        expect(checkbox).to_be_visible(); expect(checkbox).not_to_be_checked(); expect(save).to_be_disabled()
        check('Initial unaccepted plan uses reads only', posts(start)==[])
        page.keyboard.press('Control+Shift+K')
        check('Modal contains application keyboard shortcuts',page.locator('dialog[open]').count()==1)
        check('Initial focus is the modal heading', page.locator('[data-onboarding-title]').evaluate('(e)=>e===document.activeElement'))
        snapshot('none')
        checkbox.check(); save.click()
        token_review=dialog.get_by_role('region', name='Warunki modelu '+TOKENIZER, exact=True)
        expect(token_review.get_by_role('checkbox')).to_be_visible(); expect(checkbox).not_to_be_checked(); expect(save).to_be_disabled()
        state=models(); check('First decision affects only OmniVoice', state[OMNI]['accepted'] and not state[TOKENIZER]['accepted'])
        check('Exactly one explicit fixture POST for first model',len(posts(start))==1)
        snapshot('omni-only')
        checkbox.check();save.click()
        done=dialog.get_by_role('button',name='Przejdź do studia',exact=True)
        expect(done).to_be_enabled();expect(done).to_be_focused()
        check('Both accepted require two separate fixture POSTs', all(m['accepted'] for m in models().values()) and len(posts(start))==2)
        check('Completion does not claim installation or inference', 'Stan instalacji modeli' in dialog.inner_text())
        snapshot('both')
        done.click()
        with page.expect_response(lambda r:r.url.endswith('/backend/next/models/onboarding')):page.reload()
        expect(dialog).to_have_count(0)
        check('Completed reload does not reopen the popup',dialog.count()==0)

        configure('changed',clear=False);expect(checkbox).to_be_visible();expect(checkbox).not_to_be_checked()
        check('Changed fingerprints invalidate completion hint',page.evaluate("localStorage.getItem('voicestudio.license-onboarding.v1')") is None)
        check('Changed terms are visible per model', 'Warunki zmieniły się' in dialog.locator('nav').inner_text())
        snapshot('changed')
        start=len(server.state.calls);dialog.get_by_role('button',name='Później',exact=True).click();expect(dialog).to_have_count(0)
        check('Postponement sends no decisions', posts(start)==[])
        page.reload();expect(checkbox).to_be_visible();expect(checkbox).not_to_be_checked()
        check('Incomplete onboarding returns after reload', dialog.is_visible())
        page.keyboard.press('Escape');expect(dialog).to_have_count(0)
        check('Escape postpones without decisions', posts(start)==[])
        page.get_by_role('button', name='Ustawienia', exact=True).click()
        page.get_by_role('button', name='Modele i silnik',exact=True).click()
        page.locator('[data-license-onboarding-open]').click();expect(checkbox).to_be_visible();expect(checkbox).not_to_be_checked()
        check('Settings button reopens the review',dialog.is_visible())

        configure('omni-only');expect(checkbox).to_be_visible();checkbox.check()
        server.state.configure({'scenario':'changed'})
        start=len(server.state.calls);save.click()
        expect(dialog.locator('.license-error')).to_contain_text('zmieniły się')
        expect(checkbox).not_to_be_checked();expect(save).to_be_disabled()
        check('409 does not retry the old decision',len(posts(start))==1 and not any(m['accepted'] for m in models().values()))
        check('409 updates parent row from the authoritative read','Warunki zmieniły się' in dialog.locator('nav button.selected').inner_text())
        snapshot('409')

        configure('revoked',clear=False);expect(checkbox).to_be_visible()
        check('Revocation reopens only the pending model', 'cofnięte' in dialog.locator('nav button.selected').inner_text() and models()[TOKENIZER]['accepted'])

        configure('legacy056');expect(dialog.get_by_role('alert')).to_contain_text('Zaktualizuj')
        check('Legacy API cannot become a complete plan',dialog.locator('.complete').count()==0 and checkbox.count()==0)
        snapshot('legacy056')
        configure('offline');dialog.get_by_role('button',name='Sprawdź modele i warunki',exact=True).click()
        expect(dialog.get_by_role('alert')).to_be_visible()
        check('Offline error remains retryable and incomplete',dialog.get_by_role('button',name='Spróbuj ponownie',exact=True).is_enabled() and not dialog.locator('.complete').count())

        configure('none',details_delay_ms=1500)
        expect(dialog).to_be_visible();dialog.get_by_role('button',name='Później',exact=True).click();expect(dialog).to_have_count(0)
        time.sleep(2)
        check('Late read does not reopen a postponed dialog',dialog.count()==0)
        server.state.configure({'scenario':'omni-only'})
        page.evaluate("window.dispatchEvent(new Event('studio:license-onboarding-open'))")
        expect(dialog.get_by_role('region',name='Warunki modelu '+TOKENIZER,exact=True).get_by_role('checkbox')).to_be_visible()
        check('Fresh open replaces an older delayed plan',TOKENIZER in dialog.locator('nav button.selected').inner_text())

        configure('omni-only',decision_delay_ms=1500);expect(checkbox).to_be_visible();checkbox.check();save.click()
        close=dialog.get_by_role('button',name='Odłóż przegląd warunków',exact=True)
        expect(close).to_be_disabled();expect(dialog.get_by_role('button',name='Później',exact=True)).to_be_disabled()
        page.keyboard.press('Escape');check('Escape cannot close during a decision',dialog.is_visible())
        expect(dialog.get_by_role('button',name='Przejdź do studia',exact=True)).to_be_enabled()
        check('Write/reconciliation lock releases only after authoritative result', all(m['accepted'] for m in models().values()))
        check('No browser runtime errors',not report['errors'],report['errors'])
        check('No generation/model installation requests',not any(c['path'] in ['/generate','/next/models/install'] for c in server.state.calls))
        check('Fixture never forwards to a real backend',server.state.snapshot()['real_backend_requests']==0)
        page.screenshot(path=str(output.with_suffix('.png')))
        report['requests']=server.state.snapshot()['requests']
        browser.close()
except Exception as error:
    report['failure']=repr(error)
    raise
finally:
    server.shutdown();server.server_close()
    target=output
    target.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'passed':sum(c['passed'] for c in report['checks']),'checks':len(report['checks']),'failure':report.get('failure'),'report':str(target)},ensure_ascii=False),flush=True)
