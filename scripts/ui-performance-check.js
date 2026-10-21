// Uruchom przez import() w T3 na dedykowanym originie ui-performance-preview.mjs.
export async function runPerformanceCheck() {
  const results = [], metrics = {};
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async predicate => { for (let i=0;i<200;i++) { if(predicate()) return; await delay(25); } throw Error('Przekroczono czas oczekiwania UI'); };
  const assert = (name, ok, detail) => results.push({ name, passed: !!ok, detail });
  const saved = () => JSON.parse(localStorage.getItem('voicestudio.projects.v2'));
  const edit = text => { const field=document.querySelector('.speech-input'); field.value=text; field.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text.at(-1)})); };
  try {
    await wait(()=>document.querySelector('.feature-tile'));
    document.querySelector('.feature-tile').click();
    await wait(()=>document.querySelector('.speech-input'));
    await delay(450); // Poczekaj na inicjalizację głosów i ewentualny zapis początkowy.
    const projectId=localStorage.getItem('voicestudio.activeProject.v2');
    const text=document.querySelector('.speech-input').value;
    const writes=window.__qaWrites.length, started=performance.now();
    // Microtask pozwala Svelte zastosować każdą zmianę bez zależności od
    // ograniczania timerów w kartach działających w tle.
    for(let i=0;i<40;i++) { edit(text+' '+i); await Promise.resolve(); await Promise.resolve(); }
    metrics.burstMs=performance.now()-started;
    metrics.immediateWrites=window.__qaWrites.length-writes;
    assert('40 zmian tekstu nie zapisuje biblioteki przy każdym znaku',metrics.immediateWrites<=2,metrics.immediateWrites);
    await delay(500);
    metrics.settledWrites=window.__qaWrites.length-writes;
    assert('Seria wpisów kończy się jednym zapisem',metrics.settledWrites<=2,metrics.settledWrites);
    assert('Zapis zachowuje ostatnią treść i całą bibliotekę',saved().length===120&&saved().find(p=>p.id===projectId).blocks[0].text===text+' 39');
    edit('Końcowy tekst przed ukryciem');
    window.dispatchEvent(new Event('pagehide'));
    assert('pagehide zapisuje oczekującą zmianę synchronicznie',saved().find(p=>p.id===projectId).blocks[0].text==='Końcowy tekst przed ukryciem');
    await delay(350);
    edit('Nie zgub ostatniego wpisu przy ponownym otwarciu');
    const currentButton=[...document.querySelectorAll('.recent-projects button')].find(b=>b.textContent.trim()==='Projekt QA 0');
    currentButton.click(); await Promise.resolve(); await Promise.resolve();
    assert('Otwarcie bieżącego projektu zachowuje niezapisany jeszcze tekst',document.querySelector('.speech-input').value==='Nie zgub ostatniego wpisu przy ponownym otwarciu');
    edit('Treść projektu przed przełączeniem');
    const projectsNav=[...document.querySelectorAll('.navigation-sidebar button')].find(b=>b.textContent.trim()==='Projekty');
    projectsNav.click(); await wait(()=>document.querySelector('.project-list'));
    const other=[...document.querySelectorAll('.project-list button')].find(b=>b.textContent.includes('Projekt QA 1')&&!b.textContent.includes('Projekt QA 10'));
    other.click();await wait(()=>document.querySelector('.speech-input'));
    assert('Przełączenie projektu zapisuje poprzedni szkic',saved().find(p=>p.id===projectId).blocks[0].text==='Treść projektu przed przełączeniem');
    assert('Przełączenie nie przenosi tekstu do nowego projektu',document.querySelector('.speech-input').value!== 'Treść projektu przed przełączeniem');
    assert('Brak nieobsłużonych błędów aplikacji',window.__qaErrors.length===0,window.__qaErrors);
  } catch(error) { results.push({name:'Przepływ testu',passed:false,detail:String(error)}); }
  const report={passed:results.filter(r=>r.passed).length,total:results.length,metrics,results};
  window.__performanceReport=report;return report;
}
