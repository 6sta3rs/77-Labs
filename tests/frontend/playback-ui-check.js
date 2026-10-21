// Run against the actual built App on the isolated, read-only fixture origin.
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (condition, label, timeout = 4000) => {
  const start = performance.now();
  while (!condition()) {
    if (performance.now() - start > timeout) throw Error(label);
    await wait(30);
  }
};
const audio = () => document.querySelector('.player audio');
const top = () => document.querySelector('.voice-orb-play');
const bottom = () => document.querySelector('.player .play-button');
export async function runPlaybackCheck() {
  const results = [];
  const nativeContext = window.AudioContext;
  const nativePlay = HTMLMediaElement.prototype.play;
  const nativeFetch = window.fetch;
  let meterSources = 0;
  const assert = (ok, name, detail = '') => {
    results.push({ name, passed: !!ok, detail });
    if (!ok) throw Error(`${name}: ${detail}`);
  };
  try {
    if (!top()) [...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'Tekst na mowę')?.click();
    await until(() => document.querySelector('.tts-label-row button') || top(), 'Studio not mounted');
    if (!top()) document.querySelector('.tts-label-row button')?.click();
    await until(() => top() && bottom(), 'App not mounted');
    if (location.search.includes('offline')) assert(top().disabled, 'No backend: empty sample control is disabled');
    if (location.search.includes('sample-first')) {
      await until(() => !top().disabled, 'Sample control unavailable');
      top().click();
      await until(() => audio() && !audio().paused && audio().currentTime > .05, 'Sample did not start');
      await until(() => /Wstrzymaj/.test(top().ariaLabel), 'Sample did not update top state');
      assert(/Wstrzymaj/.test(top().ariaLabel) && bottom().ariaLabel === 'Wstrzymaj', 'Top loads sample into global player');
      bottom().click();
      await until(() => audio().paused && /Odtwórz/.test(top().ariaLabel), 'Sample pause did not synchronize');
      assert(true, 'Bottom controls sample started at top');
    }
    const blob = await (await fetch('/fixture-playback.wav')).blob();
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'global-playback.wav', { type: 'audio/wav' }));
    const input = document.querySelector('input[type=file][accept^="audio/"]');
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => audio() && !bottom().disabled && document.querySelector('.player-copy').textContent.includes('global-playback'), 'Imported recording unavailable');
    assert(!top().disabled, 'Current recording remains controllable without a voice backend');
    if (location.search.includes('stalled-meter')) {
      window.AudioContext = class extends AudioContext {
        get state() { return 'suspended'; }
        resume() { return new Promise(() => {}); }
        createMediaElementSource(...args) { meterSources++; return super.createMediaElementSource(...args); }
      };
    }
    bottom().click();
    await until(() => !audio().paused && audio().currentTime > .05, 'Bottom play did not start');
    assert(true, 'Native playback starts without waiting for analyser');
    await until(() => /Wstrzymaj/.test(top().ariaLabel), 'Bottom did not update top state');
    assert(/Wstrzymaj/.test(top().ariaLabel), 'Bottom play updates top control', top().ariaLabel);
    const source = audio().src, position = audio().currentTime;
    top().click();
    await until(() => audio().paused && bottom().ariaLabel === 'Odtwórz', 'Top pause did not pause global audio and update bottom control');
    assert(audio().src === source && audio().currentTime >= position, 'Top pause preserves current recording');
    assert(bottom().ariaLabel === 'Odtwórz', 'Top pause updates bottom control');
    top().click();
    await until(() => !audio().paused && audio().currentTime > position, 'Top resume did not resume');
    assert(audio().src === source, 'Top resume preserves current recording');
    const orbLevels = () => ['.voice-orb-preview .voice-orb', '.player-identity .voice-orb'].map(selector => Number(document.querySelector(selector)?.dataset.level));
    if (location.search.includes('stalled-meter')) {
      assert(orbLevels().every(level => level === 0), 'Unavailable analyser leaves audio playing with zero levels');
      assert(meterSources === 0, 'Suspended analyser never takes ownership of native audio output');
    } else {
      await until(() => orbLevels().every(level => level > .01), 'No audio activity');
      const levels = orbLevels();
      assert(levels[0] === levels[1], 'Both orbs receive identical audio levels', JSON.stringify(levels));
    }
    bottom().click();
    await until(() => audio().paused && /Odtwórz/.test(top().ariaLabel), 'Bottom pause did not update top');
    assert(true, 'Bottom pause updates top control');
    top().click();
    await until(() => !audio().paused, 'Replay did not start');
    audio().currentTime = audio().duration - .1;
    await until(() => audio().ended && bottom().ariaLabel === 'Odtwórz' && /Odtwórz/.test(top().ariaLabel), 'End did not reset both controls');
    assert(true, 'End resets both controls');
    top().click();
    await until(() => !audio().paused && audio().currentTime < 2, 'Replay after end did not start');
    assert(true, 'Replay after end starts');
    bottom().click();
    await until(() => audio().paused, 'Pause before rejected start');
    HTMLMediaElement.prototype.play = function () {
      HTMLMediaElement.prototype.play = nativePlay;
      return Promise.reject(new DOMException('Fixture autoplay block', 'NotAllowedError'));
    };
    bottom().click();
    await until(() => document.querySelector('.player-copy').textContent.includes('zablokowała'), 'Rejected start has no visible error');
    assert(bottom().ariaLabel === 'Odtwórz' && /Odtwórz/.test(top().ariaLabel), 'Rejected start leaves both controls stopped');
    top().click();
    await until(() => !audio().paused && !document.querySelector('.player-copy').textContent.includes('zablokowała'), 'Retry failed');
    assert(true, 'Retry starts audio and clears error');
    const currentAudio = audio();
    [...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'Pulpit')?.click();
    await until(() => !top(), 'Dashboard did not open');
    assert(audio() === currentAudio && !audio().paused, 'Navigation preserves global playback');
    [...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'Tekst na mowę')?.click();
    await until(() => top() && /Wstrzymaj/.test(top().ariaLabel), 'Restored top control did not synchronize');
    assert(true, 'Returning to editor restores synchronized top control');
    bottom().click();
    if (!location.search.includes('stalled-meter') && !location.search.includes('offline')) {
      let release;
      window.fetch = (input, options) => String(input).includes('/profiles/') && String(input).endsWith('/audio')
        ? new Promise(resolve => { release = () => resolve(new Response(blob, { headers: { 'Content-Type': 'audio/wav' } })); })
        : nativeFetch(input, options);
      document.querySelector('.voice-sample-button').click();
      await until(() => release, 'Delayed sample request not started');
      const newer = new DataTransfer();
      newer.items.add(new File([blob], 'newer-global.wav', { type: 'audio/wav' }));
      input.files = newer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      await until(() => document.querySelector('.player-copy').textContent.includes('newer-global'), 'Newer recording not selected');
      const newerSource = audio().src;
      release(); await wait(150);
      assert(audio().src === newerSource && document.querySelector('.player-copy').textContent.includes('newer-global'), 'Late sample cannot replace newer recording');
      bottom().click();
      await until(() => !audio().paused && orbLevels().every(level => level > .01), 'Replacement recording did not produce audio activity');
      assert(document.querySelectorAll('.player audio').length === 1, 'Source replacement retains a single working global player');
      bottom().click();
    }
  } catch (error) {
    results.push({ name: 'Run', passed: false, detail: String(error) });
  } finally {
    window.AudioContext = nativeContext;
    HTMLMediaElement.prototype.play = nativePlay;
    window.fetch = nativeFetch;
  }
  window.playbackCheckResults = results;
  document.querySelector('#playback-results').textContent = JSON.stringify(results, null, 2);
  return results;
}
const panel = document.createElement('div');
panel.style.cssText = 'position:fixed;left:12px;top:12px;z-index:99999;background:#151515;color:white;padding:10px;max-width:580px;max-height:55vh;overflow:auto;font:12px monospace';
panel.innerHTML = '<button id="run-playback-check">Sprawdź wspólne odtwarzanie</button><pre id="playback-results"></pre>';
document.body.append(panel);
panel.querySelector('button').onclick = runPlaybackCheck;
