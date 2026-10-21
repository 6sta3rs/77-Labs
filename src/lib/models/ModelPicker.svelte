<script lang="ts">
  function uiOptions<T extends { label: string }>(items: readonly T[]): T[] { return items.map(item => ({ ...item, label: tr(item.label) })); }

  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import { onDestroy, untrack } from 'svelte'
  import { Check, ArrowLeft, LayoutGrid, List, LoaderCircle, RefreshCw, Search, X } from '@lucide/svelte'
  import ModelIcon from '../ui/ModelIcon.svelte'
  import Input from '../ui/Input.svelte'
  import Select from '../ui/Select.svelte'
  import Button from '../ui/Button.svelte'
  import ButtonGroup from '../ui/ButtonGroup.svelte'
  import { mountModal } from '../ui/overlay'
  import { canSelectModel, matchesModel, modelSelectionLabel, modelStatus, type ModelPickerItem } from './model-picker'
  import './model-picker.css'

  let {
    models,
    selectedId = '',
    mode = 'panel',
    title = 'Wybierz model',
    description = 'Wybierz silnik do syntezy mowy. Repozytoria i pobrane wagi znajdziesz w ustawieniach „Modele i silnik”.',
    loading = false,
    error: loadError = '',
    onselect,
    onclose,
    onrefresh,
  }: {
    models: ModelPickerItem[]
    selectedId?: string
    mode?: 'panel' | 'dialog'
    title?: string
    description?: string
    loading?: boolean
    error?: string
    onselect: (id: string) => Promise<void>
    onclose?: () => void
    onrefresh?: () => Promise<void> | void
  } = $props()
  const uid = $props.id()
  let query = $state<string | number | null>('')
  let filter = $state(untrack(() => mode === 'dialog' ? 'all' : 'installed'))
  let language = $state('all')
  let expanded = $state(false)
  let dismissed = $state(false)
  let layout = $state<'cards' | 'list'>('cards')
  let busyId = $state('')
  let selectionError = $state('')
  let refreshing = $state(false)
  let openLanguages = $state<string[]>([])
  let disposed = false
  let interaction = 0

  onDestroy(() => {
    disposed = true
    interaction++
  })

  const modal = $derived(!dismissed && (mode === 'dialog' || expanded))
  const languages = $derived([...new Set(models.flatMap(model => model.languages))].sort((a, b) => a.localeCompare(b, 'pl')))
  const filtered = $derived(models.filter(model => {
    const matchesAvailability = filter === 'all'
      || (filter === 'installed' && (model.installed || model.canVerify))
      || (filter === 'available' && model.available && model.installed)
    const matchesLanguage = language === 'all' || model.languages.includes(language)
    return matchesModel(model, String(query ?? '')) && matchesAvailability && matchesLanguage
  }))
  const panelModels = $derived.by(() => {
    const selected = models.filter(model => model.id === selectedId)
    const alternatives = models.filter(model => model.id !== selectedId && canSelectModel(model))
    return [...selected, ...alternatives].slice(0, 3)
  })

  function close() {
    interaction++
    if (mode === 'panel' && expanded) {
      expanded = false
      filter = 'installed'
      language = 'all'
    } else {
      if (mode === 'dialog') dismissed = true
      onclose?.()
    }
  }

  function finishSelection() {
    if (disposed) return
    expanded = false
    dismissed = mode === 'dialog'
    onclose?.()
  }

  function showAll() {
    interaction++
    filter = 'all'
    expanded = true
  }

  function toggleLanguages(modelId: string) {
    openLanguages = openLanguages.includes(modelId)
      ? openLanguages.filter(id => id !== modelId)
      : [...openLanguages, modelId]
  }

  async function refresh() {
    if (!onrefresh || refreshing || loading || busyId || disposed) return
    refreshing = true
    selectionError = ''
    try {
      await onrefresh()
    } catch (cause) {
      if (!disposed) selectionError = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (!disposed) refreshing = false
    }
  }

  function reasonId(model: ModelPickerItem, full: boolean) {
    return `${uid}-${full ? 'dialog' : 'panel'}-reason-${encodeURIComponent(model.id)}`
  }

  async function select(model: ModelPickerItem) {
    if (busyId || refreshing || loading || disposed || !canSelectModel(model)) return
    if (selectedId === model.id && !model.canVerify) {
      return
    }
    busyId = model.id
    selectionError = ''
    const current = interaction
    try {
      await onselect(model.id)
      if (interaction === current) finishSelection()
    } catch (cause) {
      if (!disposed && interaction === current) {
        selectionError = cause instanceof Error ? cause.message : String(cause)
      }
    } finally {
      if (!disposed) busyId = ''
    }
  }

  function mountDialog(node: HTMLDialogElement) {
    return mountModal(node, { initialFocus: '.model-picker-search input', returnFocus: '[data-model-dialog-return]' })
  }
  function backdrop(event: MouseEvent) {
    if (event.target !== event.currentTarget) return
    const box = (event.currentTarget as HTMLDialogElement).getBoundingClientRect()
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close()
  }
