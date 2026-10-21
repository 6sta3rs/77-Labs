<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements'
  import './button-tooltip.css'

  let { variant = 'default', size = 'default', class: className = '', children, type = 'button', as = 'button', href, disabled = false, onclick, ...attributes }: Omit<HTMLButtonAttributes, 'onclick'> & Pick<HTMLAnchorAttributes, 'href' | 'download' | 'target' | 'rel'> & {
    as?: 'button' | 'label'
    for?: string
    onclick?: (event: MouseEvent & { currentTarget: EventTarget & HTMLElement }) => void
    variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive'
    size?: 'default' | 'sm' | 'compact' | 'xs' | 'icon' | 'icon-xs'
    children?: Snippet
  } = $props()
  const element = $derived(href !== undefined ? 'a' : as)
  const inactive = $derived(disabled || attributes['aria-disabled'] === true || attributes['aria-disabled'] === 'true')
</script>

<svelte:element this={element} {...attributes} type={element === 'button' ? type : undefined}
  href={element === 'a' && !inactive ? href : undefined} disabled={element === 'button' ? disabled : undefined}
  aria-disabled={inactive || undefined} tabindex={inactive && element !== 'button' ? -1 : attributes.tabindex}
  data-slot="button" data-variant={variant} data-icon-only={size === 'icon' || size === 'icon-xs' ? '' : undefined}
  class={`vs-button vs-button-${variant} vs-button-size-${size} ${className}`}
  onclick={(event: MouseEvent & { currentTarget: EventTarget & HTMLElement }) => {
    if (inactive) {
      event.preventDefault(); event.stopPropagation(); return
    }
    onclick?.(event)
  }}>
  {@render children?.()}
</svelte:element>
