/** Drag a bottom sheet down by its handle; past the threshold (or a fast flick) it closes. */
export function sheetDrag(handle: HTMLElement, onclose: () => void) {
  let close = onclose, startY = 0, startTime = 0, dy = 0, sheet: HTMLElement | null = null
  function move(event: PointerEvent) {
    dy = Math.max(0, event.clientY - startY)
    if (sheet) sheet.style.translate = `0 ${dy}px`
  }
  function end() {
    handle.removeEventListener('pointermove', move)
    if (!sheet) return
    const fast = dy / Math.max(1, performance.now() - startTime) > 0.5
    sheet.style.transition = ''
    sheet.style.translate = ''
    if (fast || dy > sheet.offsetHeight * 0.3) close()
    sheet = null
  }
  function start(event: PointerEvent) {
    sheet = handle.closest<HTMLElement>('[data-sheet]')
    if (!sheet) return
    startY = event.clientY; startTime = performance.now(); dy = 0
    sheet.style.transition = 'none'
    handle.setPointerCapture(event.pointerId)
    handle.addEventListener('pointermove', move)
  }
  handle.addEventListener('pointerdown', start)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
  return {
    update(next: () => void) { close = next },
    destroy() { handle.removeEventListener('pointerdown', start); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); handle.removeEventListener('pointermove', move) },
  }
}
