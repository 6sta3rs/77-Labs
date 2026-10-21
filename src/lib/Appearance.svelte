<script lang="ts">
  import { Check, Monitor, Moon, RotateCcw, Sun, Plus, Paintbrush } from '@lucide/svelte'
  import { defaultAppearance, themeColors, saveAppearance, type AppearanceSettings } from './appearance'
  import { getThemes, getTheme, isCustomTheme, duplicateTheme, saveCustomTheme, removeCustomTheme, serializeTheme, libraryWarning } from './themes/library'
  import { getThemeColorsForAppearance, type ThemeAppearance, type ThemeDefinition } from './themes/t3-palettes'
  import ThemeDialog from './ThemeDialog.svelte'
  import VoiceOrb from './VoiceOrb.svelte'
  import ThemeCard from './ui/ThemeCard.svelte'
  import Slider from './ui/Slider.svelte'
  import Switch from './ui/Switch.svelte'
  import Select from './ui/Select.svelte'
  import Button from './ui/Button.svelte'
  import Tooltip from './ui/Tooltip.svelte'
  import { mountModal } from './ui/overlay'
  import './ui.css'
  let { value, onchange, voiceId = 'voicestudio' }: { value: AppearanceSettings; onchange: (value: AppearanceSettings) => void; voiceId?: string } = $props()
  function update(patch: Partial<AppearanceSettings>) {
    const next = { ...value, ...patch }
    if (!saveAppearance(next)) { failure = 'Nie udało się zapisać ustawień wyglądu. Pamięć lokalna jest niedostępna lub pełna.'; return false }
    failure = ''; onchange(next); return true
  }
  let themeItems = $state(getThemes())
  let editor = $state<{ kind: 'create' | 'edit' | 'duplicate' | 'import'; seed: ThemeDefinition }>()
  let deleteTarget = $state<ThemeDefinition>()
  let message = $state('')
  let failure = $state('')
  let orbSelection = $state('')
  $effect(() => { orbSelection = value.orbVariant })
  const owner = (mode: ThemeAppearance) => (mode === 'light' ? value.lightTheme : value.darkTheme) || value.theme
  function selectHalf(id: string, mode: ThemeAppearance) {
    update({ [mode === 'light' ? 'lightTheme' : 'darkTheme']: id, theme: id })
  }
  function useTheme(theme: ThemeDefinition) {
    update({ theme: theme.id, ...(getThemeColorsForAppearance(theme, 'light') ? { lightTheme: theme.id } : {}), ...(getThemeColorsForAppearance(theme, 'dark') ? { darkTheme: theme.id } : {}) })
  }
  function openEditor(kind: 'create' | 'edit' | 'duplicate' | 'import', theme?: ThemeDefinition) {
    message = ''; failure = ''
    const base: ThemeDefinition = theme || { id: 'studio', label: 'Nowy motyw', appearance: 'light', colors: themeColors(owner('light'), 'light'), variants: { dark: themeColors(owner('dark'), 'dark') } }
    editor = { kind, seed: kind === 'edit' ? JSON.parse(JSON.stringify(base)) as ThemeDefinition : { ...duplicateTheme(base), label: kind === 'duplicate' ? `${base.label.slice(0, 42)} kopia` : 'Nowy motyw' } }
  }
  function saved(theme: ThemeDefinition) {
    const next = saveCustomTheme(theme, editor?.kind === 'edit' ? editor.seed.id : undefined)
    themeItems = getThemes(); editor = undefined; useTheme(next); message = `Zapisano motyw „${next.label}”.`
  }
  function download(theme: ThemeDefinition) {
    const url = URL.createObjectURL(new Blob([serializeTheme(isCustomTheme(theme.id) ? theme : duplicateTheme(theme))], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `${theme.label.toLowerCase().replace(/[^a-z0-9-]/g, '-')}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    message = `Przygotowano eksport motywu „${theme.label}”.`
  }
  function remove() {
    if (!deleteTarget) return
    try {
      const id = deleteTarget.id
      removeCustomTheme(id); themeItems = getThemes()
      update({ theme: value.theme === id ? 'studio' : value.theme, lightTheme: owner('light') === id ? 'studio' : owner('light'), darkTheme: owner('dark') === id ? 'studio' : owner('dark') })
      message = `Usunięto motyw „${deleteTarget.label}”.`; deleteTarget = undefined; failure = ''
    } catch (reason) { failure = (reason as Error).message }
  }
  function mountDialog(node: HTMLDialogElement) { return mountModal(node, { returnFocus: '.appearance-panel .theme-actions button,.appearance-panel .theme-name' }) }
  function previewStyle(mode: 'light' | 'dark') {
    const colors = themeColors(owner(mode), mode)
    return `--preview-bg:${colors.canvas};--preview-panel:${colors.sidebar};--preview-line:${colors.border};--preview-accent:${colors.accent};--preview-text:${colors.text}`
  }
  const modes = [{ value: 'system', label: 'System', icon: Monitor }, { value: 'light', label: 'Jasny', icon: Sun }, { value: 'dark', label: 'Ciemny', icon: Moon }] as const
  const orbStyles: Array<{ value: AppearanceSettings['orbVariant']; label: string; description: string }> = [
    { value: 'original', label: 'Oryginalna', description: 'Zbalansowany ruch i refleksy.' },
    { value: 'calm', label: 'Spokojna', description: 'Łagodne fale i miękkie światło.' },
    { value: 'storm', label: 'Burza', description: 'Dynamiczne wiry reagujące na audio.' },
    { value: 'intonation', label: 'Intonacja', description: 'Falowanie zgodne z wysokością głosu.' },
    { value: 'landing', label: 'Przepływ', description: 'Autorska kula z turkusowym podglądem.' },
  ]
  function selectOrbStyle(id: string) {
    const style = orbStyles.find(style => style.value === id)
    if (style && !update({ orbVariant: style.value })) orbSelection = value.orbVariant
  }
</script>

{#snippet miniPreview(mode: 'light' | 'dark')}
  <div class="mini-scene" style={previewStyle(mode)}>
    <div class="mini-sidebar"><i></i><i></i><i></i><i></i></div>
    <div class="mini-main"><div class="mini-topline"></div><div class="mini-text"><i></i><i></i><i></i></div><div class="mini-composer"><i></i><b></b></div></div>
    <div class="mini-popover"><i></i><i></i><i></i></div>
  </div>
{/snippet}

<div class="appearance-panel">
  <header class="appearance-header"><div><h2>Wygląd</h2><p>Dostosuj Studio do swojego sposobu pracy.</p></div>
    <Tooltip content="Przywróć domyślny wygląd"><Button variant="outline" size="xs" onclick={() => update({ ...defaultAppearance })}><RotateCcw/><span>Przywróć</span></Button></Tooltip>
  </header>
  <section aria-labelledby="mode-title">
    <h3 id="mode-title">Schemat kolorów</h3>
    <div class="mode-grid">
      {#each modes as mode}
        <button type="button" class="mode-card" class:selected={value.mode === mode.value} aria-pressed={value.mode === mode.value} onclick={() => update({ mode: mode.value })}>
          <div class="mini-app" class:preview-light={mode.value === 'light'} class:preview-dark={mode.value === 'dark'} class:preview-system={mode.value === 'system'} aria-hidden="true">
            {#if mode.value === 'system'}
              {@render miniPreview('light')}
              {@render miniPreview('dark')}
            {:else}
              {@render miniPreview(mode.value)}
            {/if}
          </div>
          <span class="mode-caption"><mode.icon size={13}/>{mode.label}{#if value.mode === mode.value}<Check size={13}/>{/if}</span>
        </button>
      {/each}
    </div>
  </section>
  <section aria-labelledby="theme-title">
    <div class="section-title"><h3 id="theme-title">Motywy</h3><div class="theme-actions"><Button size="xs" variant="outline" onclick={() => openEditor('create')}><Paintbrush/>Utwórz motyw</Button><Button size="xs" variant="outline" onclick={() => openEditor('import')}><Plus/>Dodaj motyw</Button></div></div>
    <p class="theme-help">Wybierz osobno motyw jasny i ciemny. Kliknięcie nazwy wybiera oba dostępne warianty.</p>
    <div class="theme-grid">
      {#each themeItems as theme (theme.id)}
        <ThemeCard {theme} lightSelected={owner('light') === theme.id} darkSelected={owner('dark') === theme.id}
          onselect={(mode) => selectHalf(theme.id, mode)} onuse={() => useTheme(theme)} onduplicate={() => openEditor('duplicate', theme)}
          onedit={isCustomTheme(theme.id) ? () => openEditor('edit', theme) : undefined}
          ondownload={isCustomTheme(theme.id) ? () => download(theme) : undefined}
          onremove={isCustomTheme(theme.id) ? () => { deleteTarget = theme; failure = '' } : undefined}/>
      {/each}
    </div>
    <p class="theme-current">Jasny: {getTheme(owner('light'))?.label || 'Labs'} · Ciemny: {getTheme(owner('dark'))?.label || 'Labs'}</p>
    {#if message}<p class="theme-message" role="status">{message}</p>{/if}
    {#if failure && !deleteTarget}<p class="theme-error" role="alert">{failure}</p>{/if}
    {#if libraryWarning}<p class="theme-error" role="alert">{libraryWarning}</p>{/if}
  </section>
  <section aria-labelledby="orb-title">
    <h3 id="orb-title">Kula głosu</h3>
    <div class="settings-group">
      <div class="appearance-row orb-style-row">
        <div class="orb-style-preview" aria-hidden="true"><VoiceOrb {voiceId} size={176} variant={value.orbVariant} preview/></div>
        <div class="orb-style-options"><h4>Styl kuli</h4><p id="orb-style-description">Jeden styl w całej aplikacji: edytorze, odtwarzaczu i podglądach głosu.</p>
          <div class="orb-style-control"><Select ariaLabel="Styl kuli głosu" aria-describedby="orb-style-description" bind:value={orbSelection} options={orbStyles} onchange={selectOrbStyle}/></div>
          <p class="orb-preview-note">Animacja pokazowa — bez odtwarzania dźwięku.</p>
        </div>
      </div>
    </div>
  </section>
  <section aria-labelledby="interface-title">
    <h3 id="interface-title">Interfejs</h3>
    <div class="settings-group">
      <div class="appearance-row"><div><h4>Kontrast</h4><p>Wyrazistość obramowań i podziałów interfejsu.</p></div><div class="row-control"><Slider label="Kontrast" value={value.contrast} min={75} max={150} step={5} valueLabel={`${value.contrast}%`} onchange={(contrast) => update({ contrast })}/></div></div>
      <div class="appearance-row"><div><h4>Przezroczystość menu</h4><p>Wyższa wartość daje bardziej jednolite tło.</p></div><div class="row-control"><Slider label="Nieprzezroczystość" value={value.glassOpacity} min={70} max={100} step={5} valueLabel={`${value.glassOpacity}%`} onchange={(glassOpacity) => update({ glassOpacity })}/></div></div>
      <div class="appearance-row"><div><h4>Rozmiar tekstu interfejsu</h4><p>Czytelność menu, przycisków i ustawień.</p></div><div class="row-control"><Slider label="Tekst interfejsu" value={value.interfaceFontSize} min={12} max={16} valueLabel={`${value.interfaceFontSize} px`} onchange={(interfaceFontSize) => update({ interfaceFontSize })}/></div></div>
      <div class="appearance-row"><div><h4>Rozmiar tekstu edytora</h4><p>Więcej przestrzeni lub większe litery podczas pisania.</p></div><div class="row-control"><Slider label="Tekst edytora" value={value.editorFontSize} min={16} max={24} valueLabel={`${value.editorFontSize} px`} onchange={(editorFontSize) => update({ editorFontSize })}/></div></div>
      <div class="appearance-row"><div><h4>Ogranicz animacje</h4><p>Wyłącz płynne przejścia elementów interfejsu.</p></div><Switch label="Ogranicz animacje" checked={value.reduceMotion} onchange={(reduceMotion) => update({ reduceMotion })}/></div>
    </div>
    <p class="font-note">Krój pisma: Segoe UI · systemowa czcionka Windows</p>
  </section>
</div>

{#if editor}<ThemeDialog kind={editor.kind} seed={editor.seed} onsubmit={saved} onclose={() => editor = undefined}/>{/if}
{#if deleteTarget}
  <dialog class="remove-dialog" use:mountDialog aria-labelledby="remove-theme-title" oncancel={(event) => { event.preventDefault(); deleteTarget = undefined }}><h2 id="remove-theme-title">Usunąć motyw „{deleteTarget.label}”?</h2><p>Usuniesz jeden własny motyw. Jeśli jest używany, zastąpi go Labs.</p>{#if failure}<p class="theme-error" role="alert">{failure}</p>{/if}<div><Button variant="outline" onclick={() => deleteTarget = undefined}>Anuluj</Button><Button variant="destructive" onclick={remove}>Usuń motyw</Button></div></dialog>
{/if}

<style>
  .appearance-panel{max-width:820px;margin:0 auto;padding:30px 34px 48px;color:var(--foreground);font-family:var(--font-ui);font-size:var(--ui-font-size,13px)}
  .appearance-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:32px}.appearance-header h2{font-size:var(--ui-text-22);font-weight:600;letter-spacing:-.5px;margin:0 0 7px}.appearance-header p{color:var(--muted);margin:0;font-size:var(--ui-text-13)}
  button{font:inherit;color:inherit;cursor:pointer}button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}

  section+section{margin-top:27px}h3{font-size:var(--ui-text-12);font-weight:500;color:var(--muted);margin:0 0 13px 8px}.section-title{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
  .mode-grid,.theme-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
  .mode-card{padding:8px 8px 9px;background:var(--surface);border:1px solid var(--border);border-radius:12px;min-width:0;transition:border-color var(--motion-duration)}.mode-card:hover{border-color:color-mix(in srgb,var(--foreground) 30%,var(--border))}.mode-card.selected{border-color:var(--accent);box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 15%,transparent)}
  .mode-caption{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:9px;font-size:var(--ui-text-12);color:var(--muted)}.selected .mode-caption{color:var(--foreground)}
  .mini-app{height:104px;border:1px solid #ffffff0b;border-radius:7px;position:relative;overflow:hidden}
  .mini-scene{position:absolute;inset:0;display:flex;background:var(--preview-bg)}.preview-system .mini-scene:last-child{clip-path:inset(0 0 0 50%)}
  .mini-sidebar{width:22%;flex-shrink:0;padding:9px 5px;border-right:1px solid #7772;background:var(--preview-panel);display:flex;flex-direction:column;gap:5px}.mini-sidebar i{height:6px;background:var(--preview-line);border-radius:4px}.mini-sidebar i:first-child{height:8px;background:var(--preview-text);border:1px solid #0001;margin-bottom:3px}
  .mini-main{flex:1;min-width:0;padding:10px 9px;position:relative}.mini-topline{height:9px;width:40%;margin-left:auto;background:color-mix(in srgb,var(--preview-accent) 25%,transparent);border-radius:20px}.mini-text{margin-top:9px;display:flex;flex-direction:column;gap:5px}.mini-text i{height:5px;border-radius:4px;background:var(--preview-line);width:69%}.mini-text i:nth-child(2){width:53%}.mini-text i:nth-child(3){width:40%}

  .mini-composer{position:absolute;bottom:9px;left:9px;right:9px;height:16px;display:flex;align-items:center;gap:10px;padding:0 5px;border:1px solid #8883;border-radius:6px}.mini-composer i{width:38%;height:4px;background:var(--preview-line);border-radius:4px}.mini-composer b{height:8px;width:8px;background:var(--preview-accent);border-radius:100%;margin-left:auto}
  .mini-popover{position:absolute;top:9px;right:8px;border:1px solid #8883;border-radius:7px;background:var(--preview-bg);box-shadow:0 2px 4px #0002;width:35px;padding:8px 5px;display:flex;flex-direction:column;gap:6px}.mini-popover i{height:3px;border-left:3px solid #85bba5;background:var(--preview-line);border-radius:1px}.mini-popover i:nth-child(2){border-left-color:#b49ed3}.mini-popover i:nth-child(3){border-left-color:#d9ba76}

  .settings-group{border:1px solid var(--border);border-radius:12px;background:var(--surface)}.appearance-row{display:flex;align-items:center;justify-content:space-between;gap:26px;padding:15px 16px;min-height:70px;box-sizing:border-box}.appearance-row+.appearance-row{border-top:1px solid var(--border)}.appearance-row h4{font-size:var(--ui-font-size,13px);font-weight:500;margin:0 0 5px}.appearance-row p{color:var(--muted);font-size:var(--ui-text-12);margin:0;line-height:1.5}.row-control{width:190px;flex-shrink:0}.row-control :global(.vs-slider-caption label){font-size:var(--ui-text-10);color:var(--muted)}.font-note{font-size:var(--ui-text-11);color:var(--muted);margin:12px 8px 0}
  .orb-style-row{justify-content:flex-start;gap:32px;padding:22px 24px}.orb-style-preview{display:grid;place-items:center;width:176px;flex:none}.orb-style-options{flex:1;min-width:0}.orb-style-control{max-width:240px;margin-top:14px}.orb-style-options .orb-preview-note{font-size:var(--ui-text-11);margin-top:10px}
  .theme-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-bottom:10px}.theme-help,.theme-current{font-size:var(--ui-text-11);color:var(--muted);line-height:1.6;margin:0 8px 12px}.theme-current{margin-top:12px}.theme-message{font-size:var(--ui-text-12);color:var(--foreground);margin:12px 8px}.theme-error{font-size:var(--ui-text-12);color:var(--danger);line-height:1.6;margin:12px 0}.remove-dialog{width:min(440px,calc(100vw - 32px));padding:24px;border:1px solid var(--border);border-radius:12px;color:var(--foreground);box-shadow:var(--popup-shadow)}.remove-dialog h2{font-size:var(--ui-text-17);line-height:1.5}.remove-dialog p{font-size:var(--ui-text-12);line-height:1.7;color:var(--muted);margin:12px 0 22px}.remove-dialog>div{display:flex;justify-content:flex-end;gap:8px}
  @media(min-width:1200px){.mini-app{height:122px}}
  @media(max-width:650px){.appearance-panel{padding:22px 18px}.mode-grid{gap:7px}.theme-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.mini-app{height:80px}.mini-popover{display:none}.appearance-row{gap:15px;flex-wrap:wrap}.row-control{width:100%;flex-basis:100%}.appearance-row:last-child{flex-wrap:nowrap}.appearance-row.orb-style-row{flex-wrap:wrap}.appearance-header{gap:12px}}
  @media(max-width:650px){.orb-style-row{flex-direction:column;align-items:stretch;padding:22px 16px;gap:22px}.orb-style-preview{align-self:center}.orb-style-control{max-width:none}}
</style>