</script>

{#snippet content(full: boolean)}
  {@const visible=full?filtered:panelModels}
  <header class="model-picker-heading">{#if !full&&onclose}<Button variant="ghost" size="icon" class="model-picker-back" aria-label={tr("Zamknij wybór modelu")} onclick={close}><ArrowLeft size={16}/></Button>{/if}<div><h2 id={`${uid}-${full ? 'dialog' : 'panel'}-title`}>{full ? tr("Wszystkie modele") : title}</h2>
    {#if full}
    <p id={`${uid}-description`}>{tr(description)}</p>{/if}</div>
    <div class="model-picker-heading-actions">{#if onrefresh}<Button variant="ghost" size="icon" aria-label={tr("Odśwież modele")} disabled={loading || refreshing || Boolean(busyId)} onclick={refresh}><RefreshCw size={16} class={refreshing ? 'spin' : ''}/></Button>{/if}
    {#if full}<Button variant="ghost" size="icon" aria-label={tr("Zamknij wybór modelu")} onclick={close}><X size={17}/></Button>{/if}</div>
  </header>
  {#if full}
  <label class="search-field model-picker-search"><Search size={16} aria-hidden="true"/><Input type="search" unstyled aria-label={tr("Szukaj modelu lub języka")}
    placeholder={tr("Szukaj modelu lub języka…")} bind:value={query}/></label>
    <div class="model-picker-filters"><Select label={tr("Dostępność")} ariaLabel={tr("Dostępność modelu")} value={filter} onchange={value => filter = value}
      options={uiOptions([{value:'all',label:'Wszystkie'}, {value:'installed',label:'Na tym komputerze'}, {value:'available',label:'Dostępne do wyboru'}])}/>
      <Select label={tr("Język")} ariaLabel={tr("Język modelu")} value={language} onchange={value => language = value}
        options={uiOptions([{value:'all',label:'Wszystkie języki'}, ...languages.map(value => ({value,label:value}))])}/>
      <div class="model-picker-views"><ButtonGroup label={tr("Układ modeli")} mode="single" iconOnly value={layout}
        items={uiOptions([{value:'cards',label:'Widok kart',icon:LayoutGrid},{value:'list',label:'Widok listy',icon:List}])}
        onchange={value => layout = value === 'list' ? 'list' : 'cards'}/></div>
    </div>
  {/if}
  {#if loadError || selectionError}<p class="model-picker-error" role="alert">{selectionError || loadError}</p>{/if}
  {#if loading || refreshing}<p class="model-picker-empty" role="status"><LoaderCircle size={18} class="spin"/>{tr("Wczytywanie katalogu modeli…")}</p>
  {:else}
    {#if full}<p class="model-picker-count" role="status">{tr("Wyniki:")} {visible.length} {tr("z")} {models.length}</p>{/if}
    <div class="model-picker-results" class:model-picker-grid={full && layout === 'cards'} class:model-picker-list={full && layout === 'list'} aria-busy={Boolean(busyId)}>
      {#each visible as model (model.id)}
        <article class="model-picker-card" class:model-picker-selected={selectedId === model.id}>
          <div class="model-picker-card-content">
            <div class="model-picker-card-top">{#if full}<span class="model-picker-brand"><ModelIcon id={model.id} name={model.name} size="100%" fallbackText={model.brand}/></span>{/if}
              <h3 class="model-picker-card-name">{model.name}</h3>
              {#if selectedId === model.id}<span class="model-picker-selected-label"><Check size={14} aria-hidden="true"/>{tr("Wybrany")}</span>{/if}
            </div>
            <p class="model-picker-description">{tr(model.description)}</p>
            {#if full}<div class="model-picker-tags">
              {#if model.recommended}<span class="model-picker-tag">{tr("Polecany")}</span>{/if}
              {#each model.tags || [] as tag}<span class="model-picker-tag">{tag}</span>{/each}
            </div>{/if}
            <div class="model-picker-language-chips" aria-label={tr("Obsługiwane języki")}>
              {#each model.languages.slice(0,3) as language}<span>{language}</span>{:else}<span>{tr("Brak danych o językach")}</span>{/each}
              {#if model.languages.length > 3}
                <Button variant="ghost" size="compact"
                  aria-expanded={openLanguages.includes(model.id)}
                  aria-controls={`${reasonId(model, full)}-languages`}
                  aria-label={tr("Wszystkie języki: {value0}", {value0: (model.name)})}
                  onclick={() => toggleLanguages(model.id)}>
                  {openLanguages.includes(model.id) ? tr("Zwiń") : tr("+{value0} więcej", {value0: (model.languages.length - 3)})}
                </Button>
              {/if}
            </div>
            {#if openLanguages.includes(model.id)}<p id={`${reasonId(model,full)}-languages`} class="model-picker-language-expanded">{model.languages.join(' · ')}</p>{/if}
            {#if !model.available || !model.installed}<p id={reasonId(model, full)} class="model-picker-reason">{model.reason || (model.installationKnown === false ? tr("Backend nie potwierdził gotowości tego silnika.") : model.installed ? tr("Silnik nie jest obecnie gotowy do użycia.") : 'Ten silnik nie jest zainstalowany.')}</p>{/if}
          </div>
          <footer class="model-picker-card-footer">
            <span class="model-picker-status">{modelStatus(model)}</span>
            {#if selectedId !== model.id || model.canVerify}
            <Button variant="outline" class="model-picker-choice" disabled={Boolean(busyId) || !canSelectModel(model)}
              aria-describedby={!model.available || !model.installed ? reasonId(model, full) : undefined}
              onclick={() => select(model)}>
              <span class="model-picker-sr-only">{model.name}: </span>
              {#if busyId === model.id}<LoaderCircle size={16} class="spin"/>{tr("Wybieranie…")}
              {:else if !canSelectModel(model)}{tr("Niedostępny")}
              {:else}{modelSelectionLabel(model)}{/if}
            </Button>
            {/if}
          </footer>
        </article>
      {:else}<p class="model-picker-empty">{models.length ? tr("Brak modeli spełniających wybrane kryteria.") : tr("Brak modeli w katalogu. Sprawdź stan silnika w ustawieniach.")}</p>{/each}
    </div>
  {/if}
  {#if !full}<Button variant="ghost" size="sm" class="model-picker-all" onclick={showAll}>{tr("Pokaż wszystkie modele")}</Button>{/if}
{/snippet}

{#if mode === 'panel'}<section class="model-picker model-picker-panel" aria-label={title}>{@render content(false)}</section>{/if}
{#if modal}<dialog class="model-picker model-picker-dialog" aria-labelledby={`${uid}-dialog-title`} aria-describedby={`${uid}-description`} use:mountDialog
  oncancel={event => { event.preventDefault(); close() }} onclick={backdrop} onkeydown={event => { if (event.key === 'Escape') event.stopPropagation() }}>{@render content(true)}</dialog>{/if}
