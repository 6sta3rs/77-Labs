"""Real model UI/storage acceptance in the disposable QA backend.

configure -> restart qa_session -> install -> restart qa_session -> restored.
Installs one pinned English streaming ASR model (136398284 B in this snapshot), only into the new
QA cache. No user's model is downloaded, removed or moved.
"""
from pathlib import Path
import argparse
import json
import time
from playwright.sync_api import sync_playwright, expect

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)
expect.set_options(timeout=30000)

repo = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('phase', choices=['configure', 'install', 'restored'])
args = parser.parse_args()
report_path = repo / '.tmp/qa/model-production-ui.json'
report = json.loads(report_path.read_text(encoding='utf-8')) if report_path.exists() and args.phase != 'configure' else {'checks': [], 'scope': __doc__}
cache = str((repo / '.tmp/production-session/model-cache-acceptance').resolve())
model_id = 'csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17'

def check(name, condition, **details):
    report['checks'].append({'name': name, 'passed': bool(condition), **details})
    print(json.dumps(report['checks'][-1], ensure_ascii=True), flush=True)
    if not condition: raise AssertionError(name)

with sync_playwright() as driver:
    browser = driver.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width':1280,'height':900})
    page = context.new_page()
    page.set_default_timeout(30000)
    errors=[]; page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto('http://127.0.0.1:4310', wait_until='domcontentloaded', timeout=90000)
        response = context.request.get('http://127.0.0.1:4310/backend/health')
        check('Owned QA backend: '+args.phase, response.headers.get('x-voicestudio-next') == 'seventy-seven-qa-owned')
        page.get_by_role('button',name='Ustawienia',exact=True).click()
        catalog = page.locator('.engine-catalog')
        expect(catalog.get_by_label('Pełna ścieżka do osobnego katalogu modeli')).to_be_visible()
        expect(catalog.get_by_role('button',name='Odśwież katalog',exact=True)).to_be_enabled()
        def api(path):
            response=context.request.get('http://127.0.0.1:4310/backend'+path); assert response.ok, response.text(); return response.json()
        storage=api('/next/models/storage')
        if args.phase=='configure':
            report['original']=storage['effective']
            report['configured']=cache
            check('Real TTS weights are visible', catalog.locator('.tool-list').last.locator('article').count() > 5)
            catalog.get_by_label('Pełna ścieżka do osobnego katalogu modeli').fill(cache)
            catalog.get_by_role('button',name='Zapisz katalog',exact=True).click()
            expect(catalog.get_by_text('Zapisano nową ścieżkę. Wymagany restart silnika.',exact=True)).to_be_visible(timeout=30000)
            saved=api('/next/models/storage')
            check('UI saves configured path without moving current cache',saved['configured']==cache and saved['effective']==report['original'] and saved['restart_required'])
        elif args.phase=='install':
            check('Restart applies selected cache',storage['configured']==cache and storage['effective']==cache and not storage['restart_required'])
            catalog.get_by_role('button',name='Rozpoznawanie mowy',exact=True).click()
            card=catalog.locator('article').filter(has_text=model_id)
            expect(card).to_be_visible()
            card.get_by_role('button',name='Pobierz wagi',exact=True).click()
            # Cancel during planning. Worker shutdown is separately checked with
            # a real Windows redirector/helper tree in test_model_management.py.
            cancel=card.get_by_role('button',name='Anuluj',exact=True)
            expect(cancel).to_be_visible(timeout=30000)
            cancel.click()
            expect(card.get_by_role('button',name='Wznów pobieranie',exact=True)).to_be_visible(timeout=30000)
            check('UI cancellation confirmed by backend',next(job for job in api('/next/models/jobs')['jobs'] if job['repo_id']==model_id)['state']=='cancelled')
            card.get_by_role('button',name='Wznów pobieranie',exact=True).click()
            deadline=time.monotonic()+240
            while time.monotonic()<deadline:
                job=next(job for job in api('/next/models/jobs')['jobs'] if job['repo_id']==model_id)
                print('MODEL_JOB',json.dumps(job,ensure_ascii=True),flush=True)
                if job['state']=='complete': break
                if job['state']=='failed': raise RuntimeError(job['error'])
                time.sleep(2)
            else: raise TimeoutError('Model install did not finish')
            check('Pinned model downloads and verifies from Hub', job['state']=='complete' and job['downloaded_bytes']>0,bytes=job['downloaded_bytes'],total=job['total_bytes'])
            expect(card.get_by_text('Pobieranie ukończone',exact=True)).to_be_visible(timeout=20000)
            weights=api('/models')['models']
            check('Installed state becomes visible in real catalog', next(row for row in weights if row['repo_id']==model_id)['installed'])
            check('Weights exist only in disposable selected cache',Path(cache,'models--'+model_id.replace('/','--'),'snapshots').is_dir())
            catalog.get_by_label('Pełna ścieżka do osobnego katalogu modeli').fill(report['original'])
            catalog.get_by_role('button',name='Zapisz katalog',exact=True).click()
            expect(catalog.get_by_text('Zapisano nową ścieżkę. Wymagany restart silnika.',exact=True)).to_be_visible(timeout=30000)
            check('Original QA cache selected for restoration',api('/next/models/storage')['configured']==report['original'])
        else:
            check('Original local models restored after restart', storage['configured']==report['original'] and storage['effective']==report['original'] and not storage['restart_required'])
            check('Existing local weights still installed', any(row['installed'] for row in api('/models')['models']))
        check('No uncaught model UI errors: '+args.phase,not errors,errors=errors)
        report['status']='passed-'+args.phase
    except Exception as error:
        report['status']='failed-'+args.phase; report['error']=str(error)
        page.screenshot(path=str(repo/'.tmp/model-ui-failure.png'))
        raise
    finally:
        report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        context.close();browser.close()
