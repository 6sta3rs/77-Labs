<script lang="ts">
  function uiOptions<T extends { label: string }>(items: readonly T[]): T[] { return items.map(item => ({ ...item, label: tr(item.label) })); }

  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import Button from '../ui/Button.svelte';
  import Select from '../ui/Select.svelte';
  import Switch from '../ui/Switch.svelte';
  import {
    defaultSpeechSettings, speechCapabilities, speechEngineDefaults, speechNumericFields, speechSettingsErrors, voiceDesignCategories,
    type SpeechConditioning, type SpeechEngineMetadata, type SpeechSettings,
  } from './speech-settings';
  let { value, engine, context = {}, disabled = false, onchange }: {
    value: SpeechSettings; engine?: SpeechEngineMetadata; context?: SpeechConditioning; disabled?: boolean;
    onchange: (value: SpeechSettings) => void;
  } = $props();
  const uid = $props.id();
  const capabilities = $derived(speechCapabilities(engine, { ...context, presetVoice: value.preset_voice }));
  const errors = $derived(speechSettingsErrors(value, engine, context));
  function update<K extends keyof SpeechSettings>(key: K, next: SpeechSettings[K]) { onchange({ ...value, [key]: next }); }
  function number(key: keyof typeof speechEngineDefaults, raw: string) { update(key, raw.trim() === '' ? undefined : Number(raw)); }
  function recipeChoice(key: typeof voiceDesignCategories[number]['key'], next: string) { const recipe = value.design_recipe || { description: '', picks: {} }; update('design_recipe', { ...recipe, picks: { ...recipe.picks, [key]: next } }); }
</script>

