<script lang="ts">
  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import { get } from 'svelte/store';
  import { Check, Circle, Info, LoaderCircle, ChevronDown, TriangleAlert, X } from '@lucide/svelte';
  import Button from '../ui/Button.svelte';
  import { modelStatus } from './api';
  import type { RuntimeStatus } from './runtime';
  import { engineCatalog, modelsCatalog } from '../tools/studio-tools';
  import { engineCatalogSnapshot } from '../models/engine-catalog-state';
  import { readModelWarmup, startupFraction, startupRows, warmupNote, type ModelWarmup, type WarmupNote } from './engine-startup';

  // Bottom-right card shown only while the engine starts or the TTS model warms up; nothing here starts the engine.
  // `onmodels` opens Ustawienia → Modele from the "model skipped" note.
  let { runtime, onmodels }: { runtime: { state: string; message: string; startup?: RuntimeStatus['startup'] }; onmodels?: () => void } = $props();
  let model = $state<ModelWarmup | null>(null), seen = $state(false), finished = $state(false), expanded = $state(true);
  let note = $state<WarmupNote>(), dismissed = $state(false);
  let elapsed = $state(0);

  const engineState = $derived(runtime.state); // by value: App replaces `runtime` on every poll
  const rows = $derived(startupRows(runtime, model));
  const working = $derived(engineState === 'starting' || model?.status === 'loading');
  const visible = $derived(working || finished);
  const active = $derived(rows.find(row => row.state === 'active'));
  const title = $derived(finished ? 'Silnik i model są gotowe' : engineState === 'starting' ? 'Uruchamianie silnika' : 'Ładowanie modelu głosowego');

  $effect(() => { if (working) seen = true; });

  // Time since the card appeared: an honest "how long so far", since the remaining time cannot be known.
  $effect(() => {
    if (!working) return;
    const began = Date.now();
    elapsed = 0;
    const tick = setInterval(() => { elapsed = Math.floor((Date.now() - began) / 1000); }, 1000);
    return () => clearInterval(tick);
  });

  // Once the engine answers, follow the model warm-up. A model that never starts loading (no licence or no
  // weights installed) stays "idle" and polling stops after a minute and a half.
  $effect(() => {
    if (engineState !== 'ready') { model = null; note = undefined; return; }
    const began = Date.now();
    let stop = false, explained = false, timer: ReturnType<typeof setTimeout> | undefined, hide: ReturnType<typeof setTimeout> | undefined;
    // The engine does not report why it skipped the preload, so after a quiet 15 s derive it from the catalogue.
    const explain = async () => {
      try {
        const family = get(engineCatalogSnapshot)?.catalog.tts ?? (await engineCatalog()).tts;
        const weights = (await modelsCatalog()).models;
        if (!stop && model?.status === 'idle') { note = warmupNote(model, family, weights); dismissed = false; }
      } catch { /* no catalogue: leave the card without a note */ }
    };
    const poll = async () => {
      try { if (!stop) model = readModelWarmup(await modelStatus()); } catch { /* the engine may be stopping */ }
      if (stop) return;
      if (model?.status === 'ready') {
        note = undefined;
        if (seen) { finished = true; hide = setTimeout(() => { finished = false; seen = false; }, 3000); }
      } else if (model?.status === 'error') { seen = false; note = warmupNote(model); dismissed = false; }
      else if (model?.status === 'loading') { note = undefined; timer = setTimeout(poll, 1000); }
      else {
        if (!explained && Date.now() - began > 15_000) { explained = true; void explain(); }
        if (Date.now() - began < 90_000) timer = setTimeout(poll, 1000);
      }
    };
    void poll();
    return () => { stop = true; clearTimeout(timer); clearTimeout(hide); };
  });

  const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const detail = $derived(runtime.state === 'starting' && runtime.startup && runtime.startup.phase !== 'preparing' ? runtime.message : '');
</script>

{#if visible}
  <section class="engine-startup" role="status" aria-live="polite" aria-label={tr("Stan uruchamiania silnika")}>
    <header>
      {#if finished}<Check size={15}/>{:else}<LoaderCircle size={15} class="spin"/>{/if}
      <strong>{tr(title)}</strong>
      {#if working}<span class="time">{clock(elapsed)}</span>{/if}
      <button type="button" class="fold" aria-expanded={expanded} aria-label={tr("Pokaż szczegóły uruchamiania")} onclick={() => expanded = !expanded}><ChevronDown size={15} class={expanded ? '' : 'flip'}/></button>
    </header>
    <progress max="1" value={startupFraction(rows, model)} aria-label={tr(title)}></progress>
    {#if working && active}<p class="now">{tr(active.label)}{#if active.detail} · {tr(active.detail)}{/if}</p>{/if}
    {#if detail}<p class="note">{tr(detail)}</p>{/if}
    {#if expanded}
      <ul>
        {#each rows as row (row.id)}
          <li class={row.state}>
            {#if row.state === 'done'}<Check size={13}/>{:else if row.state === 'active'}<LoaderCircle size={13} class="spin"/>{:else}<Circle size={13}/>{/if}
            <span>{tr(row.label)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{:else if note && !dismissed}
  <section class="engine-startup" role="status" aria-live="polite" aria-label={tr("Stan modelu głosowego")}>
    <header>
      {#if model?.status === 'error'}<TriangleAlert size={15}/>{:else}<Info size={15}/>{/if}
      <strong>{tr(note.text)}</strong>
      <button type="button" class="fold" aria-label={tr("Zamknij")} onclick={() => dismissed = true}><X size={15}/></button>
    </header>
    {#if note.detail}<p class="note">{note.detail}</p>{/if}
    {#if onmodels}<div class="act"><Button variant="outline" onclick={() => { dismissed = true; onmodels(); }}>{tr("Otwórz Modele")}</Button></div>{/if}
  </section>
{/if}

<style>
  .engine-startup{position:fixed;right:16px;bottom:16px;z-index:250;width:min(300px,calc(100vw - 32px));padding:12px;border:1px solid var(--border);border-radius:var(--menu-radius,14px);background:var(--surface-raised);box-shadow:var(--popup-shadow);color:var(--foreground);font-size:var(--ui-text-12)}
  header{display:flex;align-items:center;gap:8px}header strong{flex:1;min-width:0}
  .time{color:var(--muted);font-variant-numeric:tabular-nums}
  .fold{display:grid;place-items:center;width:22px;height:22px;border-radius:6px;color:var(--muted)}.fold:hover{background:var(--surface-hover)}
  .fold :global(.flip){transform:rotate(-90deg)}
  progress{display:block;width:100%;height:4px;margin:10px 0 8px;appearance:none;border:0;border-radius:2px;background:var(--surface-hover);overflow:hidden}
  progress::-webkit-progress-bar{background:var(--surface-hover)}progress::-webkit-progress-value{background:var(--accent);transition:width .25s ease}
  .now,.note{margin:0 0 6px;line-height:1.5}.note{color:var(--muted);overflow-wrap:anywhere}
  header+.note,.act{margin-top:8px}
  ul{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:5px}
  li{display:flex;align-items:center;gap:8px;color:var(--muted)}li.done{color:var(--foreground)}li.done :global(svg){color:var(--success)}li.active{color:var(--foreground);font-weight:600}
  @media (prefers-reduced-motion:reduce){progress::-webkit-progress-value{transition:none}}
</style>
