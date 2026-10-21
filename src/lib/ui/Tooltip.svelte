<script lang="ts">
  import type { Snippet } from 'svelte'
  import { tick } from 'svelte'
  import './button-tooltip.css'

  let { content, children, delay = 400, side = 'top', disabled = false }: {
    content: string; children: Snippet; delay?: number; side?: 'top' | 'bottom'; disabled?: boolean
  } = $props()
  const uid = $props.id()
  let open = $state(false)
  let anchor: HTMLSpanElement
  let popup: HTMLDivElement | undefined
  let timer = $state<ReturnType<typeof setTimeout>>()
  let closeTimer: ReturnType<typeof setTimeout> | undefined
  let positionFrame = 0
  let hovered = false
  let popupHovered = false
  let focused = false
  let dismissed = false
  let described: HTMLElement | undefined
  let priorDescription: string | null = null

  function close() {
    clearTimeout(timer)
    clearTimeout(closeTimer)
    timer = undefined
    closeTimer = undefined
    cancelAnimationFrame(positionFrame)
    positionFrame = 0
    open = false
    popupHovered = false
    if (described) {
      if (priorDescription === null) described.removeAttribute('aria-describedby')
      else described.setAttribute('aria-describedby', priorDescription)
    }
    described = undefined
  }
  function scheduleClose() {
    clearTimeout(closeTimer)
    closeTimer = setTimeout(() => {
      closeTimer = undefined
      if (!focused && !hovered && !popupHovered) close()
    }, 150)
  }
  function position() {
    if (!popup || !anchor?.isConnected) return
    const rect = anchor.getBoundingClientRect()
    if (!rect.width || !rect.height || getComputedStyle(anchor).visibility === 'hidden') {
      close()
      return
    }
    const box = popup.getBoundingClientRect()
    const margin = 5
    const above = rect.top - box.height - 4
    const below = rect.bottom + 4
    const useAbove = side === 'top' ? above >= margin || below + box.height > innerHeight - margin : below + box.height > innerHeight - margin && above >= margin
    popup.style.left = `${Math.max(margin, Math.min(rect.left + (rect.width - box.width) / 2, innerWidth - box.width - margin))}px`
    popup.style.top = `${Math.max(margin, Math.min(useAbove ? above : below, innerHeight - box.height - margin))}px`
    popup.style.visibility = 'visible'
  }
  function schedulePosition() {
    if (!open || !popup || positionFrame) return
    positionFrame = requestAnimationFrame(() => { positionFrame = 0; position() })
  }
  async function show() {
    timer = undefined
    if (disabled || dismissed || !content || !(hovered || focused)) return
    open = true
    described = anchor.querySelector<HTMLElement>('button, a, input, select, textarea, [tabindex]') || anchor
    priorDescription = described.getAttribute('aria-describedby')
    described.setAttribute('aria-describedby', [priorDescription, uid].filter(Boolean).join(' '))
    await tick()
    schedulePosition()
  }
  function portal(node: HTMLDivElement) {
    // A modal's children stay interactive; Popover lifts the tooltip above its clipping.
    const host = anchor.closest('dialog[open]') || document.body
    host.appendChild(node)
    popup = node
    node.style.visibility = 'hidden'
    node.showPopover?.()
    const enter = () => { popupHovered = true; clearTimeout(closeTimer); closeTimer = undefined }
    const leave = () => { popupHovered = false; if (!focused && !hovered) scheduleClose() }
    node.addEventListener('pointerenter', enter)
    node.addEventListener('pointerleave', leave)
    return { destroy() {
      node.removeEventListener('pointerenter', enter); node.removeEventListener('pointerleave', leave)
      popupHovered = false; popup = undefined; node.remove()
    } }
  }
  function trigger(node: HTMLSpanElement) {
    anchor = node
    const enter = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      hovered = true
      dismissed = false
      clearTimeout(closeTimer)
      closeTimer = undefined
      clearTimeout(timer)
      if (!open) timer = setTimeout(show, Math.max(0, delay))
    }
    const leave = () => { hovered = false; dismissed = false; clearTimeout(timer); timer = undefined; if (!focused) scheduleClose() }
    const focus = (event: FocusEvent) => {
      focused = event.target instanceof HTMLElement && event.target.matches(':focus-visible')
      dismissed = false
      clearTimeout(timer)
      timer = undefined
      clearTimeout(closeTimer)
      closeTimer = undefined
      if (focused && !open) void show()
    }
    const press = () => { focused = false; dismissed = true; close() }
    const blur = (event: FocusEvent) => { if (node.contains(event.relatedTarget as Node)) return; focused = false; dismissed = false; if (!hovered && !popupHovered) scheduleClose() }
    node.addEventListener('pointerenter', enter)
    node.addEventListener('pointerleave', leave)
    node.addEventListener('pointerdown', press)
    node.addEventListener('focusin', focus)
    node.addEventListener('focusout', blur)
    return { destroy() {
      close()
      node.removeEventListener('pointerenter', enter); node.removeEventListener('pointerleave', leave)
      node.removeEventListener('pointerdown', press)
      node.removeEventListener('focusin', focus); node.removeEventListener('focusout', blur)
    } }
  }
  $effect(() => {
    // Closed tooltips have no document-wide handlers. Pending hover still needs
    // Escape/scroll cancellation so it cannot appear after the user moves on.
    if (!open && timer === undefined) return
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { dismissed = true; close(); event.stopPropagation(); event.preventDefault() } }
    const scroll = () => { if (focused) schedulePosition(); else { dismissed = true; close() } }
    document.addEventListener('keydown', key, true)
    document.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', schedulePosition)
    return () => {
      document.removeEventListener('keydown', key, true); document.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', schedulePosition)
    }
  })
  $effect(() => {
    if (!open) return
    void content
    let cancelled = false
    void tick().then(() => { if (!cancelled) schedulePosition() })
    return () => { cancelled = true }
  })
  $effect(() => { if (disabled || !content) close() })
</script>

<span class="vs-tooltip-trigger" use:trigger>{@render children()}</span>
{#if open}<div id={uid} class="vs-tooltip" role="tooltip" popover="manual" use:portal>{content}</div>{/if}
