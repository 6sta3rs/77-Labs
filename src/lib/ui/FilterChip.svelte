<script lang="ts">
  import { Plus, X } from '@lucide/svelte'
  import Select from './Select.svelte'
  import LanguageFlag from './LanguageFlag.svelte'
  import './group-filter.css'

  let { label, valueLabel, options, value = $bindable(''), onchange, disabled = false, language }: {
    label: string; valueLabel?: string; options: Array<{ value: string; label: string; description?: string; disabled?: boolean; group?: string }>
    value?: string; onchange?: (value: string) => void; disabled?: boolean; language?: boolean
  } = $props()
  let container: HTMLDivElement
  const selectedLabel = $derived(valueLabel || options.find(option => option.value === value)?.label || value)
  const isLanguage = $derived(language ?? /język|jezyk|language/i.test(label))
  function update(next: string) { value = next; onchange?.(next) }
  function reset() {
    update('')
    // The clear button disappears, so keep focus on the remaining filter trigger.
    container.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')?.focus()
  }
</script>

<div bind:this={container} class="vs-filter-chip" class:vs-filter-chip-active={!!value} class:vs-filter-chip-disabled={disabled}>
  {#if value}<button type="button" class="vs-filter-clear" {disabled} aria-label={`Usuń filtr: ${label}`} onclick={reset}><X size={13}/></button>{/if}
  <Select {value} onchange={update} {options} {disabled} language={isLanguage} ariaLabel={`${label}${value ? `: ${selectedLabel}` : ': dodaj filtr'}`}
    variant="ghost" size="compact" class="vs-chip-select" placeholder={label} alignItemWithTrigger={false}>
    {#snippet triggerContent()}{#if !value}<Plus size={13}/>{/if}<span>{label}</span>{#if value}<span class="vs-filter-separator" aria-hidden="true"></span>{#if isLanguage}<LanguageFlag language={value}/>{/if}<span class="vs-filter-value">{selectedLabel}</span>{/if}{/snippet}
  </Select>
</div>
