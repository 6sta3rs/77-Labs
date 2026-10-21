<script lang="ts">
  import { onMount, tick, untrack } from 'svelte'
  import { Check, FileCheck, LoaderCircle, X } from '@lucide/svelte'
  import Button from '../ui/Button.svelte'
  import { mountModal } from '../ui/overlay'
  import ModelLicenseReview from './ModelLicenseReview.svelte'
  import { request, health } from '../platform/api'
  import { ensureRuntime, isDesktop } from '../platform/runtime'
  import { licenseStateLabel, requiredLicenseRepos, type ModelLicenseDetails } from './model-licenses'
  import { pendingLicenses, readOnboardingPlan, rememberOnboarding, type LicenseOnboardingPlan } from './license-onboarding'

  let { ready, selection = '', onsetup }: { ready: boolean; selection?: string; onsetup: () => void } = $props()
  const uid = $props.id()
  let initialized = $state(false), open = $state(false), loading = $state(false), connecting = $state(false), writing = $state(false), reconciling = $state(false)
  let plan = $state.raw<LicenseOnboardingPlan>(), selected = $state(''), error = $state(''), storageNotice = $state('')
  let connected = $state(false)
  let deferred = false, disposed = false, controller: AbortController | undefined, connectionEpoch = 0, refreshQueued = false, focusPending = false
  const pending = $derived(plan ? pendingLicenses(plan) : [])
  const locked = $derived(loading || connecting || writing || reconciling)
  const canReview = $derived(ready || connected)
  const finished = $derived(!!plan && !error && !loading && pending.length === 0)

  function mount(node: HTMLDialogElement) { return mountModal(node, { initialFocus: '[data-onboarding-title]', returnFocus: '[data-license-onboarding-open],.settings-trigger' }) }
  function close() {
    if (writing || reconciling) return
    deferred = true; open = false; connectionEpoch++; controller?.abort(); loading = false; connecting = false
  }
  function setup() { if (writing || reconciling) return; close(); onsetup() }
  function forgetHint() { try { localStorage.removeItem('voicestudio.license-onboarding.v1') } catch { /* No consent is stored here. */ } }
  async function inspect(reveal = false, advance = false) {
    const abort = new AbortController(); controller?.abort(); controller = abort
    loading = true; error = ''
    try {
      const next = await readOnboardingPlan(request, AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]))
      if (disposed || abort.signal.aborted) return
      plan = next; connected = true
      try { rememberOnboarding(localStorage, next); storageNotice = '' } catch { storageNotice = 'Nie udało się zapisać postępu powitania. Decyzje o modelach pozostają zapisane w silniku.' }
      selected = !advance && next.models.some(model => model.repo_id === selected) ? selected : pendingLicenses(next)[0]?.repo_id || ''
      if (reveal || (!deferred && pendingLicenses(next).length > 0)) open = true
    } catch (cause) {
      if (!disposed && !abort.signal.aborted) {
        plan = undefined; selected = ''
        error = cause instanceof Error ? cause.message : 'Nie udało się sprawdzić wymaganych warunków.'
        // Transient engine errors must not re-ask decisions already stored by the backend.
        if (reveal) open = true
      }
    } finally { if (controller === abort && !disposed) loading = false }
  }
  async function decisionChanged() {
    reconciling = true; focusPending = true
    try { await inspect(false, true) } finally { reconciling = false; flushQueuedRefresh(); focusAfterDecision() }
  }
  function reviewed(details: ModelLicenseDetails) {
    if (!plan) return
    plan = { ...plan, models: plan.models.map(model => model.repo_id === details.repo_id ? details.acceptance : model) }
    try { rememberOnboarding(localStorage, plan) } catch { /* The backend retains the decision. */ }
  }
  function flushQueuedRefresh() {
    if (!refreshQueued || writing || reconciling || disposed) return
    refreshQueued = false
    if (ready) void inspect()
    else { controller?.abort(); connected = false; plan = undefined; selected = ''; loading = false }
  }
  function busyChanged(value: boolean) {
    writing = value
    if (!value) { flushQueuedRefresh(); focusAfterDecision() }
  }
  function focusAfterDecision() {
    if (!focusPending || writing || reconciling || !open) return
    focusPending = false
    void tick().then(() => {
      if (!disposed && open && !writing && !reconciling) document.querySelector<HTMLElement>(`.license-onboarding ${selected || !finished ? '[data-onboarding-title]' : 'footer button'}`)?.focus({ preventScroll: true })
    })
  }
  async function connect() {
    if (locked) return
    if (canReview) { await inspect(true); return }
    const epoch = ++connectionEpoch, abort = new AbortController(); controller?.abort(); controller = abort
    connecting = true; error = ''
    try {
      if (isDesktop()) await ensureRuntime(abort.signal)
      await health(abort.signal)
      if (disposed || abort.signal.aborted) return
      connected = true
      await inspect(true)
    } catch (cause) { if (!disposed && !abort.signal.aborted) error = cause instanceof Error ? cause.message : 'Nie udało się połączyć z prywatnym silnikiem.' }
    finally { if (!disposed && epoch === connectionEpoch) connecting = false }
  }
  function show() {
    if (writing || reconciling) return
    deferred = false; open = true
    if (canReview) void inspect(true)
  }
  function required(event: Event) {
    const repos = requiredLicenseRepos((event as CustomEvent<{ models?: unknown }>).detail?.models)
    const current = plan
    if (!repos.length || writing || reconciling || !current || repos.some(repo => !current.models.some(model => model.repo_id === repo))) return
    forgetHint(); show()
  }
  function backdrop(event: MouseEvent) {
    if (event.target !== event.currentTarget) return
    const rect = (event.currentTarget as HTMLDialogElement).getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close()
  }
  $effect(() => {
    const active = ready, identity = selection, mounted = initialized
    if (!mounted) return
    untrack(() => {
      if (writing || reconciling) { refreshQueued = true; return }
      if (active && !connecting) void inspect()
      else if (!active && !connecting) { controller?.abort(); connected = false; plan = undefined; selected = ''; loading = false }
    })
    // Re-read the authoritative plan after a model selection changes.
    void identity
  })
  onMount(() => {
    // The backend plan decides: inspect() opens the dialog only when terms are pending.
    initialized = true
    window.addEventListener('studio:license-onboarding-open', show)
    window.addEventListener('studio:model-license-required', required)
    return () => { disposed = true; controller?.abort(); window.removeEventListener('studio:license-onboarding-open', show); window.removeEventListener('studio:model-license-required', required) }
  })
