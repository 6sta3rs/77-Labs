type ModalOptions = { initialFocus?: string; returnFocus?: string }

export function visibleFocusTarget(node: HTMLElement | null | undefined): node is HTMLElement {
  return !!node?.isConnected && !node.closest('[hidden],[inert]') && !node.matches(':disabled,[aria-disabled=true]')
    && (node.tabIndex >= 0 || node.hasAttribute('tabindex') || node.isContentEditable)
    && node.getClientRects().length > 0 && node.ownerDocument.defaultView?.getComputedStyle(node).visibility !== 'hidden'
}

/** Native modality remains intact even when the component's original panel hides. */
export function mountModal(node: HTMLDialogElement, options: ModalOptions = {}) {
  const doc = node.ownerDocument
  const previous = doc.activeElement as HTMLElement | null
  doc.body.appendChild(node)
  node.showModal()
  let active = true
  // Keep explicit initial focus opt-in; native dialogs otherwise choose their target.
  if (options.initialFocus) queueMicrotask(() => {
    if (active && node.open) node.querySelector<HTMLElement>(options.initialFocus!)?.focus({ preventScroll: true })
  })
  return { destroy() {
    active = false
    node.close()
    node.remove()
    const target = visibleFocusTarget(previous) ? previous
      : options.returnFocus ? [...doc.querySelectorAll<HTMLElement>(options.returnFocus)].find(visibleFocusTarget) : undefined
    target?.focus({ preventScroll: true })
  } }
}

type PopupOptions = { trigger: () => HTMLElement | null | undefined; close: () => void }

/** Nonmodal popups dismiss without stealing focus from a newly clicked/tabbed control. */
export function dismissiblePopup(node: HTMLElement, options: PopupOptions) {
  const doc = node.ownerDocument
  const view = doc.defaultView
  const inside = (target: EventTarget | null) => !!target && (node.contains(target as Node) || !!options.trigger()?.contains(target as Node))
  const outside = (event: Event) => { if (!inside(event.target)) options.close() }
  const escape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !inside(event.target)) return
    event.preventDefault(); event.stopPropagation(); options.close()
    const trigger = options.trigger()
    if (visibleFocusTarget(trigger)) trigger.focus({ preventScroll: true })
  }
  const scroll = (event: Event) => { if (!node.contains(event.target as Node)) options.close() }
  const resize = () => options.close()
  doc.addEventListener('pointerdown', outside)
  doc.addEventListener('focusin', outside)
  doc.addEventListener('keydown', escape)
  doc.addEventListener('scroll', scroll, true)
  view?.addEventListener('resize', resize)
  return { destroy() {
    doc.removeEventListener('pointerdown', outside)
    doc.removeEventListener('focusin', outside)
    doc.removeEventListener('keydown', escape)
    doc.removeEventListener('scroll', scroll, true)
    view?.removeEventListener('resize', resize)
  } }
}

export function anchoredPopupPosition(anchor: { right: number; top: number; bottom: number }, popup: { width: number; height: number }, viewport: { width: number; height: number }) {
  const margin = 8, gap = 5
  const below = viewport.height - anchor.bottom - margin - gap
  const above = anchor.top - margin - gap
  const top = below >= popup.height || below >= above ? anchor.bottom + gap : anchor.top - popup.height - gap
  return {
    left: Math.max(margin, Math.min(anchor.right - popup.width, viewport.width - popup.width - margin)),
    top: Math.max(margin, Math.min(top, viewport.height - popup.height - margin)),
  }
}

/** A details menu keeps its DOM order while Popover escapes filtered/clipped ancestors. */
export function detailsPopover(node: HTMLElement) {
  const menu = node.closest('details')!
  const trigger = menu.querySelector<HTMLElement>('summary')!
  let dismissal: ReturnType<typeof dismissiblePopup> | undefined
  const sync = () => {
    dismissal?.destroy(); dismissal = undefined
    if (!menu.open) { if (node.matches(':popover-open')) node.hidePopover(); return }
    node.style.visibility = 'hidden'
    node.showPopover()
    const view = node.ownerDocument.defaultView!
    const position = anchoredPopupPosition(trigger.getBoundingClientRect(), node.getBoundingClientRect(), { width: view.innerWidth, height: view.innerHeight })
    node.style.left = `${position.left}px`; node.style.top = `${position.top}px`
    node.style.visibility = 'visible'
    dismissal = dismissiblePopup(node, { trigger: () => trigger, close: () => { menu.open = false } })
  }
  menu.addEventListener('toggle', sync)
  return { destroy() {
    menu.removeEventListener('toggle', sync)
    dismissal?.destroy()
    if (node.matches(':popover-open')) node.hidePopover()
  } }
}
