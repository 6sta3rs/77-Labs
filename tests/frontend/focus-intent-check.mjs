import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'

const source=await readFile(new URL('../../frontend/src/styles/focus-intent.ts',import.meta.url),'utf8')
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {installFocusIntent}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))
class Control extends EventTarget {
  attrs=new Map()
  constructor(kind,options={}) { super();this.kind=kind;Object.assign(this,options) }
  setAttribute(name,value){this.attrs.set(name,value)}
  removeAttribute(name){this.attrs.delete(name)}
  hasAttribute(name){return this.attrs.has(name)}
  contains(node){return node===this||node?.label===this||node?.ownerControl===this}
  closest(selector){return selector==='label'?this.label||null:this.ownerControl||(this.kind==='svg'?null:this)}
}
const previousElement=globalThis.Element
globalThis.Element=Control
const document=new EventTarget()
document.documentElement={dataset:{}}
const fire=(type,target,extra={})=>{
  const event=new Event(type)
  Object.defineProperties(event,{target:{value:target},composedPath:{value:()=>[target,document]},...Object.fromEntries(Object.entries(extra).map(([key,value])=>[key,{value}]))})
  document.dispatchEvent(event)
}
const focus=control=>{document.activeElement=control;fire('focusin',control)}
const input=new Control('input'), trigger=new Control('button'), popupInput=new Control('input')
const checks=[]
const check=(name,run)=>{run();checks.push(name)}
const dispose=installFocusIntent(document)
try {
  check('Initial automatic field focus is passive',()=>{focus(input);assert.ok(input.hasAttribute('data-focus-passive'))})
  check('Hover cannot paint a passive field',()=>{fire('pointerenter',input);assert.ok(input.hasAttribute('data-focus-passive'))})
  check('Clicking the already focused field keeps it quiet',()=>{fire('pointerdown',input);assert.ok(input.hasAttribute('data-focus-passive'))})
  check('Typing into a field never paints a ring',()=>{fire('keydown',input,{key:'a'});fire('keydown',input,{key:'Enter'});fire('keydown',input,{key:'Shift'});assert.ok(input.hasAttribute('data-focus-passive'))})
  check('Clicking a control to focus it stays quiet',()=>{fire('pointerdown',trigger);focus(trigger);assert.ok(trigger.hasAttribute('data-focus-passive'))})
  check('Opening a popup by pointer does not paint its autofocus',()=>{focus(popupInput);assert.ok(popupInput.hasAttribute('data-focus-passive'))})
  check('Tab paints the focused control',()=>{fire('keydown',trigger,{key:'Tab'});focus(trigger);assert.equal(trigger.hasAttribute('data-focus-passive'),false)})
  check('Keyboard-opened popup keeps visible focus',()=>{fire('keydown',trigger,{key:'Enter'});focus(popupInput);assert.equal(popupInput.hasAttribute('data-focus-passive'),false)})
  check('Tab on a quiet field paints it even without a focus change',()=>{fire('pointerdown',input);focus(input);assert.ok(input.hasAttribute('data-focus-passive'));fire('keydown',input,{key:'Tab'});assert.equal(input.hasAttribute('data-focus-passive'),false)})
  check('Clicking a keyboard-focused field hides its ring',()=>{fire('pointerdown',input);assert.ok(input.hasAttribute('data-focus-passive'))})
  check('Arrow navigation between controls paints focus',()=>{fire('keydown',trigger,{key:'ArrowRight'});focus(trigger);assert.equal(trigger.hasAttribute('data-focus-passive'),false)})
  check('Focus leaving the field clears its passive marker',()=>{fire('pointerdown',trigger);focus(input);fire('focusout',input);assert.equal(input.hasAttribute('data-focus-passive'),false)})
  check('Cleanup removes listeners and pending paint state',()=>{focus(input);assert.ok(input.hasAttribute('data-focus-passive'));dispose();assert.equal(input.hasAttribute('data-focus-passive'),false);assert.equal(document.documentElement.dataset.focusPolicy,undefined);focus(popupInput);assert.equal(popupInput.hasAttribute('data-focus-passive'),false)})
  for(const name of checks)console.log('PASS '+name)
  console.log(`Focus intent: ${checks.length}/${checks.length}`)
} finally { dispose();if(previousElement===undefined)delete globalThis.Element;else globalThis.Element=previousElement }
