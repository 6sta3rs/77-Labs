type MotionState = { visible: boolean; hidden: boolean; reduced: boolean };
type Subscription = { visible: boolean; notify: (state: MotionState) => void };

// Static avatars need no observers. Animated orbs share document preferences
// and viewport observation, released when the last orb unmounts.
const subscriptions = new Map<Element, Subscription>();
let media: MediaQueryList | undefined;
let mutations: MutationObserver | undefined;
let intersection: IntersectionObserver | undefined;

function publish() {
  const hidden = document.hidden;
  const reduced = Boolean(media?.matches || document.documentElement.dataset.reducedMotion === 'true');
  for (const subscription of subscriptions.values()) subscription.notify({ visible: subscription.visible, hidden, reduced });
}

export function observeOrbMotion(element: Element, notify: Subscription['notify']) {
  if (subscriptions.size === 0) {
    media = matchMedia('(prefers-reduced-motion: reduce)');
    media.addEventListener('change', publish);
    document.addEventListener('visibilitychange', publish);
    mutations = new MutationObserver(publish);
    mutations.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduced-motion'] });
    intersection = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const subscription = subscriptions.get(entry.target);
        if (subscription) subscription.visible = entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0;
      }
      publish();
    });
  }
  subscriptions.set(element, { visible: false, notify });
  intersection!.observe(element);
  publish();
  return () => {
    intersection?.unobserve(element);
    subscriptions.delete(element);
    if (subscriptions.size) return;
    intersection?.disconnect(); mutations?.disconnect();
    media?.removeEventListener('change', publish);
    document.removeEventListener('visibilitychange', publish);
    intersection = undefined; mutations = undefined; media = undefined;
  };
}
