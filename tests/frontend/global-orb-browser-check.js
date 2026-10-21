// Wklej/wczytaj na prawdziwym App /?demo=tts. Skrypt niczego nie uruchamia sam.
// Najpierw uruchom publiczną próbkę w pętli (audio.loop=true), otwórz prawy
// Podgląd i zamknij Ustawienia. Następnie wywołaj window.runGlobalOrbChecks().
// Podczas pracy wynik jest w window.globalOrbQA.state; gotowy JSON funkcja
// zwraca i zapisuje w window.globalOrbQA. Test pozostawia ostatni styl (Przepływ).
(() => {
  let running = false;
  const styles = [
    { id: 'original', label: 'Oryginalna' }, { id: 'calm', label: 'Spokojna' },
    { id: 'storm', label: 'Burza' }, { id: 'intonation', label: 'Intonacja' },
    { id: 'landing', label: 'Przepływ' },
  ];
  const selectors = {
    settings: '.sidebar-footer button[aria-label="Ustawienia"]',
    appearance: '.settings-navigation nav > button:nth-child(3)',
    back: '.settings-back',
    style: '[aria-label="Styl kuli głosu"]',
    list: '[role="listbox"][aria-label="Styl kuli głosu"]',
    preview: '#tts-voice-preview',
    toggle: 'button[aria-controls="tts-voice-preview"]',
    footerOrb: 'footer.player .voice-orb[data-sync-group="global-playback"]',
    previewOrb: '#tts-voice-preview .voice-orb[data-sync-group="global-playback"]',
    audio: 'footer.player audio',
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const frameNumber = canvas => canvas?.dataset.sharedFrame === undefined ? null : Number(canvas.dataset.sharedFrame);
  const orbInfo = orb => {
    const canvas = orb?.querySelector('canvas');
    return { present: !!orb, variant: orb?.dataset.variant ?? null, voice: orb?.dataset.voice ?? null,
      group: orb?.dataset.syncGroup ?? null, renderer: orb?.dataset.renderer ?? null,
      ready: !!canvas?.classList.contains('ready'), frame: frameNumber(canvas),
      width: canvas?.width ?? null, height: canvas?.height ?? null };
  };
  const pairInfo = () => ({ footer: orbInfo(document.querySelector(selectors.footerOrb)), preview: orbInfo(document.querySelector(selectors.previewOrb)) });

  window.runGlobalOrbChecks = async function runGlobalOrbChecks({ timeoutMs = 8000, totalTimeoutMs = 60000 } = {}) {
    if (running) throw new Error('Test globalnej kuli już trwa. Odczytaj window.globalOrbQA.');
    running = true;
    timeoutMs = Number.isFinite(timeoutMs) ? Math.max(1000, Math.min(20000, timeoutMs)) : 8000;
    totalTimeoutMs = Number.isFinite(totalTimeoutMs) ? Math.max(timeoutMs, Math.min(120000, totalTimeoutMs)) : 60000;
    const started = performance.now(), deadline = started + totalTimeoutMs;
    const qa = window.globalOrbQA = { state: 'running', startedAt: new Date().toISOString(),
      url: location.href, timeoutMs, totalTimeoutMs, expectedStyles: styles.map(style => style.id),
      completedStyles: [], checks: [], mediaEvents: [], snapshots: [] };
    let audio, source, sourceAttribute, lastTime = 0, travelled = 0, stage = 'Warunki początkowe';
    const listeners = [];
    const dimensions = new Map();
    const fail = (message, detail) => { const error = new Error(message); error.detail = detail; error.stage = stage; throw error; };
    const check = (name, passed, detail) => {
      qa.checks.push({ name, passed: !!passed, ...(detail === undefined ? {} : { detail }) });
      if (!passed) fail(name, detail);
    };
    const audioInfo = () => ({ count: document.querySelectorAll('audio').length,
      sameElement: !!audio && document.querySelector(selectors.audio) === audio,
      connected: !!audio?.isConnected, paused: audio?.paused ?? true, loop: audio?.loop ?? false,
      src: audio?.currentSrc || audio?.src || null, srcAttribute: audio?.getAttribute('src') ?? null,
      currentTime: audio?.currentTime ?? null, duration: Number.isFinite(audio?.duration) ? audio.duration : null,
      error: audio?.error ? { code: audio.error.code, message: audio.error.message } : null });
    const auditAudio = () => {
      if (!audio) return;
      const info = audioInfo();
      if (info.count !== 1 || !info.sameElement || !info.connected || info.paused || !info.loop
        || info.src !== source || info.srcAttribute !== sourceAttribute || info.error) fail('Przerwano ciągłość jednego źródła audio.', info);
      const current = audio.currentTime;
      const delta = current - lastTime;
      travelled += delta >= 0 ? delta : Number.isFinite(audio.duration) ? Math.max(0, audio.duration - lastTime + current) : 0;
      lastTime = current;
      const interruption = qa.mediaEvents.find(event => ['pause', 'emptied', 'error', 'loadstart', 'ended'].includes(event.type));
      if (interruption) fail('Audio zgłosiło przerwanie lub przeładowanie podczas zmiany wyglądu.', interruption);
    };
    const observe = () => ({ stage, settingsOpen: !!document.querySelector(selectors.back), pair: pairInfo(), audio: audioInfo() });
    const until = async (name, probe, limit = timeoutMs) => {
      const end = Math.min(deadline, performance.now() + limit);
      while (performance.now() < end) {
        auditAudio();
        const result = probe();
        if (result) return result;
        await sleep(35);
      }
      fail(`Timeout: ${name}.`, { waitedMs: limit, ...observe() });
    };
    const settle = async ms => {
      const end = performance.now() + ms;
      while (performance.now() < end) {
        if (performance.now() >= deadline) fail('Przekroczono łączny czas testu.', observe());
        auditAudio(); await sleep(Math.min(35, end - performance.now()));
      }
      auditAudio();
    };
    const click = async (selector, name) => {
      const element = await until(name, () => document.querySelector(selector));
      if (element.disabled) fail(`Kontrolka jest wyłączona: ${name}.`, { selector });
      element.click();
    };
    const paired = variant => {
      const pair = pairInfo(), a = pair.footer, b = pair.preview;
      return a.present && b.present && a.variant === variant && b.variant === variant
        && a.voice && a.voice === b.voice && a.group === b.group && a.group === 'global-playback'
        && a.renderer === 'webgl' && b.renderer === 'webgl' && a.ready && b.ready
        && Number.isFinite(a.frame) && a.frame > 0 && a.frame === b.frame;
    };
    const waitPair = async variant => {
      const panel = document.querySelector('#generation-settings-panel');
      if (panel) panel.scrollTop = 0;
      document.querySelector(selectors.previewOrb)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      await until(`Dwie zgodne kule ${variant}`, () => paired(variant));
      return pairInfo();
    };
    const advance = async (name, minimum, forbidReset = false) => {
      let lowest = Infinity;
      await until(name, () => {
        const value = frameNumber(document.querySelector(selectors.footerOrb)?.querySelector('canvas'));
        if (!Number.isFinite(value)) return false;
        lowest = Math.min(lowest, value);
        if (forbidReset && value < minimum) fail('Zresetowano wspólną fazę/licznik klatek.', { minimum, current: value, ...observe() });
        return value > minimum;
      });
      return { before: minimum, after: pairInfo().footer.frame, lowestObserved: lowest };
    };
    const openSettings = async label => {
      stage = label;
      await click(selectors.settings, 'Ustawienia');
      await until('Otwarcie ustawień', () => document.querySelector(selectors.back));
      await settle(80);
      const before = pairInfo();
      await settle(200);
      const after = pairInfo();
      check(`${label}: wspólne klatki zatrzymane w Ustawieniach`,
        Number.isFinite(before.footer.frame) && before.footer.frame === after.footer.frame
        && Number.isFinite(before.preview.frame) && before.preview.frame === after.preview.frame,
        { before, after });
      return after;
    };
    const back = async () => {
      await click(selectors.back, 'Wróć z ustawień');
      await until('Zamknięcie ustawień', () => !document.querySelector(selectors.back));
    };
    const pixelProof = async variant => {
      const canvases = [document.querySelector(selectors.footerOrb)?.querySelector('canvas'), document.querySelector(selectors.previewOrb)?.querySelector('canvas')];
      if (canvases.some(canvas => !canvas)) fail('Brakuje jednej z prezentacji canvas.', pairInfo());
      const original = canvases.map(canvas => ({ canvas, width: canvas.width, height: canvas.height }));
      try {
        let before = canvases.map(frameNumber);
        let dimensionRetries = 0;
        for (const saved of original) {
          dimensions.set(saved.canvas, saved); saved.canvas.width = saved.canvas.height = 96;
        }
        await until(`Świeży wspólny obraz 96×96 (${variant})`, () => {
          // A ResizeObserver queued by the newly mounted preview may
          // restore its normal size once. Reapply the test raster and require
          // another shared frame, rather than reading the cleared canvas.
          if (canvases.some(canvas => canvas.width !== 96 || canvas.height !== 96)) {
            for (const canvas of canvases) if (canvas.width !== 96 || canvas.height !== 96) canvas.width = canvas.height = 96;
            before = canvases.map(frameNumber); dimensionRetries++;
            return false;
          }
          return canvases.every((canvas, index) => frameNumber(canvas) > before[index])
            && frameNumber(canvases[0]) === frameNumber(canvases[1]);
        });
        // Synchronous reads cannot straddle two animation callbacks.
        const contexts = canvases.map(canvas => canvas.getContext('2d'));
        if (contexts.some(context => !context)) fail('Prezentacja nie jest wspólnym canvas2D.', pairInfo());
        const images = contexts.map(context => context.getImageData(0, 0, 96, 96).data);
        let differentBytes = 0, differentPixels = 0, firstDifference = null;
        const opaque = [0, 0];
        for (let offset = 0; offset < images[0].length; offset += 4) {
          let different = false;
          for (let channel = 0; channel < 4; channel++) if (images[0][offset + channel] !== images[1][offset + channel]) {
            differentBytes++; different = true;
            firstDifference ??= { x: (offset / 4) % 96, y: Math.floor(offset / 4 / 96), channel,
              footer: images[0][offset + channel], preview: images[1][offset + channel] };
          }
          if (different) differentPixels++;
          for (let index = 0; index < 2; index++) if (images[index][offset + 3] === 255) opaque[index]++;
        }
        const detail = { width: 96, height: 96, sharedFrame: canvases.map(frameNumber), differentBytes, differentPixels,
          opaque, firstDifference, dimensionRetries, originalSizes: original.map(saved => [saved.width, saved.height]) };
        check(`${variant}: identyczne RGBA 96×96 i ponad 6000 nieprzezroczystych pikseli`,
          differentBytes === 0 && opaque.every(count => count > 6000), detail);
        return detail;
      } finally {
        for (const saved of original) {
          if (saved.canvas.isConnected) { saved.canvas.width = saved.width; saved.canvas.height = saved.height; }
          dimensions.delete(saved.canvas);
        }
      }
    };

    try {
      check('Prawdziwy App demo TTS i zamknięte Ustawienia', new URL(location.href).searchParams.get('demo') === 'tts'
        && !!document.querySelector('.tts-demo-notice') && !document.querySelector(selectors.back), observe());
      audio = document.querySelector(selectors.audio);
      check('Jedno już grające audio w pętli', document.querySelectorAll('audio').length === 1 && !!audio && !audio.paused && audio.loop, audioInfo());
      source = audio.currentSrc || audio.src; sourceAttribute = audio.getAttribute('src'); lastTime = audio.currentTime;
      for (const type of ['pause', 'emptied', 'error', 'loadstart', 'ended']) {
        const listener = () => qa.mediaEvents.push({ type, elapsedMs: Math.round(performance.now() - started), ...audioInfo() });
        audio.addEventListener(type, listener); listeners.push([type, listener]);
      }
      check('Prawy Podgląd jest otwarty', !!document.querySelector(selectors.preview)
        && document.querySelector(selectors.toggle)?.getAttribute('aria-expanded') === 'true', pairInfo());
      qa.initialVariant = pairInfo().footer.variant;
      await waitPair(qa.initialVariant);

      for (const [index, style] of styles.entries()) {
        await openSettings(style.label);
        await click(selectors.appearance, 'Wygląd — trzecia pozycja ustawień');
        await until('Sekcja stylu kuli', () => document.querySelector(selectors.style));
        await click(selectors.style, 'Lista stylów kuli');
        const option = await until(`Opcja ${style.label}`, () => document.querySelector(`${selectors.list} [role="option"][data-option="${index}"]`));
        check(`${style.label}: prawidłowa opcja Select`, option.querySelector('.vs-option-label')?.textContent.trim() === style.label,
          { index, text: option.textContent.trim() });
        option.click();
        await until(`Zapis wyboru ${style.label}`, () => !document.querySelector(selectors.list)
          && document.querySelector(selectors.style)?.textContent.trim() === style.label);
        await back();
        stage = `Wspólny obraz: ${style.label}`;
        const pair = await waitPair(style.id);
        check(`${style.label}: wspólny styl, głos, grupa i sharedFrame`, paired(style.id), pair);
        const pixels = await pixelProof(style.id);
        const clock = await advance(`Zegar po wyborze ${style.label}`, pairInfo().footer.frame);
        check(`${style.label}: zegar kuli i jedno audio nadal działają`, clock.after > clock.before && !audio.paused,
          { clock, audio: audioInfo() });
        qa.snapshots.push({ variant: style.id, pair, pixels, clock }); qa.completedStyles.push(style.id);
      }

      for (let index = 1; index <= 3; index++) {
        stage = `Ponowne otwarcie Podglądu ${index}/3`;
        const before = pairInfo().footer.frame;
        await click(selectors.toggle, 'Zamknij Podgląd');
        await until('Podgląd zamknięty', () => !document.querySelector(selectors.preview));
        const closed = await advance('Zegar stopki bez dużego Podglądu', before, true);
        await click(selectors.toggle, 'Otwórz Podgląd');
        const pair = await waitPair('landing');
        check(`Podgląd ${index}/3: stopka kontynuuje fazę i duża kula ją dołącza`,
          closed.after > before && pair.footer.frame >= closed.after && paired('landing'), { closed, pair });
      }

      stage = 'Powrót z Ustawień bez zmiany stylu';
      await until('Rozgrzany licznik przed sprawdzeniem ciągłości fazy', () => pairInfo().footer.frame >= 12);
      const stopped = await openSettings(stage);
      await back();
      const continuity = await advance('Wznowienie tej samej fazy po Ustawieniach', stopped.footer.frame, true);
      await waitPair('landing');
      check('Ustawienia bez zmiany stylu nie resetują wspólnej fazy', continuity.lowestObserved >= stopped.footer.frame,
        { stopped, continuity, after: pairInfo() });
      auditAudio();
      check('Wszystkie pięć stylów przeszło pełną ścieżkę UI', qa.completedStyles.length === styles.length, qa.completedStyles);
      check('Audio zachowało element/src, nie pauzowało i przesunęło zegar', travelled > .1 && qa.mediaEvents.length === 0,
        { travelledSeconds: travelled, initialSrc: source, final: audioInfo(), events: qa.mediaEvents });
    } catch (error) {
      qa.error = { message: String(error?.message || error), stage: error?.stage || stage,
        ...(error?.detail === undefined ? {} : { detail: error.detail }), observation: observe() };
      if (!qa.checks.some(check => !check.passed)) qa.checks.push({ name: qa.error.message, passed: false, detail: qa.error });
    } finally {
      // Only restore test raster dimensions. Never play/pause/seek or replace audio.
      for (const saved of dimensions.values()) if (saved.canvas.isConnected) { saved.canvas.width = saved.width; saved.canvas.height = saved.height; }
      dimensions.clear();
      for (const [type, listener] of listeners) audio?.removeEventListener(type, listener);
      if (document.querySelector(selectors.back)) document.querySelector(selectors.back).click();
      qa.state = 'complete'; qa.finishedAt = new Date().toISOString(); qa.durationMs = Math.round(performance.now() - started);
      qa.passed = qa.checks.filter(check => check.passed).length; qa.total = qa.checks.length;
      qa.success = !qa.error && qa.completedStyles.length === styles.length && qa.checks.every(check => check.passed);
      qa.final = { pair: pairInfo(), audio: audioInfo(), travelledSeconds: travelled };
      running = false;
      const summary = { success: qa.success, passed: qa.passed, total: qa.total, completedStyles: qa.completedStyles, durationMs: qa.durationMs, error: qa.error?.message };
      if (typeof console.summary === 'function') console.summary(summary);
      else console.info('globalOrbQA summary', summary);
    }
    return qa;
  };
})();
