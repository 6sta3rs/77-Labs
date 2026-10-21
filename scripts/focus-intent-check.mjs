import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'

const source=await readFile(new URL('../src/lib/focus-intent.ts',import.meta.url),'utf8')
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {installFocusIntent}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))
class Control extends EventTarget {
  attrs=new Map()
  constructor(kind,options={}) { super();this.kind=kind;Object.assign(this,options) }
  setAttribute(name,value){this.attrs.set(name,value)}
  removeAttribute(name){this.attrs.delete(name)}
  hasAttribute(name){return this.attrs.has(name)}
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
  check('Clicking the already focused field enables its ring',()=>{fire('pointerdown',input);assert.equal(input.hasAttribute('data-focus-passive'),false)})
  check('Opening a popup by pointer does not paint its autofocus',()=>{fire('pointerdown',trigger);focus(trigger);assert.equal(trigger.hasAttribute('data-focus-passive'),false);focus(popupInput);assert.ok(popupInput.hasAttribute('data-focus-passive'))})
  check('A compound label click counts as input interaction',()=>{const label=new Control('label',{control:popupInput});const icon=new Control('svg',{label});fire('pointerdown',icon);assert.equal(popupInput.hasAttribute('data-focus-passive'),false)})
  check('Programmatic return focus after pointer remains quiet',()=>{fire('pointerdown',trigger);focus(popupInput);focus(input);assert.ok(input.hasAttribute('data-focus-passive'))})
  check('Returning to the same opener cannot reuse its earlier click',()=>{fire('pointerdown',trigger);focus(trigger);focus(popupInput);focus(trigger);assert.ok(trigger.hasAttribute('data-focus-passive'))})
  check('Pointer release expires an unconsumed focus target',()=>{fire('pointerdown',trigger);fire('pointerup',trigger);focus(trigger);assert.ok(trigger.hasAttribute('data-focus-passive'))})
  check('A modifier alone does not flash a ring',()=>{focus(input);fire('keydown',input,{key:'Shift'});assert.ok(input.hasAttribute('data-focus-passive'))})
  check('Typing into an autofocused field enables its ring',()=>{fire('keydown',input,{key:'a'});assert.equal(input.hasAttribute('data-focus-passive'),false)})
  check('Keyboard navigation and keyboard-opened popup keep visible focus',()=>{fire('keydown',trigger,{key:'Tab'});focus(trigger);focus(popupInput);assert.equal(trigger.hasAttribute('data-focus-passive'),false);assert.equal(popupInput.hasAttribute('data-focus-passive'),false)})
  check('Focus leaving the field clears its passive marker',()=>{fire('pointerdown',trigger);focus(input);fire('focusout',input);assert.equal(input.hasAttribute('data-focus-passive'),false)})
  check('Cleanup removes listeners and pending paint state',()=>{focus(input);assert.ok(input.hasAttribute('data-focus-passive'));dispose();assert.equal(input.hasAttribute('data-focus-passive'),false);assert.equal(document.documentElement.dataset.focusPolicy,undefined);focus(popupInput);assert.equal(popupInput.hasAttribute('data-focus-passive'),false)})
  for(const name of checks)console.log('PASS '+name)
  console.log(`Focus intent: ${checks.length}/${checks.length}`)
} finally { dispose();if(previousElement===undefined)delete globalThis.Element;else globalThis.Element=previousElement }
