<script lang="ts">
  // "Wygląd": the real Appearance component (themes, orb, interface) inside the shared page skeleton.
  // Its own header is hidden; the two-step "Przywróć" lives in the page heading instead.
  import { onDestroy } from 'svelte';
  import { RotateCcw } from '@lucide/svelte';
  import { uiLanguage, createUiTranslator } from '../../i18n';
  import Appearance from '../Appearance.svelte';
  import { defaultAppearance, type AppearanceSettings } from '../appearance';
  import Button from '../../ui/Button.svelte';
  const tr = $derived(createUiTranslator($uiLanguage));

  let { value, voiceId, onchange }: { value: AppearanceSettings; voiceId?: string; onchange: (next: AppearanceSettings) => void } = $props();

  // Two-step inline confirmation: first click arms the button for 4 s, second click resets.
  let armed = $state(false), timer: ReturnType<typeof setTimeout> | undefined, done = $state(false);
  function reset() {
    clearTimeout(timer);
    if (!armed) { armed = true; timer = setTimeout(() => armed = false, 4000); return; }
    armed = false; onchange({ ...defaultAppearance });
    done = true; timer = setTimeout(() => done = false, 2200);
  }
  onDestroy(() => clearTimeout(timer));
</script>

<div class="p-page appearance-page">
  <div class="page-heading">
    <div><h1>{tr('Wygląd')}</h1><p>{tr('Motywy, kula głosu oraz rozmiar i kontrast interfejsu.')}</p></div>
    <div class="reset">
      <Button variant={armed ? 'destructive' : 'outline'} aria-label={tr('Przywróć domyślny wygląd')} onclick={reset}><RotateCcw size={15}/>{armed ? tr('Potwierdź przywrócenie') : tr('Przywróć')}</Button>
      {#if done}<span class="saved on" role="status">{tr('Przywrócono domyślny wygląd')}</span>{/if}
    </div>
  </div>
  <div class="host"><Appearance {value} {voiceId} {onchange}/></div>
</div>

<style>
  .page-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
  .reset{display:flex;align-items:center;gap:12px}
  .saved{color:var(--success);font-size:var(--ui-text-12)}
  /* Neutralise the real component's own page chrome so it sits in the shared page skeleton. */
  .host :global(.appearance-panel){max-width:none;margin:0;padding:0}
  .host :global(.appearance-header){display:none}
  .host :global(.appearance-panel section+section){margin-top:28px}
  .host :global(.appearance-panel h3){font-size:var(--ui-text-13);font-weight:600;color:var(--foreground);margin:0 0 12px}
  .host :global(.appearance-panel .section-title h3){margin-bottom:0}
  .host :global(.appearance-panel .theme-help),.host :global(.appearance-panel .theme-current),.host :global(.appearance-panel .font-note){margin-left:0;margin-right:0}
  .host :global(.appearance-panel .theme-message){margin-left:0}
</style>
