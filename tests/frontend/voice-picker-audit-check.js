// Controlled UI integration. This origin never forwards requests to private runtime/data.
export async function runVoicePickerAudit(){
  if(location.hostname!=='127.0.0.1'||location.port!=='4351'||location.pathname!=='/fixture.html')throw Error('Wymagana odizolowana fixture na 4351/fixture.html.')
  const results=[],sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
  const until=async(fn,message)=>{const limit=performance.now()+6000;while(!await fn()){if(performance.now()>limit)throw Error(message);await sleep(30)}}
  const check=(name,value)=>{results.push({name,passed:!!value});if(!value)throw Error(name)}
  window.__voiceAudit={results}
  const qa=()=>fetch('/__qa').then(response=>response.json())
  const configure=body=>fetch('/__qa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  const dialog=()=>document.querySelector('dialog.voice-picker[open]')
  const button=(root,text)=>[...root.querySelectorAll('button')].find(el=>el.textContent.trim()===text)
  const click=async el=>{if(!el)throw Error('Brak elementu UI.');el.click();await sleep(70)}
  await configure({reset:true,failCatalog:false,delayedAudio:false})
  check('Zimny widok nie pobiera katalogu',!(await qa()).requests.length)
  await click(document.querySelector('.tool-voice-trigger'))
  check('Otwarcie wyboru głosu bez żądań backendu',!(await qa()).requests.length)
  check('Wyszukiwarka używa wspólnego Input',!!dialog().querySelector('.voice-picker-search input[data-slot=input]'))
  check('Akcje używają wspólnego Button i ButtonGroup',!!dialog().querySelector('.voice-row-actions [data-slot=button]')&&dialog().querySelectorAll('.vs-button-group').length>=2)
  check('Brak fikcyjnych filtrów kategorii, płci i wieku',!dialog().querySelector('.voice-category-chips')&&dialog().textContent.includes('Brak danych o płci')&&!button(dialog(),'Kobiecy'))
  const sampleSummaries=[...dialog().querySelectorAll('.voice-language-summary')]
  check('Nieznany model nie tworzy liczby języków głosu',sampleSummaries.length===2&&sampleSummaries.every(el=>el.getAttribute('aria-label').startsWith('Próbka:')&&el.getAttribute('aria-label').includes('brak danych o obsłudze')&&el.querySelector('.voice-language-more')?.textContent==='?'))
  await configure({failCatalog:true});await click(button(dialog(),'Sprawdź języki modelu'))
  await until(()=>button(dialog(),'Ponów odczyt języków'),'Brak ponowienia po 503.')
  check('503 pokazuje komunikat i Ponów',dialog().textContent.includes('Nie udało się odczytać'))
  await configure({failCatalog:false});await click(button(dialog(),'Ponów odczyt języków'))
  await until(()=>dialog().querySelector('.voice-language-summary')?.getAttribute('aria-label').startsWith('Model:')&&dialog().querySelector('.voice-language-summary')?.getAttribute('aria-label').includes('2 języki'),'Nie wczytano modelu.')
  check('Alias eng nie zawyża 2 języków modelu',[...dialog().querySelectorAll('.voice-language-summary')].every(el=>el.getAttribute('aria-label').includes('2 języki')&&el.querySelector('.voice-language-more')?.textContent==='+1'))
  const catalogReads=(await qa()).requests.filter(row=>row.path==='/backend/engines').length
  await click(dialog().querySelector('.voice-picker-close'));await click(document.querySelector('.tool-voice-trigger'))
  check('Ponowne otwarcie korzysta z potwierdzonego cache',(await qa()).requests.filter(row=>row.path==='/backend/engines').length===catalogReads)
  check('Model i wybór głosu korzystają z tego samego snapshotu',document.querySelector('.fixture-panel .model-trigger').textContent.includes('Model kontrolny'))
  await click(dialog().querySelector('[aria-label="Język głosu"]'));await click([...document.querySelectorAll('[role=option]')].find(el=>el.textContent.trim()==='Angielski'))
  check('Angielski znajduje dwa profile i zachowuje polski język próbki',dialog().querySelectorAll('.voice-picker-row').length===2&&[...dialog().querySelectorAll('.voice-language-line')].every(el=>el.textContent.includes('Polski')))
  const summary=dialog().querySelector('.voice-language-summary'),tooltipFor=anchor=>anchor.getAttribute('aria-describedby')?.split(/\s+/).map(id=>document.getElementById(id)).find(node=>node?.getAttribute('role')==='tooltip'&&getComputedStyle(node).visibility==='visible')
  summary.focus({preventScroll:true});await until(()=>tooltipFor(summary),'Nie pokazano Tooltip języków modelu.')
  check('Tooltip wyraźnie odróżnia pełny zakres modelu od próbki',tooltipFor(summary).textContent.includes('Zakres modelu, bez osobnego testu jakości tego głosu: Polski, Angielski')&&tooltipFor(summary).textContent.includes('Język próbki: Polski'))
  summary.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await sleep(60)
  check('Escape zamyka opis języków i zachowuje dialog oraz fokus',!tooltipFor(summary)&&!!dialog()&&document.activeElement===summary)
  const name=dialog().querySelector('.voice-row-name');name.focus();await until(()=>tooltipFor(name),'Nie pokazano Tooltip.')
  check('Pełny długi opis jest dostępny we wspólnym Tooltip',tooltipFor(name).textContent.includes('Ten opis ma pozostać w całości dostępny'))
  name.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await sleep(60)
  const group=dialog().querySelector('.voice-library-tabs .vs-button-group'),first=group.querySelector('button')
  first.focus();first.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));await sleep(30)
  check('ButtonGroup obsługuje strzałki i pojedynczy tabindex',document.activeElement.textContent==='Moje głosy'&&group.querySelectorAll('[tabindex="0"]').length===1)
  await click(document.activeElement);await click(button(dialog(),'Wszystkie głosy'))
  await configure({delayedAudio:true})
  const previews=[...dialog().querySelectorAll('.voice-row-preview')]
  await click(previews[0]);await until(()=>previews[0].getAttribute('aria-label').startsWith('Anuluj'),'Brak stanu oczekiwania.')
  check('Wczytywanie jednej próbki nie blokuje drugiej',!previews[1].disabled)
  await click(previews[1]);await until(async()=>{const q=await qa();return q.requests.some(row=>row.path.includes('/qa-alpha/audio')&&row.cancelled)},'Nie anulowano pierwszej próbki.')
  check('Przełączenie próbki anuluje poprzedni transport',true)
  await until(()=>dialog().querySelectorAll('.preview-playing').length===1,'Nie odtworzono drugiej próbki WAV.')
  check('Tylko druga próbka jest odtwarzana',dialog().querySelector('.preview-playing .voice-row-name').textContent.includes('Drugi głos'))
  await click(dialog().querySelector('.preview-playing .voice-row-preview'))
  await click(dialog().querySelector('[aria-label="Użyj głosu Drugi głos"]'))
  check('Wywołujący otrzymuje ID wybranego profilu',!dialog()&&document.querySelector('output').textContent==='qa-beta')
  return window.__voiceAudit
}

