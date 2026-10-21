<script lang="ts">
  import { untrack } from 'svelte';
  import { voiceIdentity, orbPreviewIdentity, VoiceOrbRenderer, type OrbVariant } from './voice-orb';
  import { SharedVoiceOrb, type OrbPresentation } from './shared-voice-orb';
  import { observeOrbMotion } from './orb-motion';
  import type { AudioFeatures } from './audio-features';
  import type { OrbAudioBands } from './playback-meter';
  let { voiceId = 'voicestudio', size = 128, animated = true, level = 0, bands = [], playing = false, ring = false,
    variant = 'original', features, orbAudio, sensitivity = 1, syncGroup, suspended = false, preview = false }: {
    voiceId?: string; size?: number | string; animated?: boolean; level?: number; bands?: number[]; playing?: boolean; ring?: boolean;
    variant?: OrbVariant; features?: AudioFeatures; orbAudio?: OrbAudioBands; sensitivity?: number;
    syncGroup?: string; suspended?: boolean; preview?: boolean;
  } = $props();
  let root = $state<HTMLSpanElement>(), canvas = $state<HTMLCanvasElement>();
  let renderer = $state.raw<OrbPresentation>();
  let mode = $state('static'), reduced = $state(false), visible = $state(false), hidden = $state(false), initialized = $state(false);
  // Bumped when the app-wide orb palette changes, so colors and the GL uniforms repaint.
  let paletteVersion = $state(0);
  $effect(() => { const bump = () => paletteVersion++; window.addEventListener('orb-palette', bump); return () => window.removeEventListener('orb-palette', bump); });
  let identity = $derived((void paletteVersion, preview ? orbPreviewIdentity(voiceId, variant) : voiceIdentity(voiceId)));
  const presenting = $derived(animated && visible && !hidden && !reduced && !suspended);
  const safeSensitivity = $derived(Number.isFinite(sensitivity) ? Math.max(0, Math.min(3, sensitivity)) : 1);
  const drive = $derived(playing && presenting ? Math.min(1, Math.max(0, (features?.turbulence || 0) * safeSensitivity)) : 0);
  const pitchAngle = $derived.by(() => {
    const hz = features?.pitchHz, confidence = features?.pitchConfidence ?? 0;
    if (!playing || !presenting || typeof hz !== 'number' || !Number.isFinite(hz) || hz < 65 || hz > 800
      || !Number.isFinite(confidence) || confidence < .85) return 0;
    return Math.max(-30, Math.min(30, Math.log2(hz / 220) * 14));
  });
  const angles = Array.from({ length: 37 }, (_, index) => Math.PI + index / 36 * Math.PI);

  $effect(() => {
    if (!root || !animated) { visible = false; initialized = false; return; }
    return observeOrbMotion(root, state => {
      reduced = state.reduced; visible = state.visible; hidden = state.hidden;
      if (state.visible && !state.hidden) initialized = true;
    });
  });
  $effect(() => {
    if (animated && visible && !hidden && !suspended) initialized = true;
  });
  $effect(() => {
    const element = canvas;
    if (!element || !animated || !initialized) { mode = 'static'; return; }
    // A demonstration must never drive the shared, real playback visualization.
    const group = preview ? undefined : syncGroup;
    let local: OrbPresentation | undefined;
    const create = () => {
      // Initialization waits until a presentation is visible.
      if (!untrack(() => visible && !hidden && !suspended)) { initialized = false; mode = 'static'; return; }
      try {
        const callbacks = { onload: () => {
          mode = 'webgl';
          // A ready shared source calls back during construction; do not track presentation state here.
          untrack(() => { if (visible && !hidden && !suspended && !local?.running) local?.draw(); });
        }, onlost: () => { mode = 'fallback'; }, onerror: () => {
          local?.dispose(); local = undefined; renderer = undefined;
          mode = 'fallback';
        } };
        local = group ? new SharedVoiceOrb(group, element, callbacks) : new VoiceOrbRenderer(element, preview);
        renderer = local; mode = local instanceof SharedVoiceOrb && local.unavailable ? 'fallback' : 'webgl'; local.resize();
      }
      catch { mode = 'fallback'; renderer = undefined; }
    };
    const lost = (event: Event) => { event.preventDefault(); local?.dispose(); local = undefined; renderer = undefined; mode = 'fallback'; };
    const restored = () => create();
    element.addEventListener('webglcontextlost', lost); element.addEventListener('webglcontextrestored', restored);
    create();
    const resize = new ResizeObserver(() => { if (visible && !hidden && !suspended) local?.resize(); }); resize.observe(element);
    return () => { resize.disconnect(); local?.dispose(); renderer = undefined; element.removeEventListener('webglcontextlost', lost); element.removeEventListener('webglcontextrestored', restored); };
  });
  $effect(() => { void paletteVersion; if (renderer) { renderer.setVoice(voiceId); if (visible && !hidden && !suspended && !renderer.running) renderer.draw(); } });
  $effect(() => { if (renderer && visible && !hidden && !suspended) renderer.resize(); });
  $effect(() => {
    const current = renderer;
    if (!current || !visible || hidden || suspended) return;
    current.setVariant(variant); current.setSensitivity(sensitivity);
    current.setLevel(reduced || !playing ? 0 : level);
    current.setFeatures(reduced || !playing ? undefined : features);
    current.setAudioBands(reduced || !playing ? undefined : orbAudio);
    if (!current.running) current.draw();
  });
  $effect(() => {
    const current = renderer;
    if (!current) return;
    // Audio changes targets, never the animation clock. Idle/pause retain the original gentle drift.
    if (!reduced && visible && !hidden && !suspended) current.start(); else { current.stop(); if (visible && !hidden && !suspended) current.draw(); }
    return () => current.stop();
  });
