// Browser acceptance against the real built App on the isolated QA origin.
// Every engine mutation is answered in this tab; nothing reaches a real engine.
export async function runCatalogCheck() {
  if (!['127.0.0.1', 'localhost'].includes(location.hostname) || location.port !== '4320') {
    throw Error('Uruchom odbiór katalogu wyłącznie na odizolowanej fixture localhost:4320.');
  }
  const checks = [], requests = [], originalFetch = window.fetch;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (condition, message) => {
    const deadline = performance.now() + 6000;
    while (!condition()) { if (performance.now() > deadline) throw Error(message); await sleep(25); }
  };
  const check = (name, passed, detail = '') => {
    checks.push({ name, passed: Boolean(passed), detail });
    if (!passed) throw Error(`${name}: ${detail}`);
  };
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const oldId = 'qa-catalog-old', newId = 'qa-catalog-new';
  const oldName = 'QA Catalog Alfa', newName = 'QA Catalog Beta';
  const catalog = active => ({
    tts: { active, backends: [
      { id: oldId, display_name: oldName, available: true, installed: true, supported_language_names: ['Auto', 'Polish'] },
      { id: newId, display_name: newName, available: true, installed: true, supported_language_names: ['Auto', 'Polish'] },
    ] }, asr: { active: '', backends: [] }, llm: { active: '', backends: [] },
  });
  let active = oldId, delayNextRead = false, delayed, failNextSelection = false;
  let blockedMutations = 0, forwardedMutations = 0;
  const picker = () => document.querySelector('.inspector .model-picker-panel');
  const trigger = () => document.querySelector('.inspector .model-trigger');
  const card = name => [...(picker()?.querySelectorAll('.model-picker-card') || [])].find(row => row.querySelector('h3')?.textContent === name);
  const choice = name => card(name)?.querySelector('.model-picker-choice');
  const selected = name => card(name)?.classList.contains('model-picker-selected');
  const closePicker = async () => { picker()?.querySelector('[aria-label="Zamknij wybór modelu"]')?.click(); await until(() => trigger(), 'Picker nie wrócił do ustawień.'); };
  const openPicker = async () => {
    await until(() => trigger() && !trigger().disabled, 'Trigger katalogu nie jest gotowy.'); trigger().click();
    await until(() => card(oldName) && card(newName), 'Nie wczytano dwóch silników fixture.');
  };
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.pathname === '/backend/engines' && method === 'GET') {
      const snapshot = catalog(active);
      requests.push({ method, path: url.pathname, snapshot: active, delayed: delayNextRead });
      if (delayNextRead) {
        delayNextRead = false;
        // Deliberately ignore AbortSignal at the transport seam. App must still
        // reject the stale response when this promise is eventually released.
        return new Promise(resolve => { delayed = { signal: init.signal, release: () => resolve(response(snapshot)) }; });
      }
      return response(snapshot);
    }
    if (url.pathname === '/backend/engines/select' && method === 'POST') {
      const body = JSON.parse(init.body);
      requests.push({ method, path: url.pathname, id: body.backend_id, fixture: true, failed: failNextSelection });
      if (failNextSelection) { failNextSelection = false; return response({ detail: 'Kontrolowany błąd katalogu QA. Spróbuj ponownie.' }, 503); }
      if (body.family !== 'tts' || ![oldId, newId].includes(body.backend_id)) return response({ detail: 'Nieznany silnik fixture.' }, 422);
      active = body.backend_id;
      return response({ active, env_override: false });
    }
    if (!['GET', 'HEAD'].includes(method)) {
      blockedMutations++;
      return response({ detail: 'Odbiór QA blokuje rzeczywiste mutacje silnika.' }, 403);
    }
    return originalFetch.call(window, input, init);
  };
  try {
    [...document.querySelectorAll('.nav-destination')].find(button => button.textContent.trim() === 'Tekst na mowę')?.click();
    await until(() => trigger(), 'Nie otwarto rzeczywistego widoku Studio.');
    await openPicker();
    check('Built App loads both available fixture engines', Boolean(card(oldName) && card(newName)));
    check('Selected available engine has no repeat action', !choice(oldName) && Boolean(choice(newName)));
    check('Picker selectedId follows the initial active engine', selected(oldName) && !selected(newName));
    await closePicker();
    check('Initial model trigger shows the confirmed engine', trigger().textContent.includes(oldName));

    delayNextRead = true;
    const refresh = document.querySelector('[aria-label="Odśwież stan studia"]');
    refresh?.click(); await until(() => delayed, 'Odświeżanie nie rozpoczęło opóźnionego odczytu.');
    check('A real App background refresh is held at its GET', Boolean(delayed));
    await openPicker();
    check('Picker supersedes the background request with cancellation', delayed.signal?.aborted === true);
    choice(newName).click();
    await until(() => trigger()?.textContent.includes(newName), 'Wybór nowego silnika nie został potwierdzony.');
    check('POST selection stays inside this tab and receives confirmation', requests.some(row => row.method === 'POST' && row.id === newId && row.fixture));
    check('Confirmed selection updates the real model trigger', trigger().textContent.includes(newName));
    delayed.release(); await sleep(150);
    check('Released stale GET cannot roll the model trigger back', trigger().textContent.includes(newName));
    await openPicker();
    check('Released stale GET cannot roll selectedId back', selected(newName) && !selected(oldName));

    failNextSelection = true;
    choice(oldName).click();
    await until(() => picker()?.querySelector('.model-picker-error')?.textContent.includes('Kontrolowany błąd'), 'Błąd wyboru nie jest widoczny.');
    check('Selection failure remains visible in the actual picker', picker().querySelector('.model-picker-error').textContent.includes('Kontrolowany błąd'));
    check('Failed selection preserves the last confirmed selectedId', selected(newName) && !selected(oldName));
    await until(() => !choice(oldName).disabled, 'Nie zwolniono blokady po błędzie wyboru.');
    check('Selection failure allows retry', !choice(oldName).disabled);
    choice(oldName).click();
    await until(() => trigger()?.textContent.includes(oldName), 'Ponowienie wyboru nie zakończyło się sukcesem.');
    check('Retry changes the trigger after a fresh confirmation', trigger().textContent.includes(oldName));
    await openPicker();
    check('Retry updates selectedId and clears the previous error', selected(oldName) && !picker().querySelector('.model-picker-error'));
    await closePicker();
    check('No backend mutation escaped the fetch fixture', blockedMutations === 0 && forwardedMutations === 0);
    const report = { checks, requests, blockedMutations, forwardedMutations, origin: location.origin, fixtureOnly: true, finalModel: active };
    window.__catalogCheck = report;
    return report;
  } catch (error) {
    window.__catalogCheck = { checks, requests, blockedMutations, forwardedMutations, origin: location.origin, fixtureOnly: true, error: String(error) };
    throw error;
  } finally {
    delayed?.release();
    window.fetch = originalFetch;
    if (window.__catalogCheck) window.__catalogCheck.fetchRestored = window.fetch === originalFetch;
  }
}
