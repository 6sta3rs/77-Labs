<script lang="ts">
  import { uiLanguage, createUiTranslator } from '../i18n'
  const tr = $derived(createUiTranslator($uiLanguage))
  import { AudioLines } from '@lucide/svelte'
  let { id, name, size = 24 }: {
    id?: string; name?: string; src?: string; size?: number | string; fallbackText?: string
  } = $props()
  const title = $derived(name || id ? tr('Model: {name}', { name: name || id || '' }) : tr('Model mowy'))
</script>

<span class="model-icon" title={title} aria-hidden="true" data-icon-kind="neutral"
  style={`--model-icon-size:${typeof size === 'number' ? `${size}px` : size}`}>
  <AudioLines size="65%"/>
</span>

<style>
  .model-icon{width:var(--model-icon-size);height:var(--model-icon-size);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;vertical-align:middle;color:var(--icon-muted,var(--muted));overflow:hidden;border-radius:5px}
</style>
