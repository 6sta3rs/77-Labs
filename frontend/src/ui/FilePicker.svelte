<script lang="ts">
  import { Upload } from '@lucide/svelte'
  import Button from './Button.svelte'
  import { uiLanguage, createUiTranslator } from '../i18n'
  import { polishPlural } from '../i18n/plural'

  const tr = $derived(createUiTranslator($uiLanguage))

  let { label = 'Wybierz plik', accept, multiple = false, disabled = false, id, ariaLabel, variant = 'outline',
    showName = true, placeholder, bare = false, onchange }: {
    label?: string; accept?: string; multiple?: boolean; disabled?: boolean; id?: string; ariaLabel?: string
    variant?: 'default' | 'secondary' | 'outline' | 'ghost'
    /** Show the chosen file name next to the button; turn off when the caller shows it itself. */
    showName?: boolean; placeholder?: string
    /** Render only the hidden input; open it with `open()` from a custom drop zone. */
    bare?: boolean
    onchange: (files: File[]) => void
  } = $props()
  let names = $state('')
  let input = $state<HTMLInputElement>()
  export function open() { input?.click() }

  function changed(event: Event & { currentTarget: HTMLInputElement }) {
    const files = Array.from(event.currentTarget.files ?? [])
    // Reset so choosing the same file again still fires change.
    event.currentTarget.value = ''
    if (!files.length) return
    names = files.length === 1 ? files[0].name : `${files.length} ${tr(polishPlural(files.length, 'plik', 'pliki', 'plików'))}`
    onchange(files)
  }
</script>

{#if bare}
  <input bind:this={input} class="vs-file-input" type="file" tabindex="-1" aria-hidden="true" {accept} {multiple} {disabled} onchange={changed}/>
{:else}
<span class="vs-file-picker">
  <Button as="label" {variant} {disabled}><Upload size={14}/>{tr(label)}<input bind:this={input} class="vs-file-input" type="file" {id} {accept} {multiple} {disabled} aria-label={tr(ariaLabel ?? label)} onchange={changed}/></Button>
  {#if showName}<span class="vs-file-name" title={names || undefined}>{names || tr(placeholder ?? 'Nie wybrano pliku')}</span>{/if}
</span>
{/if}

<style>
  .vs-file-picker{display:inline-flex;align-items:center;gap:10px;min-width:0;max-width:100%}
  .vs-file-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--ui-text-12);color:var(--muted)}
</style>
