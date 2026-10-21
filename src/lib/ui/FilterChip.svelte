<script lang="ts">
  import { Plus } from '@lucide/svelte'
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
  // Inactive „+” is a pointer shortcut to the list; the trigger keeps the accessible name.
  function open() { container.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')?.click() }
  function reset() {
    update('')
    // The clear button disappears, so keep focus on the remaining filter trigger.
    container.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')?.focus()
  }
</script>

<div bind:this={container} class="vs-filter-chip" class:vs-filter-chip-active={!!value} class:vs-filter-chip-disabled={disabled}>
  <button type="button" class="vs-filter-clear" {disabled} aria-label={value ? `Usuń filtr: ${label}` : undefined} aria-hidden={value ? undefined : 'true'} tabindex={value ? undefined : -1} onclick={value ? reset : open}><Plus size={14}/></button>
  <Select {value} onchange={update} {options} {disabled} language={isLanguage} ariaLabel={`${label}${value ? `: ${selectedLabel}` : ': dodaj filtr'}`}
    variant="ghost" class="vs-chip-select" placeholder={label} alignItemWithTrigger={false}>
    {#snippet triggerContent()}<span class="vs-filter-label">{label}</span>{#if value}<span class="vs-filter-value-group">{#if isLanguage}<LanguageFlag language={value}/>{/if}<span class="vs-filter-value">{selectedLabel}</span></span>{/if}{/snippet}
  </Select>
</div>
