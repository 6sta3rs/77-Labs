<script lang="ts">
  // Skip ±10 s: arc with a corner arrow over a centred "10". Both directions are exact mirrors.
  let { direction = 'back', size = 22 }: { direction?: 'back' | 'forward'; size?: number } = $props()
</script>

<svg class="skip-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <g transform={direction === 'forward' ? 'translate(24 0) scale(-1 1)' : undefined} stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4.5 9a7.5 7.5 0 0 1 14.6-2.4"/>
    <path d="M4.5 4.6V9h4.4"/>
  </g>
  <text x="11.4" y="21.9" text-anchor="middle" font-size="10.5" letter-spacing="-0.2" font-weight="700" fill="currentColor" font-family="inherit">10</text>
</svg>

<style>
  .skip-icon{display:block;flex:none}
</style>
