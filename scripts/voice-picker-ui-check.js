import {voicePickerMeasurements} from './voice-picker-audit-check.js'
export async function runVoicePickerCheck(){
  if(!['127.0.0.1','localhost'].includes(location.hostname)||new URLSearchParams(location.search).get('demo')!=='tts')throw Error('Test wymaga lokalnego ?demo=tts.')
  const checks=[],before=JSON.stringify({...localStorage}),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
  window.__voicePickerChecks={checks}
  const check=(name,pass)=>{checks.push({name,passed:!!pass});if(!pass)throw Error(name)}
  const until=async(fn,message)=>{const limit=performance.now()+6000;while(!fn()){if(performance.now()>limit)throw Error(message);await sleep(30)}}
  const click=async el=>{if(!el)throw Error('Brak elementu UI.');el.click();await sleep(60)}
  const dialog=()=>document.querySelector('dialog.voice-picker[open]'),rows=()=>[...dialog().querySelectorAll('.voice-picker-row')]
  const select=async label=>{await click(dialog().querySelector('[aria-label="Język głosu"]'));await click([...document.querySelectorAll('[role=option]')].find(el=>el.textContent.trim()===label))}
  if(!dialog())await click(document.querySelector('.voice-pill'))
  check('Pełna lista 12 głosów',rows().length===12)
  check('Wspólne Input, Button i ButtonGroup',!!dialog().querySelector('input[data-slot=input]')&&!!dialog().querySelector('.voice-library-tabs .vs-button-group')&&!!dialog().querySelector('.voice-row-actions [data-slot=button]'))
  check('Fokus w wyszukiwaniu',document.activeElement===dialog().querySelector('input[type=search]'))
  check('Złożona wyszukiwarka ma jeden fokus na kontenerze',getComputedStyle(dialog().querySelector('input[type=search]')).outlineStyle==='none'&&getComputedStyle(dialog().querySelector('.voice-picker-search')).boxShadow!=='none')
  document.activeElement.blur();const measurement=voicePickerMeasurements()
  check('Kontrast opisu minimum 4.5:1',measurement.descriptionContrast>=4.5)
  check('Zaznaczenie jest nieprzezroczyste i kontrastowe',measurement.selectedVisible&&measurement.selectedContrast>=3)
  const selected=dialog().querySelector('.selected');selected.classList.remove('selected');const rejected=!voicePickerMeasurements().selectedVisible;selected.classList.add('selected')
  check('Regresja odrzuca brak zaznaczenia',rejected)
  const sampleLanguages=new Map(rows().map(row=>[row.querySelector('strong').textContent,row.querySelector('.voice-language-line').textContent]))
  await select('Angielski');check('Angielski obejmuje 12 profili i nie zmienia języka ani akcentu próbki',rows().length===12&&rows().every(row=>row.querySelector('.voice-language-line').textContent===sampleLanguages.get(row.querySelector('strong').textContent)))
  const anna=rows().find(row=>row.querySelector('strong').textContent==='Anna'),summary=anna.querySelector('.voice-language-summary')
  check('Licznik deklaracji profilu ma 7 języków i +6',summary.getAttribute('aria-label').includes('Profil:')&&summary.getAttribute('aria-label').includes('7 języków')&&summary.querySelector('.voice-language-more').textContent==='+6')
  const tooltip=()=>summary.getAttribute('aria-describedby')?.split(/\s+/).map(id=>document.getElementById(id)).find(node=>node?.getAttribute('role')==='tooltip'&&getComputedStyle(node).visibility==='visible')
  summary.focus({preventScroll:true});await until(tooltip,'Nie pokazano języków profilu w Tooltip.')
  check('Tooltip zachowuje źródło, 7 nazw i język próbki',tooltip().textContent.includes('Języki zadeklarowane w profilu')&&['Polski','Angielski','Niemiecki','Francuski','Hiszpański','Włoski','Portugalski'].every(language=>tooltip().textContent.includes(language))&&tooltip().textContent.includes('Język próbki: Polski'))
  summary.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await sleep(60)
  check('Escape zamyka Tooltip i zachowuje fokus licznika oraz dialog',!tooltip()&&document.activeElement===summary&&!!dialog())
  await select('Niemiecki');check('Niemiecki zawęża listę do 6 profili',rows().length===6)
  await click(dialog().querySelector('.voice-filter-reset'));await click(dialog().querySelector('[aria-label="Użyj głosu Emilia"]'))
  check('Wybór zachowuje właściwego mówcę',!dialog()&&document.querySelector('.voice-pill').textContent.includes('Emilia'))
  check('Bez zapisów biblioteki i żądań backendu',before===JSON.stringify({...localStorage})&&performance.getEntriesByType('resource').every(row=>!row.name.includes('/backend/')))
  return window.__voicePickerChecks={checks,measurement}
}
export async function runVoicePickerMobileCheck(){
  if(new URLSearchParams(location.search).get('demo')!=='tts')throw Error('Wymagane demo TTS.')
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
  let dialog=document.querySelector('dialog.voice-picker[open]');if(!dialog){document.querySelector('.voice-pill').click();await sleep(100);dialog=document.querySelector('dialog.voice-picker[open]')}
  const summary=dialog.querySelector('.voice-language-summary');summary.focus({preventScroll:true})
  const tooltip=()=>summary.getAttribute('aria-describedby')?.split(/\s+/).map(id=>document.getElementById(id)).find(node=>node?.getAttribute('role')==='tooltip'&&getComputedStyle(node).visibility==='visible')
  const limit=performance.now()+6000;while(!tooltip()){if(performance.now()>limit)throw Error('Nie pokazano mobilnego Tooltip języków.');await sleep(30)}
  const box=tooltip().getBoundingClientRect(),result={...voicePickerMeasurements(),languagesTooltip:tooltip().textContent,tooltipFits:box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight}
  if(!result.fits||!result.languagesVisible||result.overflow>1||!result.languagesTooltip||!result.tooltipFits)throw Error('Błąd mobilny: '+JSON.stringify(result))
  summary.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await sleep(60)
  return result
}
