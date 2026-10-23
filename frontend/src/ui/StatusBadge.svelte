<script lang="ts" module>
  export type BadgeKind = 'ok' | 'warn' | 'bad' | 'wait' | 'neutral';
</script>
<script lang="ts">
  // Final status badge ("Przyciskowy kontur"). Status, not a control: no hover, no focus.
  // The leading icon keeps the status readable without colour. Pure numbers in the compact form (tab counts) get no icon.
  import { CircleCheck, TriangleAlert, CircleX, Clock } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  let { kind, text = '', compact = false, children }: { kind: BadgeKind; text?: string; compact?: boolean; children?: Snippet } = $props();
  const noIcon = $derived(kind === 'neutral' || (compact && /^\d+$/.test(text)));
</script>

<span class="p-badge {kind}" class:compact>{#if noIcon}{:else if kind === 'ok'}<CircleCheck aria-hidden="true"/>{:else if kind === 'warn'}<TriangleAlert aria-hidden="true"/>{:else if kind === 'bad'}<CircleX aria-hidden="true"/>{:else}<Clock aria-hidden="true"/>{/if}{text}{@render children?.()}</span>

<style>
  .p-badge{--bc:var(--muted);display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 8px;border:1px solid color-mix(in srgb,var(--bc) 45%,transparent);border-radius:8px;background:color-mix(in srgb,var(--bc) 12%,transparent);color:var(--bc);font-size:var(--ui-text-12);font-weight:500;line-height:1;letter-spacing:0;text-transform:none;font-variant-numeric:tabular-nums;white-space:nowrap;flex-shrink:0;align-self:center;cursor:default;user-select:none}
  .ok{--bc:var(--success)}.warn,.wait{--bc:var(--settings-warn,#d6b36a)}.bad{--bc:var(--danger)}
  .p-badge :global(svg){width:13px;height:13px;flex-shrink:0;color:var(--bc)}
  .compact{height:20px;min-width:20px;justify-content:center;gap:4px;padding:0 6px;border-radius:6px;font-size:var(--ui-text-11)}
  .compact :global(svg){width:12px;height:12px}
</style>
