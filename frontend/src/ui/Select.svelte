<script lang="ts">
  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import { tick, untrack, type Snippet } from 'svelte'
  import { fade } from 'svelte/transition'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import { Check, ChevronDown, ChevronUp } from '@lucide/svelte'
  import LanguageFlag from './LanguageFlag.svelte'
  import '../styles/ui.css'
  import '../styles/ui-fields.css'

  type Props = Omit<HTMLButtonAttributes, 'value' | 'onchange' | 'onclick' | 'onkeydown' | 'type'> & {
    value?: string; onchange?: (value: string) => void
    options: Array<{ value: string; label: string; description?: string; disabled?: boolean; group?: string }>
    label?: string; ariaLabel?: string; size?: 'default' | 'lg'
    variant?: 'default' | 'ghost'; name?: string; required?: boolean; placeholder?: string
    alignItemWithTrigger?: boolean
    language?: boolean
    triggerContent?: Snippet
  }
  let { value = $bindable(''), onchange, options, label, ariaLabel, disabled = false,
    size = 'default', variant = 'default', name, required = false, form,
    placeholder = 'Wybierz…', alignItemWithTrigger = true, language, triggerContent, id, class: className = '', ...native }: Props = $props()
  const uid = $props.id()
  const triggerId = $derived(id || `${uid}-trigger`)
  const initial = untrack(() => value)
  const isLanguage = $derived(language ?? /język|jezyk|language/i.test([label, ariaLabel, native['aria-label'], name].filter(Boolean).join(' ')))
  let input: HTMLSelectElement
  let invalid = $state(false)
  function update(next: string) { value = next; invalid = false; onchange?.(next) }
  $effect(() => {
    const owner = input.form
    const reset = (event: Event) => queueMicrotask(() => {
      if (!event.defaultPrevented) { input.value = initial; update(initial) }
    })
    owner?.addEventListener('reset', reset)
    return () => owner?.removeEventListener('reset', reset)
  })
  function enabledFrom(start: number, direction: number) {
    for (let offset = 0; offset < options.length; offset++) {
      const index = (start + offset * direction + options.length) % options.length
      if (!options[index].disabled) return index
    }
    return -1
  }
  let open = $state(false)
  function fadeDuration() {
    const duration = getComputedStyle(document.documentElement).getPropertyValue('--motion-duration').trim()
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches || parseFloat(duration) === 0 ? 0 : 120
  }
  let active = $state(0)
  let keyboardActive = $state(false)
  let container: HTMLDivElement
  let trigger: HTMLButtonElement
  let list = $state<HTMLDivElement>()
  let popup = $state<HTMLDivElement>()
  let canScrollUp = $state(false)
  let canScrollDown = $state(false)
  let scrollTimer: ReturnType<typeof setInterval> | undefined
  const groups = $derived.by(() => {
    const rows: Array<{ name?: string; start: number; options: typeof options }> = []
    options.forEach((option, index) => {
      let group = rows[rows.length - 1]
      if (!group || group.name !== option.group) { group = { name: option.group, start: index, options: [] }; rows.push(group) }
      group.options.push(option)
    })
    return rows
  })
  function updateScroll() {
    if (!list) return
    canScrollUp = list.scrollTop > 1
    canScrollDown = list.scrollTop + list.clientHeight < list.scrollHeight - 1
  }
  function scrollBy(direction: number) {
    list?.scrollBy({ top: direction * 48, behavior: 'instant' }); updateScroll()
    if (direction < 0 ? !canScrollUp : !canScrollDown) stopScrolling()
  }
  function stopScrolling() { clearInterval(scrollTimer); scrollTimer = undefined }
  function startScrolling(event: PointerEvent, direction: number) {
    if (event.pointerType !== 'mouse') return
    stopScrolling()
    scrollTimer = setInterval(() => scrollBy(direction), 100)
  }
  let position = $state({ left: 0, top: 0, width: 0, maxHeight: 272 })
  let selected = $derived(options.find((option) => option.value === value))
  let search = ''
  let lastSearch = 0
  // Like Base UI's Portal: menus escape scrolling panels and modal clipping.
  function portal(node: HTMLDivElement) {
    const host = trigger.closest('dialog[open]') || document.body
    node.popover = 'manual'
    host.appendChild(node)
    node.showPopover?.()
    return { destroy() { if (node.matches(':popover-open')) node.hidePopover?.(); node.remove() } }
  }
  async function show(keyboard = false) {
    if (disabled || options.length === 0 || open) return
    search = ''
    keyboardActive = keyboard
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled)
    active = selectedIndex >= 0 ? selectedIndex : enabledFrom(0, 1)
    const rect = trigger.getBoundingClientRect()
    position = { left: rect.left, top: rect.bottom + 5, width: rect.width, maxHeight: 272 }
    open = true
    await tick()
    if (open && list && popup) {
      popup.inert = false
      popup.removeAttribute('aria-hidden')
      const height = Math.min(list.scrollHeight + 2, 272)
      const below = Math.max(0, window.innerHeight - rect.bottom - 12)
      const above = Math.max(0, rect.top - 12)
      const upward = below < height && above > below
      const maxHeight = alignItemWithTrigger ? Math.min(272, window.innerHeight - 16) : Math.min(272, upward ? above : below)
      const actualHeight = Math.min(height, maxHeight)
      const row = list.querySelector<HTMLElement>(`[data-option="${active}"]`)
      const rowOffset = row ? row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop : 0
      const minTop = 8, maxTop = window.innerHeight - actualHeight - 8
      const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
      let desiredTop = upward ? rect.top - actualHeight - 5 : rect.bottom + 5
      if (alignItemWithTrigger && row) {
        // Screen y where the selected row must sit to cover the trigger.
        const rowTop = rect.top + rect.height / 2 - row.offsetHeight / 2 - 1
        // Its offset inside the popup: prefer no scrolling, but a deep row is scrolled
        // into view instead of pushing the popup off-screen, away from the trigger.
        const maxScroll = Math.max(0, list.scrollHeight - (actualHeight - 2))
        let inside = rowTop - clamp(rowTop - rowOffset, minTop, maxTop)
        inside = clamp(inside, Math.max(0, rowOffset - maxScroll), rowOffset)
        // Keep clear of the 28 px scroll-arrow bands (list scroll-padding), or scrollActive() shifts the row.
        const band = maxScroll > 0 ? 28 : 0
        inside = clamp(inside, Math.min(rowOffset, band), Math.max(0, actualHeight - row.offsetHeight - 2 - band))
        desiredTop = rowTop - inside
      }
      position = {
        left: Math.max(8, Math.min(rect.left, window.innerWidth - popup.offsetWidth - 8)),
        top: clamp(desiredTop, minTop, maxTop),
        width: rect.width,
        maxHeight: Math.max(0, maxHeight),
      }
      await tick()
      if (alignItemWithTrigger && row) {
        list.scrollTop = Math.max(0, rowOffset + row.offsetHeight / 2 - (rect.top + rect.height / 2 - position.top - 1))
      }
      list.focus({ preventScroll: true })
      updateScroll()
    }
    scrollActive()
  }
  function close(restoreFocus = true) {
    // Svelte retains an outgoing block without updating its attributes during fade-out.
    if (popup) { popup.inert = true; popup.setAttribute('aria-hidden', 'true') }
    open = false
    if (restoreFocus) trigger?.focus({ preventScroll: true })
  }
  function choose(index: number) { if (!options[index] || options[index].disabled) return; update(options[index].value); close() }
  function scrollActive() { list?.querySelector(`[data-option="${active}"]`)?.scrollIntoView({ block: 'nearest' }); updateScroll() }
  async function keydown(event: KeyboardEvent) {
    if (event.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
    // Restore the anchor before native Tab navigation, even though the menu is portalled.
    if (event.key === 'Tab') { close(); return }
    if (event.key === 'Enter' || (event.key === ' ' && (!search || Date.now() - lastSearch >= 500))) { event.preventDefault(); choose(active); return }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      keyboardActive = true
      if (event.key === 'Home') active = enabledFrom(0, 1)
      else if (event.key === 'End') active = enabledFrom(options.length - 1, -1)
      else { const direction = event.key === 'ArrowDown' ? 1 : -1; active = enabledFrom(active + direction, direction) }
      await tick(); scrollActive()
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      keyboardActive = true
      const now = Date.now()
      search = now - lastSearch < 500 ? search + event.key.toLocaleLowerCase('pl') : event.key.toLocaleLowerCase('pl')
      lastSearch = now
      const repeated = [...search].every(char => char === search[0])
      const query = repeated ? search[0] : search
      const start = repeated ? active + 1 : Math.max(0, active)
      const next = Array.from({ length: options.length }, (_, offset) => (start + offset) % options.length)
        .find(index => !options[index].disabled && options[index].label.toLocaleLowerCase('pl').startsWith(query)) ?? -1
      if (next >= 0) { active = next; await tick(); scrollActive() }
    }
  }
  $effect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !container.contains(event.target) && !popup?.contains(event.target)) close(false) }
    document.addEventListener('pointerdown', outside)
    const resize = () => close()
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !popup?.contains(event.target)) close() }
    const focus = (event: FocusEvent) => { if (event.target instanceof Node && !container.contains(event.target) && !popup?.contains(event.target)) close(false) }
    window.addEventListener('resize', resize)
    document.addEventListener('scroll', scroll, true)
    document.addEventListener('focusin', focus)
    return () => { stopScrolling(); document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', resize); document.removeEventListener('scroll', scroll, true); document.removeEventListener('focusin', focus) }
  })
  $effect(() => { if (disabled || options.length === 0) close(false) })
  $effect(() => {
    if (open && (!options[active] || options[active].disabled)) active = enabledFrom(0, 1)
  })
