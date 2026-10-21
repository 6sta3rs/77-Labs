<script lang="ts">
  function uiOptions<T extends { label: string }>(items: readonly T[]): T[] { return items.map(item => ({ ...item, label: tr(item.label) })); }

  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import { Plus, RotateCcw, Paintbrush, Download, LoaderCircle, Info } from '@lucide/svelte'
  import Button from '../ui/Button.svelte'
  import Tooltip from '../ui/Tooltip.svelte'
  import Input from '../ui/Input.svelte'
  import Select from '../ui/Select.svelte'
  import { engineLanguageOptions } from '../voices/voice-picker'
  import Switch from '../ui/Switch.svelte'
  import ThemeCard from '../ui/ThemeCard.svelte'
  import ThemeDialog from '../settings/ThemeDialog.svelte'
  import { builtInThemes, duplicateTheme, serializeTheme } from '../themes/library'
  import { getThemeColorsForAppearance, type ThemeDefinition, type ThemeAppearance } from '../themes/t3-palettes'

  let { onpreview, lightSelectedId = 'studio', darkSelectedId = 'studio' }: {
    onpreview: (theme: ThemeDefinition, mode?: ThemeAppearance) => void
    lightSelectedId?: string; darkSelectedId?: string
  } = $props()
  let feedback = $state('Wybierz wariant przycisku, żeby sprawdzić działanie.')
  let localThemes = $state<ThemeDefinition[]>([...builtInThemes])
  let dialog = $state<{ kind: 'create' | 'edit' | 'duplicate' | 'import'; seed: ThemeDefinition }>()
  let formName = $state('Przykładowy projekt'), formLanguage = $state('pl'), formConsent = $state(true)
  let formResult = $state('Formularz nie został jeszcze wysłany.')
  const languages = engineLanguageOptions()
  const variants = ['default','secondary','outline','ghost','destructive'] as const
  const sizes = ['xs','compact','sm','default'] as const
  const inventory = [
    ['Input', 'Pola tekstowe, email, hasło i liczby; 4 rozmiary, mono, bez ramki, błąd, readonly, disabled.'],
    ['Textarea', '3 rozmiary, dopasowanie do treści, limit wysokości, błąd i disabled.'],
    ['Select', '5 rozmiarów, default/ghost, grupy, wyłączone opcje, klawiatura i formularze.'],
    ['Slider', 'Zwykły lub zwijany, default/compact; dymek hover/focus/drag, opisy krańców.'],
    ['Switch', 'default/sm, włączony/wyłączony, disabled i formularze.'],
    ['Button', '5 wariantów i 6 rozmiarów; ikona, disabled i stan oczekiwania.'],
    ['Tooltip', 'Podpowiedź nad lub pod elementem; hover/focus, Escape i kolizje ekranu.'],
    ['ThemeCard', 'Osobne warianty jasny/ciemny, wybór pary, dostępne akcje i podpowiedzi.'],
    ['ThemeDialog', 'Tworzenie, edycja, kopia, import JSON i edycja kolorów w modalu.'],
    ['SpeechEditor', 'Tekst, mówcy, wybór głosu, tagi, undo/redo i blokada podczas pracy.'],
    ['GenerationCard / Player', 'Karta audio, fala, odtwarzanie, czas, przewijanie i pobieranie.'],
    ['Appearance', 'Tryb systemowy/jasny/ciemny, biblioteka motywów i ustawienia interfejsu.'],
    ['AISettings', 'Połączenie AI, wybór modelu, ustawienia i rzeczywisty test połączenia.'],
    ['EngineCatalog', 'Katalog i stan lokalnych silników oraz wag modeli.'],
    ['ProductionWorkspace', 'Ekrany dubbingu i audiobooków, pliki, segmenty i postęp.'],
    ['StudioTools / VoiceManager', 'Narzędzia audio i zarządzanie głosami.'],
    ['App / NavigationSidebar / SettingsShell / DeviceStatus', 'Składanie aplikacji, nawigacja, układ ustawień i stan urządzenia.'],
    ['Upload / wyszukiwarka / modal / komunikat', 'Złożenia natywnych pól i kontrolek używane w ekranach aplikacji.'],
    ['ControlGallery / ComponentVariants', 'Ten katalog i interaktywne warianty; dane tylko w pamięci.'],
    ['AudioExamples', 'Próbka mowy, ton z ciszą, import pliku i rzeczywista reakcja kuli na audio.'],
    ['ButtonGroup / FilterChip / GroupFilterExamples', 'Połączone przyciski, wybór pojedynczy/wielokrotny i filtrowanie.'],
    ['ModelTrigger / ModelPicker / ModelExamples', 'Panel i modal z wyszukiwaniem, filtrami oraz stanem dostępności silników.'],
    ['ActionBar', 'Wspólny pasek tagowania i głównej akcji o równej wysokości.'],
  ]
  function select(theme: ThemeDefinition, mode?: ThemeAppearance) {
    onpreview(theme, mode)
  }
  function edit(kind: 'create' | 'edit' | 'duplicate' | 'import', theme = localThemes[0]) {
    dialog = {kind, seed: kind === 'edit' ? structuredClone($state.snapshot(theme)) : {...duplicateTheme(theme),label:kind === 'duplicate' ? `${theme.label} kopia` : 'Nowy motyw'}}
  }
  function save(theme: ThemeDefinition) {
    localThemes = [...localThemes.filter(item => item.id !== theme.id), theme]
    dialog = undefined; select(theme); feedback = `Zapisano motyw „${theme.label}” wyłącznie w podglądzie.`
  }
  function download(theme: ThemeDefinition) {
    const blob = new Blob([serializeTheme(duplicateTheme(theme))],{type:'application/json'})
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = 'motyw-podglad.json'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
</script>

<section class="variant-card wide" id="control-9">
  <div class="variant-heading"><span>09</span><h2>{tr("Przyciski")}</h2><code>{tr("Button")}</code></div>
  <p>{tr("Warianty kontrolek Seventy Seven Labs, dopasowane do bieżącej palety.")}</p>
  <div class="button-samples">{#each variants as variant}<div><small>{variant}</small><Button {variant} onclick={()=>feedback=tr("Kliknięto wariant: {value0}.", {value0: (variant)})}><Plus/>{tr("Dodaj element")}</Button></div>{/each}</div>
  <div class="button-samples">{#each sizes as size}<div><small>{size}</small><Button variant="outline" {size} onclick={()=>feedback=tr("Kliknięto rozmiar: {value0}.", {value0: (size)})}>{tr("Przycisk")}</Button></div>{/each}<div><small>{tr("icon / tooltip")}</small><Tooltip content={tr("Przywróć przykładowy komunikat")}><Button variant="ghost" size="icon" aria-label={tr("Przywróć komunikat")} onclick={()=>feedback=tr("Przywrócono przykładowy komunikat.")}><RotateCcw/></Button></Tooltip></div><div><small>{tr("icon-xs")}</small><Button variant="outline" size="icon-xs" aria-label={tr("Przykładowe pobieranie")} onclick={()=>feedback=tr("Przycisk pobierania jest aktywny.")}><Download/></Button></div></div>
  <div class="button-samples"><Button disabled>{tr("Wyłączony")}</Button><Button variant="outline" disabled aria-busy="true"><LoaderCircle class="spin"/>{tr("Wczytywanie…")}</Button></div>
  <p class="demo-status" role="status">{tr(feedback)}</p>
</section>

<section class="variant-card" id="control-10">
  <div class="variant-heading"><span>10</span><h2>{tr("Podpowiedzi")}</h2><code>{tr("Tooltip")}</code></div>
  <p>{tr("Najedź kursorem lub przejdź Tabem. Escape zamyka dymek. Kliknięcie wykonuje działanie.")}</p>
  <div class="tooltip-samples"><Tooltip content={tr("Podpowiedź nad elementem")}><Button variant="outline" onclick={()=>feedback=tr("Kliknięto przycisk z podpowiedzią.")}><Info/>{tr("Nad elementem")}</Button></Tooltip><Tooltip content={tr("Podpowiedź pod elementem")} side="bottom"><Button variant="outline" onclick={()=>feedback=tr("Kliknięto przycisk z dolną podpowiedzią.")}>{tr("Pod elementem")}</Button></Tooltip></div>
  <p>{tr("Dymek jest częścią interfejsu. Nie jest powiadomieniem ani komunikatem o wykonaniu operacji.")}</p>
</section>

<section class="variant-card" id="control-11">
  <div class="variant-heading"><span>11</span><h2>{tr("Formularz")}</h2><code>{tr("name / reset")}</code></div>
  <form data-demo-form onsubmit={(event)=>{event.preventDefault();formResult=JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))}}>
    <label for="demo-project-name">{tr("Nazwa projektu")}</label><Input id="demo-project-name" name="project" required bind:value={formName}/>
    <Select language label={tr("Język formularza")} name="language" required bind:value={formLanguage} options={uiOptions(languages)}/>
    <div class="form-switch"><span>{tr("Zapisz ustawienie")}</span><Switch name="enabled" label={tr("Ustawienie formularza")} bind:checked={formConsent}/></div>
    <div class="button-samples"><Button type="submit">{tr("Sprawdź dane")}</Button><Button variant="outline" type="reset" onclick={()=>formResult=tr("Przywrócono wartości początkowe formularza.")}>{tr("Resetuj formularz")}</Button></div>
    <output class="form-output">{formResult}</output>
  </form>
</section>

<section class="variant-card wide" id="control-12">
  <div class="variant-heading"><span>12</span><h2>{tr("Karty i edytor motywów")}</h2><code>{tr("ThemeCard / ThemeDialog")}</code></div>
  <div class="theme-demo-header"><p>{tr("Te same karty i przyciski co w ustawieniach. Najedź na kulkę, by sprawdzić podpowiedź.")}</p><div class="button-samples"><Button variant="outline" size="xs" onclick={()=>edit('create')}><Paintbrush/>{tr("Utwórz motyw")}</Button><Button variant="outline" size="xs" onclick={()=>edit('import')}><Plus/>{tr("Dodaj motyw")}</Button></div></div>
  <div class="theme-demo-grid">{#each localThemes as theme (theme.id)}<ThemeCard {theme} lightSelected={lightSelectedId===theme.id} darkSelected={darkSelectedId===theme.id} onselect={mode=>select(theme,mode)} onuse={()=>select(theme)} onduplicate={()=>edit('duplicate',theme)} ondownload={()=>download(theme)} onedit={!builtInThemes.some(item=>item.id===theme.id) ? ()=>edit('edit',theme) : undefined}/>{/each}</div>
  <p>{tr("Motywy utworzone tutaj pozostają w pamięci podglądu. Właściwa biblioteka w Studio zapisuje je lokalnie.")}</p>
</section>

<section class="variant-card wide" id="control-13">
  <div class="variant-heading"><span>13</span><h2>{tr("Wszystkie komponenty projektu")}</h2><code>{tr("inwentarz")}</code></div>
  <p>{tr("Kontrolki bazowe mają warianty powyżej. Komponenty ekranów łączą je z funkcjami Seventy Seven Labs.")}</p>
  <div class="inventory">{#each inventory as [name,description]}<div><strong>{name}</strong><span>{description}</span></div>{/each}</div>
</section>

{#if dialog}<ThemeDialog kind={dialog.kind} seed={dialog.seed} onsubmit={save} onclose={()=>dialog=undefined}/>{/if}

<style>
  .variant-card{min-width:0;border:1px solid var(--border);border-radius:12px;padding:23px;scroll-margin-top:18px}.wide{grid-column:1/-1}.variant-heading{display:flex;align-items:center;gap:10px;margin-bottom:20px}.variant-heading>span{color:var(--muted);font-size:var(--ui-text-10);opacity:.65}.variant-heading h2{font-size:var(--ui-text-14);font-weight:550;letter-spacing:-.2px}.variant-heading code{margin-left:auto;color:var(--muted);font-size:var(--ui-text-10)}p{color:var(--muted);font-size:var(--ui-text-12);line-height:1.8;margin:0 0 16px}.button-samples,.tooltip-samples{display:flex;align-items:center;flex-wrap:wrap;gap:12px}.button-samples+.button-samples{margin-top:20px}.button-samples>div>small{display:block;color:var(--muted);font-family:ui-monospace,monospace;font-size:var(--ui-text-10);margin-bottom:8px}.demo-status{margin:20px 0 0;padding:10px 12px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--foreground)}.tooltip-samples{margin-bottom:20px}form>label{display:block;font-size:var(--ui-text-12);margin:0 0 7px}form :global(.vs-select){margin-top:18px}.form-switch{display:flex;align-items:center;justify-content:space-between;gap:15px;margin:20px 0;font-size:var(--ui-text-12)}.form-output{display:block;min-height:35px;padding-top:15px;overflow-wrap:anywhere;font-size:var(--ui-text-11);line-height:1.7;color:var(--muted)}.theme-demo-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:22px}.theme-demo-header p{margin:0}.theme-demo-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:18px}.inventory>div{display:grid;grid-template-columns:230px minmax(0,1fr);gap:16px;padding:13px 0;border-top:1px solid var(--border);font-size:var(--ui-text-12);line-height:1.7}.inventory strong{font-weight:500;overflow-wrap:anywhere}.inventory span{color:var(--muted)}@media(max-width:700px){.variant-card{padding:18px}.inventory>div{grid-template-columns:1fr;gap:4px}.theme-demo-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.variant-heading{gap:7px}.variant-heading code{font-size:var(--ui-text-9)}}
</style>
