<script lang="ts">
  import { ChevronRight } from '@lucide/svelte'
  import ModelIcon from './ModelIcon.svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import '../models/model-picker.css'

  type Props = Omit<HTMLButtonAttributes, 'type' | 'children'> & {
    name?: string
    brand?: string
    modelId?: string
    iconSrc?: string
    label?: string
    expanded?: boolean
    active?: boolean
    busy?: boolean
    popup?: 'dialog' | 'listbox'
  }
  let { name = 'Wybierz model', brand, modelId, iconSrc, label = 'Model', expanded = false, active = false, busy = false,
    popup, disabled = false, class: className = '', ...native }: Props = $props()
</script>

<button {...native} type="button" class={`model-trigger ${className}`} disabled={disabled || busy}
  aria-expanded={expanded} aria-haspopup={popup} aria-busy={busy || undefined}
    aria-label={native['aria-label'] || `${label || 'Model'}: ${name}`} data-active={active || undefined}>
  <span class="model-trigger-copy">{#if label}<span class="model-trigger-label">{label}</span>{/if}
    <span class="model-trigger-name"><ModelIcon id={modelId} {name} src={iconSrc} size={20} fallbackText={brand}/><span>{busy ? 'Wczytywanie modeli…' : name}</span></span>
  </span><ChevronRight size={16} class="model-trigger-chevron" aria-hidden="true"/>
</button>
