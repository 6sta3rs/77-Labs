<script lang="ts">
  import { userMessage } from '../platform/user-message';
  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import Button from '../ui/Button.svelte';
  import { onDestroy } from 'svelte'
  import ModelTrigger from '../ui/ModelTrigger.svelte'
  import ModelPicker from './ModelPicker.svelte'
  import LlmNotice from './LlmNotice.svelte'
  import { engineCatalog, selectEngine } from '../tools/studio-tools'
  import { canSelectModel, FASTER_WHISPER_DEFAULT, FASTER_WHISPER_ENGINES, normalizeTtsModels } from './model-picker'
  import { engineCatalogSnapshot } from './engine-catalog-state'

  let { ready, disabled = false, family = 'tts', busy = $bindable(false), onopenai }: {
    ready: boolean; disabled?: boolean; family?: 'tts' | 'asr' | 'llm'; busy?: boolean; onopenai?: () => void
  } = $props()
  let open = $state(false), error = $state('')
  const catalog = $derived(ready ? $engineCatalogSnapshot?.catalog[family] : undefined)
  let controller: AbortController | undefined, disposed = false, revision = 0
  const label = $derived(family === 'asr' ? 'Model rozpoznawania' : family === 'llm' ? 'Model ulepszania tekstu' : 'Model syntezy')
  const items = $derived(normalizeTtsModels(catalog).map(item => family === 'tts' ? item : { ...item, description: catalog?.backends.find(engine => engine.id === item.id)?.description || (family === 'asr' ? 'Silnik rozpoznawania mowy.' : 'Lokalny model do pracy z tekstem.') }))
  const selected = $derived(items.find(item => item.id === catalog?.active))
  // ASR with no pinned engine ("auto"): the engine picks its own at first use, so do not claim nothing is chosen.
  const auto = $derived(family === 'asr' && !!catalog && !catalog.active && catalog.configured_active === 'auto')
  const shownModel = $derived(catalog?.active_model || (family === 'asr' && catalog && FASTER_WHISPER_ENGINES.includes(catalog.active) ? FASTER_WHISPER_DEFAULT : ''))
  const pickerDescription = $derived(family === 'asr' ? 'Wybierz silnik rozpoznawania mowy. Dostępność trybów i segmentów zależy od wybranego silnika.' : family === 'llm' ? 'Wybierz lokalny model językowy używany do pracy z tekstem.' : 'Wybierz silnik syntezy mowy używany do przygotowania nagrania.')
  async function load() {
    if (!ready || disposed || busy) return
    const current = ++revision
    controller?.abort(); controller = new AbortController()
    busy = true; error = ''
    try {
      await engineCatalog(controller.signal)
    } catch (cause) {
      if (!disposed && current === revision && !(cause instanceof Error && cause.name === 'AbortError')) error = userMessage(cause, 'Nie udało się odczytać modeli.')
    } finally { if (!disposed && current === revision) busy = false }
  }
  async function choose(id: string) {
    if (!ready || disabled || busy || !items.some(item => item.id === id && canSelectModel(item))) throw new Error('Ten model nie jest teraz dostępny.')
    const current = ++revision
    controller?.abort(); controller = new AbortController()
    busy = true; error = ''
    try {
      await selectEngine(family, id, controller.signal)
      await engineCatalog(controller.signal)
      if (disposed || current !== revision) return
      if (catalog?.active !== id) throw new Error('Silnik nie potwierdził wybranego modelu. Spróbuj ponownie.')
      open = false
    } finally { if (!disposed && current === revision) busy = false }
  }
  $effect(() => {
    void family
    if (!ready) { open = false; busy = false }
    return () => { revision++; controller?.abort(); busy = false }
  })
  onDestroy(() => { disposed = true; revision++; controller?.abort() })
</script>

<div class="tool-workspace-section">
  <h2>{tr(String(label))}</h2>
  <ModelTrigger label="" name={selected?.name || (ready ? (auto ? tr("Automatycznie") : tr("Wybierz model")) : tr("Silnik wyłączony"))} modelId={catalog?.active} active={!!catalog?.active || auto} expanded={open} popup="dialog" {busy} disabled={!ready || disabled} onclick={() => { open = true; void load() }}/>
  {#if shownModel}<p class="tool-workspace-note repository" title={tr(String(shownModel))}>{shownModel}</p>{:else if auto}<p class="tool-workspace-note">{tr("Silnik rozpoznawania zostanie dobrany automatycznie przy pierwszym użyciu.")}</p>{/if}
  {#if selected?.readinessLabel}<p class="tool-workspace-note">{selected.readinessLabel}</p>{/if}
  {#if error}<p class="model-error" role="alert">{tr(String(error))}</p><Button variant="ghost" disabled={!ready || busy} onclick={load}>{tr("Ponów odczyt modeli")}</Button>{/if}
  {#if family === 'llm'}<LlmNotice {ready} {onopenai}/>{/if}
  <p class="tool-workspace-note">{tr("Aktywny model jest wspólny dla narzędzi studia.")}</p>
</div>
{#if open}<ModelPicker mode="dialog" title={tr(String(label))} description={tr(String(pickerDescription))} models={items} selectedId={catalog?.active || ''} loading={busy} {error} onselect={choose} onrefresh={load} onclose={() => open = false}/>{/if}

<style>
  .repository{overflow-wrap:anywhere}.model-error{color:var(--danger);font-size:var(--ui-text-12);line-height:1.7;overflow-wrap:anywhere}
</style>
