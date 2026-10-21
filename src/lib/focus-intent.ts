/** Keep automatic entry/return focus useful without painting an unsolicited ring. */
export function installFocusIntent(document: Document) {
  let modality: 'automatic' | 'pointer' | 'keyboard' = 'automatic'
  let pointerTarget: Element | null = null
  let passive: Element | null = null
  const root = document.documentElement
  const capture = { capture: true }
  root.dataset.focusPolicy = 'intent'

  function clearPassive() {
    passive?.removeAttribute('data-focus-passive')
    passive = null
  }
  function controlFor(target: EventTarget | null): Element | null {
    if (!(target instanceof Element)) return null
    const label = target.closest('label') as HTMLLabelElement | null
    return label?.control || target.closest('input, textarea, select, button, a[href], summary, [tabindex]')
  }
  function pointer(event: PointerEvent) {
    modality = 'pointer'
    pointerTarget = controlFor(event.composedPath()[0] || event.target)
    // Clicking an already autofocused field does not emit another focusin.
    if (pointerTarget && pointerTarget === document.activeElement) {
      clearPassive()
      pointerTarget = null
    }
  }
  function releasePointer() { pointerTarget = null }
  function keyboard(event: KeyboardEvent) {
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return
    modality = 'keyboard'
    pointerTarget = null
    clearPassive()
  }
  function focus(event: FocusEvent) {
    clearPassive()
    const target = event.composedPath()[0] || event.target
    if (!(target instanceof Element)) return
    const directPointerFocus = modality === 'pointer' && target === pointerTarget
    pointerTarget = null
    if (modality === 'keyboard' || directPointerFocus) return
    target.setAttribute('data-focus-passive', '')
    passive = target
  }
  function blur(event: FocusEvent) {
    if (event.target === passive) clearPassive()
  }
  document.addEventListener('pointerdown', pointer, capture)
  document.addEventListener('pointerup', releasePointer, capture)
  document.addEventListener('pointercancel', releasePointer, capture)
  document.addEventListener('keydown', keyboard, capture)
  document.addEventListener('focusin', focus, capture)
  document.addEventListener('focusout', blur, capture)
  return () => {
    document.removeEventListener('pointerdown', pointer, capture)
    document.removeEventListener('pointerup', releasePointer, capture)
    document.removeEventListener('pointercancel', releasePointer, capture)
    document.removeEventListener('keydown', keyboard, capture)
    document.removeEventListener('focusin', focus, capture)
    document.removeEventListener('focusout', blur, capture)
    clearPassive()
    delete root.dataset.focusPolicy
  }
}
