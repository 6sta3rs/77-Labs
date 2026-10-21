<script lang="ts">
  import { untrack } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import '../styles/ui.css'
  import '../styles/ui-fields.css'
  type Props = Omit<HTMLButtonAttributes, 'type' | 'onclick' | 'onchange' | 'value'> & {
    checked?: boolean; onchange?: (value: boolean) => void; label: string
    size?: 'default' | 'sm' | 'lg'; name?: string; value?: string; required?: boolean
  }
  let { checked = $bindable(false), onchange, label, disabled = false,
    size = 'default', name, value = 'on', required = false, form,
    class: className = '', ...native }: Props = $props()
  const initial = untrack(() => checked)
  let input: HTMLInputElement
  let button: HTMLButtonElement
  let invalid = $state(false)
  function update(next: boolean) { checked = next; invalid = false; onchange?.(next) }
  $effect(() => {
    const owner = input.form
    const reset = (event: Event) => queueMicrotask(() => {
      if (!event.defaultPrevented) { input.checked = initial; update(initial) }
    })
    owner?.addEventListener('reset', reset)
    return () => owner?.removeEventListener('reset', reset)
  })
</script>

<button {...native} bind:this={button} type="button" class={`vs-switch ${className}`}
  data-size={size} data-slot="switch" role="switch" aria-checked={checked} aria-label={label}
  aria-required={required || undefined} aria-invalid={invalid || native['aria-invalid']} {disabled}
  onclick={() => update(!checked)}><span data-slot="switch-thumb"></span></button>
<input bind:this={input} class="vs-native-control" type="checkbox" tabindex="-1" aria-hidden="true"
  {name} {value} {checked} {disabled} {required} {form}
  onchange={(event) => update(event.currentTarget.checked)}
  oninvalid={(event) => { event.preventDefault(); invalid = true; button.focus() }} />
