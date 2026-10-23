<script lang="ts">
  import { onMount } from 'svelte';
  import VoiceOrb from './playback/VoiceOrb.svelte';
  import Player from './playback/Player.svelte';
  import Button from './ui/Button.svelte';
  import { quietActivity, type PlaybackActivity } from './playback/playback-meter';
  import { idlePlaybackState, type PlaybackState } from './playback/playback-state';
  import { uiLanguage, createUiTranslator, setUiLanguage } from './i18n';
  import type { Render } from './data';

  const tr = $derived(createUiTranslator($uiLanguage));
  let recording = $state<Render>();
  let activity = $state.raw<PlaybackActivity>(quietActivity());
  let playback = $state<PlaybackState>(idlePlaybackState());
  let error = $state('');

  function chooseLanguage(language: 'pl' | 'en') {
    const result = setUiLanguage(language);
    error = result.ok ? '' : result.error;
  }

  onMount(() => {
    let disposed = false;
    let url = '';
    void fetch('/demo/orb-music.wav').then(async response => {
      if (!response.ok) throw new Error('Nie udało się wczytać muzyki demo.');
      const blob = await response.blob();
      if (disposed) return;
      url = URL.createObjectURL(blob);
      recording = { id: 'flow-music-demo', title: 'Signal Bloom', text: '', voice: 'Seventy Seven Labs',
        created: '', kind: 'audio', source: 'import', filename: 'signal-bloom.wav', duration: 24, blob, url };
    }).catch(() => { if (!disposed) error = 'Nie udało się wczytać muzyki demo.'; });
    return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  });
</script>

<main class="orb-music-demo" data-ui-language={$uiLanguage}>
  <header>
    <a href="/">Seventy Seven Labs</a>
    <div class="language-buttons" aria-label={tr('Język interfejsu')}>
      <Button variant="ghost" size="sm" aria-pressed={$uiLanguage === 'pl'} onclick={() => chooseLanguage('pl')}>Polski</Button>
      <Button variant="ghost" size="sm" aria-pressed={$uiLanguage === 'en'} onclick={() => chooseLanguage('en')}>English</Button>
    </div>
  </header>
  <section class="music-stage" aria-label={tr('Muzyka i wizualizacja')}>
    <div class="eyebrow">{tr('Przepływ')} · {tr('Muzyka demo')}</div>
    <h1>{tr('Przepływ reagujący na muzykę')}</h1>
    <p>{tr('Prawdziwy odtwarzacz, analiza dźwięku i renderer z aplikacji.')}</p>
    <div class="orb-capture" data-capture-orb>
      <VoiceOrb voiceId="flow-music-demo" variant="landing" size={512}
        level={activity.level} bands={activity.bands} features={activity.features}
        orbAudio={activity.orbAudio} playing={activity.playing} />
    </div>
    <div class="signal"><span>{tr('Poziom sygnału')}</span><meter min="0" max="1" value={activity.level}>{activity.level}</meter><span>{Math.round(activity.level * 100)}%</span></div>
    <p class="footnote">Signal Bloom · {tr('Oryginalna muzyka bez nagrań głosu.')}</p>
    <p class="footnote">{tr('Ten podgląd nie uruchamia silnika ani modeli.')}</p>
    {#if error}<p role="alert">{tr(error)}</p>{:else if !recording}<p role="status">{tr('Wczytywanie muzyki demo…')}</p>{/if}
  </section>
  <Player {recording} onimport={() => {}} onactivity={value => activity = value} onstate={value => playback = value}
    orbVariant="landing" orbVoiceId="flow-music-demo" />
  <span class="playback-observer" data-demo-playback={playback.status} aria-hidden="true"></span>
</main>

<style>
  .orb-music-demo{min-height:100vh;background:#08090b;color:#f5f5f5;padding-bottom:110px}
  header{display:flex;align-items:center;justify-content:space-between;padding:22px 40px;border-bottom:1px solid #ffffff10}
  header a{color:inherit;font-size:16px;font-weight:650;text-decoration:none}.language-buttons{display:flex;gap:6px}
  .music-stage{display:flex;align-items:center;flex-direction:column;padding:36px 20px 24px;text-align:center}
  .eyebrow{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#9ba7b5}h1{font-size:32px;line-height:1.15;margin:10px 0 12px;font-weight:600}
  p{margin:0 0 8px;color:#a5adb8;font-size:14px}.orb-capture{width:512px;height:512px;max-width:100%;margin:16px 0 6px;display:grid;place-items:center;background:#08090b}
  .signal{display:flex;align-items:center;gap:12px;font-size:12px;color:#b7bec8;min-height:24px}.signal meter{width:180px;height:10px;accent-color:#54bccd}.signal>span:last-child{width:35px;font-variant-numeric:tabular-nums}
  .footnote{font-size:12px;margin-top:9px;color:#8d97a5}.playback-observer{display:none}[role=alert]{color:#fba2a2}
  @media(max-width:600px){header{padding:18px 20px}.music-stage{padding-top:24px}h1{font-size:25px}.orb-capture{transform:scale(.7);margin:-60px 0}.signal meter{width:100px}}
</style>
