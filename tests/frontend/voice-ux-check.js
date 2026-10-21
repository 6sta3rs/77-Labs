// Local fixture only. Explicit folder actions persist ONLY under the isolated QA origin.
export async function runVoiceUxCheck(){
 if(location.hostname!=='127.0.0.1'||location.port!=='4351'||location.pathname!=='/fixture.html')throw Error('Wymagana fixture 4351/fixture.html')
 const checks=[],sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),check=(name,passed)=>{checks.push({name,passed:!!passed});if(!passed)throw Error(name)}
 window.__voiceUx={checks}
 const click=async el=>{if(!el)throw Error('Brak kontrolki');el.focus();el.click();await sleep(80)}
 const field=(el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}))}
 const dialog=()=>document.querySelector('dialog.voice-picker[open]'),button=(root,text)=>[...root.querySelectorAll('button')].find(el=>el.textContent.trim()===text)
 if(!dialog())await click(document.querySelector('.tool-voice-trigger'))
 const rows=()=>[...dialog().querySelectorAll('.voice-picker-row')]
 check('Rzeczywista data jest mapowana z sekund backendu',rows()[0].querySelector('time').dateTime==='2024-01-15T12:00:00.000Z')
 check('Brak daty nie jest wymyśloną datą utworzenia',rows()[1].querySelector('time').textContent==='Brak daty')
 check('Akcent wyłącznie z jawnych danych',!rows()[0].querySelector('.voice-accent')&&rows()[1].querySelector('.voice-accent').textContent==='Standardowy')
 check('Wiersz desktopowy jest kompaktowy',rows()[0].getBoundingClientRect().height<=66)
 check('Język i licznik w jednym wierszu',getComputedStyle(rows()[0].querySelector('.voice-row-language')).flexDirection==='row')
 check('Brak rozbudowanego panelu języków',!dialog().querySelector('.voice-language-details'))
 const preview=rows()[0].querySelector('.voice-row-preview'),avatar=preview.querySelector('.voice-avatar-image'),overlay=preview.querySelector('.voice-preview-icon'),rect=preview.getBoundingClientRect()
 check('Odsłuch obejmuje pełną kulę bez wychodzenia poza koło',[avatar,overlay].every(el=>Math.abs(el.getBoundingClientRect().width-rect.width)<1&&Math.abs(el.getBoundingClientRect().height-rect.height)<1)&&getComputedStyle(preview).overflow==='hidden')
 const trigger=dialog().querySelector('[aria-label="Język głosu"]')
 check('Filtr języka ma wysokość 42 px',trigger.getBoundingClientRect().height>=42)
 await click(trigger);await click([...document.querySelectorAll('[role=option]')].find(el=>el.textContent.trim()==='Polski'))
 check('Wybrany język ma flagę i osobny reset',!!dialog().querySelector('.voice-language-filter .language-flag')&&!!dialog().querySelector('[aria-label="Usuń filtr języka"]'))
 await click(dialog().querySelector('[aria-label="Usuń filtr języka"]'))
 check('Reset języka zachowuje przycisk i usuwa filtr',dialog().querySelector('[aria-label="Język głosu"]').textContent.includes('Wszystkie języki')&&!dialog().querySelector('[aria-label="Usuń filtr języka"]'))
 rows()[0].querySelector('.voice-row-name').focus();await sleep(80)
 check('Fokus klawiatury odsłania akcje',getComputedStyle(rows()[0].querySelector('.voice-row-actions')).visibility==='visible')
 await click(rows()[0].querySelector('[aria-label^="Dodaj głos"]'))
 const name=dialog().querySelector('[aria-label="Nazwa nowego folderu"]');field(name,'Narracja QA');await click(button(dialog().querySelector('.voice-folder-form'),'Zapisz'))
 check('Dodaj zapisuje do rzeczywistego lokalnego folderu',JSON.parse(localStorage.getItem('voicestudio.voiceFolders.v1')).some(folder=>folder.name==='Narracja QA'&&folder.voiceIds.includes('qa-alpha')))
 await click(dialog().querySelector('[aria-label="Folder głosów"]'));await click([...document.querySelectorAll('[role=option]')].find(el=>el.textContent.includes('Narracja QA')))
 check('Folder pokazuje tylko zapisany głos',rows().length===1&&rows()[0].textContent.includes('Głos Alfa'))
 rows()[0].querySelector('.voice-row-name').focus();await click(rows()[0].querySelector('summary'));await sleep(80)
 const menu=rows()[0].querySelector('.voice-menu-items'),box=menu.getBoundingClientRect()
 check('Menu ma ID, link i zapis do folderu',menu.textContent.includes('Skopiuj ID głosu')&&menu.textContent.includes('Skopiuj link do głosu')&&menu.textContent.includes('Zapisz do folderu'))
 check('Menu mieści się w ekranie',box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight)
 menu.querySelector('button').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await sleep(50)
 check('Escape zamyka menu i przywraca fokus',!rows()[0].querySelector('details').open&&document.activeElement===rows()[0].querySelector('summary'))
 await click(dialog().querySelector('.voice-picker-close'));await click(document.querySelector('.tool-voice-trigger'))
 check('Zapis jest dostępny po ponownym otwarciu',dialog().textContent.includes('Narracja QA'))
 return window.__voiceUx
}

export async function runVoiceCreateNavigationCheck(){
 if(new URLSearchParams(location.search).get('demo')!=='tts')throw Error('Wymagane demo TTS')
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),checks=[],check=(name,passed)=>{checks.push({name,passed:!!passed});if(!passed)throw Error(name)}
 if(!document.querySelector('dialog.voice-picker[open]')){document.querySelector('.voice-pill').click();await sleep(100)}
 const add=[...document.querySelector('dialog.voice-picker[open]').querySelectorAll('button')].find(el=>el.textContent.trim()==='Dodaj głos');add.click();await sleep(150)
 check('Dodaj głos otwiera stronę bez popupu',!!document.querySelector('.voice-create-page')&&!document.querySelector('dialog[open]')&&!document.querySelector('.modal-backdrop'))
 check('Strona domyślnie oferuje klonowanie',!!document.querySelector('.voice-clone-form'))
 const design=[...document.querySelector('.voice-create-page').querySelectorAll('button')].find(el=>el.textContent.trim()==='Zaprojektuj głos');design.click();await sleep(80)
 check('Projektowanie jest osobną metodą na stronie',!!document.querySelector('.voice-design-form')&&!document.querySelector('.voice-clone-form'))
 check('Demo nie uruchamia zapisu do silnika',document.querySelector('.voice-design-form button[type=submit]').disabled)
 return {checks}
}
