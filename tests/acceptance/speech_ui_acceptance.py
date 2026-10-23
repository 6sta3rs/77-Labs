"""One real clone synthesis from product UI, followed by Player and persistence.

Requires the disposable QA backend and its explicitly created clone. Uses a new
browser context. No microphone or user data is accessed.
"""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

from pathlib import Path
import email.policy
from email.parser import BytesParser
import hashlib
import io
import json
import time
import wave
import os
from playwright.sync_api import sync_playwright, expect

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)

expect.set_options(timeout=30000)
repo=Path(__file__).resolve().parents[2]
base=os.environ.get('SEVENTY_SEVEN_QA_UI','http://127.0.0.1:4316')
report={'checks':[], 'scope':__doc__}
def check(name,condition,**details):
    report['checks'].append({'name':name,'passed':bool(condition),**details})
    print(json.dumps(report['checks'][-1],ensure_ascii=True),flush=True)
    if not condition: raise AssertionError(name)

with sync_playwright() as driver:
    browser=driver.chromium.launch(headless=True)
    context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
    context.add_init_script("""if(!localStorage.getItem('seventy-seven-speech-qa')) {
      const project={id:'qa-speech-ui',name:'QA ustawienia i odtwarzanie',updated:new Date().toISOString(),blocks:[{id:'qa-block',voiceId:'3d7a9e9c',text:'Cześć. Sprawdzamy ustawienia głosu.'}]};
      localStorage.setItem('voicestudio.projects.v2',JSON.stringify([project]));localStorage.setItem('voicestudio.activeProject.v2',project.id);localStorage.setItem('seventy-seven-speech-qa','1');
    }""")
    page=context.new_page(); errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    network=[]
    page.on('response',lambda response:network.append({'url':response.url,'status':response.status}) if '/backend/' in response.url else None)
    page.on('requestfailed',lambda request:network.append({'url':request.url,'error':request.failure}))
    captured={}
    def capture(request):
        if request.method!='POST' or not request.url.endswith('/backend/generate'): return
        message=BytesParser(policy=email.policy.default).parsebytes(('Content-Type: '+request.headers['content-type']+'\r\n\r\n').encode()+request.post_data_buffer)
        captured.update({part.get_param('name',header='content-disposition'):part.get_payload(decode=True).decode('utf-8') for part in message.iter_parts()})
    page.on('request',capture)
    began=time.monotonic()
    try:
        page.goto(base,wait_until='domcontentloaded',timeout=90000)
        health=context.request.get(base+'/backend/health')
        check('Owned disposable backend',health.headers.get('x-voicestudio-next')=='seventy-seven-qa-owned')
        page.wait_for_selector('.navigation-sidebar',timeout=90000)
        page.get_by_role('button',name='Odśwież stan studia',exact=True).click()
        expect(page.get_by_role('button',name='Odśwież stan studia',exact=True)).to_be_enabled(timeout=60000)
        print('REFRESH_DIAGNOSTICS',json.dumps({'network':network,'statuses':page.get_by_role('status').all_text_contents()},ensure_ascii=True),flush=True)
        print('NAV_DIAGNOSTICS',json.dumps(page.evaluate("({buttons:[...document.querySelectorAll('.nav-destination')].map(n=>({text:n.textContent,label:n.getAttribute('aria-label'),role:n.getAttribute('role')})),inert:[...document.querySelectorAll('[inert]')].map(n=>({tag:n.tagName,cls:n.className,value:n.getAttribute('inert')}))})"),ensure_ascii=True),flush=True)
        page.locator('.pinned-scroll .nav-destination').first.click()
        expect(page.get_by_role('textbox',name='Tekst mówcy 1',exact=True)).to_have_value('Cześć. Sprawdzamy ustawienia głosu.')
        if os.environ.get('SEVENTY_SEVEN_QA_READ_ONLY')=='1':
            check('Read-only UI diagnosis',True,network=network,statuses=page.get_by_role('status').all_text_contents())
            report['status']='diagnostic-only';raise SystemExit(0)
        page.get_by_text('Zaawansowane ustawienia mowy',exact=True).click()
        page.get_by_label('Siła instrukcji',exact=True).fill('2.1')
        page.get_by_label('Znaki w jednym fragmencie',exact=True).fill('600')
        with page.expect_response(lambda response: response.url.endswith('/backend/generate') and response.request.method=='POST',timeout=420000) as completed:
            page.get_by_role('button',name='Wygeneruj mowę',exact=True).click()
        response=completed.value
        check('Actual synthesis returns audio',response.status==200 and response.header_value('content-type').startswith('audio/'),status=response.status)
        check('Advanced controls reach the actual backend',captured.get('guidance_scale')=='2.1' and captured.get('max_chunk_chars')=='600' and captured.get('profile_id')=='3d7a9e9c' and captured.get('engine')=='omnivoice',fields=captured)
        player=page.locator('footer.player');expect(player).to_be_visible()
        player.get_by_role('button',name='Odtwórz',exact=True).click()
        page.wait_for_function("() => document.querySelector('footer.player audio')?.currentTime>0.1")
        player.get_by_role('button',name='Wstrzymaj',exact=True).click()
        expect(player).to_have_attribute('data-playback-state','paused')
        slider=player.get_by_role('slider',name='Pozycja nagrania',exact=True)
        slider.evaluate("input=>{input.value='0.8';input.dispatchEvent(new Event('input',{bubbles:true}))}")
        page.wait_for_function("() => Math.abs(document.querySelector('footer.player audio').currentTime-0.8)<0.15")
        check('Player really plays, pauses and seeks',True)
        with page.expect_download() as download:
            player.get_by_role('link',name='Pobierz nagranie',exact=True).click()
        destination=repo/'.tmp/speech-ui-generated.wav';download.value.save_as(destination)
        data=destination.read_bytes()
        with wave.open(io.BytesIO(data)) as wav:
            duration=wav.getnframes()/wav.getframerate();rate=wav.getframerate()
        check('Downloaded result is a real WAV',len(data)>1000 and duration>0.1,bytes=len(data),duration=duration,sampleRate=rate,sha256=hashlib.sha256(data).hexdigest())
        page.reload(wait_until='domcontentloaded')
        page.locator('.sidebar-search').first.click()
        page.get_by_role('textbox',name='Szukaj ekranu',exact=True).fill('Nagrania')
        page.locator('.search-results').get_by_role('button',name='Nagrania',exact=True).click()
        page.get_by_role('button',name='Odtwórz QA ustawienia i odtwarzanie',exact=True).click()
        page.wait_for_function("() => document.querySelector('footer.player audio')?.currentTime>0.1")
        page.locator('footer.player').get_by_role('button',name='Wstrzymaj',exact=True).click()
        check('Generated Blob survives reload and plays from history',True)
        check('No uncaught UI errors',not errors,errors=errors)
        report['status']='passed'
    except Exception as error:
        report['status']='failed';report['error']=str(error)
        report['browserErrors']=errors;report['network']=network
        try:
            (repo/'.tmp/speech-ui-failure.html').write_text(page.content(),encoding='utf-8')
            page.screenshot(path=str(repo/'.tmp/speech-ui-failure.png'))
        except Exception as capture_error:
            report['captureError']=str(capture_error)
        raise
    finally:
        report['seconds']=round(time.monotonic()-began,2)
        (repo/'.tmp/qa/speech-production-ui.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        context.close();browser.close()