</script>

{#if open}
  <dialog class="license-onboarding" use:mount aria-labelledby={`${uid}-title`} aria-describedby={`${uid}-intro`} oncancel={event => { event.preventDefault(); close() }} onkeydown={event => { if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 'k'))) event.stopPropagation() }} onclick={backdrop}>
    <header><div><p class="eyebrow">Pierwsze kroki</p><h1 id={`${uid}-title`} tabindex="-1" data-onboarding-title>Przygotuj modele do pracy</h1></div><Button variant="ghost" size="icon" aria-label="Odłóż przegląd warunków" disabled={writing || reconciling} onclick={close}><X size={18}/></Button></header>
    <div class="onboarding-content">
      <p id={`${uid}-intro`}>Przed pierwszą syntezą sprawdź warunki wybranego modelu i jego wymaganych składników. Każde potwierdzenie zapisujesz osobno, po przeczytaniu informacji i źródeł.</p>
      {#if connecting || (loading && !plan)}<p class="progress" role="status"><LoaderCircle size={16} class="spin"/>{connecting ? 'Łączenie z prywatnym silnikiem…' : 'Sprawdzanie modeli i zapisanych decyzji…'}</p>
      {:else if plan}
        <div class="plan-summary"><div><strong>{plan.engine.label || plan.engine.id}</strong>{#if plan.engine.model_id}<code>{plan.engine.model_id}</code>{/if}</div><span>{plan.models.length - pending.length} z {plan.models.length} sprawdzonych</span></div>
        {#if finished}<p class="complete" role="status"><Check size={20}/>Wymagane potwierdzenia są aktualne. Możesz wrócić do studia.</p><p class="hint">To sprawdzenie dotyczy warunków. Stan instalacji modeli i silnika znajdziesz w ustawieniach.</p>{/if}
        <nav aria-label="Modele do przeglądu">{#each plan.models as model (model.repo_id)}<button class:selected={selected === model.repo_id} disabled={locked} aria-current={selected === model.repo_id ? 'step' : undefined} onclick={() => selected = model.repo_id}><span class="step-icon">{#if !model.required || model.accepted}<Check size={16}/>{:else}<FileCheck size={16}/>{/if}</span><span><code>{model.repo_id}</code><small>{licenseStateLabel(model.state)}</small></span></button>{/each}</nav>
        {#if loading}<p class="progress" role="status"><LoaderCircle size={16} class="spin"/>Odświeżanie zapisanych decyzji…</p>{/if}
        {#if selected}<ModelLicenseReview ready={canReview && (!loading || reconciling)} repoId={selected} onbusychange={busyChanged} onchanged={decisionChanged} onreviewed={reviewed}/>{/if}
      {:else}<div class="welcome"><h2>Twoje decyzje, zapisane lokalnie</h2><p>Studio odczyta wymagania aktywnego silnika i pokaże modele, które potrzebują Twojego potwierdzenia. Możesz odłożyć ten krok i wrócić do niego w Ustawienia → Modele i silnik.</p><p class="hint">Przycisk poniżej uruchamia prywatny silnik, jeśli jest zainstalowany. Pobieranie modeli wybierasz osobno.</p><Button variant="default" disabled={locked} onclick={connect}>Sprawdź modele i warunki</Button></div>{/if}
      {#if error}<div class="onboarding-error" role="alert"><p>{error}</p><Button variant="outline" disabled={locked} onclick={connect}>Spróbuj ponownie</Button><Button variant="ghost" disabled={writing || reconciling} onclick={setup}>Otwórz ustawienia silnika</Button></div>{/if}
      {#if storageNotice}<p class="hint" role="status">{storageNotice}</p>{/if}
    </div>
    <footer><span>{writing || reconciling ? 'Zapisywanie decyzji — poczekaj na wynik.' : 'Potwierdzenia możesz później przejrzeć lub cofnąć w ustawieniach.'}</span><Button variant={finished ? 'default' : 'outline'} disabled={writing || reconciling} onclick={close}>{finished ? 'Przejdź do studia' : 'Później'}</Button></footer>
  </dialog>
{/if}

<style>
  dialog.license-onboarding{position:fixed;inset:0;margin:auto;padding:0;width:min(820px,calc(100vw - 32px));max-width:none;max-height:calc(100dvh - 32px);border:1px solid var(--border);border-radius:14px;color:var(--foreground);box-shadow:0 24px 80px rgb(0 0 0 / 25%)}dialog[open]{display:flex;flex-direction:column}header{display:flex;align-items:center;gap:14px;padding:24px;border-bottom:1px solid var(--border)}header>div:nth-child(2){flex:1;min-width:0}.eyebrow{color:var(--muted);font-size:var(--ui-text-11);margin-bottom:5px}h1{font-size:var(--ui-text-20);font-weight:600}h1:focus{outline:none}.onboarding-content{padding:24px;overflow:auto;min-height:0;display:flex;flex-direction:column;gap:20px}.onboarding-content p,footer{font-size:var(--ui-text-12);line-height:1.8;color:var(--muted)}.progress,.complete{display:flex;align-items:center;gap:10px}.plan-summary{display:flex;align-items:center;justify-content:space-between;gap:16px;font-size:var(--ui-text-12)}.plan-summary>div{display:flex;flex-direction:column;gap:6px}.plan-summary>span{color:var(--muted);white-space:nowrap}code{font-size:var(--ui-text-11);overflow-wrap:anywhere}.plan-summary code{color:var(--muted)}nav{display:grid;gap:8px}nav button{display:flex;align-items:center;justify-content:flex-start;gap:12px;text-align:left;padding:12px 14px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--foreground);min-width:0}nav button.selected{border-color:var(--focus);background:var(--surface-hover)}nav button:disabled{opacity:.65}nav button>span:last-child{display:flex;flex-direction:column;gap:5px;min-width:0}nav small{font-size:var(--ui-text-11);color:var(--muted)}.step-icon{display:flex;flex-shrink:0}.welcome{padding:20px;border:1px solid var(--border);border-radius:10px;display:flex;flex-direction:column;align-items:flex-start;gap:14px}h2{font-size:var(--ui-text-15)}.complete{padding:16px;border:1px solid var(--border);border-radius:8px;color:var(--foreground)!important}.hint{font-size:var(--ui-text-11)!important}.onboarding-error{padding:16px;border:1px solid var(--danger);border-radius:8px;display:flex;flex-wrap:wrap;gap:10px}.onboarding-error p{width:100%;color:var(--danger)}footer{border-top:1px solid var(--border);padding:16px 24px;display:flex;align-items:center;justify-content:space-between;gap:20px}footer>span{font-size:var(--ui-text-11)}footer :global(button){flex-shrink:0}nav button:focus-visible{outline:2px solid var(--focus);outline-offset:3px}@media(max-width:600px){header,.onboarding-content,footer{padding:16px}footer{align-items:flex-start;flex-direction:column;gap:12px}.plan-summary{align-items:flex-start;flex-direction:column;gap:8px}h1{font-size:var(--ui-text-18)}}
</style>