</script>

<span bind:this={root} class="voice-orb" class:ring class:reactive={playing && presenting} data-renderer={mode} data-voice={voiceId} data-level={(presenting ? level : 0).toFixed(3)}
  data-variant={variant} data-preview={preview || undefined} data-sync-group={preview ? undefined : syncGroup} data-turbulence={drive.toFixed(3)} data-pitch={playing && presenting ? features?.pitchHz?.toFixed(1) : undefined} aria-hidden="true"
  style={`--orb-size:${typeof size === 'number' ? `${size}px` : size};--orb-dark:${identity.colors[0]};--orb-mid:${identity.colors[1]};--orb-light:${identity.colors[2]};--orb-level:${presenting ? level : 0};--orb-pitch-angle:${pitchAngle}deg;--orb-duration:${variant === 'calm' ? 36 : variant === 'intonation' ? 28 : 24}s`}>
  <span class="orb-sphere">
    <span class="orb-fallback" class:moving={mode === 'fallback' && presenting}></span>
    {#if animated}<canvas bind:this={canvas} class:ready={mode === 'webgl'}></canvas>{/if}
  </span>
  {#if ring}<svg viewBox="0 0 200 200" class="orb-ring">
    {#each angles as angle, index}
      {@const amplitude = playing && presenting ? (bands[Math.floor(index / angles.length * bands.length)] || 0) : 0}
      <line x1={100 + Math.cos(angle) * 88} y1={100 + Math.sin(angle) * 88} x2={100 + Math.cos(angle) * (90.3 + amplitude * 9)} y2={100 + Math.sin(angle) * (90.3 + amplitude * 9)} stroke-opacity={.25 + amplitude * .7}/>
    {/each}
  </svg>{/if}
</span>

<style>
  .voice-orb[data-variant=intonation] .orb-fallback{transition:filter .8s ease-out}@media(prefers-reduced-motion:reduce){.voice-orb[data-variant=intonation] .orb-fallback{transition:none}}:global([data-reduced-motion=true]) .voice-orb[data-variant=intonation] .orb-fallback{transition:none}
  .voice-orb{display:inline-block;position:relative;width:var(--orb-size);height:var(--orb-size);flex:none;vertical-align:middle;isolation:isolate;pointer-events:none}.orb-sphere{position:absolute;inset:0;border-radius:50%;overflow:hidden;background:var(--orb-dark);transform:translateZ(0)}.ring .orb-sphere{inset:13%}.orb-fallback{position:absolute;inset:0;border-radius:50%;background:radial-gradient(ellipse at 28% 26%,var(--orb-light),transparent 48%),radial-gradient(ellipse at 72% 70%,var(--orb-mid),transparent 50%),radial-gradient(ellipse at 70% 28%,var(--orb-dark),transparent 55%),var(--orb-mid);box-shadow:inset -5px -8px 18px #0004,inset 2px 2px 10px #ffffff18}.orb-fallback.moving{animation:orb-drift 22s linear infinite}.voice-orb:not([data-variant=original]) .orb-fallback.moving{animation-duration:var(--orb-duration)}.voice-orb[data-variant=intonation] .orb-fallback{filter:hue-rotate(var(--orb-pitch-angle))}.orb-sphere canvas{position:absolute;width:100%;height:100%;inset:0;opacity:0}.orb-sphere canvas.ready{opacity:1}.orb-ring{position:absolute;inset:0;width:100%;height:100%;overflow:visible;fill:none;stroke:var(--foreground);stroke-width:1.6;stroke-linecap:round}@keyframes orb-drift{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.orb-fallback.moving{animation:none}}
</style>
