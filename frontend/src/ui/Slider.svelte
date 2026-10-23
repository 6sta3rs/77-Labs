<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { fade } from 'svelte/transition'
  import { ChevronRight } from '@lucide/svelte'
  import '../styles/ui.css'
  let { value, min = 0, max = 100, step = 1, onchange, label, valueLabel, startLabel, endLabel,
    disabled = false, collapsible = false, defaultOpen = true, size = 'default', valueDisplay = 'both' }: {
    value: number; min?: number; max?: number; step?: number; onchange: (value: number) => void
    label: string; valueLabel?: string; startLabel?: string; endLabel?: string; disabled?: boolean
    collapsible?: boolean; defaultOpen?: boolean; size?: 'default' | 'compact'
    /** Sposób wyświetlania wartości; zwinięty suwak zawsze zachowuje podsumowanie. */
    valueDisplay?: 'tooltip' | 'right' | 'both'
  } = $props()
  const uid = $props.id()
  let open = $state(untrack(() => defaultOpen))
  let hovered = $state(false)
  let dragging = $state(false)
  let keyboardFocus = $state(false)
  let dismissed = $state(false)
  let input = $state<HTMLInputElement>()
  let bubble = $state<HTMLOutputElement>()
  let position = $state({ left: 0, top: 0 })
  let positionFrame = 0
  let positioned = false
  const progress = $derived(max > min ? Math.min(100, Math.max(0, (value - min) / (max - min) * 100)) : 0)
  const expanded = $derived(!collapsible || open)
  const inlineValue = $derived(valueDisplay !== 'tooltip')
  const showValue = $derived(valueDisplay !== 'right' && expanded && !disabled && !dismissed && (hovered || dragging || keyboardFocus))

  function fadeDuration() {
    const duration = getComputedStyle(document.documentElement).getPropertyValue('--motion-duration').trim()
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches || parseFloat(duration) === 0 ? 0 : 120
  }

  // The native range announces its value; the floating duplicate is visual only.
  function portal(node: HTMLOutputElement) {
    positioned = false
    // Keep the popup in its modal's tree, and escape clipping through the top layer.
    const host = input?.closest('dialog[open]') ?? document.body
    host.appendChild(node)
    if ('showPopover' in node) {
      node.setAttribute('popover', 'manual')
      node.showPopover()
    }
    return { destroy() { if ('hidePopover' in node && node.matches(':popover-open')) node.hidePopover(); node.remove() } }
  }
  function updatePosition() {
    if (!input || !bubble) return
    const rect = input.getBoundingClientRect()
    const bubbleRect = bubble.getBoundingClientRect()
    const center = rect.left + 6 + (rect.width - 12) * progress / 100
    const padding = 5
    const left = Math.max(padding, Math.min(center - bubbleRect.width / 2, window.innerWidth - bubbleRect.width - padding))
    const above = rect.top + rect.height / 2 - 6 - bubbleRect.height - 4
    const below = rect.top + rect.height / 2 + 6 + 4
    const top = above >= padding ? above : Math.min(below, window.innerHeight - bubbleRect.height - padding)
    const nextTop = Math.max(padding, top)
    // Start at the thumb, rather than animating into view from the viewport origin.
    if (!positioned) {
      bubble.style.transition = 'none'
      bubble.style.transform = `translate3d(${left}px,${nextTop}px,0)`
      bubble.getBoundingClientRect()
      bubble.style.removeProperty('transition')
      positioned = true
    }
    if (position.left !== left || position.top !== nextTop) position = { left, top: nextTop }
  }
  function schedulePosition() {
    if (positionFrame) return
    positionFrame = requestAnimationFrame(() => { positionFrame = 0; updatePosition() })
  }
  $effect(() => {
    if (!showValue) return
    void progress
    void valueLabel
    let cancelled = false
    // Measure after Svelte's DOM update, without delaying by another animation frame.
    void tick().then(() => { if (!cancelled) updatePosition() })
    return () => { cancelled = true }
  })
  $effect(() => {
    if (!showValue) return
    const observer = new ResizeObserver(schedulePosition)
    if (input) observer.observe(input)
    if (bubble) observer.observe(bubble)
    window.addEventListener('resize', schedulePosition)
    window.addEventListener('scroll', schedulePosition, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', schedulePosition)
      window.removeEventListener('scroll', schedulePosition, true)
      cancelAnimationFrame(positionFrame); positionFrame = 0
    }
  })
  function finishDrag(event: PointerEvent) {
    dragging = false
    if (event.pointerType !== 'mouse' || event.type === 'pointercancel') hovered = false
    if (event.type === 'pointercancel') { keyboardFocus = false; dismissed = true }
  }
  $effect(() => {
    if (!showValue) return
    const dismissValue = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !showValue) return
      event.preventDefault()
      event.stopPropagation()
      dismissed = true
    }
    window.addEventListener('keydown', dismissValue, true)
    return () => window.removeEventListener('keydown', dismissValue, true)
  })
