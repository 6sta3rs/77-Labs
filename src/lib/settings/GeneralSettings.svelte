<script lang="ts">
  import { uiLanguage, createUiTranslator, getUiLanguage, getUiLanguageError, setUiLanguage, type UiLanguage } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import { onDestroy, untrack } from 'svelte'
  import { Settings2, RefreshCw, Save } from '@lucide/svelte'
  import Button from '../ui/Button.svelte'
  import Input from '../ui/Input.svelte'
  import Select from '../ui/Select.svelte'
  import Switch from '../ui/Switch.svelte'
  import { productionJson, postJson } from '../tools/production/production'
  import { generalPreferences, saveGeneralPreferences, skillLabels, connectionMessage, type LlmProvider, type LlmProviders, type LlmSkill, type RefinementSettings, type AsrEndpoint, type ConnectionResult, type TranslationQuality } from './general-settings'
  import { readEngineIdleMinutes, saveEngineIdleMinutes, engineIdleOptions, type EngineIdleMinutes } from '../platform/runtime'
  let { ready }: { ready: boolean } = $props()
  const interfaceLanguages = [{ value: 'pl', label: 'Polski' }, { value: 'en', label: 'English' }]
  const uid = $props.id()
  let engineIdle = $state<EngineIdleMinutes>(readEngineIdleMinutes())
  let selectedLanguage = $state<UiLanguage>(getUiLanguage())
  let languageError = $state(getUiLanguageError())
  let failedSections = $state<string[]>([])
  $effect(() => { selectedLanguage = $uiLanguage })
  function changeUiLanguage(next: string) {
    const result = setUiLanguage(next as UiLanguage)
    languageError = result.ok ? '' : result.error
    if (!result.ok) selectedLanguage = result.language
  }
  let providers = $state.raw<LlmProvider[]>([]), active = $state(''), engineActive = $state(''), enginePinned = $state(false)
  let skills = $state.raw<LlmSkill[]>([]), refinement = $state<RefinementSettings>(), asr = $state<AsrEndpoint>()
  let editing = $state(''), baseUrl = $state(''), model = $state(''), apiKey = $state(''), account = $state('')
  let asrUrl = $state(''), asrModel = $state(''), asrKey = $state(''), providerModels = $state<string[]>([])
  let values = $state<Record<string, string>>({ DEEPL_API_KEY: '', DEEPL_BASE_URL: '', MICROSOFT_API_KEY: '', MICROSOFT_BASE_URL: '' }), busy = $state(''), error = $state(''), notice = $state(''), loaded = $state(false)
  let connection = $state<ConnectionResult>(), asrConnection = $state<ConnectionResult>()
  let controller: AbortController | undefined, disposed = false
  const locked = $derived(!!busy)
  const current = $derived(providers.find(provider => provider.id === editing))
  const fields = [
    { key: 'DEEPL_API_KEY', label: 'Klucz API DeepL', secret: true, placeholder: 'Nowy klucz DeepL' },
    { key: 'DEEPL_BASE_URL', label: 'Adres API DeepL', secret: false, placeholder: 'https://api.deepl.com/v2' },
    { key: 'MICROSOFT_API_KEY', label: 'Klucz API Microsoft Translator', secret: true, placeholder: 'Nowy klucz Microsoft' },
    { key: 'MICROSOFT_BASE_URL', label: 'Adres API Microsoft Translator', secret: false, placeholder: 'https://api.cognitive.microsofttranslator.com' },
  ]
  function choose(id: string, list = providers) {
    const provider = list.find(row => row.id === id)
    editing = id; baseUrl = provider?.base_url || ''; model = provider?.model || ''; account = provider?.account_id || ''
    apiKey = ''; connection = undefined; providerModels = []
  }
  function acceptProviders(data: LlmProviders, keep = editing) {
    providers = data.providers; active = data.active || ''; engineActive = data.engine_active || ''; enginePinned = !!data.engine_from_env
    choose(keep && data.providers.some(row => row.id === keep) ? keep : data.active || data.providers[0]?.id || '', data.providers)
  }
  async function work(label: string, action: (signal: AbortSignal) => Promise<void>) {
    if (!ready || busy || disposed) return
    const abort = new AbortController(); controller = abort; busy = label; error = ''; notice = ''; failedSections = []
    try { await action(abort.signal) } catch (cause) { if (!disposed && !abort.signal.aborted) error = cause instanceof Error ? cause.message : String(cause) }
    finally { if (!disposed) busy = '' }
  }
  async function refresh() {
    await work('Odczyt ustawień', async signal => {
      const results = await Promise.allSettled([
        productionJson<LlmProviders>('/api/settings/llm-providers', { signal }),
        productionJson<{ skills: LlmSkill[] }>('/api/settings/llm-skills', { signal }),
        productionJson<RefinementSettings>('/api/settings/dictation-refinement', { signal }),
        productionJson<AsrEndpoint>('/api/settings/asr-openai-compat', { signal }),
      ])
      signal.throwIfAborted(); if (disposed) return
      if (results[0].status === 'fulfilled') acceptProviders(results[0].value)
      if (results[1].status === 'fulfilled') skills = results[1].value.skills
      if (results[2].status === 'fulfilled') refinement = results[2].value
      if (results[3].status === 'fulfilled') { asr = results[3].value; asrUrl = asr.base_url; asrModel = asr.model; asrKey = '' }
      const labels = ['dostawców LLM', 'funkcji LLM', 'redakcji dyktowania', 'zewnętrznego ASR']
      const failed = results.flatMap((result, index) => result.status === 'rejected' ? [labels[index]] : [])
      failedSections = failed
      loaded = true
    })
  }
  function preference(patch: Partial<{ reviewMode: boolean; translationQuality: TranslationQuality }>) {
    try { saveGeneralPreferences({ ...$generalPreferences, ...patch }); error = ''; notice = 'Zapisano preferencje aplikacji.' }
    catch { error = 'Nie udało się zapisać preferencji w tej aplikacji. Poprzednie ustawienie pozostaje aktywne.' }
  }
  async function changeEngineIdle(value: string) {
    const minutes = Number(value) as EngineIdleMinutes, previous = engineIdle
    engineIdle = minutes
    try { await saveEngineIdleMinutes(minutes); error = ''; notice = tr("Zapisano: silnik utrzymywany {minutes} min po ostatnim zadaniu.", { minutes }) }
    catch (cause) { engineIdle = previous; error = tr("Nie udało się zmienić czasu utrzymania silnika: {reason}. Poprzednie ustawienie pozostaje aktywne.", { reason: cause instanceof Error ? cause.message : String(cause) }) }
  }
  async function saveProvider(signal: AbortSignal, clear = false) {
    const data = await productionJson<LlmProviders>(`/api/settings/llm-providers/${encodeURIComponent(editing)}`, {
      ...postJson({ base_url: baseUrl.trim(), model: model.trim(), ...(current?.needs_account ? { account_id: account.trim() } : {}), ...(clear ? { api_key: '' } : apiKey ? { api_key: apiKey } : {}), make_active: false, activate_if_unset: false }, signal), method: 'PUT',
    })
    signal.throwIfAborted(); acceptProviders(data)
  }
  async function providerAction(action: 'save' | 'test' | 'connect' | 'models' | 'clear') {
    await work(action === 'connect' ? 'Test i aktywacja dostawcy' : 'Konfiguracja dostawcy LLM', async signal => {
      await saveProvider(signal, action === 'clear')
      if (action === 'test' || action === 'connect') {
        const result = await productionJson<ConnectionResult>(`/api/settings/llm-providers/${encodeURIComponent(editing)}/${action}`, postJson({}, signal))
        signal.throwIfAborted(); connection = result
        if (result.ok && action === 'connect') { acceptProviders(await productionJson<LlmProviders>('/api/settings/llm-providers', { signal })); connection = result; skills = (await productionJson<{ skills: LlmSkill[] }>('/api/settings/llm-skills', { signal })).skills }
      } else if (action === 'models') {
        const result = await productionJson<{ ok: boolean; models: string[]; detail?: string; truncated?: boolean }>(`/api/settings/llm-providers/${encodeURIComponent(editing)}/models`, { signal })
        if (!result.ok) throw new Error(result.detail || 'Serwer nie zwrócił listy modeli.')
        providerModels = result.models; notice = `Odczytano ${result.models.length} modeli${result.truncated ? ' (lista ograniczona przez serwer)' : ''}.`
      } else notice = action === 'clear' ? 'Usunięto klucz z prywatnego magazynu. Klucz środowiskowy może nadal mieć pierwszeństwo.' : `Zapisano dostawcę. ${active !== editing || engineActive !== 'openai-compat' ? 'Aby używać go w produkcji, wybierz „Sprawdź i aktywuj”.' : 'Dostawca jest aktywny.'}`
    })
  }
  async function changeSkill(skill: LlmSkill, patch: { enabled?: boolean; provider_override?: string }) {
    await work('Zapis funkcji LLM', async signal => {
      const previous = skills; skills = skills.map(row => row.id === skill.id ? { ...row, ...patch } : row)
      try { skills = (await productionJson<{ skills: LlmSkill[] }>(`/api/settings/llm-skills/${encodeURIComponent(skill.id)}`, { ...postJson(patch, signal), method: 'PUT' })).skills; notice = 'Zapisano kierowanie funkcji LLM.' }
      catch (cause) { skills = previous; throw cause }
    })
  }
  async function saveRefinement() {
    if (!refinement) return
    const { auto, smart_cleanup, self_correction, preserve_technical } = refinement
    await work('Zapis redakcji dyktowania', async signal => { refinement = await productionJson<RefinementSettings>('/api/settings/dictation-refinement', { ...postJson({ auto, smart_cleanup, self_correction, preserve_technical }, signal), method: 'PUT' }); notice = 'Zapisano ustawienia redakcji dyktowania.' })
  }
  async function saveAsr(test = false, clear = false) {
    await work('Konfiguracja serwera ASR', async signal => {
      asr = await productionJson<AsrEndpoint>('/api/settings/asr-openai-compat', { ...postJson({ base_url: asrUrl.trim(), model: asrModel.trim(), ...(clear ? { api_key: '' } : asrKey ? { api_key: asrKey } : {}) }, signal), method: 'PUT' })
      asrUrl = asr.base_url; asrModel = asr.model; asrKey = ''; asrConnection = undefined
      if (test) asrConnection = await productionJson<ConnectionResult>('/api/settings/asr-openai-compat/test', postJson({}, signal))
      else notice = clear ? 'Usunięto prywatny klucz ASR.' : 'Zapisano serwer ASR. Wybierz odpowiedni silnik w katalogu modeli, aby go użyć.'
    })
  }
  async function saveTranslation(key: string) {
    await work('Zapis dostawcy tłumaczenia', async signal => { await productionJson('/system/set-env', postJson({ key, value: values[key]?.trim() || '' }, signal)); values[key] = ''; notice = 'Zapisano w prywatnych ustawieniach silnika.' })
  }
  $effect(() => { if (ready && !loaded) untrack(() => { void refresh() }) })
  onDestroy(() => { disposed = true; controller?.abort() })
