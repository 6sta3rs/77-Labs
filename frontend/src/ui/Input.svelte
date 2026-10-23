<script lang="ts">
  import { untrack } from 'svelte'
  import type { HTMLInputAttributes } from 'svelte/elements'
  import '../styles/ui.css'
  import '../styles/ui-fields.css'

  type Props = Omit<HTMLInputAttributes, 'size' | 'value'> & {
    value?: string | number | null
    size?: 'compact' | 'sm' | 'default' | 'lg'
    font?: 'default' | 'mono'
    unstyled?: boolean
  }
  let { value = $bindable(''), defaultValue, defaultvalue, size = 'default', font = 'default', unstyled = false,
    class: className = '', ...native }: Props = $props()
  // Svelte's native reset binding reads defaultValue, not the initial bound value.
  const initial = untrack(() => value ?? '')
</script>

<input {...native} defaultValue={native.type === 'file' ? undefined : defaultValue ?? defaultvalue ?? initial}
  bind:value class={`text-input vs-input ${className}`}
  data-size={size} data-font={font} data-unstyled={unstyled || undefined} data-slot="input" />
