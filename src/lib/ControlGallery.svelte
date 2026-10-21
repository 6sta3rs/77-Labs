<script lang="ts">
  import { onMount } from 'svelte'
  import { Search, Upload, RotateCcw, ArrowUpRight, SlidersHorizontal } from '@lucide/svelte'
  import Select from './ui/Select.svelte'
  import Slider from './ui/Slider.svelte'
  import Switch from './ui/Switch.svelte'
  import SpeechEditor from './SpeechEditor.svelte'
  import Input from './ui/Input.svelte'
  import Textarea from './ui/Textarea.svelte'
  import Button from './ui/Button.svelte'
  import ComponentVariants from './ComponentVariants.svelte'
  import AudioExamples from './AudioExamples.svelte'
  import GroupFilterExamples from './GroupFilterExamples.svelte'
  import ModelExamples from './ModelExamples.svelte'
  import ActionBar from './ui/ActionBar.svelte'
  import { autoTagText } from './tags'
  import { getThemeColorsForAppearance, type ThemeDefinition } from './themes/t3-palettes'
  import { applyAppearance, defaultAppearance, themes, type AppearanceSettings } from './appearance'
  import { voices } from './data'
  import type { SpeechBlock } from './tags'

  let appearance = $state<AppearanceSettings>({ ...defaultAppearance })
  let name = $state('Nowa narracja'), email = $state(''), password = $state(''), seed = $state<number | null>(42)
  let query = $state(''), text = $state('Cześć! To jest miejsce na twoją następną opowieść.\n\nMożesz edytować ten tekst i zmieniać rozmiar pola.')
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
  let enabled = $state(true), reduced = $state(false), fileName = $state(''), resetKey = $state(0)
  const initialBlocks = (): SpeechBlock[] => [{ id: 'gallery-speaker', voiceId: voices[0].id, text: 'Dobry głos zaczyna się od dobrego tekstu. [pause 250ms] Sprawdź tagi i dopisz swoją historię.' }]
  let blocks = $state<SpeechBlock[]>(initialBlocks())
  const languageOptions = [{ value: 'pl', label: 'Polski' }, { value: 'en', label: 'English' }, { value: 'auto', label: 'Automatycznie', description: 'Rozpoznanie języka na podstawie tekstu.' }]
  const effectOptions = [{ value: 'raw', label: 'Bez efektów' }, { value: 'podcast', label: 'Podcast', description: 'Wyraźna i wyrównana mowa.' }, { value: 'warm', label: 'Ciepłe' }, { value: 'broadcast', label: 'Radiowe' }, { value: 'cinematic', label: 'Filmowe' }, { value: 'bright', label: 'Jasne' }]
  const sections = ['Pola tekstowe', 'Wyszukiwanie', 'Dłuższy tekst', 'Listy wyboru', 'Suwaki', 'Przełączniki', 'Pliki', 'Edytor narracji', 'Przyciski', 'Podpowiedzi', 'Formularz', 'Motywy', 'Inwentarz', 'Audio', 'Grupy i filtry', 'Wybór modeli']
  const items = ['Lektor', 'Narrator', 'Anna', 'Michał']
  const inputSizes = ['compact', 'sm', 'default', 'lg'] as const
  const textareaSizes = ['sm', 'default', 'lg'] as const
  const selectSizes = ['xs', 'compact', 'sm', 'default', 'lg'] as const
  const groupedOptions = Array.from({length:24},(_,index)=>({value:`voice-${index}`,label:`Głos ${String(index+1).padStart(2,'0')}`,group:index<12?'Polskie':'Pozostałe',disabled:index===3}))
  let groupedVoice = $state('voice-0')
  let audioExamples = $state<AudioExamples>()
  let galleryEditor = $state<SpeechEditor>()
  let actionNotice = $state('')
  $effect(() => {
    const settings = { ...appearance, lightTheme: previewLightTheme?.id || appearance.theme, darkTheme: previewDarkTheme?.id || appearance.theme, reduceMotion: reduced }
    const dark = isDarkPreview
    const previewTheme = dark ? previewDarkTheme : previewLightTheme
    applyAppearance(settings, previewTheme ? getThemeColorsForAppearance(previewTheme, dark ? 'dark' : 'light') || undefined : undefined)
  })
  function reset() {
    appearance = { ...defaultAppearance }; name = 'Nowa narracja'; email = ''; password = ''; seed = 42; query = ''
    text = 'Cześć! To jest miejsce na twoją następną opowieść.\n\nMożesz edytować ten tekst i zmieniać rozmiar pola.'
    stability = 44; similarity = 75; previewLightTheme = undefined; previewDarkTheme = undefined; groupedVoice = 'voice-0'; language = 'pl'; selectedEffect = 'raw'; speed = 1; steps = 16; enabled = true; reduced = false; fileName = ''; blocks = initialBlocks(); resetKey++
  }
