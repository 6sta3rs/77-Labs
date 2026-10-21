// Run on /inputy after one trusted Play/Pause click to unlock browser audio.
export async function checkAudioCards() {
  const checks = [];
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async condition => { const start = performance.now(); while (!condition()) { if (performance.now() - start > 3000) return; await wait(30); } };
  const assert = (name, value) => { checks.push({ name, passed: !!value }); if (!value) throw new Error(name); };
  const root = document.querySelector('#control-14');
  const cards = [...root.querySelectorAll('.audio-sample .generation-card')];
  const card = cards[0], button = card.querySelector('.mini-play');
  const audio = () => root.querySelector('audio');
  const nativePlay = HTMLMediaElement.prototype.play;
  try {
    if (!audio().paused) { root.querySelector('.play-button').click(); await wait(40); }
    root.querySelector('.audio-sample-heading button').click(); await wait(100);
    const range = card.querySelector('input[type=range]');
    range.value = '0'; range.dispatchEvent(new Event('input', { bubbles: true })); await wait(50);
    button.click(); await until(() => !audio().paused && Number(range.value) > .1);
    assert('Karta uruchamia natywne audio', !audio().paused && audio().currentTime > .1);
    assert('Karta pokazuje Pause i playing', card.dataset.playbackState === 'playing' && button.ariaLabel.includes('Wstrzymaj'));
    assert('Waveform pokazuje rzeczywisty postęp', !/100%/.test(card.querySelector('.wave-played').style.clipPath));
    assert('Pozycja karty odpowiada audio', Math.abs(Number(range.value) - audio().currentTime) < .4);
    button.click(); await wait(70); const pausedTime = audio().currentTime;
    assert('Drugi klik zatrzymuje audio', audio().paused && card.dataset.playbackState === 'paused');
    await wait(150);
    assert('Pauza nie przewija nagrania', Math.abs(audio().currentTime - pausedTime) < .02);
    range.value = '1.5'; range.dispatchEvent(new Event('input', { bubbles: true })); await wait(100);
    assert('Przewijanie z karty działa', audio().paused && Math.abs(audio().currentTime - 1.5) < .1);
    button.click(); await wait(120);
    assert('Wznowienie zachowuje pozycję', !audio().paused && audio().currentTime >= 1.5);
    root.querySelector('.play-button').click(); await wait(80);
    assert('Pauza globalna synchronizuje kartę', card.dataset.playbackState === 'paused');
    cards[1].querySelector('.mini-play').click(); await until(() => cards[1].dataset.playbackState === 'playing');
    assert('Inna karta zmienia źródło i uruchamia je', cards[1].dataset.playbackState === 'playing' && card.dataset.playbackState === 'idle');
    cards[1].querySelector('.mini-play').click(); await wait(70);
    assert('Drugą kartę też można zatrzymać', audio().paused);
    let release;
    HTMLMediaElement.prototype.play = () => new Promise(resolve => release = resolve);
    cards[1].querySelector('.mini-play').click(); await wait(50);
    assert('Oczekujący start pokazuje loader', cards[1].dataset.playbackState === 'loading' && cards[1].querySelector('.generation-loading'));
    cards[1].querySelector('.mini-play').click(); await wait(50);
    assert('Wczytywanie można anulować', cards[1].dataset.playbackState === 'paused' && audio().paused);
    release(); HTMLMediaElement.prototype.play = nativePlay; await wait(30);
    assert('Spóźniony start nie wznawia anulowanego audio', audio().paused);
    HTMLMediaElement.prototype.play = () => Promise.reject(new Error('Controlled playback failure'));
    cards[1].querySelector('.mini-play').click(); await wait(50);
    assert('Błąd startu jest widoczny i umożliwia ponowienie', cards[1].dataset.playbackState === 'error' && cards[1].querySelector('[role=alert]') && !cards[1].querySelector('.mini-play').disabled);
    HTMLMediaElement.prototype.play = nativePlay;
    const variants = [...root.querySelectorAll('.orb-comparison button')];
    assert('Są cztery warianty z oryginałem', variants.length === 4 && variants[0].textContent.includes('Oryginał'));
    for (const item of variants) {
      item.click(); await wait(40);
      assert(`Wybór wariantu ${item.textContent.trim()}`, root.querySelector('.audio-orb-stage .voice-orb').dataset.variant === item.querySelector('.voice-orb').dataset.variant);
    }
    assert('Shadery działają w przeglądarce', [...root.querySelectorAll('.voice-orb')].every(orb => orb.dataset.renderer === 'webgl'));
    const demo = root.querySelector('.generation-demo button'); demo.click(); await wait(40);
    const generating = root.querySelector('[data-playback-state=generating]');
    assert('Generowanie pokazuje loader i blokuje Play', generating.querySelector('.generation-loading') && generating.querySelector('.mini-play').disabled);
    assert('Generowanie nie wymyśla procentu', !generating.querySelector('[role=progressbar]').hasAttribute('aria-valuenow'));
    demo.click(); await wait(30);
    assert('Podgląd generowania można zakończyć', !root.querySelector('[data-playback-state=generating]'));
    return { passed: checks.length, checks };
  } catch (error) { return { passed: checks.filter(row => row.passed).length, checks, error: String(error) }; }
  finally { HTMLMediaElement.prototype.play = nativePlay; audio()?.pause(); }
}