</script>

<svelte:window onpointerup={finishDrag} onpointercancel={finishDrag}
  onblur={() => { dragging = false; hovered = false; keyboardFocus = false }} />

<div class="vs-slider" class:vs-disabled={disabled} data-size={size} data-collapsible={collapsible} data-open={expanded} data-value-display={valueDisplay}>
  <div class="vs-slider-caption">
    {#if collapsible}
      <button class="vs-slider-disclosure" type="button" {disabled} aria-expanded={expanded} aria-controls={`${uid}-panel`}
        onclick={() => { open = !open; hovered = false; dragging = false; keyboardFocus = false; dismissed = false }}>
        <span id={`${uid}-label`}>{label}</span>
        {#if inlineValue || !expanded}<span class="vs-slider-inline-value" aria-hidden="true">{valueLabel ?? value}</span>{/if}
        <ChevronRight size={14} class="vs-slider-chevron" />
      </button>
    {:else}
      <label for={uid}>{label}</label>
      {#if inlineValue}<span class="vs-slider-inline-value" aria-hidden="true">{valueLabel ?? value}</span>{/if}
    {/if}
  </div>
  <div id={`${uid}-panel`} class="vs-slider-panel-shell" inert={!expanded} aria-hidden={!expanded}>
  <div class="vs-slider-panel"><div class="vs-slider-panel-content">
    {#if startLabel || endLabel}
      <div id={`${uid}-endpoints`} class="vs-slider-endpoints"><span>{startLabel}</span><span>{endLabel}</span></div>
    {/if}
    <div class="vs-slider-rail" style={`--range-progress:${progress}%`}>
      <input bind:this={input} id={uid} type="range" {min} {max} {step} {value} {disabled}
        aria-labelledby={collapsible ? `${uid}-label` : undefined} aria-valuetext={valueLabel}
        aria-describedby={startLabel || endLabel ? `${uid}-endpoints` : undefined}
        onpointerenter={(event) => { if (event.pointerType === 'mouse') { hovered = true; dismissed = false } }}
        onpointerleave={() => { hovered = false; if (!dragging) dismissed = false }}
        onpointerdown={() => { dragging = true; keyboardFocus = false; dismissed = false }}
        onfocus={(event) => { keyboardFocus = event.currentTarget.matches(':focus-visible'); dismissed = false }}
        onblur={() => { keyboardFocus = false; dismissed = false }}
        onkeydown={(event) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) { keyboardFocus = true; dismissed = false } }}
        oninput={(event) => onchange(Number(event.currentTarget.value))} />
    </div>
  </div></div>
  </div>
</div>
{#if showValue}
  <output bind:this={bubble} use:portal transition:fade={{ duration: fadeDuration() }} class="vs-slider-value" for={uid} aria-hidden="true"
    style={`transform:translate3d(${position.left}px,${position.top}px,0);visibility:${position.top ? 'visible' : 'hidden'}`}>{valueLabel ?? value}</output>
{/if}
