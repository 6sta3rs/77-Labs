import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { build } from 'vite'

const read = file => readFile(new URL(`../../${file}`, import.meta.url), 'utf8')
const checks = []
async function test(name, run) {
  try { await run(); checks.push({ name, passed: true }) }
  catch (error) { checks.push({ name, passed: false, error: error.message }) }
}
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText

await test('Production CSS retains standard popup/modal blur and reduced-transparency resets', async () => {
  const source = await read('frontend/src/ui/overlays.css')
  const result = await build({ configFile: false, logLevel: 'silent', plugins: [{
    name: 'overlay-regression',
    resolveId(id) { if (id === 'virtual:overlay-entry' || id === 'virtual:overlay.css') return `\0${id}` },
    load(id) {
      if (id === '\0virtual:overlay-entry') return 'import "virtual:overlay.css";console.log("overlay regression")'
      if (id === '\0virtual:overlay.css') return source
    },
  }], build: { write: false, emptyOutDir: false, rollupOptions: { input: 'virtual:overlay-entry' } } })
  const css = String(result.output.find(item => item.type === 'asset' && item.fileName.endsWith('.css')).source)
  assert.match(css, /(?:[;{])backdrop-filter:blur\(var\(--popup-blur\)\)/, 'standard popup blur was removed during production compilation')
  assert.match(css, /(?:[;{])backdrop-filter:blur\(var\(--modal-blur\)\)/, 'standard modal backdrop blur was removed')
  assert.match(css, /@media\s*\(prefers-reduced-transparency:reduce\)[\s\S]*[;{]backdrop-filter:none/, 'reduced transparency must override standard blur')
})

let overlays = {}
try { overlays = await import(`data:text/javascript;base64,${Buffer.from(transpile(await read('frontend/src/ui/overlay.ts'))).toString('base64')}`) }
catch (error) { if (error.code !== 'ENOENT') throw error }

// A controlled DOM tests the actual mount action's ordering and cleanup. Browser
// acceptance separately verifies native top-layer painting, geometry and focus.
function dom() {
  const document = new EventTarget()
  const view = new EventTarget()
  document.defaultView = view
  view.innerWidth = 900; view.innerHeight = 800
  view.getComputedStyle = () => ({ visibility: 'visible' })
  view.requestAnimationFrame = callback => { callback(); return 1 }
  view.cancelAnimationFrame = () => {}
  class Element extends EventTarget {
    constructor(name, visible = true) { super(); this.name = name; this.ownerDocument = document; this.isConnected = true; this.visible = visible; this.children = []; this.open = false; this.style = {}; this.tabIndex = ['body', 'responsive-inspector', 'dialog'].includes(name) ? -1 : 0; this.attributes = new Map() }
    appendChild(node) { node.parentElement?.children.splice(node.parentElement.children.indexOf(node), 1); this.children.push(node); node.parentElement = this; return node }
    contains(node) { return node === this || this.children.some(child => child.contains(node)) }
    matches(selector) { return selector === ':popover-open' ? !!this.popoverOpen : false }
    hasAttribute(name) { return this.attributes.has(name) }
    setAttribute(name, value) { this.attributes.set(name, value) }
    closest() { return null }
    getClientRects() { return this.visible ? [{}] : [] }
    getBoundingClientRect() { return this.rect || { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } }
    querySelector() { return null }
    focus() { document.activeElement = this; this.focused = true }
    showModal() { this.hostAtShow = this.parentElement; this.open = true }
    close() { this.open = false }
    showPopover() { this.popoverOpen = true; this.popoverShows = (this.popoverShows || 0) + 1 }
    hidePopover() { this.popoverOpen = false }
    remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; this.isConnected = false }
  }
  document.body = new Element('body')
  const inspector = new Element('responsive-inspector')
  const trigger = new Element('original-trigger')
  const fallback = new Element('visible-mobile-trigger')
  const dialog = new Element('dialog')
  document.body.appendChild(inspector); inspector.appendChild(trigger); inspector.appendChild(dialog)
  document.activeElement = trigger
  document.querySelectorAll = () => [fallback]
  return { document, inspector, trigger, fallback, dialog, Element }
}

await test('Actual ModelPicker mount portals before showModal and cleans up after responsive parent hides', async () => {
  const source = (await read('frontend/src/models/ModelPicker.svelte')).match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
  const ast = ts.createSourceFile('model.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const action = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'mountDialog')
  assert.ok(action, 'ModelPicker exposes its mount action')
  const mount = new Function('mountModal', `${transpile(action.getText(ast))};return mountDialog`)(overlays.mountModal)
  const { document, inspector, trigger, fallback, dialog } = dom()
  const handle = mount(dialog)
  assert.ok(dialog.hostAtShow === document.body, 'dialog must leave its responsive inspector before showModal')
  assert.equal(dialog.open, true)
  inspector.visible = false; trigger.visible = false
  handle.destroy()
  assert.equal(dialog.open, false)
  assert.equal(dialog.parentElement, null, 'portalled dialog must not leak after unmount')
  assert.ok(document.activeElement === fallback, 'hidden opener must fall back to visible mobile control')
})

await test('Programmatically opened VoicePicker restores a voice trigger or mobile settings instead of unfocusable body/div', async () => {
  const source = (await read('frontend/src/voices/VoicePicker.svelte')).match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
  const ast = ts.createSourceFile('voice.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const action = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'mountDialog')
  assert.ok(action)
  const mount = new Function('mountModal', 'tick', `${transpile(action.getText(ast))};return mountDialog`)(overlays.mountModal, () => Promise.resolve())
  for (const [origin, desktopVisible] of [['body', true], ['div', false]]) {
    const { document, dialog, Element } = dom()
    const voice = new Element('voice-select', desktopVisible), mobile = new Element('mobile-inspector')
    document.body.appendChild(voice); document.body.appendChild(mobile)
    const previous = origin === 'body' ? document.body : new Element('plain-div')
    previous.tabIndex = -1
    document.activeElement = previous
    document.querySelectorAll = selector => selector.includes('.voice-select') && selector.includes('.mobile-inspector') ? [voice, mobile] : []
    const handle = mount(dialog)
    handle.destroy()
    await Promise.resolve()
    assert.ok(document.activeElement === (desktopVisible ? voice : mobile), `${origin}: restore a visible voice control without late autofocus stealing it`)
  }
  const { Element } = dom()
  const explicit = new Element('programmatic-target'); explicit.tabIndex = -1; explicit.setAttribute('tabindex', '-1')
  assert.equal(overlays.visibleFocusTarget(explicit), true, 'an explicit tabindex=-1 remains a valid programmatic return target')
})

await test('Popup focusout closes without stealing focus; nested Escape and cleanup are respected', () => {
  assert.equal(typeof overlays.dismissiblePopup, 'function')
  const { document, trigger, dialog, Element } = dom()
  const elsewhere = new Element('next-field')
  const inside = new Element('popup-button'); dialog.appendChild(inside)
  let closes = 0
  const handle = overlays.dismissiblePopup(dialog, { trigger: () => trigger, close: () => { closes++ } })
  const dispatch = (type, target, extra = {}) => {
    const event = new Event(type, { cancelable: true })
    Object.defineProperty(event, 'target', { value: target })
    Object.assign(event, extra)
    document.dispatchEvent(event)
    return event
  }
  dispatch('focusin', inside); assert.equal(closes, 0)
  document.activeElement = elsewhere
  dispatch('focusin', elsewhere); assert.equal(closes, 1)
  assert.ok(document.activeElement === elsewhere, 'focusout must preserve the new focused control')
  const consumed = new Event('keydown', { cancelable: true })
  Object.defineProperty(consumed, 'target', { value: inside }); Object.assign(consumed, { key: 'Escape' })
  consumed.preventDefault(); document.dispatchEvent(consumed); assert.equal(closes, 1)
  const escape = dispatch('keydown', inside, { key: 'Escape' })
  assert.equal(escape.defaultPrevented, true); assert.equal(closes, 2)
  assert.ok(document.activeElement === trigger, 'Escape restores the popup trigger')
  handle.destroy()
  dispatch('focusin', elsewhere); dispatch('pointerdown', elsewhere)
  assert.equal(closes, 2, 'destroy removes all document dismiss handlers')
})

await test('Anchored menu geometry flips above and clamps to viewport independently of dialog offsets', () => {
  assert.equal(typeof overlays.anchoredPopupPosition, 'function')
  const popup = { width: 220, height: 110 }, viewport = { width: 900, height: 800 }
  assert.deepEqual(overlays.anchoredPopupPosition({ right: 850, top: 300, bottom: 330 }, popup, viewport), { left: 630, top: 335 })
  assert.deepEqual(overlays.anchoredPopupPosition({ right: 850, top: 720, bottom: 750 }, popup, viewport), { left: 630, top: 605 })
  assert.deepEqual(overlays.anchoredPopupPosition({ right: 920, top: 780, bottom: 810 }, popup, viewport), { left: 672, top: 665 })
  assert.deepEqual(overlays.anchoredPopupPosition({ right: 10, top: 0, bottom: 4 }, popup, { width: 240, height: 120 }), { left: 8, top: 8 })
})

await test('Voice details menu enters native Popover without changing DOM order and releases dismissal listeners', () => {
  assert.equal(typeof overlays.detailsPopover, 'function')
  const { document, Element } = dom()
  const menu = new Element('details'), trigger = new Element('summary'), popup = new Element('voice-menu-items')
  document.body.appendChild(menu); menu.appendChild(trigger); menu.appendChild(popup)
  trigger.rect = { right: 850, top: 720, bottom: 750 }
  popup.rect = { width: 220, height: 110 }
  popup.closest = selector => selector === 'details' ? menu : null
  menu.querySelector = () => trigger
  const handle = overlays.detailsPopover(popup)
  menu.open = true; menu.dispatchEvent(new Event('toggle'))
  assert.equal(popup.popoverOpen, true)
  assert.ok(popup.parentElement === menu, 'native top-layer promotion must retain logical keyboard/DOM order')
  assert.equal(popup.style.left, '630px'); assert.equal(popup.style.top, '605px')
  const outside = new Event('focusin'); Object.defineProperty(outside, 'target', { value: new Element('next-control') })
  document.dispatchEvent(outside); assert.equal(menu.open, false)
  menu.dispatchEvent(new Event('toggle')); assert.equal(popup.popoverOpen, false)
  menu.open = true; menu.dispatchEvent(new Event('toggle'))
  handle.destroy(); assert.equal(popup.popoverOpen, false)
  const shows = popup.popoverShows
  menu.dispatchEvent(new Event('toggle')); assert.equal(popup.popoverShows, shows, 'destroy detaches native toggle handling')
  document.dispatchEvent(outside); assert.equal(menu.open, true, 'destroy removes focusout dismissal')
})

for (const row of checks) console.log(`${row.passed ? 'PASS' : 'FAIL'} ${row.name}${row.error ? `: ${row.error}` : ''}`)
console.log(`Overlay regression: ${checks.filter(row => row.passed).length}/${checks.length}`)
if (checks.some(row => !row.passed)) process.exitCode = 1
