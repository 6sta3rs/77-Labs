<script lang="ts">
  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import { untrack } from 'svelte'
  import { X, Upload, Sun, Moon, Plus } from '@lucide/svelte'
  import { THEME_COLOR_ROLES, getThemeColorsForAppearance, type ThemeDefinition, type ThemeAppearance, type ThemeColorRole } from '../themes/t3-palettes'
  import { defaultColors, validThemeColor, parseThemeFile, MAX_THEME_BYTES } from '../themes/library'
  import Button from '../ui/Button.svelte'
  import FilePicker from '../ui/FilePicker.svelte'
  import Tooltip from '../ui/Tooltip.svelte'
  import { mountModal } from '../ui/overlay'

  let { kind, seed, onsubmit, onclose }: { kind: 'create' | 'edit' | 'duplicate' | 'import'; seed: ThemeDefinition; onsubmit: (theme: ThemeDefinition) => void; onclose: () => void } = $props()
  let draft = $state(untrack(() => JSON.parse(JSON.stringify(seed)) as ThemeDefinition))
  let mode = $state<ThemeAppearance>(untrack(() => seed.appearance))
  let json = $state('')
  let error = $state('')
  let importedName = $state('')
  const titles = { create: 'Utwórz motyw', edit: 'Edytuj motyw', duplicate: 'Kopia motywu', import: 'Dodaj motyw' }
  // Only the roles this app actually reads (appearance.ts / ui-colors.ts), named by where they show up.
  // The remaining T3 Code roles (terminal, code, search, toolbar…) stay in the JSON but change nothing here.
  const labels: Partial<Record<ThemeColorRole, string>> = {
    canvas: 'Tło aplikacji', surface: 'Tło paneli', surfaceRaised: 'Karty i podniesione panele', surfaceOverlay: 'Tło menu, list i okien',
    accentSurface: 'Podświetlenie po najechaniu i opcja w liście', text: 'Tekst', textMuted: 'Tekst pomocniczy', placeholder: 'Podpowiedź w pustym polu',
    secondaryLabel: 'Etykiety drugorzędne', iconMuted: 'Ikony pomocnicze', border: 'Obramowania i linie', input: 'Obramowanie pól i list wyboru',
    focus: 'Obwódka fokusu (Tab)', accent: 'Akcent i tagi audio', accentForeground: 'Tekst na akcencie',
    messageAction: 'Przycisk główny (np. Wygeneruj mowę)', messageActionForeground: 'Tekst przycisku głównego', messageActionHover: 'Przycisk główny po najechaniu',
    secondary: 'Przycisk drugorzędny', secondaryForeground: 'Tekst przycisku drugorzędnego', muted: 'Tło wyciszonych elementów',
    error: 'Kolor usuwania i błędu', errorForeground: 'Tekst i ikony błędu', errorSurface: 'Tło komunikatu błędu',
    sidebar: 'Tło nawigacji', sidebarForeground: 'Tekst nawigacji', sidebarMutedForeground: 'Tekst pomocniczy nawigacji', sidebarControlSurface: 'Przyciski w nawigacji',
    sidebarRowHover: 'Wiersz nawigacji po najechaniu', sidebarRowSelected: 'Wybrany wiersz nawigacji', sidebarBorder: 'Obramowanie nawigacji',
  }
  const appRoles = THEME_COLOR_ROLES.filter(role => role in labels)
  const mainRoles: ThemeColorRole[] = ['canvas', 'surface', 'text', 'textMuted', 'border', 'accent', 'messageAction', 'sidebar', 'sidebarRowSelected']
  let colors = $derived(getThemeColorsForAppearance(draft, mode) || defaultColors(mode))
  let hasMode = $derived(!!getThemeColorsForAppearance(draft, mode))
  function mount(node: HTMLDialogElement) { return mountModal(node, { returnFocus: '.appearance-panel .theme-actions button,.appearance-panel .theme-name' }) }
  function setColor(role: ThemeColorRole, color: string) {
    const next = { ...colors, [role]: color }
    draft = mode === draft.appearance ? { ...draft, colors: next } : { ...draft, variants: { ...draft.variants, [mode]: next } }
    error = ''
  }
  function addVariant() { draft = { ...draft, variants: { ...draft.variants, [mode]: { ...defaultColors(mode) } } } }
  function hex(color: string) {
    if (!validThemeColor(color)) return '#000000'
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!
    context.fillStyle = color; context.fillRect(0, 0, 1, 1)
    return '#' + [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => value.toString(16).padStart(2, '0')).join('')
  }
  async function readFile(file?: File) {
    if (!file) return
    error = ''
    if (file.size > MAX_THEME_BYTES) { error = 'Plik może mieć najwyżej 256 KB.'; return }
    try { json = await file.text(); importedName = file.name } catch { error = 'Nie udało się odczytać pliku.' }
  }
  function submit(event: SubmitEvent) {
    event.preventDefault(); error = ''
    try {
      if (kind === 'import') onsubmit(parseThemeFile(json))
      else {
        if (!draft.label.trim() || draft.label.trim().length > 48) throw new Error('Nazwa musi mieć od 1 do 48 znaków.')
        const sets = [draft.colors, ...Object.values(draft.variants || {})]
        for (const set of sets) for (const [role, color] of Object.entries(set)) if (!validThemeColor(color)) throw new Error(`Nieprawidłowy kolor: ${labels[role as ThemeColorRole] || role}.`)
        onsubmit({ ...draft, label: draft.label.trim() })
      }
    } catch (reason) { error = (reason as Error).message }
  }