<details class="advanced-speech-settings">
  <summary>{tr("Zaawansowane ustawienia mowy")}</summary>
  <p class="advanced-hint">{tr("Dostępność ustawień zależy od wybranego silnika.")}</p>
  {#if capabilities.fields.has('preset_voice')}<Select label={tr("Wbudowany głos silnika")} value={value.preset_voice || ''} onchange={next => update('preset_voice', next)} options={[{value:'',label:tr("Domyślny głos silnika")}, ...(engine?.preset_voices || []).map(voice => ({value:voice,label:voice}))]} {disabled}/><p class="advanced-hint">{tr("To głosy dostarczone z modelem. W tym trybie profil klonu nie steruje barwą nagrania.")}</p>{/if}
  {#if capabilities.fields.has('wav_bits')}<Select label={tr("Format WAV")} value={value.wav_bits} onchange={next => update('wav_bits', next as SpeechSettings['wav_bits'])} options={uiOptions([{value:'16',label:'16-bit PCM'},{value:'24',label:'24-bit PCM'},{value:'32',label:'32-bit float'}])} {disabled}/><p class="advanced-hint">{tr("Rozdzielczość zapisu gotowego pliku, również po połączeniu mówców. Nie zmienia możliwości ani jakości samego modelu.")}</p>{/if}
  {#if capabilities.fields.has('design_recipe')}<div class="advanced-switch"><span>{tr("Zachowaj szkic projektowania głosu")}</span><Switch label={tr("Zachowaj szkic projektowania głosu")} checked={!!value.design_recipe} onchange={checked => update('design_recipe', checked ? {description:'',picks:{}} : undefined)} {disabled}/></div>{#if value.design_recipe}<label class="advanced-field" for={`${uid}-recipe-description`}>{tr("Opis szkicu")}<textarea class="text-input" id={`${uid}-recipe-description`} maxlength="2000" rows="3" value={value.design_recipe.description} {disabled} oninput={event => update('design_recipe', {...value.design_recipe!, description:event.currentTarget.value})}></textarea></label>{#each voiceDesignCategories as category}<label class="advanced-field" for={`${uid}-recipe-${category.key}`}>{tr(category.label)} {tr("· jawny wybór szkicu")}<input class="text-input" id={`${uid}-recipe-${category.key}`} maxlength="64" value={value.design_recipe.picks[category.key] || ''} {disabled} oninput={event => recipeChoice(category.key,event.currentTarget.value)}/></label>{/each}<p class="advanced-hint">{tr("Szkic jest metadanymi do ponownego otwarcia projektu i nagrania. Brzmieniem nadal sterują profil i instrukcja. Backend sam wylicza mapowanie opisu; szkic nie zastępuje tych ustawień.")}</p>{/if}{/if}
  {#if capabilities.fields.has('instruct')}
    <label class="advanced-field" for={`${uid}-instruct`}>{tr("Instrukcja brzmienia")}<textarea id={`${uid}-instruct`} class="text-input" rows="3" value={value.instruct} disabled={disabled} oninput={event => update('instruct', event.currentTarget.value)} placeholder={capabilities.instruction === 'taxonomy' ? 'np. female, middle-aged, low pitch' : tr("Wpisz sposób mówienia obsługiwany przez ten silnik")}></textarea></label>
    <p class="advanced-hint">{capabilities.instruction === 'taxonomy' ? tr("OmniVoice przyjmuje cechy oddzielone przecinkami: barwę, wiek, wysokość, szept, akcent i dialekt. Puste pole zachowuje instrukcję profilu.") : tr("Puste pole zachowuje instrukcję profilu. Silnik interpretuje tekst według własnych możliwości.")}</p>
  {/if}
  {#each speechNumericFields.filter(row => capabilities.fields.has(row.key)) as row (row.key)}
    <label class="advanced-field" for={`${uid}-${row.key}`}>{tr(row.label)}<input id={`${uid}-${row.key}`} class="text-input" type="number" min={row.key === 't_shift' ? 0 : row.min} step="any" value={value[row.key] ?? ''} placeholder={tr("Automatycznie ({value0})", {value0: (speechEngineDefaults[row.key])})} disabled={disabled} oninput={event => number(row.key, event.currentTarget.value)} aria-describedby={`${uid}-${row.key}-hint`}/></label><p id={`${uid}-${row.key}-hint`} class="advanced-hint">{tr(row.description)} {tr("Puste pole: ustawienie silnika.")}</p>
  {/each}
  {#if capabilities.fields.has('denoise')}<div class="advanced-switch"><span>{tr("Tryb odszumiania modelu")}</span><Switch label={tr("Tryb odszumiania modelu")} checked={value.denoise} onchange={checked => update('denoise', checked)} {disabled}/></div>{/if}
  {#if capabilities.fields.has('postprocess_output')}<Select label={tr("Obróbka brzegów nagrania")} value={value.postprocess_output === undefined ? 'auto' : String(value.postprocess_output)} onchange={next => update('postprocess_output', next === 'auto' ? undefined : next === 'true')} options={uiOptions([{value:'auto',label:'Automatycznie — ustawienie silnika'},{value:'true',label:'Włączona'},{value:'false',label:'Wyłączona'}])} {disabled}/><p class="advanced-hint">{tr("Obróbka wyjścia modelu obejmuje ciszę i łagodne brzegi audio. Przy tempie poniżej 1× ustawienie automatyczne zostawia pauzy, bo to one spowalniają mowę.")}</p>{/if}
  <label class="advanced-field" for={`${uid}-chunk`}>{tr("Znaki w jednym fragmencie")}<input id={`${uid}-chunk`} class="text-input" type="number" min="0" step="1" value={value.max_chunk_chars} disabled={disabled} oninput={event => update('max_chunk_chars', event.currentTarget.value === '' ? Number.NaN : Number(event.currentTarget.value))}/></label>
  <p class="advanced-hint">{tr("Tekst jest dzielony przy granicach zdań. 0 wyłącza dzielenie; silnik dostaje cały tekst.")}</p>
  <label class="advanced-field" for={`${uid}-crossfade`}>{tr("Przenikanie fragmentów w ms")}<input id={`${uid}-crossfade`} class="text-input" type="number" min="0" max="1000" step="1" value={value.crossfade_ms} disabled={disabled || value.max_chunk_chars === 0} oninput={event => update('crossfade_ms', event.currentTarget.value === '' ? Number.NaN : Number(event.currentTarget.value))}/></label>
  <div class="advanced-switch"><span>{tr("Stosuj słownik wymowy")}</span><Switch label={tr("Stosuj słownik wymowy")} checked={value.pronounce} onchange={checked => update('pronounce', checked)} {disabled}/></div>
  <p class="advanced-hint">{tr("Wymaga również włączonego słownika w silniku. Wpisane w tekście [[wskazówki wymowy]] są stosowane niezależnie od tego przełącznika.")}</p>
  {#if errors.length}<div class="advanced-error" role="alert">{#each errors as error}<p>{tr(error)}</p>{/each}</div>{/if}
  <Button type="button" variant="ghost" {disabled} onclick={() => onchange(defaultSpeechSettings())}>{tr("Przywróć ustawienia domyślne")}</Button>
</details>

<style>
  .advanced-speech-settings{border-top:1px solid var(--border);padding-top:18px;margin-top:18px;display:block}.advanced-speech-settings>summary{font-size:var(--ui-text-12);font-weight:550;cursor:pointer;line-height:1.6;margin-bottom:14px}.advanced-field{display:flex;flex-direction:column;gap:9px;font-size:var(--ui-text-12);font-weight:500;margin-top:16px}.advanced-field .text-input{width:100%;min-width:0;font-size:var(--ui-text-12)}.advanced-hint{font-size:var(--ui-text-11);line-height:1.7;color:var(--muted);margin:8px 0 14px;overflow-wrap:anywhere}.advanced-switch{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:var(--ui-text-12);line-height:1.6;margin:18px 0}.advanced-error{border:1px solid #ba5555;border-radius:7px;padding:10px 12px;font-size:var(--ui-text-11);line-height:1.7;white-space:pre-wrap}.advanced-error p{margin:0 0 7px}.advanced-speech-settings>:global([data-slot="button"]){margin-top:12px}
</style>
