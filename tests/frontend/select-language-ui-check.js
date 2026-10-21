// Run in the isolated voice-audit gallery/app on localhost:4351. No private backend.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, message) { const limit=performance.now()+6000;while(!fn()){if(performance.now()>limit)throw Error(message);await sleep(30)} }
const field = (label, root=document) => root.querySelector(`[role=combobox][aria-label="${label}"]`)
const option = label => [...document.querySelectorAll('[role=option]')].find(el=>el.textContent.trim()===label)
const style = el => ({background:getComputedStyle(el).backgroundColor,outline:getComputedStyle(el).outlineStyle,width:getComputedStyle(el).outlineWidth})
async function click(el){if(!el)throw Error('Brak kontrolki.');el.focus({preventScroll:true});el.click();await sleep(90)}
function key(el,value){el.dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}))}
async function pointer(el){el.dispatchEvent(new PointerEvent('pointermove',{pointerType:'mouse',bubbles:true}));await sleep(60)}
function recorder(key){const result={checks:[]};window[key]=result;return {result,check:(name,passed)=>{result.checks.push({name,passed:!!passed});if(!passed)throw Error(name)}}}
function requireOrigin(){if(location.hostname!=='127.0.0.1'||location.port!=='4351')throw Error('Wymagany odizolowany serwer 4351.')}

export async function runSelectLanguageGalleryCheck(){
  requireOrigin();if(location.pathname!=='/inputy.html')throw Error('Wymagana galeria inputy.html.')
  const {result,check}=recorder('__selectLanguageGallery')
  const language=field('Język',document.querySelector('#control-4'))
  await until(()=>language?.querySelector('.language-flag img')?.naturalWidth>0,'Brak lokalnej flagi.')
  check('Pole języka pokazuje lokalną flagę',true)
  check('Zwykły Select efektów nie dostaje flag',!field('Efekty audio').querySelector('.language-flag'))
  await click(language);const english=option('English');await pointer(english)
  check('Hover myszą ma wybrane szare tło',style(english).background==='rgb(33, 33, 33)')
  check('Hover myszą nie ma niebieskiego obrysu',style(english).outline==='none'&&!document.querySelector('.vs-option-keyboard'))
  check('Polski i angielski na liście mają poprawnie wczytane flagi',[...document.querySelectorAll('[role=option] .language-flag img')].length===2&&[...document.querySelectorAll('[role=option] .language-flag img')].every(el=>el.complete&&el.naturalWidth>0))
  const automatic=[...document.querySelectorAll('[role=option]')].find(el=>el.textContent.trim().startsWith('Automatycznie'))
  check('Automatyczne rozpoznawanie ma glob',!!automatic.querySelector('.language-flag svg')&&!automatic.querySelector('.language-flag img'))
  key(document.querySelector('[role=listbox]'),'ArrowDown');await sleep(50)
  check('Strzałka klawiatury podświetla opcję tym samym tłem co mysz, bez obrysu',style(document.querySelector('.vs-option-keyboard')).background==='rgb(33, 33, 33)'&&style(document.querySelector('.vs-option-keyboard')).outline==='none')
  key(document.querySelector('[role=listbox]'),'Home');await sleep(50)
  check('Home przechodzi na pierwszy język',document.querySelector('.vs-option-keyboard').textContent.trim()==='Polski')
  key(document.querySelector('[role=listbox]'),'End');await sleep(50)
  check('End przechodzi na automatyczny język',document.querySelector('.vs-option-keyboard').textContent.trim().startsWith('Automatycznie'))
  key(document.querySelector('[role=listbox]'),'e');await sleep(50)
  check('Wpisywanie nazwy znajduje język',document.querySelector('.vs-option-keyboard').textContent.trim()==='English')
  key(document.querySelector('[role=listbox]'),'Enter');await sleep(150)
  check('Enter aktualizuje kod, nazwę i flagę',language.textContent.trim()==='English'&&!!language.querySelector('.language-flag img')&&language.closest('.vs-select').querySelector('select').value==='en')
  await click(language);await click([...document.querySelectorAll('[role=option]')].find(el=>el.textContent.trim().startsWith('Automatycznie')))
  check('Wybranie Auto zastępuje flagę globem',!!language.querySelector('.language-flag svg')&&!language.querySelector('.language-flag img'))
  const ghost=field('Wariant ghost');await click(ghost)
  check('Otwarty wariant ghost używa tego samego neutralnego tła',style(ghost).background==='rgb(33, 33, 33)')
  key(document.querySelector('[role=listbox]'),'Escape');await sleep(150)
  const disabled=field('Lista wyłączona')
  check('Wyłączone pole zachowuje flagę i blokadę',disabled.disabled&&!!disabled.querySelector('.language-flag img'))
  const chip=field('Język: dodaj filtr');await click(chip);await click(option('Polski'))
  check('Filtr językowy pokazuje jedną flagę',field('Język: Polski').querySelectorAll('.language-flag img').length===1)
  await click(document.querySelector('[aria-label="Usuń filtr: Język"]'))
  check('Reset filtra usuwa flagę i przywraca fokus',!chip.querySelector('.language-flag')&&document.activeElement===chip)
  const form=document.querySelector('[data-demo-form]'),formField=field('Język formularza',form),native=form.querySelector('select[name=language]'),initial=native.value
  await click(formField);await click(option('English'))
  check('FormData zawiera kod języka zamiast etykiety lub ikony',new FormData(form).get('language')==='en')
  await click(form.querySelector('button[type=reset]'))
  check('Reset formularza przywraca wartość i flagę',native.value===initial&&!!formField.querySelector('.language-flag img'))
  return result
}

