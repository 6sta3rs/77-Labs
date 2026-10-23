<script lang="ts">
  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import { AudioLines, Search } from '@lucide/svelte';
  let { onhome, onsearch }: { onhome: () => void; onsearch: () => void } = $props();
</script>
<div class="sidebar-header"><button class="sidebar-brand" aria-label={tr("Seventy Seven Labs — pulpit")} onclick={onhome}><AudioLines size={24}/><span>{tr("Seventy Seven Labs")}</span></button><button class="sidebar-search" aria-label={tr("Szukaj i przejdź do")} aria-haspopup="dialog" aria-keyshortcuts="Control+k" onclick={onsearch}><Search size={16}/><span>{tr("Szukaj…")}</span><kbd>{tr("Ctrl K")}</kbd></button></div>

<style>
  .sidebar-brand > span { font-size:var(--ui-text-15); letter-spacing: -.4px; white-space: nowrap; }
</style>