</script>

<dialog use:mount aria-labelledby="theme-dialog-title" onkeydown={(event) => { if (event.key === 'Escape') event.stopPropagation() }} oncancel={(event) => { event.preventDefault(); onclose() }}>
  <form onsubmit={submit}>
    <header><div><h2 id="theme-dialog-title">{tr(titles[kind])}</h2><p>{kind === 'import' ? tr("Wczytaj plik JSON motywu lub wklej jego zawartość.") : tr('Zmieniaj kolory osobno dla jasnego i ciemnego wariantu.')}</p></div><Tooltip content={tr("Zamknij edytor motywu")}><Button variant="ghost" size="icon" aria-label={tr("Zamknij edytor motywu")} onclick={onclose}><X/></Button></Tooltip></header>
    <div class="dialog-content">
      {#if kind === 'import'}
        <div class="upload-theme"><FilePicker label={importedName || tr('Wybierz plik JSON')} accept=".json,application/json" showName={false} onchange={files => void readFile(files[0])}/></div>
        <label class="field-label" for="theme-json">{tr("JSON motywu")}</label>
        <textarea id="theme-json" class="text-input json-input" bind:value={json} spellcheck="false" placeholder={'{\n  "version": 1,\n  "name": "Mój motyw",\n  "appearance": "dark",\n  "colors": { "accent": "#346bf1" }\n}'}></textarea>
        <p class="hint">{tr("Format JSON v1, maks. 256 KB. Brakujące kolory uzupełnimy paletą Labs dla danego trybu.")}</p>
      {:else}
        <label class="field-label" for="theme-name">{tr("Nazwa motywu")}</label><input id="theme-name" class="text-input" bind:value={draft.label} maxlength="48" required/>
        <div class="variant-tabs" aria-label={tr("Wariant motywu")}><button type="button" class:chosen={mode === 'light'} aria-pressed={mode === 'light'} onclick={() => mode = 'light'}><Sun size={14}/>{tr("Jasny")}</button><button type="button" class:chosen={mode === 'dark'} aria-pressed={mode === 'dark'} onclick={() => mode = 'dark'}><Moon size={14}/>{tr("Ciemny")}</button></div>
        {#if !hasMode}<div class="missing-variant"><p>{tr("Ten motyw nie ma jeszcze wariantu")} {mode === 'light' ? 'jasnego' : 'ciemnego'}.</p><Button variant="outline" size="sm" onclick={addVariant}><Plus/>{tr("Dodaj wariant")}</Button></div>
        {:else}
          <div class="palette-preview" style={`--p-bg:${colors.canvas};--p-panel:${colors.sidebar};--p-text:${colors.text};--p-muted:${colors.textMuted};--p-border:${colors.border};--p-primary:${colors.messageAction};--p-on-primary:${colors.messageActionForeground}`}>
            <aside><span></span><span></span><span></span></aside><div><strong>{tr("Twoje studio")}</strong><p>{tr("Podgląd tekstu i kolorów interfejsu.")}</p><span class="preview-action">{tr("Wygeneruj mowę")}</span></div>
          </div>
          {#snippet field(role: ThemeColorRole)}
            <div class="color-field"><label for={`color-${role}`}>{tr(labels[role] || role)}</label><div><input type="color" aria-label={tr("Wybierz kolor: {value0}", {value0: (labels[role] || role)})} value={hex(colors[role])} oninput={(event) => setColor(role, event.currentTarget.value)}/><input id={`color-${role}`} class="text-input" aria-invalid={!validThemeColor(colors[role])} value={colors[role]} oninput={(event) => setColor(role, event.currentTarget.value)} spellcheck="false"/></div></div>
          {/snippet}
          <div class="color-grid">{#each mainRoles as role}{@render field(role)}{/each}</div>
          <details><summary>{tr("Pozostałe kolory ({count})", { count: appRoles.length - mainRoles.length })}</summary><div class="color-grid">{#each appRoles.filter(role => !mainRoles.includes(role)) as role}{@render field(role)}{/each}</div></details>
        {/if}
      {/if}
      {#if error}<p class="error" role="alert">{tr(error)}</p>{/if}
    </div>
    <footer><Button variant="outline" onclick={onclose}>{tr("Anuluj")}</Button><Button type="submit">{kind === 'import' ? tr("Dodaj motyw") : 'Zapisz motyw'}</Button></footer>
  </form>
</dialog>

<style>
  dialog{padding:0;border:1px solid var(--border);border-radius:14px;color:var(--foreground);width:min(720px,calc(100vw - 32px));max-height:calc(100dvh - 40px);box-shadow:var(--popup-shadow);font-family:var(--font-ui)}form{display:flex;flex-direction:column;max-height:calc(100dvh - 42px)}header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:22px 24px;border-bottom:1px solid var(--border)}h2{font-size:var(--ui-text-18)}header p,.hint{font-size:var(--ui-text-12);color:var(--muted);line-height:1.6;margin-top:7px}.dialog-content{padding:20px 24px;overflow:auto;min-height:0}.field-label{display:block;margin-bottom:8px;font-size:var(--ui-text-12);font-weight:500}.variant-tabs{display:flex;gap:6px;margin:20px 0 14px}.variant-tabs button{display:flex;align-items:center;gap:7px;border-radius:6px;padding:7px 12px;color:var(--muted)}.variant-tabs .chosen{background:var(--surface-hover);color:var(--foreground)}.palette-preview{display:flex;border:1px solid var(--p-border);border-radius:9px;overflow:hidden;background:var(--p-bg);color:var(--p-text);margin-bottom:22px;min-height:120px}.palette-preview aside{width:80px;padding:18px 12px;background:var(--p-panel);border-right:1px solid var(--p-border);display:grid;align-content:start;gap:9px}.palette-preview aside span{height:5px;border-radius:4px;background:var(--p-muted);opacity:.5}.palette-preview>div{padding:18px 20px}.palette-preview strong{font-size:var(--ui-text-14)}.palette-preview p{font-size:var(--ui-text-12);color:var(--p-muted);margin:7px 0 12px}.preview-action{background:var(--p-primary);color:var(--p-on-primary);font-size:var(--ui-text-11);padding:6px 10px;border-radius:5px;display:inline-block}.color-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 18px}.color-field{min-width:0}.color-field>label{font-size:var(--ui-text-11);color:var(--muted);display:block;margin-bottom:6px}.color-field>div{display:flex;gap:7px;align-items:center}.color-field input[type=color]{width:30px;height:30px;padding:0;border:1px solid var(--input-border);border-radius:6px;flex-shrink:0;cursor:pointer;background:transparent}.color-field input[type=color]::-webkit-color-swatch-wrapper{padding:3px}.color-field input[type=color]::-webkit-color-swatch{border:0;border-radius:3px}.color-field .text-input{font-family:ui-monospace,monospace;font-size:var(--ui-text-11);height:32px;min-width:0;padding:5px 7px}.text-input[aria-invalid=true]{border-color:var(--danger)}details{margin-top:22px}summary{font-size:var(--ui-text-12);color:var(--muted);cursor:pointer;margin-bottom:15px}.missing-variant{display:flex;gap:16px;align-items:center;justify-content:space-between;font-size:var(--ui-text-12);color:var(--muted);padding:22px 0}.upload-theme{display:flex;align-items:center;justify-content:center;gap:8px;border:1px dashed var(--input-border);border-radius:8px;padding:18px;cursor:pointer;font-size:var(--ui-text-12);margin-bottom:20px}.upload-theme input{max-width:190px;font-size:var(--ui-text-11)}.json-input{min-height:250px;resize:vertical;font-family:ui-monospace,monospace;font-size:var(--ui-text-12);line-height:1.7}.error{font-size:var(--ui-text-12);line-height:1.6;color:var(--danger);margin-top:15px}footer{border-top:1px solid var(--border);padding:16px 24px;display:flex;justify-content:flex-end;gap:8px}button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}@media(max-width:560px){.color-grid{grid-template-columns:1fr}header,.dialog-content,footer{padding:16px}.missing-variant{flex-wrap:wrap}.upload-theme{flex-wrap:wrap}}
</style>
