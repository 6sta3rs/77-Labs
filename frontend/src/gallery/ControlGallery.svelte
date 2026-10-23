<script lang="ts">
  function uiOptions<T extends { label: string }>(items: readonly T[]): T[] { return items.map(item => ({ ...item, label: tr(item.label) })); }

  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import { onMount, untrack } from 'svelte'
  import { Search, Upload, RotateCcw, ArrowUpRight, SlidersHorizontal } from '@lucide/svelte'
  import Select from '../ui/Select.svelte'
  import Slider from '../ui/Slider.svelte'
  import Switch from '../ui/Switch.svelte'
  import Checkbox from '../ui/Checkbox.svelte'
  import Drawer from '../ui/Drawer.svelte'
  import SpeechEditor from '../tts/SpeechEditor.svelte'
  import Input from '../ui/Input.svelte'
  import Textarea from '../ui/Textarea.svelte'
  import Button from '../ui/Button.svelte'
  import FilePicker from '../ui/FilePicker.svelte'
  import VoiceAvatar from '../ui/VoiceAvatar.svelte'
  import LanguageFlag from '../ui/LanguageFlag.svelte'
  import InspectorSection from '../tts/InspectorSection.svelte'
  import '../tts/tts-inspector.css'
  import ComponentVariants from './ComponentVariants.svelte'
  import AudioExamples from './AudioExamples.svelte'
  import GroupFilterExamples from './GroupFilterExamples.svelte'
  import ModelExamples from './ModelExamples.svelte'
  import { getThemeColorsForAppearance, type ThemeDefinition } from '../themes/t3-palettes'
  import { applyAppearance, defaultAppearance, themes, type AppearanceSettings } from '../settings/appearance'
  import { voices } from '../data'
  import type { SpeechBlock } from '../tts/tags'

  let appearance = $state<AppearanceSettings>({ ...defaultAppearance })
  let name = $state('Nowa narracja'), email = $state(''), password = $state(''), seed = $state<number | null>(42)
  let query = $state(''), text = $state(untrack(() => tr('Cześć! To jest miejsce na twoją następną opowieść.\n\nMożesz edytować ten tekst i zmieniać rozmiar pola.')))
  let language = $state('pl'), selectedEffect = $state('raw'), speed = $state(1), steps = $state(16)
  let stability = $state(44), similarity = $state(75)
  let previewLightTheme = $state<ThemeDefinition>(), previewDarkTheme = $state<ThemeDefinition>()
  let systemDark = $state(false)
  const isDarkPreview = $derived(appearance.mode === 'dark' || (appearance.mode === 'system' && systemDark))
  const activePreviewTheme = $derived(isDarkPreview ? previewDarkTheme : previewLightTheme)
  const previewOptions = $derived.by(() => {
    const options = themes.map(theme => ({value:theme.name,label:theme.label}))
    for (const theme of [previewLightTheme,previewDarkTheme]) if (theme && !options.some(item=>item.value===theme.id)) options.push({value:theme.id,label:theme.label})
    return options
  })
  onMount(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => systemDark = media.matches
    update(); media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  })
  let drawerOpen = $state(false), checkA = $state(true), checkB = $state(false), checkAll = $state(false)
  let enabled = $state(true), reduced = $state(false), fileName = $state(''), resetKey = $state(0)
  const initialBlocks = (): SpeechBlock[] => [{ id: 'gallery-speaker', voiceId: voices[0].id, text: tr('Dobry głos zaczyna się od dobrego tekstu. [pause 250ms] Sprawdź tagi i dopisz swoją historię.') }]
  let blocks = $state<SpeechBlock[]>(initialBlocks())
  const languageOptions = [{ value: 'pl', label: 'Polski' }, { value: 'en', label: 'English' }, { value: 'auto', label: 'Automatycznie', description: 'Rozpoznanie języka na podstawie tekstu.' }]
  const effectOptions = [{ value: 'raw', label: 'Bez efektów' }, { value: 'podcast', label: 'Podcast', description: 'Wyraźna i wyrównana mowa.' }, { value: 'warm', label: 'Ciepłe' }, { value: 'broadcast', label: 'Radiowe' }, { value: 'cinematic', label: 'Filmowe' }, { value: 'bright', label: 'Jasne' }]
  // Sidebar order follows the page; ids match the section anchors below.
  const sections = [
    ['Pole tekstowe', 'Input'], ['Wyszukiwanie', 'search-field'], ['Dłuższy tekst', 'Textarea'], ['Lista wyboru', 'Select'],
    ['Suwak', 'Slider'], ['Przełącznik', 'Switch'], ['Wybór pliku', 'FilePicker'], ['Edytor narracji', 'SpeechEditor'],
    ['Przyciski', 'Button'], ['Podpowiedzi', 'Tooltip'], ['Formularz', 'form'], ['Motywy', 'ThemeCard'], ['Inwentarz', 'moduły'],
    ['Audio i kula głosu', 'Player'], ['Grupy i filtry', 'FilterChip'], ['Wybór modeli', 'ModelPicker'],
    ['Pasek postępu', 'progress'], ['Awatar głosu', 'VoiceAvatar'], ['Flaga języka', 'LanguageFlag'], ['Sekcja zwijana', 'InspectorSection'], ['Pole wyboru', 'Checkbox'], ['Szuflada', 'Drawer'],
  ].map(([label, code], index) => ({ id: `control-${index + 1}`, label, code }))
  let activeSection = $state('intro')
  onMount(() => {
    // Highlight the last section whose top has passed the upper part of the viewport.
    const ids = ['intro', 'appearance', ...sections.map(section => section.id)]
    const spy = () => {
      let current = ids[0]
      for (const id of ids) { const node = document.getElementById(id); if (node && node.getBoundingClientRect().top <= 120) current = id }
      // Short sections at the end can never reach the top; the page bottom selects the last one.
      activeSection = innerHeight + scrollY >= document.documentElement.scrollHeight - 2 ? ids[ids.length - 1] : current
    }
    spy(); addEventListener('scroll', spy, { passive: true })
    return () => removeEventListener('scroll', spy)
  })
  const items = ['Lektor', 'Narrator', 'Anna', 'Michał']
  const inputSizes = ['compact', 'sm', 'default', 'lg'] as const
  const textareaSizes = ['sm', 'default', 'lg'] as const
  const selectSizes = ['default', 'lg'] as const
  const groupedOptions = Array.from({length:24},(_,index)=>({value:`voice-${index}`,label:`Głos ${String(index+1).padStart(2,'0')}`,group:index<12?'Polskie':'Pozostałe',disabled:index===3}))
  let groupedVoice = $state('voice-0')
  $effect(() => {
    const settings = { ...appearance, lightTheme: previewLightTheme?.id || appearance.theme, darkTheme: previewDarkTheme?.id || appearance.theme, reduceMotion: reduced }
    const dark = isDarkPreview
    const previewTheme = dark ? previewDarkTheme : previewLightTheme
    applyAppearance(settings, previewTheme ? getThemeColorsForAppearance(previewTheme, dark ? 'dark' : 'light') || undefined : undefined)
  })
  function reset() {
    appearance = { ...defaultAppearance }; name = 'Nowa narracja'; email = ''; password = ''; seed = 42; query = ''
    text = tr('Cześć! To jest miejsce na twoją następną opowieść.\n\nMożesz edytować ten tekst i zmieniać rozmiar pola.')
    stability = 44; similarity = 75; previewLightTheme = undefined; previewDarkTheme = undefined; groupedVoice = 'voice-0'; language = 'pl'; selectedEffect = 'raw'; speed = 1; steps = 16; enabled = true; reduced = false; fileName = ''; blocks = initialBlocks(); resetKey++
  }
