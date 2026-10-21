<script lang="ts">
  import { Upload } from '@lucide/svelte'
  import Button from './Button.svelte'

  let { label = 'Wybierz plik', accept, multiple = false, disabled = false, id, ariaLabel, variant = 'outline',
    showName = true, placeholder = 'Nie wybrano pliku', onchange }: {
    label?: string; accept?: string; multiple?: boolean; disabled?: boolean; id?: string; ariaLabel?: string
    variant?: 'default' | 'secondary' | 'outline' | 'ghost'
    /** Show the chosen file name next to the button; turn off when the caller shows it itself. */
    showName?: boolean; placeholder?: string
    onchange: (files: File[]) => void
  } = $props()
  let names = $state('')

  function changed(event: Event & { currentTarget: HTMLInputElement }) {
    const files = Array.from(event.currentTarget.files ?? [])
    // Reset so choosing the same file again still fires change.
    event.currentTarget.value = ''
    if (!files.length) return
    names = files.length === 1 ? files[0].name : `${files.length} pliki`
    onchange(files)
  }
</script>

<span class="vs-file-picker">
  <Button as="label" {variant} {disabled}><Upload size={14}/>{label}<input class="vs-file-input" type="file" {id} {accept} {multiple} {disabled} aria-label={ariaLabel ?? label} onchange={changed}/></Button>
  {#if showName}<span class="vs-file-name" title={names || undefined}>{names || placeholder}</span>{/if}
</span>

<style>
  .vs-file-picker{display:inline-flex;align-items:center;gap:10px;min-width:0;max-width:100%}
  .vs-file-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--ui-text-12);color:var(--muted)}
</style>
