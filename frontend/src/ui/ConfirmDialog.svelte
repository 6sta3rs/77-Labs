<script lang="ts">
  import { uiLanguage, createUiTranslator } from '../i18n'
  const tr = $derived(createUiTranslator($uiLanguage))
  import Button from './Button.svelte'
  import { mountModal } from './overlay'
  import { pendingConfirm } from './confirm'

  // Mounted once in App.svelte. Native <dialog> modality gives the focus trap; Escape fires `cancel`.
  const mount = (node: HTMLDialogElement) => mountModal(node, { initialFocus: '[data-confirm]' })
</script>

{#if $pendingConfirm}
  {@const ask = $pendingConfirm}
  <dialog use:mount class="confirm-dialog" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-message"
    oncancel={(event) => { event.preventDefault(); ask.settle(false) }}>
    <h2 id="confirm-title">{ask.title ?? tr('Potwierdź działanie')}</h2>
    <p id="confirm-message">{ask.message}</p>
    <div class="actions">
      <Button variant="outline" onclick={() => ask.settle(false)}>{ask.cancelLabel ?? tr('Anuluj')}</Button>
      <Button variant={ask.danger ? 'destructive' : 'default'} data-confirm onclick={() => ask.settle(true)}>{ask.confirmLabel ?? tr('Potwierdź')}</Button>
    </div>
  </dialog>
{/if}

<style>
  dialog{padding:22px 24px;border:1px solid var(--border);border-radius:14px;color:var(--foreground);width:min(440px,calc(100vw - 32px));box-shadow:var(--popup-shadow);font-family:var(--font-ui)}
  h2{font-size:var(--ui-text-18)}
  p{margin-top:10px;font-size:var(--ui-text-14);line-height:1.6;color:var(--muted);white-space:pre-line}
  .actions{display:flex;justify-content:flex-end;gap:8px;margin-top:22px}
</style>