</script>

<svelte:head><title>Kontrolki — Seventy Seven Labs</title><meta name="description" content="Interaktywny podgląd pól i kontrolek Seventy Seven Labs we wszystkich motywach." /></svelte:head>

<div class="gallery">
  <header class="gallery-header"><a class="gallery-brand" href="/"><SlidersHorizontal size={17}/><span>Seventy Seven Labs <span class="slash">/</span> Kontrolki</span></a><div class="header-actions"><Button variant="ghost" href="/">Otwórz Studio <ArrowUpRight size={14}/></Button><Button variant="outline" size="sm" onclick={reset}><RotateCcw size={13}/>Resetuj podgląd</Button></div></header>
  <main class="gallery-main">
    <div class="intro"><span class="eyebrow">BIBLIOTEKA INTERFEJSU</span><h1>Wszystkie pola.<br/>Jedno miejsce do sprawdzania.</h1><p>Pisz, wybieraj i przesuwaj. To te same kontrolki, których używasz w Studio.</p></div>
    <div class="gallery-settings"><div class="settings-heading"><strong>Wygląd podglądu</strong><span>Zmiany zostają tylko na tej stronie.</span></div><div class="theme-control"><Select label="Motyw" value={activePreviewTheme?.id || appearance.theme} options={previewOptions} onchange={theme => { previewLightTheme = undefined; previewDarkTheme = undefined; appearance = { ...appearance, theme } }}/></div><div class="theme-control"><Select label="Tryb" value={appearance.mode} options={[{value:'dark',label:'Ciemny'},{value:'light',label:'Jasny'},{value:'system',label:'Systemowy'}]} onchange={mode => appearance = { ...appearance, mode: mode as AppearanceSettings['mode'] }}/></div></div>
    <nav class="gallery-nav" aria-label="Rodzaje kontrolek">{#each sections as section, i}<a href={`#control-${i+1}`}>{section}</a>{/each}</nav>
    {#key resetKey}<div class="gallery-grid">
      <section class="control-card" id="control-1"><div class="card-heading"><span class="section-number">01</span><h2>Pola tekstowe</h2><span class="type-label">input</span></div><div class="field-grid">
        <label class="demo-field"><span>Nazwa projektu <small>Edytowalne</small></span><Input bind:value={name} placeholder="Wpisz nazwę projektu"/></label>
        <label class="demo-field"><span>Puste pole <small>Placeholder</small></span><Input placeholder="Nadaj tytuł nagraniu"/></label>
        <label class="demo-field"><span>Adres e-mail</span><Input type="email" bind:value={email} placeholder="twoj@email.pl"/></label>
        <label class="demo-field"><span>Hasło</span><Input type="password" bind:value={password} placeholder="Wpisz przykładowe hasło" autocomplete="new-password"/></label>
        <label class="demo-field"><span>Ziarno losowości <small>Liczba</small></span><Input type="number" min="0" step="1" bind:value={seed}/></label>
        <label class="demo-field"><span>Tylko do odczytu</span><Input value="OmniVoice · WAV 24 kHz" readonly/></label>
        <label class="demo-field"><span>Pole wyłączone</span><Input value="Niedostępne podczas generowania" disabled/></label>
        <label class="demo-field"><span>Pole z błędem</span><Input value="" placeholder="Nazwa projektu" aria-invalid="true" aria-describedby="name-error"/><small id="name-error" class="field-error">Podaj nazwę projektu.</small></label>
      </div><div class="size-variants">{#each inputSizes as size}<label class="demo-field"><span>Rozmiar {size}</span><Input {size} placeholder={`Pole ${size}`}/></label>{/each}<label class="demo-field"><span>Czcionka mono</span><Input font="mono" value="voice_001.wav"/></label><label class="demo-field"><span>Bez obramowania</span><Input unstyled value="Tekst bez ramki"/></label></div><p class="card-hint">Kliknij pole lub przejdź do niego Tabem, aby zobaczyć focus.</p></section>

      <section class="control-card" id="control-2"><div class="card-heading"><span class="section-number">02</span><h2>Wyszukiwanie</h2><span class="type-label">search</span></div><label class="demo-field"><span>Szukaj głosu</span><span class="search-field"><Search size={15}/><input type="search" placeholder="Wpisz imię…" aria-label="Szukaj głosu w podglądzie" bind:value={query}/><kbd>/</kbd></span></label><div class="demo-results" aria-live="polite">{#each items.filter(item => item.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl'))) as item}<div><span class="result-avatar">{item[0]}</span><span>{item}</span><small>Głos przykładowy</small></div>{:else}<p>Brak głosów pasujących do „{query}”.</p>{/each}</div></section>

      <section class="control-card" id="control-3"><div class="card-heading"><span class="section-number">03</span><h2>Dłuższy tekst</h2><span class="type-label">textarea</span></div><label class="demo-field"><span>Treść transkrypcji <small>{text.length} znaków</small></span><Textarea class="gallery-textarea" bind:value={text} rows={5}/></label><label class="demo-field"><span>Wyłączone pole</span><Textarea disabled rows={2} value="Nagranie jest przetwarzane…"/></label><div class="stack-variants">{#each textareaSizes as size}<label class="demo-field"><span>Rozmiar {size}</span><Textarea {size} placeholder={`Tekst — ${size}`}/></label>{/each}</div></section>

      <section class="control-card" id="control-4"><div class="card-heading"><span class="section-number">04</span><h2>Listy wyboru</h2><span class="type-label">select</span></div><Select language label="Język" value={language} options={languageOptions} onchange={v => language = v}/><Select label="Efekty audio" value={selectedEffect} options={effectOptions} onchange={v => selectedEffect = v}/><Select language label="Lista wyłączona" value="pl" options={languageOptions} disabled onchange={() => {}}/><div class="stack-variants">{#each selectSizes as size}<Select language label={`Rozmiar ${size}`} {size} value={language} options={languageOptions} onchange={v=>language=v}/>{/each}<Select language label="Wariant ghost" variant="ghost" value={language} options={languageOptions} onchange={v=>language=v}/><Select label="Grupy i przewijanie" options={groupedOptions} bind:value={groupedVoice}/><Select language label="Otwieranie pod polem" alignItemWithTrigger={false} value={language} options={languageOptions} onchange={v=>language=v}/></div><p class="card-hint">Strzałki i Home/End zmieniają aktywną opcję. Enter wybiera, Escape zamyka. Możesz też zacząć wpisywać nazwę.</p></section>

      <section class="control-card" id="control-5"><div class="card-heading"><span class="section-number">05</span><h2>Suwaki</h2><span class="type-label">range</span></div><Slider label="Stabilność" collapsible value={stability} min={0} max={100} valueLabel={`${stability}%`} startLabel="Kreatywny" endLabel="Solidny" onchange={v => stability = v}/><Slider valueDisplay="tooltip" label="Podobieństwo" collapsible defaultOpen={false} value={similarity} valueLabel={`${similarity}%`} startLabel="Swobodnie" endLabel="Dokładnie" onchange={v=>similarity=v}/><Slider label="Szybkość" value={speed} min={.5} max={2} step={.05} valueLabel={`${speed.toFixed(2)}×`} startLabel="Wolniej" endLabel="Szybciej" onchange={v => speed = v}/><Slider label="Kroki generowania" valueDisplay="right" size="compact" value={steps} min={8} max={64} step={8} onchange={v => steps = v}/><Slider label="Suwak wyłączony" value={40} disabled onchange={() => {}}/><p class="card-hint">Wartość po prawej i płynny dymek nad uchwytem. Kroki generowania: wariant tylko z wartością po prawej. Chevron rozwija i zwija suwak.</p></section>

      <section class="control-card" id="control-6"><div class="card-heading"><span class="section-number">06</span><h2>Przełączniki</h2><span class="type-label">switch</span></div><div class="switch-row"><div><strong>Przykładowa funkcja</strong><span>{enabled ? 'Włączona' : 'Wyłączona'}</span></div><Switch label="Przykładowa funkcja" checked={enabled} onchange={v => enabled = v}/></div><div class="switch-row"><div><strong>Ogranicz animacje</strong><span>Wpływa na kontrolki w podglądzie.</span></div><Switch label="Ogranicz animacje" checked={reduced} onchange={v => reduced = v}/></div><div class="switch-row"><div><strong>Wyłączony przełącznik</strong><span>Stan: wyłączony</span></div><Switch label="Wyłączony przełącznik" checked={false} disabled onchange={() => {}}/></div><div class="switch-row"><div><strong>Zablokowana funkcja</strong><span>Stan: włączony</span></div><Switch label="Zablokowana funkcja" checked={true} disabled onchange={() => {}}/></div><div class="switch-row"><div><strong>Kompaktowy</strong><span>Rozmiar sm</span></div><Switch size="sm" label="Przełącznik kompaktowy" checked={enabled} onchange={v => enabled = v}/></div><div class="switch-row"><div><strong>Duży przełącznik</strong><span>Rozmiar lg</span></div><Switch size="lg" label="Duży przełącznik" checked={enabled} onchange={v => enabled = v}/></div></section>

      <section class="control-card" id="control-7"><div class="card-heading"><span class="section-number">07</span><h2>Wybór pliku</h2><span class="type-label">file</span></div>{#key resetKey}<label class="upload-zone gallery-upload"><Upload size={25}/><strong>{fileName || 'Wybierz nagranie'}</strong><span>WAV, MP3, M4A, OGG lub FLAC</span><input type="file" aria-label="Wybierz przykładowe nagranie" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac" onchange={e => fileName = e.currentTarget.files?.[0]?.name || ''}/></label>{/key}<label class="upload-zone compact vs-disabled"><Upload size={18}/><strong>Upload wyłączony</strong><span>Kontrolka nie przyjmuje pliku.</span><input type="file" disabled aria-label="Wyłączony wybór pliku"/></label><p class="card-hint">Podgląd pokazuje nazwę wybranego pliku. Nie wysyła go ani nie uruchamia przetwarzania.</p></section>

      <section class="control-card wide" id="control-8"><div class="card-heading"><span class="section-number">08</span><h2>Edytor narracji</h2><span class="type-label">textarea + tagi</span></div><div class="editor-demo"><SpeechEditor bind:this={galleryEditor} {blocks} {voices} onblockschange={v => blocks = v} onchoosevoice={id => blocks = blocks.map(block => block.id === id ? { ...block, voiceId: block.voiceId === voices[0].id ? voices[1].id : voices[0].id } : block)}/></div><p class="card-hint">Działający edytor: tagi audio, wielu mówców, zmiana przykładowego głosu i cofanie zmian.</p><div class="gallery-action-bar"><ActionBar tagLabel="Automatyczne pauzy" generateLabel="Odtwórz przykład" ontag={()=>{blocks=blocks.map(block=>({...block,text:autoTagText(block.text)}));actionNotice='Dodano pauzy lokalną regułą, bez wywołania AI.'}} ontags={()=>galleryEditor?.toggleTags()} ongenerate={()=>audioExamples?.playExample()}/><p role="status">{actionNotice}</p></div></section>
      <ComponentVariants lightSelectedId={previewLightTheme?.id || appearance.theme} darkSelectedId={previewDarkTheme?.id || appearance.theme} onpreview={(theme, mode) => {
        if ((!mode || mode === 'light') && getThemeColorsForAppearance(theme, 'light')) previewLightTheme = theme
        if ((!mode || mode === 'dark') && getThemeColorsForAppearance(theme, 'dark')) previewDarkTheme = theme
      }}/>
      <AudioExamples bind:this={audioExamples}/><GroupFilterExamples/><ModelExamples/>
    </div>{/key}
    <footer class="gallery-footer"><span>Seventy Seven Labs · Wspólne kontrolki aplikacji</span><span>Tab — następne pole <span class="dot">·</span> Shift + Tab — poprzednie</span></footer>
  </main>
</div>

<style>
  :global(html[data-page=controls]),:global(html[data-page=controls] body),:global(html[data-page=controls] #app){height:auto;min-height:0;overflow:visible}
  .gallery{font-family:var(--font-ui);color:var(--foreground);background:var(--background);font-size:var(--ui-font-size,13px)}
  .gallery-header{display:flex;align-items:center;justify-content:space-between;gap:16px;max-width:1120px;margin:auto;padding:22px 28px;border-bottom:1px solid var(--border)}.gallery-brand{display:flex;gap:10px;align-items:center;font-size:var(--ui-text-13);font-weight:550}.gallery-brand :global(svg){color:var(--muted)}.slash{padding:0 9px;color:var(--muted);font-weight:400}.header-actions{display:flex;gap:9px;align-items:center}
  .gallery-main{max-width:1120px;margin:0 auto;padding:48px 28px 24px}.eyebrow{font-size:var(--ui-text-10);letter-spacing:1.8px;color:var(--muted);font-weight:600}.intro h1{font-size:clamp(27px,4.5vw,38px);font-weight:550;line-height:1.18;letter-spacing:-1.3px;margin:15px 0}.intro p{font-size:var(--ui-text-13);line-height:1.8;color:var(--muted);margin:0}
  .gallery-settings{display:flex;gap:20px;align-items:center;margin:29px 0 22px;padding:19px 21px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}.settings-heading{flex:1;min-width:160px}.settings-heading strong{display:block;font-weight:500;font-size:var(--ui-text-12)}.settings-heading span{display:block;color:var(--muted);font-size:var(--ui-text-11);margin-top:6px}.theme-control{width:180px;min-width:0}.gallery-nav{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 25px}.gallery-nav a{font-size:var(--ui-text-11);padding:6px 9px;color:var(--muted);border:1px solid transparent;border-radius:6px}.gallery-nav a:hover{border-color:var(--border);background:var(--surface)}
  .gallery-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}.control-card{min-width:0;border:1px solid var(--border);border-radius:12px;padding:23px;background:var(--background);scroll-margin-top:18px}.control-card:first-child,.wide{grid-column:1/-1}.card-heading{display:flex;align-items:center;gap:10px;margin-bottom:23px}.section-number{font-variant-numeric:tabular-nums;font-size:var(--ui-text-10);color:var(--muted);opacity:.65}.card-heading h2{font-size:var(--ui-text-14);font-weight:550;letter-spacing:-.2px}.type-label{margin-left:auto;color:var(--muted);font-size:var(--ui-text-10);font-family:ui-monospace,monospace}.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px 24px}.demo-field{display:block;min-width:0}.demo-field>span:first-child{display:flex;justify-content:space-between;gap:10px;font-size:var(--ui-text-12);margin-bottom:8px}.demo-field small{font-size:var(--ui-text-10);color:var(--muted);font-weight:400}.demo-field .field-error{display:block;color:var(--danger);margin-top:6px}.control-card>.demo-field+.demo-field{margin-top:19px}.card-hint{font-size:var(--ui-text-11);color:var(--muted);line-height:1.8;margin:18px 0 0}:global(.gallery-textarea){min-height:133px!important}.control-card > :global(.vs-select+.vs-select){margin-top:20px}.control-card :global(.vs-slider+.vs-slider){margin-top:22px}
  .demo-results{display:grid;gap:2px;margin-top:15px}.demo-results>div{display:flex;align-items:center;gap:10px;padding:8px 0;font-size:var(--ui-text-12)}.result-avatar{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;color:var(--muted);background:var(--surface);border:1px solid var(--border);font-size:var(--ui-text-10)}.demo-results small{margin-left:auto;color:var(--muted);font-size:var(--ui-text-10)}.demo-results>p{font-size:var(--ui-text-12);color:var(--muted);padding:15px 0;line-height:1.8}.search-field{display:flex;align-items:center}.search-field input{flex:1;width:100%}.search-field kbd{font-size:var(--ui-text-10)}
  .switch-row{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:13px 0}.switch-row+.switch-row{border-top:1px solid var(--border)}.switch-row strong{display:block;font-size:var(--ui-text-12);font-weight:500}.switch-row>div>span{display:block;font-size:var(--ui-text-11);color:var(--muted);margin-top:5px}.gallery-upload{padding:30px 18px}.editor-demo{border:1px solid var(--border);border-radius:9px;padding:23px}.gallery-footer{display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;color:var(--muted);font-size:var(--ui-text-10);line-height:1.8;padding:25px 0 0}.dot{padding:0 7px}
  @media(max-width:700px){.gallery-header{padding:16px}.gallery-main{padding:30px 16px 22px}.header-actions>:global(a[data-slot="button"]){display:none}.gallery-grid{grid-template-columns:1fr}.field-grid{grid-template-columns:1fr}.gallery-settings{flex-wrap:wrap;gap:16px;padding:16px}.settings-heading{flex-basis:100%}.theme-control{flex:1;width:auto}.control-card{padding:18px}.intro h1{letter-spacing:-.8px}.gallery-brand{font-size:var(--ui-text-12)}.slash{padding:0 4px}.editor-demo{padding:16px}}
.size-variants{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px 24px;margin-top:24px;padding-top:22px;border-top:1px solid var(--border)}.stack-variants{display:grid;gap:18px;margin-top:22px;padding-top:22px;border-top:1px solid var(--border)}@media(max-width:700px){.size-variants{grid-template-columns:1fr}}
.gallery-action-bar{margin-top:20px}.gallery-action-bar>p{font-size:var(--ui-text-11);color:var(--muted);line-height:1.7;margin-top:10px}
</style>
