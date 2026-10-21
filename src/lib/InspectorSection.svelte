<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { ChevronDown } from '@lucide/svelte';
  let { label, summary = '', defaultOpen = false, children }: { label: string; summary?: string; defaultOpen?: boolean; children: Snippet } = $props();
  let open = $state(untrack(() => defaultOpen));
  const uid = $props.id();
</script>
<section class="tts-disclosure" data-open={open}><button type="button" class="tts-disclosure-trigger" aria-expanded={open} aria-controls={uid+'-content'} onclick={() => open = !open}><span>{label}</span><span class="tts-disclosure-tail">{#if !open && summary}<span class="tts-value-badge">{summary}</span>{/if}<ChevronDown size={16} class={open ? '' : 'closed'}/></span></button><div id={uid+'-content'} class="tts-disclosure-content" hidden={!open}>{@render children()}</div></section>
