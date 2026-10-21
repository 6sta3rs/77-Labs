// Run in an isolated browser profile. No synthesis, AI or data deletion.
const checks = [], delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async fn => { for (let i = 0; i < 400; i++) { if (fn()) return; await delay(25); } throw new Error('Shell acceptance timeout'); };
const check = (name, condition) => { checks.push({ name, passed: Boolean(condition) }); if (!condition) throw new Error(name); };
const active = () => document.querySelector('.settings-shell') || document.querySelector('.app-shell');
const fill = (element, value) => { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); };
const savedPins = localStorage.getItem('voicestudio.navigation.pins.v1');
const capture = root => Object.fromEntries(['.sidebar-brand', '.sidebar-search', '.shell-topbar', '.sidebar-footer'].map(selector => { const r = root.querySelector(selector).getBoundingClientRect(); return [selector, { x: r.x, y: r.y, width: r.width, height: r.height }]; }));
const same = (a, b) => Object.keys(a).every(key => Object.keys(a[key]).every(prop => Math.abs(a[key][prop] - b[key][prop]) <= 1));
try {
  await wait(() => document.querySelector('.sidebar-brand'));
  active().querySelector('.sidebar-brand').click(); await delay(70);
  check('Home opens the dashboard', Boolean(document.querySelector('.dashboard h1')));
  check('Dashboard exposes eight working entry points', document.querySelectorAll('.feature-tile').length === 8);
  check('Dashboard shows local projects and actual library sections', document.querySelectorAll('.dashboard-projects button').length > 0 && document.querySelector('.dashboard-library').innerText.includes('Ostatnie nagrania'));
  const titles = ['Tekst na mowę','Głosy','Dubbing','Audiobooki','Mowa na tekst','Konwersja głosu','Kolejka dubbingu','Słownik wymowy'];
  const destinations = ['studio', 'voices', 'dubbing', 'audiobooks', 'transcription', 'conversion', 'batch', 'pronunciation'];
  for (let i = 0; i < destinations.length; i++) {
    document.querySelectorAll('.feature-tile')[i].click(); await delay(70);
    check(`Dashboard routes to ${destinations[i]}`, !document.querySelector('.dashboard') && document.querySelector('.content')?.getAttribute('aria-label') === titles[i]);
    document.querySelector('.sidebar-brand').click(); await delay(60);
  }
  const sidebar = document.querySelector('.navigation-sidebar'), more = document.querySelector('.more-tools');
  check('Search has a visible field border before interaction', parseFloat(getComputedStyle(sidebar.querySelector('.sidebar-search')).borderTopWidth) >= 1);
  check('Home and Voices are permanent entries above pinned tools', [...sidebar.querySelectorAll('.sidebar-context .nav-destination')].map(button => button.textContent.trim()).join('|') === 'Pulpit|Głosy' && ![...sidebar.querySelectorAll('.pinned-area .nav-destination')].some(button => button.textContent.trim() === 'Głosy'));
  check('More fills the exact row width', Math.abs(more.getBoundingClientRect().width - document.querySelector('.pinned-area').getBoundingClientRect().width) <= 1);
  check('More has the same radius as pinned rows', getComputedStyle(more).borderRadius === getComputedStyle(document.querySelector('.nav-entry')).borderRadius);
  check('Sidebar never scrolls', sidebar.scrollHeight <= sidebar.clientHeight + 1 && getComputedStyle(sidebar).overflowY === 'hidden');
  check('Empty player is hidden', !document.querySelector('.player'));
  check('Main footer has actions without back', !document.querySelector('.navigation-sidebar .shell-back') && Boolean(document.querySelector('.sidebar-actions')));
  const before = capture(active());
  document.querySelector('.settings-trigger').focus(); document.querySelector('.settings-trigger').click(); await delay(80);
  const after = capture(active());
  check('Settings back replaces footer actions', Boolean(active().querySelector('.shell-back')) && !active().querySelector('.sidebar-actions'));

  check('Logo search header back and footer positions are identical in settings', same(before, after));
  check('Settings retains the same logo and search', active().querySelector('.sidebar-brand').innerText === 'Seventy Seven Labs' && active().querySelector('.sidebar-search').innerText.includes('Szukaj'));
  check('Settings has no redundant sidebar headings', !active().querySelector('.context-title,.sidebar-section-title'));
  const appearance = [...active().querySelectorAll('nav button')].find(b => b.textContent.includes('Wygląd')); appearance.click(); await delay(70);
  check('Settings section navigation works inside the shared shell', Boolean(active().querySelector('.settings-page')));
  active().querySelector('.sidebar-search').click(); await delay(50);
  check('The same global search works above settings', Boolean(document.querySelector('dialog[open][aria-label="Szukaj"]')));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await delay(50);
  check('Closing search preserves settings', Boolean(document.querySelector('.settings-shell')) && !document.querySelector('dialog[open][aria-label="Szukaj"]'));
  active().querySelector('.shell-back').click(); await delay(60);
  check('Back restores the original dashboard and focus', Boolean(document.querySelector('.dashboard')) && document.activeElement === document.querySelector('.settings-trigger'));
  document.querySelector('.more-tools').click(); await delay(60);
  const rows = [...document.querySelectorAll('.tools-popover .nav-entry')], popup = document.querySelector('.tools-popover').getBoundingClientRect();
  check('More is a compact single column', rows.every(row => Math.abs(row.getBoundingClientRect().left - rows[0].getBoundingClientRect().left) < 1) && popup.width <= 250);
  check('Popup fits the viewport', popup.top >= 0 && popup.left >= 0 && popup.right <= innerWidth && popup.bottom <= innerHeight);
  check('Visible pins are excluded from More', rows.every(row => ![...document.querySelectorAll('.pinned-area .nav-destination')].some(pin => pin.textContent.trim() === row.querySelector('.nav-destination').textContent.trim())));
  check('Permanent Voices cannot be pinned or duplicated in More', !rows.some(row => row.querySelector('.nav-destination').textContent.trim() === 'Głosy'));
  const dictionary = rows.find(row => row.textContent.includes('Słownik wymowy'));
  if (dictionary) { dictionary.querySelector('.nav-destination').click(); await delay(60); }
  else { document.querySelector('.more-tools').click(); [...document.querySelectorAll('.pinned-area .nav-destination')].find(b => b.textContent.includes('Słownik wymowy')).click(); await delay(60); }
  const draft = document.querySelector('[aria-label="Słowo lub skrót"]'); fill(draft, 'Szkic zachowany przez ustawienia');
  document.querySelector('.settings-trigger').click(); await delay(50); active().querySelector('.shell-back').click(); await delay(60);
  check('Shared settings preserves an unsaved form without remount', document.querySelector('[aria-label="Słowo lub skrót"]') === draft && draft.value === 'Szkic zachowany przez ustawienia');
  // Create a free pin slot before pinning a new item from More.
  document.querySelector('.pinned-area .pin-action')?.click(); await delay(40);
  document.querySelector('.more-tools').click(); await delay(40);
  const candidate = document.querySelector('.tools-popover .pin-action[aria-pressed="false"]');
  const candidateLabel = candidate?.getAttribute('aria-label')?.replace('Przypnij ', '');
  candidate?.focus(); candidate?.click(); await delay(80);
  check('Pin moves an item into the sidebar', [...document.querySelectorAll('.pinned-area .nav-destination')].some(b => b.textContent.trim() === candidateLabel));
  check('Pinning keeps keyboard focus inside the popup', document.activeElement === document.querySelector('.tools-popover input'));
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await delay(40);
  check('Escape closes More with focus restored', !document.querySelector('.tools-popover') && document.activeElement === document.querySelector('.more-tools'));
  document.querySelector('.device-trigger').click(); await delay(60);
  check('Footer statistics action opens device metrics', Boolean(document.querySelector('.device-popover')));
  document.querySelector('.close-device').click(); await delay(30);
  check('No horizontal overflow', document.documentElement.scrollWidth === innerWidth);
  window.__dashboardShellChecks = { checks, geometry: { before, after }, viewport: { width: innerWidth, height: innerHeight } };
  console.log('DASHBOARD_SHELL_PASS', JSON.stringify(window.__dashboardShellChecks));
} catch (cause) { window.__dashboardShellChecks = { checks, error: String(cause) }; throw cause; }
finally { if (savedPins === null) localStorage.removeItem('voicestudio.navigation.pins.v1'); else localStorage.setItem('voicestudio.navigation.pins.v1', savedPins); }
