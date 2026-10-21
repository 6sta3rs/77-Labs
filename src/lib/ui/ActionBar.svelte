<script lang="ts">
  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import { Tags, ChevronDown, LoaderCircle, Square, Settings2, History } from '@lucide/svelte'
  import Button from './Button.svelte'
  let { tagging = false, running = false, tagDisabled = false, generateDisabled = false,
    tagLabel = 'Automatyczne tagowanie', generateLabel = 'Wygeneruj mowę', progressLabel = 'Przerwij generowanie',
    ontag, ontags, ongenerate, oncancel, onsettings, onhistory }: {
    tagging?: boolean; running?: boolean; tagDisabled?: boolean; generateDisabled?: boolean
    tagLabel?: string; generateLabel?: string; progressLabel?: string
    ontag: () => void | Promise<void>; ontags: () => void; ongenerate: () => void | Promise<void>; oncancel?: () => void
    /** Narrow windows only: open the side panel as a bottom sheet. */
    onsettings?: () => void; onhistory?: () => void
  } = $props()
</script>
<div class="studio-actions" aria-label={tr("Akcje narracji")}>
  <div class="studio-action-split" role="group" aria-label={tr("Tagowanie tekstu")}>
    <Button variant="ghost" class="studio-action-tag" aria-label={tr(tagLabel)} aria-busy={tagging || undefined} disabled={tagDisabled || running || tagging} onclick={()=>void ontag()}>
      {#if tagging}<LoaderCircle class="spin"/>{:else}<Tags/>{/if}<span>{tagging ? tr('Tagowanie…') : tr(tagLabel)}</span>
    </Button>
    <Button variant="ghost" class="studio-action-menu" aria-label={tr("Wybierz tag audio")} data-speech-tag-trigger disabled={running || tagging} onclick={ontags}><ChevronDown/></Button>
  </div>
  {#if onsettings || onhistory}<div class="studio-panel-buttons">{#if onsettings}<Button variant="outline" size="icon" aria-label={tr("Ustawienia generowania")} onclick={onsettings}><Settings2/></Button>{/if}{#if onhistory}<Button variant="outline" size="icon" aria-label={tr("Historia generowania")} onclick={onhistory}><History/></Button>{/if}</div>{/if}
  <Button class="studio-action-generate" disabled={!running && (generateDisabled || tagging)} onclick={()=>running ? oncancel?.() : void ongenerate()}>
    {#if running}<Square size={12} fill="currentColor"/>{/if}{tr(running ? progressLabel : generateLabel)}
  </Button>
</div>
<style>
  .studio-actions{display:flex;align-items:center;flex-wrap:wrap;gap:10px;min-width:0}.studio-action-split{display:flex;align-items:stretch;height:36px;border:1px solid var(--input-border);border-radius:8px;overflow:hidden;background:var(--control-background)}
  .studio-actions :global(.vs-button){height:36px;font-size:var(--ui-text-12);font-weight:500}
  .studio-action-split :global(.vs-button){height:34px;border:0;box-shadow:none;border-radius:0;scale:1}
  .studio-action-split :global(.studio-action-tag){--control-icon-color:var(--tag);padding-inline:10px;gap:8px}
  .studio-action-split :global(.studio-action-menu){width:32px;padding:0;border-left:1px solid var(--input-border);--control-icon-color:var(--muted)}
  .studio-actions :global(.studio-action-generate){min-width:126px;padding-inline:14px}
  .studio-actions :global(.vs-button::after){display:none}
  .studio-action-split:has(:focus-visible){outline:2px solid var(--focus);outline-offset:2px}
.studio-panel-buttons{display:none;gap:8px;margin-left:auto}.studio-panel-buttons :global(.vs-button){width:36px;padding:0}
  @media(max-width:980px){.studio-panel-buttons{display:flex}.studio-actions :global(.studio-action-generate){flex:1 0 100%}}
  @media(max-width:520px){.studio-actions{gap:8px}.studio-action-split :global(.studio-action-tag){padding-inline:8px}.studio-actions :global(.studio-action-generate){min-width:115px;padding-inline:10px}}
</style>
