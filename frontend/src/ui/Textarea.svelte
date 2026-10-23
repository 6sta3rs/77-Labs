<script lang="ts">
  import { untrack } from 'svelte'
  import type { HTMLTextareaAttributes } from 'svelte/elements'
  import '../styles/ui.css'
  import '../styles/ui-fields.css'

  type Props = Omit<HTMLTextareaAttributes, 'value'> & {
    value?: string
    size?: 'sm' | 'default' | 'lg'
    unstyled?: boolean
  }
  let { value = $bindable(''), defaultValue, defaultvalue, size = 'default', unstyled = false,
    class: className = '', ...native }: Props = $props()
  const initial = untrack(() => value)
</script>

<textarea {...native} defaultValue={defaultValue ?? defaultvalue ?? initial} bind:value class={`text-input vs-textarea ${className}`}
  data-size={size} data-unstyled={unstyled || undefined} data-slot="textarea"></textarea>
