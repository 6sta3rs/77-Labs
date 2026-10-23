<script lang="ts">
  import type { Snippet } from 'svelte'
  import { sheetDrag } from './sheet-drag'

  // Bottom drawer: backdrop click, Escape and dragging the handle down all close it.
  type Props = { open?: boolean; label: string; onclose?: () => void; children?: Snippet; class?: string }
  let { open = $bindable(false), label, onclose, children, class: className = '' }: Props = $props()
  function close() { open = false; onclose?.() }
</script>

<svelte:window onkeydown={event => { if (open && event.key === 'Escape') close() }} />
{#if open}
  <div class="vs-drawer-backdrop" aria-hidden="true" onclick={close}></div>
  <div class={`vs-drawer ${className}`} data-sheet data-slot="drawer" role="dialog" aria-modal="true" aria-label={label}>
    <div class="vs-drawer-handle" aria-hidden="true" use:sheetDrag={close}></div>
    <div class="vs-drawer-body">{@render children?.()}</div>
  </div>
{/if}

<style>
  .vs-drawer-backdrop{position:fixed;inset:0;z-index:40;background:#0008;animation:vs-drawer-fade 300ms ease-out}
  .vs-drawer{position:fixed;z-index:41;left:0;right:0;bottom:0;max-height:85dvh;overflow:auto;border:1px solid var(--border);border-bottom:0;border-radius:16px 16px 0 0;background:var(--surface);box-shadow:0 -15px 50px #0006;transition:translate 300ms cubic-bezier(.32,.72,0,1);animation:vs-drawer-in 400ms cubic-bezier(.32,.72,0,1)}
  .vs-drawer-handle{position:sticky;top:0;z-index:1;height:22px;cursor:grab;touch-action:none;background:inherit}
  .vs-drawer-handle::before{content:'';display:block;width:40px;height:4px;margin:9px auto 0;border-radius:999px;background:var(--border)}
  .vs-drawer-body{padding:8px 20px 24px}
  @keyframes vs-drawer-in{from{translate:0 100%}}
  @keyframes vs-drawer-fade{from{opacity:0}}
  @media(prefers-reduced-motion:reduce){.vs-drawer,.vs-drawer-backdrop{animation:none;transition:none}}
</style>
