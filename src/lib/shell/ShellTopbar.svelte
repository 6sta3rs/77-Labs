<script lang="ts">
  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import Button from '../ui/Button.svelte';
  import type { Snippet } from 'svelte';
  import { PanelLeft } from '@lucide/svelte';
  let { title, ontoggle, collapsed = false, children, actions }: { title: string; ontoggle: () => void; collapsed?: boolean; children?: Snippet; actions?: Snippet } = $props();
</script>
<header class="topbar shell-topbar"><div class="breadcrumbs"><Button variant="ghost" size="icon" aria-label={collapsed ? tr("Rozwiń nawigację") : tr("Zwiń nawigację")} onclick={ontoggle}><PanelLeft size={18}/></Button><strong tabindex="-1">{tr(title)}</strong>{@render children?.()}</div><div class="top-actions">{@render actions?.()}</div></header>
