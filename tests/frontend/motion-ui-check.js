import { mount, unmount, tick, createRawSnippet } from 'svelte';
import VoiceOrb from '../../src/lib/playback/VoiceOrb.svelte';
import Tooltip from '../../src/lib/ui/Tooltip.svelte';
import MotionPreview from '../../tools/preview/motion-preview.svelte';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Isolated real-component regression. No backend, storage, synthesis or user media. */
export async function checkMotion() {
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), ...(detail ? { detail } : {}) });
  const target = document.createElement('div');
  document.body.append(target);
  const previous = document.documentElement.dataset.reducedMotion;
  document.documentElement.dataset.reducedMotion = 'false';
  let component;
  try {
    component = mount(MotionPreview, { target });
    await tick(); await delay(180);
    const canvas = () => target.querySelector('[data-motion-orb] canvas');
    const frames = () => Number(canvas()?.dataset.frames || 0);
    check('Visible orb compiles WebGL', target.querySelector('.voice-orb')?.dataset.renderer === 'webgl');
    const activeBefore = frames(); await delay(300);
    check('Visible idle orb renders', frames() > activeBefore, { frames: frames() - activeBefore });
    component.setShown(false); await tick(); await delay(120);
    const hiddenBefore = frames();
    for (let index = 0; index < 24; index++) { component.signal((index % 8) / 8); await tick(); await delay(5); }
    check('Hidden orb draws zero frames during 24 audio updates', frames() === hiddenBefore, { frames: frames() - hiddenBefore });
    component.setShown(true); await tick(); await delay(150);
    check('Visible orb resumes rendering', frames() > hiddenBefore);
    component.setShown(false); await tick(); await delay(60);
    component.setAnimated(false); await tick(); component.setAnimated(true); await tick(); await delay(100);
    check('Initially hidden orb allocates no WebGL renderer', target.querySelector('.voice-orb')?.dataset.renderer === 'static' && frames() === 0);
    component.setShown(true); await tick(); await delay(150);
    check('First visible frame creates its renderer', target.querySelector('.voice-orb')?.dataset.renderer === 'webgl' && frames() > 0);
    document.documentElement.dataset.reducedMotion = 'true'; await delay(100);
    const reducedBefore = frames();
    for (let index = 0; index < 12; index++) { component.signal(index / 12); await tick(); await delay(5); }
    check('Reduced motion draws zero frames during audio updates', frames() === reducedBefore, { frames: frames() - reducedBefore });
    document.documentElement.dataset.reducedMotion = 'false'; await delay(120);
    check('Motion resumes after preference update', frames() > reducedBefore);
    const previousHidden = Object.getOwnPropertyDescriptor(document, 'hidden');
    try {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange')); await tick(); await delay(50);
      const tabHiddenBefore = frames();
      for (let index = 0; index < 12; index++) { component.signal(index / 12); await tick(); await delay(5); }
      check('Background document draws zero frames during audio updates', frames() === tabHiddenBefore, { frames: frames() - tabHiddenBefore });
    } finally {
      if (previousHidden) Object.defineProperty(document, 'hidden', previousHidden);
      else delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
      await tick(); await delay(80);
    }

    const OriginalResize = window.ResizeObserver;
    let observers = 0;
    window.ResizeObserver = class extends OriginalResize { constructor(...args) { super(...args); observers++; } };
    try {
      const range = target.querySelector('input[type=range]');
      range.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
      await tick(); await delay(60);
      const before = observers;
      for (let index = 0; index < 24; index++) { component.sliderValue(index + 40); await tick(); }
      await delay(60);
      check('Dragging slider reuses its observers', observers === before, { createdDuring24Updates: observers - before });
      check('Slider bubble tracks latest value', document.querySelector('.vs-slider-value')?.textContent === '63%');
      range.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
      await tick();
    } finally { window.ResizeObserver = OriginalResize; }

    let intersections = 0, mutations = 0;
    const OriginalIntersection = window.IntersectionObserver, OriginalMutation = window.MutationObserver;
    const avatars = [];
    window.IntersectionObserver = class extends OriginalIntersection { constructor(...args) { super(...args); intersections++; } };
    window.MutationObserver = class extends OriginalMutation { constructor(...args) { super(...args); mutations++; } };
    try {
      for (let index = 0; index < 20; index++) avatars.push(mount(VoiceOrb, { target, props: { voiceId: `static-${index}`, animated: false, size: 12 } }));
      await tick(); await delay(30);
      check('Twenty static avatars install zero motion observers', intersections === 0 && mutations === 0, { intersections, mutations });
    } finally {
      for (const avatar of avatars) await unmount(avatar);
      window.IntersectionObserver = OriginalIntersection; window.MutationObserver = OriginalMutation;
    }
    const originalAdd = EventTarget.prototype.addEventListener;
    let globalListeners = 0;
    const tooltips = [];
    EventTarget.prototype.addEventListener = function(type, ...args) {
      if ((this === document && ['scroll', 'keydown'].includes(type)) || (this === window && type === 'resize')) globalListeners++;
      return originalAdd.call(this, type, ...args);
    };
    try {
      const children = createRawSnippet(() => ({ render: () => '<button type="button">Pomoc</button>' }));
      for (let index = 0; index < 20; index++) tooltips.push(mount(Tooltip, { target, props: { content: 'Pomoc testowa', children } }));
      await tick();
      check('Twenty closed tooltips install zero global listeners', globalListeners === 0, { globalListeners });
    } finally {
      EventTarget.prototype.addEventListener = originalAdd;
      for (const tooltip of tooltips) await unmount(tooltip);
    }
    const tooltip = target.querySelector('[data-motion-tooltip]');
    tooltip.parentElement.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await delay(60);
    check('Tooltip opens and describes its trigger', Boolean(document.querySelector('[role=tooltip]')) && Boolean(tooltip.getAttribute('aria-describedby')));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    check('Escape closes tooltip and restores aria description', !document.querySelector('[role=tooltip]') && !tooltip.hasAttribute('aria-describedby'));
    tooltip.parentElement.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    tooltip.parentElement.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await tick(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await delay(60);
    check('Escape cancels a pending delayed tooltip', !document.querySelector('[role=tooltip]'));
  } finally {
    if (component) await unmount(component);
    target.remove();
    if (previous === undefined) delete document.documentElement.dataset.reducedMotion;
    else document.documentElement.dataset.reducedMotion = previous;
  }
  check('Unmount removes all portalled control popups', !document.querySelector('.vs-slider-value, [role=tooltip]'));
  return { checks, passed: checks.filter(check => check.pass).length, failed: checks.filter(check => !check.pass).length, privateData: false };
}
