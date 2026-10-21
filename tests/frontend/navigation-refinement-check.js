// Run in an isolated profile against the production preview; imports a public test WAV.
const checks = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (name, passed) => { checks.push({ name, passed: Boolean(passed) }); if (!passed) throw new Error(name); };
const wait = async predicate => { for (let n = 0; n < 200; n++) { if (predicate()) return; await delay(25); } throw new Error('Navigation refinement timeout'); };
const click = async selector => { document.querySelector(selector).click(); await delay(60); };
const savedPins = localStorage.getItem('voicestudio.navigation.pins.v1');
try {
  await click('.sidebar-brand');
  check('Empty player is absent', !document.querySelector('.player'));
  check('Inactive voice row is neutral', getComputedStyle(document.querySelector('.voice-entry')).backgroundColor === 'rgba(0, 0, 0, 0)');
  check('All navigation rows share dimensions', [...document.querySelectorAll('.navigation-sidebar .nav-entry')].every(e => e.getBoundingClientRect().height === 36));
  if (document.querySelector('.more-tools')) {
    await click('.more-tools');
    for (let n = 0; n < 20; n++) {
      const pin = document.querySelector('.tools-popover .pin-action');
      if (!pin) break;
      pin.click(); await delay(60);
    }
  }
  check('All twelve tools stay in sidebar', document.querySelectorAll('.pinned-scroll .nav-entry').length === 12);
  check('More disappears after final pin and closes popup', !document.querySelector('.more-tools,.tools-popover'));
  check('Final pin restores connected focus', document.activeElement?.isConnected && document.activeElement.matches('.nav-destination'));
  const scroll = document.querySelector('.pinned-scroll');
  check('Pins use vertical scrolling', getComputedStyle(scroll).overflowY === 'auto');
  if (innerHeight <= 650) {
    check('All pins overflow inside the scroll area', scroll.scrollHeight > scroll.clientHeight);
    scroll.scrollTop = scroll.scrollHeight;
    check('Scroll reaches final tool', scroll.lastElementChild.getBoundingClientRect().bottom <= scroll.getBoundingClientRect().bottom + 1);
  }
  const footer = document.querySelector('.navigation-sidebar .sidebar-footer').getBoundingClientRect();
  check('Footer remains visible', footer.bottom <= innerHeight && footer.height === 52);
  await click('.pinned-scroll .pin-action');
  check('Unpin restores More', Boolean(document.querySelector('.more-tools')));
  await click('.settings-trigger');
  check('Back replaces all footer actions', Boolean(document.querySelector('.settings-shell .shell-back')) && !document.querySelector('.settings-shell .sidebar-actions'));
  const geometry = [];
  for (const label of ['Wygląd', 'Modele i silnik', 'AI i subskrypcja', 'Skróty klawiaturowe']) {
    [...document.querySelectorAll('.settings-navigation nav button')].find(e => e.textContent.trim() === label).click(); await delay(80);
    const heading = document.querySelector('.settings-content h1,.settings-content h2');
    const r = heading.getBoundingClientRect(); geometry.push({ label, x: r.x, y: r.y });
  }
  check('All settings headings align with Appearance', geometry.every(r => Math.abs(r.x - geometry[0].x) < 1 && Math.abs(r.y - geometry[0].y) < 1));
  await click('.settings-shell .shell-back');
  await click('.device-trigger');
  const device = document.querySelector('.device-popover').getBoundingClientRect();
  check('Compact device popup fits viewport', device.width <= 280 && device.left >= 0 && device.top >= 0 && device.bottom <= innerHeight);
  await click('.close-device');
  const blob = await (await fetch('/demo/interface-tone.wav')).blob();
  const files = new DataTransfer(); files.items.add(new File([blob], 'test-nawigacji.wav', { type: 'audio/wav' }));
  const input = document.querySelector('input[type=file][accept^="audio/"]'); input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(() => document.querySelector('.player audio')?.readyState >= 2);
  check('Real imported WAV reveals player', Boolean(document.querySelector('.player')) && document.querySelector('.player audio').duration > 0);
  check('Player enters from below', getComputedStyle(document.querySelector('.player')).animationName.includes('player-enter'));
  await click('.player .play-button');
  await wait(() => document.querySelector('.player').dataset.playbackState === 'playing');
  check('Playback actually starts', !document.querySelector('.player audio').paused);
  await click('.player .play-button');
  check('Pause remains available with selected audio', document.querySelector('.player audio').paused && Boolean(document.querySelector('.player')));
  const root = document.documentElement, oldMotion = root.dataset.reducedMotion; root.dataset.reducedMotion = 'true';
  check('Reduced motion disables player entrance', getComputedStyle(document.querySelector('.player')).animationName === 'none');
  if (oldMotion === undefined) delete root.dataset.reducedMotion; else root.dataset.reducedMotion = oldMotion;
  check('No page overflow', document.documentElement.scrollWidth === innerWidth);
  window.__navigationRefinementChecks = { checks, geometry, device: { width: device.width, height: device.height }, viewport: { width: innerWidth, height: innerHeight } };
} catch (error) { window.__navigationRefinementChecks = { checks, error: String(error) }; throw error; }
finally { if (savedPins === null) localStorage.removeItem('voicestudio.navigation.pins.v1'); else localStorage.setItem('voicestudio.navigation.pins.v1', savedPins); }