</script>

<div class="general-settings">
  <header><Settings2 size={23}/><div><h1>{tr("Ogólne i usługi językowe")}</h1><p>{tr("Preferencje pracy oraz rzeczywiste ustawienia tłumaczenia, ASR i funkcji LLM prywatnego silnika.")}</p></div><Button variant="ghost" size="icon" aria-label={tr("Odśwież ustawienia ogólne")} disabled={!ready || locked} onclick={refresh}><RefreshCw size={15}/></Button></header>
  <section aria-label={tr("Preferencje pracy")}><h2>{tr("Praca w studiu")}</h2><div class="option"><div><strong>{tr("Język interfejsu")}</strong><p>{tr("Zmień język całej aplikacji. Tekst narracji, głosy i ustawienia modeli pozostają bez zmian.")}</p></div><Select ariaLabel={tr('Język interfejsu')} bind:value={selectedLanguage} onchange={changeUiLanguage} language={false} options={interfaceLanguages}/></div>{#if languageError}<p class="failure" role="alert">{tr(languageError)}</p>{/if}<div class="option"><div><strong>{tr("Zatrzymuj dubbing do sprawdzenia")}</strong><p>{tr("Po przygotowaniu materiału i transkrypcji czekaj na następny krok. Po wyłączeniu przygotowanie przechodzi do transkrypcji i tłumaczenia. Generowanie audio uruchamiasz ręcznie.")}</p></div><Switch label={tr("Zatrzymuj dubbing do sprawdzenia")} checked={$generalPreferences.reviewMode} onchange={value => preference({ reviewMode: value })}/></div><Select label={tr("Domyślny tryb tłumaczenia nowych materiałów")} value={$generalPreferences.translationQuality} onchange={value => preference({ translationQuality: value as TranslationQuality })} options={[{ value: 'fast', label: tr("Podstawowy") }, { value: 'autofit', label: tr("Dopasuj do czasu · LLM") }, { value: 'cinematic', label: tr("Naturalny dialog · LLM") }]}/><Select label={tr("Utrzymuj silnik po bezczynności")} value={String(engineIdle)} onchange={changeEngineIdle} options={engineIdleOptions.map(minutes => ({ value: String(minutes), label: tr("{minutes} min", { minutes }) }))}/><p>{tr("Dłużej = szybsze kolejne generowanie, ale silnik dłużej zajmuje pamięć RAM/VRAM.")}</p></section>
  {#if !ready}<p role="status">{tr("Uruchom prywatny silnik, aby odczytać ustawienia usług językowych.")}</p>{/if}
  <section aria-label={tr("Dostawcy LLM")}><h2>{tr("Dostawcy LLM")}</h2><p>{tr("Te usługi obsługują tłumaczenie i redakcję silnika. Tagowanie przez subskrypcję ChatGPT ma osobne ustawienia „AI i subskrypcja”. Sam zapis konfiguracji nie wysyła tekstu do dostawcy.")}</p>
    {#if providers.length}<p>{tr("Aktywny dostawca:")} {providers.find(row => row.id === active)?.display_name || tr("brak")} {tr("· silnik:")} {engineActive || tr("nieustalony")}{enginePinned ? tr(" · wybór narzucony przez środowisko") : ''}.</p><Select label={tr("Edytowany dostawca LLM")} value={editing} onchange={choose} options={providers.map(row => ({ value: row.id, label: `${row.display_name}${row.local ? tr(" · lokalny") : ''}` }))} disabled={locked}/>
      <label for={`${uid}-llm-url`}>{tr("Adres serwera")}</label><Input id={`${uid}-llm-url`} bind:value={baseUrl} disabled={locked}/><label for={`${uid}-llm-model`}>{tr("Model LLM")}</label><Input id={`${uid}-llm-model`} bind:value={model} list={`${uid}-models`} disabled={locked}/><datalist id={`${uid}-models`}>{#each providerModels as item (item)}<option value={item}></option>{/each}</datalist>
      {#if current?.needs_account}<label for={`${uid}-account`}>{tr("Id konta dostawcy")}</label><Input id={`${uid}-account`} bind:value={account} disabled={locked}/>{/if}
      <label for={`${uid}-llm-key`}>{tr("Nowy klucz API")}</label><Input id={`${uid}-llm-key`} type="password" bind:value={apiKey} autocomplete="off" disabled={locked} placeholder={current?.has_key ? tr("Klucz jest zapisany · puste pole zachowuje go") : current?.local ? tr("Lokalny serwer może nie wymagać klucza") : tr("Wpisz klucz API")}/><p>{tr("Klucz w magazynie:")} {current?.has_key ? tr("zapisany") : tr("brak")}{current?.key_from_env ? tr(" · dostępny klucz środowiskowy") : ''}{tr(". Test LLM wysyła krótkie żądanie do wybranego serwera i może wykorzystać jego limit.")}</p>
      <div class="actions"><Button variant="outline" disabled={!ready || locked} onclick={() => providerAction('save')}><Save size={14}/>{tr("Zapisz dostawcę")}</Button><Button variant="outline" disabled={!ready || locked} onclick={() => providerAction('models')}>{tr("Pobierz listę modeli")}</Button><Button variant="outline" disabled={!ready || locked} onclick={() => providerAction('test')}>{tr("Wyślij test LLM")}</Button><Button variant="default" disabled={!ready || locked || current?.active_from_env} onclick={() => providerAction('connect')}>{tr("Sprawdź i aktywuj")}</Button><Button variant="ghost" disabled={!ready || locked || !current?.has_key} onclick={() => providerAction('clear')}>{tr("Usuń zapisany klucz LLM")}</Button></div>
      {#if connection}<p role="status" class:failure={!connection.ok}>{connectionMessage(connection, tr)}</p>{#if connection.ok && active !== editing}<p>{tr("Test się powiódł. Ten dostawca nie jest aktywny.")}</p>{/if}{/if}
    {/if}
  </section>
  <section aria-label={tr("Funkcje i kierowanie LLM")}><h2>{tr("Funkcje i kierowanie LLM")}</h2><p>{tr("Wybierz dostawcę osobno dla każdej funkcji. Wyłączona funkcja korzysta z podstawowej ścieżki silnika lub zgłasza brak wymaganej usługi.")}</p>{#each skills as skill (skill.id)}<div class="skill"><div class="option"><div><strong>{tr(skillLabels[skill.id] || skill.id)}</strong><p>{!skill.enabled ? tr("Wyłączone") : skill.ready ? tr('Skonfigurowano · {provider}', { provider: skill.provider_display_name || tr('aktywny dostawca') }) : tr("Wymaga konfiguracji dostawcy")}</p></div><Switch label={tr('Włącz {name}', { name: tr(skillLabels[skill.id] || skill.id) })} checked={skill.enabled} onchange={enabled => changeSkill(skill, { enabled })} disabled={!ready || locked}/></div><Select label={tr('Dostawca: {name}', { name: tr(skillLabels[skill.id] || skill.id) })} value={skill.provider_override || ''} onchange={provider_override => changeSkill(skill, { provider_override })} options={[{ value: '', label: tr("Używaj aktywnego dostawcy") }, ...providers.filter(row => row.configured || row.id === skill.provider_override).map(row => ({ value: row.id, label: `${row.display_name}${row.local ? tr(" · lokalny") : ''}` }))]} disabled={!ready || locked || !skill.enabled}/></div>{/each}</section>
  <section aria-label={tr("Redakcja dyktowania")}><h2>{tr("Redakcja dyktowania")}</h2>{#if refinement}<p>{tr("LLM:")} {refinement.llm_ready ? tr("skonfigurowany · gotowość połączenia wymaga testu") : tr("nieskonfigurowany")}. {refinement.last_refine_status?.ok === false ? tr("Ostatnia redakcja nie powiodła się; silnik zachował tekst rozpoznany przez ASR.") : ''}</p>{#each [{ key: 'auto' as const, label: tr("Automatyczna redakcja dyktowania") }, { key: 'smart_cleanup' as const, label: tr("Porządkuj interpunkcję i wypełniacze") }, { key: 'self_correction' as const, label: tr("Rozpoznawaj wypowiedziane poprawki") }, { key: 'preserve_technical' as const, label: tr("Zachowuj słownictwo techniczne") }] as item (item.key)}<div class="option"><strong>{tr(item.label)}</strong><Switch label={tr(item.label)} checked={refinement[item.key]} onchange={value => { if (refinement) refinement[item.key] = value }} disabled={!ready || locked}/></div>{/each}<Button variant="outline" disabled={!ready || locked} onclick={saveRefinement}><Save size={14}/>{tr("Zapisz redakcję dyktowania")}</Button>{/if}</section>
  <section aria-label={tr("Tłumacze DeepL i Microsoft")}><h2>{tr("Tłumacze DeepL i Microsoft")}</h2><p>{tr("Klucze są zapisywane przez istniejący mechanizm prywatnego silnika. Pola są puste przy otwarciu, ponieważ nie odczytujemy zapisanych sekretów.")}</p>{#each fields as field (field.key)}<label for={`${uid}-${field.key}`}>{tr(field.label)}</label><div class="field"><Input id={`${uid}-${field.key}`} type={field.secret ? 'password' : 'text'} autocomplete="off" bind:value={values[field.key]} placeholder={tr(field.placeholder)} disabled={!ready || locked}/><Button variant="outline" disabled={!ready || locked || !values[field.key]?.trim()} onclick={() => saveTranslation(field.key)}>{tr("Zapisz")}</Button></div>{/each}</section>
  <section aria-label={tr("Serwer ASR zgodny z OpenAI")}><h2>{tr("Serwer ASR zgodny z OpenAI")}</h2><p>{tr("Po zapisaniu wybierz ten silnik w katalogu modeli. Test sprawdza listę modeli i nie wysyła nagrania. Sam test połączenia nie potwierdza transkrypcji.")}</p>{#if asr}<label for={`${uid}-asr-url`}>{tr("Adres serwera ASR")}</label><Input id={`${uid}-asr-url`} bind:value={asrUrl} disabled={locked}/><label for={`${uid}-asr-model`}>{tr("Model transkrypcji")}</label><Input id={`${uid}-asr-model`} bind:value={asrModel} disabled={locked}/><label for={`${uid}-asr-key`}>{tr("Nowy klucz ASR")}</label><Input id={`${uid}-asr-key`} type="password" autocomplete="off" bind:value={asrKey} placeholder={asr.has_key ? tr("Klucz jest zapisany · puste pole zachowuje go") : tr("Opcjonalny klucz serwera")} disabled={locked}/><div class="actions"><Button variant="outline" disabled={!ready || locked} onclick={() => saveAsr()}>{tr("Zapisz serwer ASR")}</Button><Button variant="outline" disabled={!ready || locked} onclick={() => saveAsr(true)}>{tr("Zapisz i sprawdź połączenie ASR")}</Button><Button variant="ghost" disabled={!ready || locked || !asr.has_key} onclick={() => saveAsr(false, true)}>{tr("Usuń zapisany klucz ASR")}</Button></div>{#if asrConnection}<p role="status" class:failure={!asrConnection.ok}>{connectionMessage(asrConnection, tr)}</p>{/if}{/if}</section>
  {#if failedSections.length}<p class="failure" role="alert">{tr('Nie odczytano: {sections}. Odśwież po uruchomieniu prywatnego silnika.', { sections: failedSections.map(section => tr(section)).join(', ') })}</p>{/if}
  {#if busy}<p role="status">{tr(busy)}…</p>{/if}{#if error}<p class="failure" role="alert">{tr(error)}</p>{/if}{#if notice}<p role="status">{tr(notice)}</p>{/if}
</div>

<style>
  .general-settings{display:flex;flex-direction:column;gap:20px;min-width:0}.general-settings header{display:flex;align-items:flex-start;gap:14px}.general-settings header>div{flex:1}.general-settings h1{font-size:var(--ui-text-22);font-weight:600;letter-spacing:-.4px}.general-settings h2{font-size:var(--ui-text-14);font-weight:600}.general-settings p{font-size:var(--ui-text-12);color:var(--muted);line-height:1.75;margin:6px 0}.general-settings section{display:flex;flex-direction:column;gap:12px;padding:20px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}.general-settings label,.general-settings strong{font-size:var(--ui-text-12)}.option{display:flex;align-items:center;justify-content:space-between;gap:20px}.option>div{flex:1}.option :global([role=switch]){flex-shrink:0}.actions{display:flex;flex-wrap:wrap;gap:8px}.field{display:flex;gap:8px}.field :global(input){flex:1;min-width:0}.skill{display:flex;flex-direction:column;gap:9px;padding:12px 0;border-bottom:1px solid var(--border)}.failure{color:var(--danger)!important}.general-settings section>:global([data-slot=button]){align-self:flex-start}@media(max-width:600px){.general-settings section{padding:16px}.field{flex-wrap:wrap}}
</style>