export async function runVoicePaletteAudit(){
  if(location.port!=='4351'||location.pathname!=='/fixture.html')throw Error('Wymagana fixture 4351.')
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),rows=[]
  const close=async()=>{document.querySelector('.voice-picker-close')?.click();await sleep(40)}
  const open=async()=>{document.querySelector('.tool-voice-trigger').click();await sleep(60);document.activeElement?.blur()}
  const controls=[...document.querySelectorAll('.fixture-controls select')]
  const set=(input,value)=>{input.value=value;input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}))}
  const fonts=document.querySelector('[aria-label="Tekst UI QA"]'),glass=document.querySelector('[aria-label="Krycie QA"]')
  for(const theme of [...controls[0].options].map(option=>option.value).filter(Boolean))for(const mode of ['dark','light'])for(const opacity of [70,95,100]){
    await close();set(controls[0],theme);set(controls[1],mode);set(glass,String(opacity));await sleep(170);await open()
    rows.push({theme,mode,opacity,...voicePickerMeasurements()})
  }
  await close();set(controls[0],'studio');set(controls[1],'dark');set(glass,'95');set(fonts,'12');await sleep(170);await open();const small=voicePickerMeasurements()
  await close();set(fonts,'16');await sleep(170);await open();const large=voicePickerMeasurements()
  const selected=document.querySelector('.voice-picker-row.selected');selected.classList.remove('selected');const guard=voicePickerMeasurements().selectedVisible;selected.classList.add('selected')
  const result={rows,scaling:{small,large,scales:large.nameFont>small.nameFont&&large.descriptionFont>small.descriptionFont},selectedGuardRejectsMissingMarker:!guard}
  window.__voicePaletteAudit=result
  return result
}

export function voicePickerMeasurements(){
  const d=document.querySelector('dialog.voice-picker[open]');if(!d)throw Error('Otwórz picker przed pomiarem.')
  const rgba=color=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map(value=>value/255)}
  const blend=(fg,bg)=>fg.slice(0,3).map((value,i)=>value*fg[3]+bg[i]*(1-fg[3])).concat(1)
  const background=element=>{let color=[1,1,1,1];const parents=[];for(let el=element;el;el=el.parentElement)parents.unshift(el);for(const el of parents){if(el===d)color=blend(rgba(getComputedStyle(d,'::backdrop').backgroundColor),color);color=blend(rgba(getComputedStyle(el).backgroundColor),color)}return color}
  const lum=color=>color.slice(0,3).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4).reduce((sum,value,i)=>sum+value*[.2126,.7152,.0722][i],0)
  const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
  const text=d.querySelector('.voice-row-description'),row=d.querySelector('.selected'),rect=d.getBoundingClientRect()
  const border=row?getComputedStyle(row).borderLeftColor:'transparent',borderRgba=rgba(border)
  return {descriptionContrast:contrast(blend(rgba(getComputedStyle(text).color),background(text)),background(text)),selectedVisible:!!row&&borderRgba[3]>.1&&parseFloat(getComputedStyle(row).borderLeftWidth)>0,selectedContrast:row?contrast(blend(borderRgba,background(row)),background(row)):0,font:parseFloat(getComputedStyle(d).fontSize),nameFont:parseFloat(getComputedStyle(d.querySelector('.voice-row-name strong')).fontSize),descriptionFont:parseFloat(getComputedStyle(text).fontSize),glass:getComputedStyle(d).backgroundColor,opacity:getComputedStyle(d).getPropertyValue('--glass-opacity'),overflow:d.scrollWidth-d.clientWidth,fits:rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight,languagesVisible:d.querySelector('.voice-language-summary').getBoundingClientRect().height>0}
}
