<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLInputAttributes } from 'svelte/elements'
  import '../styles/ui.css'

  type Props = Omit<HTMLInputAttributes, 'type' | 'checked' | 'children' | 'onchange'> & {
    checked?: boolean; indeterminate?: boolean; onchange?: (checked: boolean) => void; children?: Snippet
  }
  let { checked = $bindable(false), indeterminate = $bindable(false), onchange, children, class: className = '', ...native }: Props = $props()
  let input: HTMLInputElement
  // `indeterminate` exists only as a DOM property.
  $effect(() => { input.indeterminate = indeterminate })
</script>

{#snippet box()}
  <input {...native} bind:this={input} type="checkbox" class={`vs-checkbox ${children ? '' : className}`} data-slot="checkbox"
    {checked} aria-checked={indeterminate ? 'mixed' : undefined}
    onchange={event => { checked = event.currentTarget.checked; indeterminate = false; onchange?.(checked) }} />
{/snippet}
{#if children}<label class={`vs-checkbox-label ${className}`}>{@render box()}<span>{@render children()}</span></label>{:else}{@render box()}{/if}

<style>
  .vs-checkbox{appearance:none;flex:none;position:relative;width:16px;height:16px;margin:0;border:1px solid var(--input-border);border-radius:4px;background:var(--background);cursor:pointer;transition:background-color 150ms ease,border-color 150ms ease}
  .vs-checkbox::after{content:'';position:absolute;inset:0;background:var(--primary-foreground);opacity:0;mask:center/12px no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12l5 5L20 7'/%3E%3C/svg%3E")}
  .vs-checkbox:checked,.vs-checkbox:indeterminate{background:var(--primary);border-color:var(--primary)}
  .vs-checkbox:checked::after,.vs-checkbox:indeterminate::after{opacity:1}
  .vs-checkbox:indeterminate::after{mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='3' stroke-linecap='round'%3E%3Cpath d='M6 12h12'/%3E%3C/svg%3E")}
  .vs-checkbox:focus-visible{outline:2px solid var(--focus,var(--accent));outline-offset:2px}
  .vs-checkbox:focus:not(:focus-visible){outline:none}
  .vs-checkbox:disabled{opacity:.64;cursor:not-allowed}
  .vs-checkbox[aria-invalid=true]{border-color:var(--danger)}
  .vs-checkbox-label{display:inline-flex;align-items:center;gap:8px;cursor:pointer}
  @media(prefers-reduced-motion:reduce){.vs-checkbox{transition:none}}
</style>
