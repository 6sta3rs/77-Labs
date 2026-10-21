<script lang="ts">
  import { AudioLines, Search } from '@lucide/svelte';
  let { onhome, onsearch }: { onhome: () => void; onsearch: () => void } = $props();
</script>
<div class="sidebar-header"><button class="sidebar-brand" aria-label="Seventy Seven Labs — pulpit" onclick={onhome}><AudioLines size={24}/><span>Seventy Seven Labs</span></button><button class="sidebar-search" aria-label="Szukaj i przejdź do" aria-haspopup="dialog" aria-keyshortcuts="Control+k" onclick={onsearch}><Search size={16}/><span>Szukaj…</span><kbd>Ctrl K</kbd></button></div>

<style>
  .sidebar-brand > span { font-size:var(--ui-text-15); letter-spacing: -.4px; white-space: nowrap; }
</style>