</script>

<div class="vs-select" bind:this={container}>
  {#if label}<label class="vs-control-label" for={triggerId}>{label}</label>{/if}
  <button {...native} id={triggerId} bind:this={trigger} type="button" role="combobox" class={`vs-select-trigger ${className}`} {disabled}
    data-size={size} data-variant={variant} data-slot="select-trigger"
    aria-label={ariaLabel || native['aria-label'] || label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${uid}-list` : undefined}
    aria-invalid={invalid || native['aria-invalid']}
    onclick={event => open ? close() : show(event.detail === 0)}
    onkeydown={async (event) => {
      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); await show(true)
        if (event.key === 'Home' || event.key === 'End') await keydown(event)
      } else if (event.key.length === 1 && event.key !== ' ') {
        event.preventDefault(); await show(true); await keydown(event)
      }
    }}>
    {#if triggerContent}{@render triggerContent()}{:else}<span class="vs-select-value" class:vs-select-language-value={isLanguage} data-placeholder={!selected || undefined}>{#if isLanguage}<LanguageFlag language={selected?.value || selected?.label || ''}/><span class="vs-select-language-text">{selected?.label ?? tr(placeholder)}</span>{:else}{selected?.label ?? tr(placeholder)}{/if}</span><ChevronDown size={14} class="vs-control-chevron" style={`transform:rotate(${open ? 180 : 0}deg)`} />{/if}
  </button>
  <select bind:this={input} class="vs-native-control" aria-hidden="true" tabindex="-1"
    {name} {value} {disabled} {required} {form}
    onchange={(event) => update(event.currentTarget.value)}
    oninvalid={(event) => { event.preventDefault(); invalid = true; trigger.focus() }}>
    {#if !options.some(option => option.value === '')}<option value=""></option>{/if}
    {#each groups as group}
      {#if group.name}<optgroup label={group.name}>{#each group.options as option (option.value)}<option value={option.value} disabled={option.disabled}>{option.label}</option>{/each}</optgroup>
      {:else}{#each group.options as option (option.value)}<option value={option.value} disabled={option.disabled}>{option.label}</option>{/each}{/if}
    {/each}
  </select>
  {#snippet optionRow(option: (typeof options)[number], index: number)}
    <div id={`${uid}-option-${index}`} role="option" tabindex="-1" aria-selected={value === option.value} aria-disabled={option.disabled || undefined}
      class:vs-option-active={active === index} class:vs-option-keyboard={keyboardActive && active === index} class="vs-select-option" data-option={index}
      onclick={() => choose(index)} onpointermove={() => { keyboardActive = false; if (!option.disabled) active = index }} onkeydown={() => {}}>
      <span class:vs-option-language={isLanguage}>{#if isLanguage}<LanguageFlag language={option.value || option.label}/>{/if}<span><span class="vs-option-label">{option.label}</span>{#if option.description}<span class="vs-option-description">{option.description}</span>{/if}</span></span>
      {#if option.value === value}<Check size={14} />{/if}
    </div>
  {/snippet}
  {#if open}
    <div class="vs-select-popup vs-select-with-arrows" bind:this={popup} use:portal transition:fade={{ duration: fadeDuration() }} inert={!open} aria-hidden={!open}
      style={`left:${position.left}px;top:${position.top}px;--select-width:${position.width}px;--select-max-height:${position.maxHeight}px`}>
      {#if canScrollUp}<button type="button" class="vs-select-scroll vs-select-scroll-up" tabindex="-1" aria-label={tr("Przewiń opcje w górę")}
        onpointerdown={event => event.preventDefault()} onclick={() => scrollBy(-1)}
        onpointerenter={event => startScrolling(event, -1)} onpointerleave={stopScrolling}><ChevronUp size={16}/></button>{/if}
      <div id={`${uid}-list`} class="vs-select-list" role="listbox" tabindex="-1" bind:this={list}
        aria-label={ariaLabel || native['aria-label'] || label || tr('Opcje')} aria-required={required || undefined}
        aria-activedescendant={active >= 0 ? `${uid}-option-${active}` : undefined} onkeydown={keydown} onscroll={updateScroll}>
        {#each groups as group, groupIndex}
          {#if group.name}<div role="group" aria-labelledby={`${uid}-group-${groupIndex}`}>
            <div id={`${uid}-group-${groupIndex}`} class="vs-select-group-label" role="presentation">{group.name}</div>
            {#each group.options as option, offset (option.value)}{@render optionRow(option, group.start + offset)}{/each}
          </div>
          {:else}{#each group.options as option, offset (option.value)}{@render optionRow(option, group.start + offset)}{/each}{/if}
        {/each}
      </div>
      {#if canScrollDown}<button type="button" class="vs-select-scroll vs-select-scroll-down" tabindex="-1" aria-label={tr("Przewiń opcje w dół")}
        onpointerdown={event => event.preventDefault()} onclick={() => scrollBy(1)}
        onpointerenter={event => startScrolling(event, 1)} onpointerleave={stopScrolling}><ChevronDown size={16}/></button>{/if}
    </div>
  {/if}
</div>

<style>
  .vs-select :global(.vs-control-chevron){transition:transform var(--motion-duration,140ms) ease}
  @media(prefers-reduced-motion:reduce){.vs-select :global(.vs-control-chevron){transition:none}}
</style>
