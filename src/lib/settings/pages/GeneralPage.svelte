<script lang="ts">
  // "Ogólne": interface language, dubbing review and default translation mode (all local preferences).
  import { onDestroy } from 'svelte';
  import { ChevronRight } from '@lucide/svelte';
  import { uiLanguage, createUiTranslator, getUiLanguageError, setUiLanguage, type UiLanguage } from '../../i18n';
  import { generalPreferences, saveGeneralPreferences, type GeneralPreferences, type TranslationQuality } from '../general-settings';
  import type { SettingsSection } from '../settings-catalog';
  import Button from '../../ui/Button.svelte';
  import Select from '../../ui/Select.svelte';
  import Switch from '../../ui/Switch.svelte';
  const tr = $derived(createUiTranslator($uiLanguage));

  let { onnavigate }: { ready?: boolean; onnavigate?: (id: SettingsSection) => void } = $props();

  let lang = $state<string>($uiLanguage), languageError = $state(getUiLanguageError()), prefError = $state('');
  $effect(() => { lang = $uiLanguage; });
  let saved = $state<Record<string, boolean>>({});
  const timers: ReturnType<typeof setTimeout>[] = [];
  onDestroy(() => timers.forEach(clearTimeout));
  // Short green "Zapisano" next to the control that changed.
  function flash(key: string) { saved[key] = true; timers.push(setTimeout(() => saved[key] = false, 1800)); }

  function changeLanguage(next: string) {
    const result = setUiLanguage(next as UiLanguage);
    languageError = result.ok ? '' : result.error;
    if (result.ok) flash('lang'); else lang = result.language;
  }
  function preference(key: string, patch: Partial<GeneralPreferences>) {
    try { saveGeneralPreferences({ ...$generalPreferences, ...patch }); prefError = ''; flash(key); }
    catch { prefError = 'Nie udało się zapisać preferencji. Pamięć lokalna jest niedostępna lub pełna.'; }
  }

  const MODE_HINT: Record<string, string> = {
    fast: 'Szybkie tłumaczenie bez LLM. Dobre do wstępnego przeglądu.',
    autofit: 'LLM skraca lub wydłuża zdania, aby mieściły się w czasie oryginału.',
    cinematic: 'LLM tłumaczy swobodniej, aby dialog brzmiał naturalnie.',
  };
</script>

<div class="p-page">
  <div class="page-heading"><div><h1>{tr('Ogólne')}</h1><p>{tr('Język aplikacji i domyślny sposób pracy z dubbingiem.')}</p></div></div>

  <section class="p-card card">
    <div class="p-section">
      <header><h3>{tr('Praca w studiu')}</h3></header>
      <div class="p-rows">
        <div class="p-row">
          <div class="t"><b>{tr('Język interfejsu')}</b><span>{tr('Dotyczy całej aplikacji. Tekst narracji, głosy i modele zostają bez zmian.')}</span></div>
          <div class="inline"><span class="saved" class:on={saved.lang}>{tr('Zapisano')}</span><Select ariaLabel={tr('Język interfejsu')} value={lang} options={[{ value: 'pl', label: 'Polski' }, { value: 'en', label: 'English' }]} onchange={changeLanguage}/></div>
        </div>
        {#if languageError}<p class="p-field-err" role="alert">{languageError}</p>{/if}
        <div class="p-row">
          <div class="t"><b>{tr('Zatrzymuj dubbing do sprawdzenia')}</b><span>{$generalPreferences.reviewMode ? tr('Po transkrypcji aplikacja czeka na Twoje sprawdzenie. Audio generujesz ręcznie.') : tr('Po transkrypcji przygotowanie od razu tłumaczy tekst. Audio nadal generujesz ręcznie.')}</span></div>
          <div class="inline"><span class="saved" class:on={saved.review}>{tr('Zapisano')}</span><Switch label={tr('Zatrzymuj dubbing do sprawdzenia')} checked={$generalPreferences.reviewMode} onchange={v => preference('review', { reviewMode: v })}/></div>
        </div>
        <div class="p-row">
          <div class="t"><b>{tr('Domyślny tryb tłumaczenia nowych materiałów')}</b><span>{tr(MODE_HINT[$generalPreferences.translationQuality])}</span></div>
          <div class="inline"><span class="saved" class:on={saved.mode}>{tr('Zapisano')}</span><Select ariaLabel={tr('Domyślny tryb tłumaczenia nowych materiałów')} value={$generalPreferences.translationQuality} options={[{ value: 'fast', label: tr('Podstawowy') }, { value: 'autofit', label: tr('Dopasuj do czasu · LLM') }, { value: 'cinematic', label: tr('Naturalny dialog · LLM') }]} onchange={v => preference('mode', { translationQuality: v as TranslationQuality })}/></div>
        </div>
        {#if prefError}<p class="p-field-err" role="alert">{tr(prefError)}</p>{/if}
        <div class="p-row">
          <div class="t"><b>{tr('Dostawcy LLM, tłumacze i klucze')}</b><span>{tr('Konfiguracja usług językowych jest teraz w osobnej sekcji.')}</span></div>
          <Button variant="ghost" onclick={() => onnavigate?.('ai')}>{tr('AI i klucze')}<ChevronRight size={15}/></Button>
        </div>
      </div>
    </div>
  </section>
</div>

<style>
  .card{display:flex;flex-direction:column;gap:18px}
  .inline{display:flex;align-items:center;gap:10px}
  .saved{color:var(--success);font-size:var(--ui-text-12)}
</style>
