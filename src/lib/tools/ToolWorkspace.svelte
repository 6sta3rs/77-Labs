<script lang="ts">
  import type { Snippet } from 'svelte'
  import './tool-workspace.css'

  let { title, description = '', tab = $bindable('settings'), historyLabel = 'Historia', historyCount,
    content, settings, history, actions, headerActions }: {
    title: string; description?: string; tab?: 'settings' | 'history'; historyLabel?: string; historyCount?: number;
    content: Snippet; settings: Snippet; history?: Snippet; actions?: Snippet; headerActions?: Snippet;
  } = $props()
  const uid = $props.id()
  function switchTab(event: KeyboardEvent) {
    if (!history || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    tab = event.key === 'Home' ? 'settings' : event.key === 'End' ? 'history' : tab === 'settings' ? 'history' : 'settings'
    document.getElementById(`${uid}-${tab}-tab`)?.focus()
  }
</script>

<div class="tool-workspace">
  <section class="tool-workspace-main" aria-label={title}>
    <div class="tool-workspace-scroll">
      <header class="tool-workspace-heading"><div><h1>{title}</h1>{#if description}<p>{description}</p>{/if}</div>{#if headerActions}{@render headerActions()}{/if}</header>
      <div class="tool-workspace-content">{@render content()}</div>
    </div>
    {#if actions}<footer class="tool-workspace-actions">{@render actions()}</footer>{/if}
  </section>
  <aside class="tool-workspace-inspector" aria-label={`Panel: ${title}`}>
    <div class="tool-workspace-tabs" role="tablist" aria-label="Panel narzędzia">
      <button id={`${uid}-settings-tab`} role="tab" aria-selected={tab === 'settings'} aria-controls={`${uid}-settings`} tabindex={tab === 'settings' ? 0 : -1} onclick={() => tab = 'settings'} onkeydown={switchTab}>Ustawienia</button>
      {#if history}<button id={`${uid}-history-tab`} role="tab" aria-selected={tab === 'history'} aria-controls={`${uid}-history`} tabindex={tab === 'history' ? 0 : -1} onclick={() => tab = 'history'} onkeydown={switchTab}>{historyLabel}{#if historyCount !== undefined}<span>{historyCount}</span>{/if}</button>{/if}
    </div>
    <div id={`${uid}-settings`} class="tool-workspace-panel" role="tabpanel" aria-labelledby={`${uid}-settings-tab`} hidden={tab !== 'settings'}>{@render settings()}</div>
    {#if history}<div id={`${uid}-history`} class="tool-workspace-panel" role="tabpanel" aria-labelledby={`${uid}-history-tab`} hidden={tab !== 'history'}>{@render history()}</div>{/if}
  </aside>
</div>
