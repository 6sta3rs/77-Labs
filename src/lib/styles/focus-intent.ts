/** Paint the focus ring only for keyboard navigation (Tab, arrows), never for clicks, typing or automatic focus. */
const navigationKeys = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'F6'])

export function installFocusIntent(document: Document) {
  let keyboard = false
  let passive: Element | null = null
  const root = document.documentElement
  const capture = { capture: true }
  root.dataset.focusPolicy = 'intent'

  function clearPassive() {
    passive?.removeAttribute('data-focus-passive')
    passive = null
  }
  function markPassive(target: Element) {
    clearPassive()
    target.setAttribute('data-focus-passive', '')
    passive = target
  }
  function pointer(event: PointerEvent) {
    keyboard = false
    // Clicking an already focused (e.g. keyboard-reached) field hides its ring; no focusin follows.
    const active = document.activeElement
    const target = (event.composedPath()[0] || event.target) as Node
    if (active instanceof Element && active.contains(target)) markPassive(active)
  }
  function key(event: KeyboardEvent) {
    // Typing, Enter, Space and modifiers keep the current paint; only navigation shows the ring.
    if (!navigationKeys.has(event.key)) return
    keyboard = true
    if (event.key === 'Tab') clearPassive()
  }
  function focus(event: FocusEvent) {
    const target = event.composedPath()[0] || event.target
    if (!(target instanceof Element)) return
    if (keyboard) clearPassive()
    else markPassive(target)
  }
  function blur(event: FocusEvent) {
    if (event.target === passive) clearPassive()
  }
  document.addEventListener('pointerdown', pointer, capture)
  document.addEventListener('keydown', key, capture)
  document.addEventListener('focusin', focus, capture)
  document.addEventListener('focusout', blur, capture)
  return () => {
    document.removeEventListener('pointerdown', pointer, capture)
    document.removeEventListener('keydown', key, capture)
    document.removeEventListener('focusin', focus, capture)
    document.removeEventListener('focusout', blur, capture)
    clearPassive()
    delete root.dataset.focusPolicy
  }
}
