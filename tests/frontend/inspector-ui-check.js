// Isolated browser profile only. Adds/removes only uniquely named QA records.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async predicate => { for (let i = 0; i < 300; i++) { if (predicate()) return; await sleep(25); } throw Error('Inspector acceptance timeout'); };
const fill = (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
const btn = (text, root = document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim() === text);
async function database() { return new Promise((resolve, reject) => { const req = indexedDB.open('voicestudio-next-library', 1); req.onupgradeneeded = () => req.result.createObjectStore('recordings', { keyPath: 'id' }); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
export async function seedInspectorFixture() {
  const blob = await (await fetch('/demo/interface-tone.wav')).blob(), now = Date.now(), prefix = 'inspector-qa-' + now;
  const fixtures = [
    { voice: 'Głos A · test', modelId: 'omnivoice', modelName: 'OmniVoice', source: 'generation', text: 'QA-HISTORY Unikatowy fragment.', age: 60000 },
    { voice: 'Głos B · test', modelId: 'qa-model', modelName: 'Model testowy', source: 'generation', text: 'QA-HISTORY Inny głos i model.', age: 30*60000 },
    { voice: 'Wczytane nagranie', source: 'import', text: '', age: 60*60000 },
    { voice: 'Głos A · test', modelId: 'omnivoice', modelName: 'OmniVoice', source: 'generation', text: 'QA-HISTORY Wczorajsze nagranie.', age: 86400000 },
    { voice: 'Głos A · test', text: 'QA-HISTORY Starszy wpis bez metadanych.', age: 2*86400000 },
    { voice: 'Głos B · test', modelId: 'qa-model', modelName: 'Model testowy', source: 'generation', text: 'QA-HISTORY Dawna narracja.', age: 60*86400000 },
    { voice: 'Głos A · test', modelId: 'omnivoice', modelName: 'OmniVoice', source: 'generation', text: 'QA-HISTORY [pause] Długi tekst, który powinien mieścić się w jednym wierszu historii i być czytelnie skracany.', age: 3*60000 },
  ].map((row, i) => ({ ...row, id: prefix+'-'+i, title: 'QA-HISTORY nagranie '+i, kind: 'audio', created: new Date(now-row.age).toISOString(), blob, filename: 'qa.wav', voiceId: 'qa-voice-'+i }));
  const db = await database();
  await new Promise((resolve,reject) => { const tx = db.transaction('recordings','readwrite'); for(const row of fixtures)tx.objectStore('recordings').put(row); tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error); }); db.close();
  sessionStorage.setItem('inspector-qa-ids',JSON.stringify(fixtures.map(r=>r.id)));
  return { count: fixtures.length, ids: fixtures.map(r=>r.id) };
}
export async function cleanupInspectorFixture() {
  const ids=JSON.parse(sessionStorage.getItem('inspector-qa-ids')||'[]'); const db=await database();
  await new Promise((resolve,reject)=>{const tx=db.transaction('recordings','readwrite');for(const id of ids){if(!id.startsWith('inspector-qa-'))throw Error('Unexpected fixture ID');tx.objectStore('recordings').delete(id);}tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}); db.close(); sessionStorage.removeItem('inspector-qa-ids'); return { removed:ids.length };
}
export async function runInspectorCheck() {
  const checks=[], check=(name,passed)=>{checks.push({name,passed:Boolean(passed)});if(!passed)throw Error(name);};
  try {
    await until(()=>document.querySelector('.voice-row-add'));
    const plus=document.querySelector('.voice-row-add'),row=plus.closest('.nav-entry'),a=plus.getBoundingClientRect(),b=row.getBoundingClientRect();
    check('Voice plus is inside the same navigation capsule',a.left>=b.left&&a.right<=b.right&&a.top>=b.top&&a.bottom<=b.bottom);
    check('Voice controls are sibling buttons, never nested',!row.querySelector('button button'));
    const page=document.querySelector('.content').getAttribute('aria-label');plus.click();await sleep(40);
    check('Plus opens real add-voice form without navigating',document.querySelector('.modal[aria-label="Dodaj głos"]')&&document.querySelector('.content').getAttribute('aria-label')===page);
    document.querySelector('.modal-close').click();
    [...document.querySelectorAll('.nav-destination')].find(b=>b.textContent.trim()==='Tekst na mowę').click();await sleep(60);
    check('Settings and History share the existing accessible tabs',document.querySelectorAll('.tts-inspector [role=tab]').length===2);
    check('Voice selector matches compact 40px control',Math.abs(document.querySelector('.tts-voice-tray').getBoundingClientRect().height-40)<=1);
    const disclosure=label=>[...document.querySelectorAll('.tts-disclosure-trigger')].find(b=>b.firstElementChild.textContent===label);
    check('Language is collapsed with a value badge',disclosure('Język').getAttribute('aria-expanded')==='false'&&disclosure('Język').querySelector('.tts-value-badge'));
    disclosure('Język').click();await sleep(30);document.querySelector('[aria-label="Język generowania"]').click();await sleep(30);
    [...document.querySelectorAll('[role=option]')].find(o=>o.textContent.trim()==='English').click();await sleep(30);disclosure('Język').click();await sleep(30);
    check('Collapsed language summary follows the actual selection',disclosure('Język').textContent.includes('English'));
    const speed=document.querySelector('.tts-fields input[type=range]');fill(speed,1.35);await sleep(30);btn('Resetuj wartości').click();await sleep(30);
    check('Reset updates the real generation speed',Number(speed.value)===1);
    check('Output lists only the supported WAV format',document.querySelector('[aria-label="Format wyjściowy"]').innerText.includes('WAV')&&!document.querySelector('.tts-fields').innerText.includes('MP3'));
    btn('Podgląd').click();await sleep(30);check('Large voice preview and transport remain available',Boolean(document.querySelector('.voice-orb-play')));btn('Podgląd').click();
    document.querySelector('#generation-history-tab').click();await sleep(40);
    await until(()=>document.querySelectorAll('.history-entry').length>=7);
    fill(document.querySelector('[aria-label="Szukaj w historii"]'),'QA-HISTORY');await sleep(40);
    check('History includes all seven fixture records',document.querySelectorAll('.history-entry').length===7);
    check('History groups records by calendar date',document.querySelector('.tts-history').innerText.includes('Dzisiaj')&&document.querySelector('.tts-history').innerText.includes('Wczoraj')&&document.querySelectorAll('.history-date-group').length>=4);
    check('Four functional filter chips are available',document.querySelectorAll('.history-filters .vs-filter-chip').length===4);
    fill(document.querySelector('[aria-label="Szukaj w historii"]'),'Unikatowy');await sleep(30);
    check('Search filters by narration content',document.querySelectorAll('.history-entry').length===1);
    fill(document.querySelector('[aria-label="Szukaj w historii"]'),'QA-HISTORY');await sleep(30);
    const choose=async(label,option)=>{document.querySelector('button[aria-label="'+label+': dodaj filtr"]').click();await sleep(30);[...document.querySelectorAll('[role=option]')].find(o=>o.textContent.trim()===option).click();await sleep(40);};
    await choose('Model','OmniVoice');check('Model filter uses saved model metadata',document.querySelectorAll('.history-entry').length===3);
    document.querySelector('[aria-label="Usuń filtr: Model"]').click();await sleep(30);
    await choose('Głos','Głos A · test');check('Voice filter is applied',document.querySelectorAll('.history-entry').length===4);
    document.querySelector('[aria-label="Usuń filtr: Głos"]').click();await sleep(30);
    await choose('Data','Dzisiaj');await choose('Źródło','Wczytany plik');
    check('Date and source filters combine correctly',document.querySelectorAll('.history-entry').length===1&&document.querySelector('.history-entry').innerText.includes('Wczytane nagranie'));
    btn('Wyczyść filtry').click();await sleep(40);fill(document.querySelector('[aria-label="Szukaj w historii"]'),'QA-HISTORY');await sleep(30);
    document.querySelector('.history-sort').click();await sleep(40);
    check('Sort changes to oldest first',document.querySelector('.history-entry').getAttribute('data-recording-id').endsWith('-5'));
    document.querySelector('#generation-settings-tab').click();await sleep(20);document.querySelector('#generation-history-tab').click();await sleep(30);
    check('History query survives switching tabs',document.querySelector('[aria-label="Szukaj w historii"]').value==='QA-HISTORY');
    check('History has no horizontal overflow',document.querySelector('.tts-history').scrollWidth<=document.querySelector('.tts-history').clientWidth);
    window.__inspectorChecks={checks};return window.__inspectorChecks;
  } catch(error){window.__inspectorChecks={checks,error:String(error)};throw error;}
}
