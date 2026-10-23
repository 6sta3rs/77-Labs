<script lang="ts">
  // Brand marks from ./ai-icons (lobe-icons, MIT; see provider-icons/README.md). Monochrome, follow currentColor.
  import { Server } from '@lucide/svelte';
  const files = import.meta.glob('./provider-icons/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  let { id, size = 22 }: { id: string; size?: number } = $props();
  const svg = $derived(files[`./provider-icons/${id === 'claudecode' ? 'anthropic' : id}.svg`]?.replace(/<title>.*?<\/title>/, ''));
</script>

<span class="pi" style:font-size="{size}px" style:width="{size}px" style:height="{size}px" aria-hidden="true">{#if svg}{@html svg}{:else}<Server size={size} strokeWidth={1.6}/>{/if}</span>

<style>
  .pi{display:inline-flex;align-items:center;justify-content:center;flex:none;color:var(--foreground)}
  .pi :global(svg){display:block}
</style>
