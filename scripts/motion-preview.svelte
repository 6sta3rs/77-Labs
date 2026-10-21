<script lang="ts">
  import VoiceOrb from '../src/lib/VoiceOrb.svelte';
  import Slider from '../src/lib/ui/Slider.svelte';
  import Tooltip from '../src/lib/ui/Tooltip.svelte';
  import type { AudioFeatures } from '../src/lib/audio-features';
  let level = $state(0);
  let value = $state(30);
  let shown = $state(true);
  let animated = $state(true);
  let features = $state<AudioFeatures>();
  export function signal(next: number, nextFeatures?: AudioFeatures) { level = next; features = nextFeatures; }
  export function setShown(next: boolean) { shown = next; }
  export function setAnimated(next: boolean) { animated = next; }
  export function sliderValue(next: number) { value = next; }
</script>

<section style="position:fixed;inset:20px auto auto 20px;z-index:999;background:var(--background);padding:20px;width:280px" data-motion-fixture>
  <div style:display={shown ? 'block' : 'none'} data-motion-orb><VoiceOrb voiceId="motion-regression" size={100} {animated} {level} {features} playing ring /></div>
  <div data-motion-slider><Slider {value} onchange={next => value = next} label="Testowy suwak" valueLabel={`${value}%`} /></div>
  <Tooltip content="Testowy dymek" delay={20}><button type="button" data-motion-tooltip>Dymek</button></Tooltip>
</section>