</script>

<svelte:head><title>{tr("Kontrolki — Seventy Seven Labs")}</title><meta name="description" content={tr("Interaktywny podgląd pól i kontrolek Seventy Seven Labs we wszystkich motywach.")} /></svelte:head>

<div class="gallery">
  <aside class="gallery-sidebar" aria-label={tr("Spis komponentów")}>
    <a class="gallery-brand" href="/"><SlidersHorizontal size={16}/><span>{tr("Kontrolki")}</span></a>
    <p class="sidebar-group">{tr("Sekcje")}</p>
    <a class="sidebar-link" class:active={activeSection === 'intro'} href="#intro">{tr("Wprowadzenie")}</a>
    <a class="sidebar-link" class:active={activeSection === 'appearance'} href="#appearance">{tr("Wygląd podglądu")}</a>
    <p class="sidebar-group">{tr("Komponenty")}</p>
    {#each sections as section}<a class="sidebar-link" class:active={activeSection === section.id} href={`#${section.id}`} aria-current={activeSection === section.id ? 'location' : undefined}>{tr(section.label)}<small>{tr(section.code)}</small></a>{/each}
  </aside>
  <div class="gallery-page">
  <header class="gallery-header"><span class="gallery-crumb">{tr("Seventy Seven Labs")} <span class="slash">/</span> {tr("Kontrolki")}</span><div class="header-actions"><Button variant="ghost" href="/">{tr("Otwórz Studio")} <ArrowUpRight size={14}/></Button><Button variant="outline" size="sm" onclick={reset}><RotateCcw size={13}/>{tr("Resetuj podgląd")}</Button></div></header>
  <main class="gallery-main">
    <div class="intro" id="intro"><span class="eyebrow">{tr("BIBLIOTEKA INTERFEJSU")}</span><h1>{tr("Wszystkie pola.")}<br/>{tr("Jedno miejsce do sprawdzania.")}</h1><p>{tr("Pisz, wybieraj i przesuwaj. To te same kontrolki, których używasz w Studio.")}</p></div>
    <div class="gallery-settings" id="appearance"><div class="settings-heading"><strong>{tr("Wygląd podglądu")}</strong><span>{tr("Zmiany zostają tylko na tej stronie.")}</span></div><div class="theme-control"><Select label={tr("Motyw")} value={activePreviewTheme?.id || appearance.theme} options={uiOptions(previewOptions)} onchange={theme => { previewLightTheme = undefined; previewDarkTheme = undefined; appearance = { ...appearance, theme } }}/></div><div class="theme-control"><Select label={tr("Tryb")} value={appearance.mode} options={uiOptions([{value:'dark',label:'Ciemny'},{value:'light',label:'Jasny'},{value:'system',label:'Systemowy'}])} onchange={mode => appearance = { ...appearance, mode: mode as AppearanceSettings['mode'] }}/></div></div>
    {#key resetKey}<div class="gallery-grid">
      <section class="control-card" id="control-1"><div class="card-heading"><span class="section-number">01</span><h2>{tr("Pola tekstowe")}</h2><span class="type-label">{tr("input")}</span></div><div class="field-grid">
        <label class="demo-field"><span>{tr("Nazwa projektu")} <small>{tr("Edytowalne")}</small></span><Input bind:value={name} placeholder={tr("Wpisz nazwę projektu")}/></label>
        <label class="demo-field"><span>{tr("Puste pole")} <small>{tr("Placeholder")}</small></span><Input placeholder={tr("Nadaj tytuł nagraniu")}/></label>
        <label class="demo-field"><span>{tr("Adres e-mail")}</span><Input type="email" bind:value={email} placeholder={tr("twoj@email.pl")}/></label>
        <label class="demo-field"><span>{tr("Hasło")}</span><Input type="password" bind:value={password} placeholder={tr("Wpisz przykładowe hasło")} autocomplete="new-password"/></label>
        <label class="demo-field"><span>{tr("Ziarno losowości")} <small>{tr("Liczba")}</small></span><Input type="number" min="0" step="1" bind:value={seed}/></label>
        <label class="demo-field"><span>{tr("Tylko do odczytu")}</span><Input value="OmniVoice · WAV 24 kHz" readonly/></label>
        <label class="demo-field"><span>{tr("Pole wyłączone")}</span><Input value="Niedostępne podczas generowania" disabled/></label>
        <label class="demo-field"><span>{tr("Pole z błędem")}</span><Input value="" placeholder={tr("Nazwa projektu")} aria-invalid="true" aria-describedby="name-error"/><small id="name-error" class="field-error">{tr("Podaj nazwę projektu.")}</small></label>
      </div><div class="size-variants">{#each inputSizes as size}<label class="demo-field"><span>{tr("Rozmiar")} {size}</span><Input {size} placeholder={tr("Pole {value0}", {value0: (size)})}/></label>{/each}<label class="demo-field"><span>{tr("Czcionka mono")}</span><Input font="mono" value="voice_001.wav"/></label><label class="demo-field"><span>{tr("Bez obramowania")}</span><Input unstyled value="Tekst bez ramki"/></label></div><p class="card-hint">{tr("Kliknij pole lub przejdź do niego Tabem, aby zobaczyć focus.")}</p></section>

      <section class="control-card" id="control-2"><div class="card-heading"><span class="section-number">02</span><h2>{tr("Wyszukiwanie")}</h2><span class="type-label">{tr("search")}</span></div><label class="demo-field"><span>{tr("Szukaj głosu")}</span><span class="search-field"><Search size={15}/><input type="search" placeholder={tr("Wpisz imię…")} aria-label={tr("Szukaj głosu w podglądzie")} bind:value={query}/><kbd>/</kbd></span></label><div class="demo-results" aria-live="polite">{#each items.filter(item => item.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl'))) as item}<div><span class="result-avatar">{item[0]}</span><span>{item}</span><small>{tr("Głos przykładowy")}</small></div>{:else}<p>{tr("Brak głosów pasujących do „")}{query}”.</p>{/each}</div></section>

      <section class="control-card" id="control-3"><div class="card-heading"><span class="section-number">03</span><h2>{tr("Dłuższy tekst")}</h2><span class="type-label">{tr("textarea")}</span></div><label class="demo-field"><span>{tr("Treść transkrypcji")} <small>{text.length} {tr("znaków")}</small></span><Textarea class="gallery-textarea" bind:value={text} rows={5}/></label><label class="demo-field"><span>{tr("Wyłączone pole")}</span><Textarea disabled rows={2} value="Nagranie jest przetwarzane…"/></label><div class="stack-variants">{#each textareaSizes as size}<label class="demo-field"><span>{tr("Rozmiar")} {size}</span><Textarea {size} placeholder={tr("Tekst — {value0}", {value0: (size)})}/></label>{/each}</div></section>

      <section class="control-card" id="control-4"><div class="card-heading"><span class="section-number">04</span><h2>{tr("Listy wyboru")}</h2><span class="type-label">{tr("select")}</span></div><Select language label={tr("Język")} value={language} options={uiOptions(languageOptions)} onchange={v => language = v}/><Select label={tr("Efekty audio")} value={selectedEffect} options={uiOptions(effectOptions)} onchange={v => selectedEffect = v}/><Select language label={tr("Lista wyłączona")} value="pl" options={uiOptions(languageOptions)} disabled onchange={() => {}}/><div class="stack-variants">{#each selectSizes as size}<Select language label={tr("Rozmiar {value0}", {value0: (size)})} {size} value={language} options={uiOptions(languageOptions)} onchange={v=>language=v}/>{/each}<Select language label={tr("Wariant ghost")} variant="ghost" value={language} options={uiOptions(languageOptions)} onchange={v=>language=v}/><Select label={tr("Grupy i przewijanie")} options={uiOptions(groupedOptions)} bind:value={groupedVoice}/><Select language label={tr("Otwieranie pod polem")} alignItemWithTrigger={false} value={language} options={uiOptions(languageOptions)} onchange={v=>language=v}/></div><p class="card-hint">{tr("Strzałki i Home/End zmieniają aktywną opcję. Enter wybiera, Escape zamyka. Możesz też zacząć wpisywać nazwę.")}</p></section>

      <section class="control-card" id="control-5"><div class="card-heading"><span class="section-number">05</span><h2>{tr("Suwaki")}</h2><span class="type-label">{tr("range")}</span></div><Slider label={tr("Stabilność")} collapsible value={stability} min={0} max={100} valueLabel={`${stability}%`} startLabel={tr("Kreatywny")} endLabel={tr("Solidny")} onchange={v => stability = v}/><Slider valueDisplay="tooltip" label={tr("Podobieństwo")} collapsible defaultOpen={false} value={similarity} valueLabel={`${similarity}%`} startLabel={tr("Swobodnie")} endLabel={tr("Dokładnie")} onchange={v=>similarity=v}/><Slider label={tr("Szybkość")} value={speed} min={.5} max={2} step={.05} valueLabel={`${speed.toFixed(2)}×`} startLabel={tr("Wolniej")} endLabel={tr("Szybciej")} onchange={v => speed = v}/><Slider label={tr("Kroki generowania")} valueDisplay="right" size="compact" value={steps} min={8} max={64} step={8} onchange={v => steps = v}/><Slider label={tr("Suwak wyłączony")} value={40} disabled onchange={() => {}}/><p class="card-hint">{tr("Wartość po prawej i płynny dymek nad uchwytem. Kroki generowania: wariant tylko z wartością po prawej. Chevron rozwija i zwija suwak.")}</p></section>

      <section class="control-card" id="control-6"><div class="card-heading"><span class="section-number">06</span><h2>{tr("Przełączniki")}</h2><span class="type-label">{tr("switch")}</span></div><div class="switch-row"><div><strong>{tr("Przykładowa funkcja")}</strong><span>{enabled ? tr("Włączona") : tr("Wyłączona")}</span></div><Switch label={tr("Przykładowa funkcja")} checked={enabled} onchange={v => enabled = v}/></div><div class="switch-row"><div><strong>{tr("Ogranicz animacje")}</strong><span>{tr("Wpływa na kontrolki w podglądzie.")}</span></div><Switch label={tr("Ogranicz animacje")} checked={reduced} onchange={v => reduced = v}/></div><div class="switch-row"><div><strong>{tr("Wyłączony przełącznik")}</strong><span>{tr("Stan: wyłączony")}</span></div><Switch label={tr("Wyłączony przełącznik")} checked={false} disabled onchange={() => {}}/></div><div class="switch-row"><div><strong>{tr("Zablokowana funkcja")}</strong><span>{tr("Stan: włączony")}</span></div><Switch label={tr("Zablokowana funkcja")} checked={true} disabled onchange={() => {}}/></div><div class="switch-row"><div><strong>{tr("Kompaktowy")}</strong><span>{tr("Rozmiar sm")}</span></div><Switch size="sm" label={tr("Przełącznik kompaktowy")} checked={enabled} onchange={v => enabled = v}/></div><div class="switch-row"><div><strong>{tr("Duży przełącznik")}</strong><span>{tr("Rozmiar lg")}</span></div><Switch size="lg" label={tr("Duży przełącznik")} checked={enabled} onchange={v => enabled = v}/></div></section>

      <section class="control-card" id="control-7"><div class="card-heading"><span class="section-number">07</span><h2>{tr("Wybór pliku")}</h2><span class="type-label">{tr("file")}</span></div>{#key resetKey}<label class="upload-zone gallery-upload"><Upload size={25}/><strong>{fileName || tr('Wybierz nagranie')}</strong><span>{tr("WAV, MP3, M4A, OGG lub FLAC")}</span><input type="file" aria-label={tr("Wybierz przykładowe nagranie")} accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac" onchange={e => fileName = e.currentTarget.files?.[0]?.name || ''}/></label>{/key}<label class="upload-zone compact vs-disabled"><Upload size={18}/><strong>{tr("Upload wyłączony")}</strong><span>{tr("Kontrolka nie przyjmuje pliku.")}</span><input type="file" disabled aria-label={tr("Wyłączony wybór pliku")}/></label><div class="gallery-file-pickers"><FilePicker label={tr("Wybierz plik")} accept=".json,application/json" onchange={() => {}}/><FilePicker label={tr("Wybierz plik")} disabled onchange={() => {}}/></div><p class="card-hint">{tr("FilePicker zastępuje natywne „Wybierz plik / Nie wybrano pliku”. Podgląd pokazuje nazwę wybranego pliku. Nie wysyła go ani nie uruchamia przetwarzania.")}</p></section>

      <section class="control-card wide" id="control-8"><div class="card-heading"><span class="section-number">08</span><h2>{tr("Edytor narracji")}</h2><span class="type-label">{tr("textarea + tagi")}</span></div><div class="editor-demo"><SpeechEditor {blocks} {voices} onblockschange={v => blocks = v} onchoosevoice={id => blocks = blocks.map(block => block.id === id ? { ...block, voiceId: block.voiceId === voices[0].id ? voices[1].id : voices[0].id } : block)}/></div><p class="card-hint">{tr("Działający edytor: tagi audio, wielu mówców, zmiana przykładowego głosu i cofanie zmian.")}</p></section>
      <ComponentVariants lightSelectedId={previewLightTheme?.id || appearance.theme} darkSelectedId={previewDarkTheme?.id || appearance.theme} onpreview={(theme, mode) => {
        if ((!mode || mode === 'light') && getThemeColorsForAppearance(theme, 'light')) previewLightTheme = theme
        if ((!mode || mode === 'dark') && getThemeColorsForAppearance(theme, 'dark')) previewDarkTheme = theme
      }}/>
      <AudioExamples/><GroupFilterExamples/><ModelExamples/>
      <section class="control-card" id="control-17"><div class="card-heading"><span class="section-number">17</span><h2>{tr("Pasek postępu")}</h2><span class="type-label">{tr("progress")}</span></div><div class="progress-demo"><span>{tr("Pobieranie modelu · 42%")}</span><progress max="100" value="42" aria-label={tr("Przykładowy postęp 42%")}></progress><span>{tr("Ładowanie modelu · czas nieznany")}</span><progress aria-label={tr("Przykładowy postęp nieokreślony")}></progress></div><p class="card-hint">{tr("Natywny <progress> ma jeden styl w całej aplikacji. Bez wartości pokazuje animację nieokreśloną; przy ograniczonym ruchu stoi.")}</p></section>
      <section class="control-card" id="control-18"><div class="card-heading"><span class="section-number">18</span><h2>{tr("Awatar głosu")}</h2><span class="type-label">VoiceAvatar</span></div><div class="avatar-demo">{#each [16, 24, 32, 48] as size}<VoiceAvatar voiceId={voices[0].id} name={voices[0].name} {size}/>{/each}<VoiceAvatar voiceId={voices[1].id} name={voices[1].name} size={48}/></div><p class="card-hint">{tr("Bez portretu awatar pokazuje kulę głosu wyliczoną z identyfikatora — ten sam głos ma zawsze ten sam kolor.")}</p></section>
      <section class="control-card" id="control-19"><div class="card-heading"><span class="section-number">19</span><h2>{tr("Flaga języka")}</h2><span class="type-label">LanguageFlag</span></div><div class="flag-demo">{#each ['Polski', 'English', 'Deutsch', 'Español', 'Nieznany'] as language}<span><LanguageFlag {language}/>{language}</span>{/each}</div><p class="card-hint">{tr("Nieznany język pokazuje ikonę globu zamiast flagi.")}</p></section>
      <section class="control-card" id="control-20"><div class="card-heading"><span class="section-number">20</span><h2>{tr("Sekcja zwijana")}</h2><span class="type-label">InspectorSection</span></div><div class="disclosure-demo"><InspectorSection label={tr("Język")} summary={languageOptions.find(option => option.value === language)?.label || language}><Select language ariaLabel={tr("Język generowania")} value={language} options={uiOptions(languageOptions)} onchange={v => language = v}/></InspectorSection><InspectorSection label={tr("Efekty audio")} summary={effectOptions.find(option => option.value === selectedEffect)?.label || selectedEffect} defaultOpen><Select ariaLabel={tr("Preset efektów audio")} value={selectedEffect} options={uiOptions(effectOptions)} onchange={v => selectedEffect = v}/></InspectorSection><Slider label={tr("Stabilność")} collapsible value={stability} min={0} max={100} valueLabel={`${stability}%`} startLabel={tr("Kreatywny")} endLabel={tr("Solidny")} onchange={v => stability = v}/></div><p class="card-hint">{tr("Panel ustawień Studio. Sekcja z listą rozwija się tą samą animacją wysokości co zwijany suwak; zwinięta pokazuje wybraną wartość obok strzałki.")}</p></section>
      <section class="control-card" id="control-21"><div class="card-heading"><span class="section-number">21</span><h2>{tr("Pola wyboru")}</h2><span class="type-label">Checkbox</span></div><div class="checkbox-demo">
        <Checkbox bind:checked={checkA}>{tr("Zaznaczone")}</Checkbox><Checkbox bind:checked={checkB}>{tr("Niezaznaczone")}</Checkbox>
        <Checkbox bind:checked={checkAll} indeterminate={checkA !== checkB}>{tr("Nieokreślone (gdy powyższe się różnią)")}</Checkbox>
        <Checkbox checked disabled>{tr("Wyłączone, zaznaczone")}</Checkbox><Checkbox disabled>{tr("Wyłączone")}</Checkbox><Checkbox aria-invalid="true">{tr("Z błędem")}</Checkbox>
      </div></section>
      <section class="control-card" id="control-22"><div class="card-heading"><span class="section-number">22</span><h2>{tr("Szuflada")}</h2><span class="type-label">Drawer</span></div><div class="drawer-demo">
        <Button variant="outline" onclick={() => drawerOpen = true}>{tr("Otwórz szufladę")}</Button>
        <small>{tr("Zamyka ją Esc, kliknięcie w tło albo przeciągnięcie uchwytu w dół.")}</small>
      </div><Drawer bind:open={drawerOpen} label={tr("Przykładowa szuflada")}><p>{tr("Treść szuflady. Na małym ekranie tak wysuwają się panele boczne.")}</p><Button variant="default" onclick={() => drawerOpen = false}>{tr("Zamknij")}</Button></Drawer></section>
    </div>{/key}
    <footer class="gallery-footer"><span>{tr("Seventy Seven Labs · Wspólne kontrolki aplikacji")}</span><span>{tr("Tab — następne pole")} <span class="dot">·</span> {tr("Shift + Tab — poprzednie")}</span></footer>
  </main>
  </div>
</div>

<style>
  :global(html[data-page=controls]),:global(html[data-page=controls] body),:global(html[data-page=controls] #app){height:auto;min-height:0;overflow:visible}
  .gallery{font-family:var(--font-ui);color:var(--foreground);background:var(--background);font-size:var(--ui-font-size,13px)}
  .gallery-header{display:flex;align-items:center;justify-content:space-between;gap:16px;max-width:1120px;margin:auto;padding:22px 28px;border-bottom:1px solid var(--border)}.gallery-brand{display:flex;gap:10px;align-items:center;font-size:var(--ui-text-13);font-weight:550}.gallery-brand :global(svg){color:var(--muted)}.slash{padding:0 9px;color:var(--muted);font-weight:400}.header-actions{display:flex;gap:9px;align-items:center}
  .gallery-main{max-width:1120px;margin:0 auto;padding:48px 28px 24px}.eyebrow{font-size:var(--ui-text-10);letter-spacing:1.8px;color:var(--muted);font-weight:600}.intro h1{font-size:clamp(27px,4.5vw,38px);font-weight:550;line-height:1.18;letter-spacing:-1.3px;margin:15px 0}.intro p{font-size:var(--ui-text-13);line-height:1.8;color:var(--muted);margin:0}
  .gallery-settings{display:flex;gap:20px;align-items:center;margin:29px 0 22px;padding:19px 21px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}.settings-heading{flex:1;min-width:160px}.settings-heading strong{display:block;font-weight:500;font-size:var(--ui-text-12)}.settings-heading span{display:block;color:var(--muted);font-size:var(--ui-text-11);margin-top:6px}.theme-control{width:180px;min-width:0}
  .gallery-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}.control-card{min-width:0;border:1px solid var(--border);border-radius:12px;padding:23px;background:var(--background);scroll-margin-top:18px}.control-card:first-child,.wide{grid-column:1/-1}.card-heading{display:flex;align-items:center;gap:10px;margin-bottom:23px}.section-number{font-variant-numeric:tabular-nums;font-size:var(--ui-text-10);color:var(--muted);opacity:.65}.card-heading h2{font-size:var(--ui-text-14);font-weight:550;letter-spacing:-.2px}.type-label{margin-left:auto;color:var(--muted);font-size:var(--ui-text-10);font-family:ui-monospace,monospace}.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px 24px}.demo-field{display:block;min-width:0}.demo-field>span:first-child{display:flex;justify-content:space-between;gap:10px;font-size:var(--ui-text-12);margin-bottom:8px}.demo-field small{font-size:var(--ui-text-10);color:var(--muted);font-weight:400}.demo-field .field-error{display:block;color:var(--danger);margin-top:6px}.control-card>.demo-field+.demo-field{margin-top:19px}.card-hint{font-size:var(--ui-text-11);color:var(--muted);line-height:1.8;margin:18px 0 0}:global(.gallery-textarea){min-height:133px!important}.control-card > :global(.vs-select+.vs-select){margin-top:20px}.control-card :global(.vs-slider+.vs-slider){margin-top:22px}
  .demo-results{display:grid;gap:2px;margin-top:15px}.demo-results>div{display:flex;align-items:center;gap:10px;padding:8px 0;font-size:var(--ui-text-12)}.result-avatar{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;color:var(--muted);background:var(--surface);border:1px solid var(--border);font-size:var(--ui-text-10)}.demo-results small{margin-left:auto;color:var(--muted);font-size:var(--ui-text-10)}.demo-results>p{font-size:var(--ui-text-12);color:var(--muted);padding:15px 0;line-height:1.8}.search-field{display:flex;align-items:center}.search-field input{flex:1;width:100%}.search-field kbd{font-size:var(--ui-text-10)}
  .switch-row{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:13px 0}.switch-row+.switch-row{border-top:1px solid var(--border)}.switch-row strong{display:block;font-size:var(--ui-text-12);font-weight:500}.switch-row>div>span{display:block;font-size:var(--ui-text-11);color:var(--muted);margin-top:5px}.gallery-upload{padding:30px 18px}.editor-demo{border:1px solid var(--border);border-radius:9px;padding:23px}.gallery-footer{display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;color:var(--muted);font-size:var(--ui-text-10);line-height:1.8;padding:25px 0 0}.dot{padding:0 7px}
  @media(max-width:700px){.gallery-header{padding:16px}.gallery-main{padding:30px 16px 22px}.header-actions>:global(a[data-slot="button"]){display:none}.gallery-grid{grid-template-columns:1fr}.field-grid{grid-template-columns:1fr}.gallery-settings{flex-wrap:wrap;gap:16px;padding:16px}.settings-heading{flex-basis:100%}.theme-control{flex:1;width:auto}.control-card{padding:18px}.intro h1{letter-spacing:-.8px}.gallery-brand{font-size:var(--ui-text-12)}.slash{padding:0 4px}.editor-demo{padding:16px}}
.size-variants{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px 24px;margin-top:24px;padding-top:22px;border-top:1px solid var(--border)}.stack-variants{display:grid;gap:18px;margin-top:22px;padding-top:22px;border-top:1px solid var(--border)}@media(max-width:700px){.size-variants{grid-template-columns:1fr}}

  .gallery-file-pickers{display:grid;gap:10px;margin-top:14px}
  .checkbox-demo,.drawer-demo{display:grid;gap:12px;justify-items:start;font-size:var(--ui-text-12)}.drawer-demo small{color:var(--muted)}
  .disclosure-demo{display:grid;gap:18px;max-width:340px}

  /* Docs layout: sticky component list on the left, one column of demos on the right. */
  .gallery{display:grid;grid-template-columns:232px minmax(0,1fr);min-height:100vh}
  .gallery-sidebar{position:sticky;top:0;height:100vh;overflow-y:auto;display:flex;flex-direction:column;gap:2px;padding:24px 14px 32px;border-right:1px solid var(--border)}
  .gallery-sidebar .gallery-brand{margin:0 8px 18px}
  .sidebar-group{margin:18px 10px 6px;font-size:var(--ui-text-11);color:var(--muted);font-weight:500}
  .sidebar-link{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:6px 10px;border-radius:8px;font-size:var(--ui-text-13);font-weight:500;color:var(--foreground);text-decoration:none;transition:background-color 150ms ease}
  .sidebar-link small{font-size:var(--ui-text-10);color:var(--muted);font-family:var(--font-mono,monospace);opacity:0;transition:opacity 150ms ease}
  .sidebar-link:hover{background:var(--surface-hover)}.sidebar-link:hover small,.sidebar-link.active small{opacity:1}
  .sidebar-link.active{background:var(--surface-hover);box-shadow:inset 0 0 0 1px var(--border)}
  .gallery-page{min-width:0}
  .gallery-header{max-width:820px}.gallery-crumb{font-size:var(--ui-text-12);color:var(--muted)}
  .gallery-main{max-width:820px}
  .gallery-grid{grid-template-columns:minmax(0,1fr);gap:28px}
  .gallery-grid>:global(section){scroll-margin-top:24px}
  .intro,.gallery-settings{scroll-margin-top:24px}
  .progress-demo{display:grid;gap:10px;font-size:var(--ui-text-12);color:var(--muted)}.progress-demo progress{margin-bottom:8px}
  .avatar-demo,.flag-demo{display:flex;align-items:center;flex-wrap:wrap;gap:18px}.flag-demo span{display:inline-flex;align-items:center;gap:8px;font-size:var(--ui-text-12)}
  @media(max-width:900px){.gallery{grid-template-columns:1fr}.gallery-sidebar{position:sticky;top:0;z-index:5;height:auto;flex-direction:row;overflow-x:auto;padding:10px 12px;border-right:0;border-bottom:1px solid var(--border);background:var(--background)}.gallery-sidebar .gallery-brand,.sidebar-group{display:none}.sidebar-link{flex:none}.sidebar-link small{display:none}}
</style>
