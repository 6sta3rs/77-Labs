<script lang="ts">
  import type { Component } from 'svelte'
  import Button from './Button.svelte'
  import './group-filter.css'

  type Item = { value: string; label: string; icon?: Component<any>; disabled?: boolean }
  let { label, items, mode = 'actions', value = $bindable<string | string[]>(''), onchange, onactivate,
    disabled = false, iconOnly = false }: {
    label: string; items: Item[]; mode?: 'actions' | 'single' | 'multiple'; value?: string | string[]
    onchange?: (value: string | string[]) => void; onactivate?: (value: string) => void
    disabled?: boolean; iconOnly?: boolean
  } = $props()
  let active = $state<string>()
  const enabled = $derived(items.filter(item => !item.disabled))
  const tabStop = $derived(enabled.some(item => item.value === active) ? active : enabled.find(item => selected(item.value))?.value || enabled[0]?.value)
  function selected(key: string) { return mode !== 'actions' && (Array.isArray(value) ? value.includes(key) : value === key) }
  function choose(key: string) {
    if (mode === 'actions') { onactivate?.(key); return }
    value = mode === 'single' ? key : selected(key) ? (Array.isArray(value) ? value : []).filter(item => item !== key) : [...(Array.isArray(value) ? value : []), key]
    onchange?.(value)
  }
  function keydown(event: KeyboardEvent, key: string) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = enabled.findIndex(item => item.value === key)
    const rtl = getComputedStyle(event.currentTarget as HTMLElement).direction === 'rtl'
    const direction = (event.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (index + direction + enabled.length) % enabled.length
    const target = enabled[next]
    if (!target) return
    active = target.value
    const group = (event.currentTarget as HTMLElement).closest('.vs-button-group')
    group?.querySelectorAll<HTMLButtonElement>('button[data-group-value]').forEach(button => {
      if (button.dataset.groupValue === target.value) button.focus()
    })
  }
</script>

<div class="vs-button-group" role="group" aria-label={label} data-mode={mode}>
  {#each items as item (item.value)}
    <Button variant={selected(item.value) ? 'secondary' : 'outline'} size={iconOnly ? 'icon' : 'sm'} class="vs-group-button"
      data-group-value={item.value} disabled={disabled || item.disabled} tabindex={!disabled && item.value === tabStop ? 0 : -1}
      aria-label={iconOnly ? item.label : undefined} aria-pressed={mode === 'actions' ? undefined : selected(item.value)}
      onfocus={() => active = item.value} onkeydown={event => keydown(event, item.value)} onclick={() => choose(item.value)}>
      {#if item.icon}<item.icon/>{/if}{#if !iconOnly}{item.label}{/if}
    </Button>
  {/each}
</div>