export async function runSelectLanguageAppCheck(){
  requireOrigin();if(new URLSearchParams(location.search).get('demo')!=='tts')throw Error('Wymagane demo TTS.')
  const {result,check}=recorder('__selectLanguageApp')
  const section=[...document.querySelectorAll('.tts-disclosure-trigger')].find(el=>el.firstElementChild?.textContent==='Język')
  if(section.getAttribute('aria-expanded')==='false')await click(section)
  const tts=field('Język generowania')
  check('Inspektor TTS pokazuje flagę języka',!!tts.querySelector('.language-flag img'))
  await click(document.querySelector('.voice-pill'));const dialog=document.querySelector('dialog.voice-picker[open]'),picker=field('Język głosu',dialog)
  await click(picker);await pointer(option('Angielski'))
  check('Opcja języka pickera ma flagę oraz szary hover bez obrysu',!!option('Angielski').querySelector('.language-flag img')&&style(option('Angielski')).background==='rgb(33, 33, 33)'&&style(option('Angielski')).outline==='none')
  await click(option('Angielski'))
  check('Własny trigger pickera ma jedną flagę, bez duplikatu',picker.querySelectorAll('.language-flag img').length===1)
  await click(picker);key(document.querySelector('[role=listbox]'),'ArrowDown');await sleep(50)
  check('Picker zachowuje fokus przy nawigacji klawiaturą',!!document.querySelector('.vs-option-keyboard'))
  await pointer(option('Angielski'))
  check('Powrót do myszy usuwa obrys klawiatury',!document.querySelector('.vs-option-keyboard'))
  key(document.querySelector('[role=listbox]'),'Escape');await sleep(150)
  check('Escape zamyka listę, zachowuje dialog i przywraca fokus',picker.getAttribute('aria-expanded')==='false'&&!!document.querySelector('dialog.voice-picker[open]')&&document.activeElement===picker)
  const urls=performance.getEntriesByType('resource').map(row=>row.name)
  check('Flagi nie pobierają CDN ani prywatnego backendu',urls.every(url=>!url.includes('/backend/')&&!/^https?:\/\//.test(url.replace(location.origin,''))))
  return result
}
