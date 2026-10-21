<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { ChevronDown } from '@lucide/svelte';
  let { label, summary = '', defaultOpen = false, children }: { label: string; summary?: string; defaultOpen?: boolean; children: Snippet } = $props();
  let open = $state(untrack(() => defaultOpen));
  const uid = $props.id();
</script>
<!-- Same height animation as the collapsible Slider: grid rows 0fr ↔ 1fr, closed content is inert. -->
<section class="tts-disclosure" data-open={open}><button type="button" class="tts-disclosure-trigger" aria-expanded={open} aria-controls={uid+'-content'} onclick={() => open = !open}><span>{label}</span><span class="tts-disclosure-tail">{#if !open && summary}<span class="tts-value-badge">{summary}</span>{/if}<ChevronDown size={16} class="tts-disclosure-chevron"/></span></button><div id={uid+'-content'} class="tts-disclosure-shell" inert={!open} aria-hidden={!open}><div class="tts-disclosure-panel"><div class="tts-disclosure-content">{@render children()}</div></div></div></section>

<style>
  .tts-disclosure-shell{display:grid;grid-template-rows:1fr;opacity:1;transition:grid-template-rows calc(var(--motion-duration,140ms) * 1.5) cubic-bezier(.2,.8,.2,1),opacity var(--motion-duration,140ms) ease}
  .tts-disclosure[data-open=false] .tts-disclosure-shell{grid-template-rows:0fr;opacity:0}
  .tts-disclosure-panel{min-height:0;overflow:hidden}
  .tts-disclosure :global(.tts-disclosure-chevron){transition:transform calc(var(--motion-duration,140ms) * 1.5) cubic-bezier(.2,.8,.2,1)}
  .tts-disclosure[data-open=false] :global(.tts-disclosure-chevron){transform:rotate(-90deg)}
  @media(prefers-reduced-motion:reduce){.tts-disclosure-shell,.tts-disclosure :global(.tts-disclosure-chevron){transition:none}}
  :global([data-reduced-motion=true]) .tts-disclosure-shell,:global([data-reduced-motion=true]) .tts-disclosure :global(.tts-disclosure-chevron){transition:none}
</style>
