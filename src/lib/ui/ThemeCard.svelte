<script lang="ts">
  import { Copy, Download, Moon, Pencil, Sun, Trash2 } from '@lucide/svelte'
  import { getThemeColorsForAppearance, type ThemeAppearance, type ThemeDefinition } from '../themes/t3-palettes'
  import { themeSwatch } from '../themes/library'
  import Button from './Button.svelte'
  import Tooltip from './Tooltip.svelte'

  let { theme, lightSelected = false, darkSelected = false, onselect, onuse, onduplicate, ondownload, onedit, onremove, disabled = false }: {
    theme: ThemeDefinition; lightSelected?: boolean; darkSelected?: boolean; disabled?: boolean
    onselect: (mode: ThemeAppearance) => void; onuse: () => void
    onduplicate?: () => void; ondownload?: () => void; onedit?: () => void; onremove?: () => void
  } = $props()
</script>

<div class="theme-card" data-theme-id={theme.id}>
  <div class="theme-swatches">
    {#each ['light', 'dark'] as appearance}
      {@const mode = appearance as ThemeAppearance}
      {@const colors = getThemeColorsForAppearance(theme, mode)}
      {@const selected = mode === 'light' ? lightSelected : darkSelected}
      {#if colors}
        <Tooltip content={`Użyj tylko w trybie ${mode === 'light' ? 'jasnym' : 'ciemnym'}`} {disabled}>
          <button type="button" class="theme-orb" class:assigned={selected} style={`background:${themeSwatch(colors)}`} {disabled}
            aria-label={`${theme.label}: użyj w trybie ${mode === 'light' ? 'jasnym' : 'ciemnym'}`} aria-pressed={selected} onclick={() => onselect(mode)}>
            {#if selected}<span class="variant-badge">{#if mode === 'light'}<Sun size={10}/>{:else}<Moon size={10}/>{/if}</span>{/if}
          </button>
        </Tooltip>
      {:else}
        <span class="theme-orb unavailable" title={`Brak wariantu ${mode === 'light' ? 'jasnego' : 'ciemnego'}`} aria-label={`Brak wariantu ${mode === 'light' ? 'jasnego' : 'ciemnego'}`}></span>
      {/if}
    {/each}
  </div>
  <div class="theme-caption">
    <Tooltip content="Użyj dostępnych wariantów" {disabled}><button type="button" class="theme-name" {disabled} onclick={onuse}>{theme.label}</button></Tooltip>
    <div class="card-actions">
      {#if onduplicate}<Tooltip content="Utwórz edytowalną kopię" {disabled}><Button variant="ghost" size="icon-xs" {disabled} aria-label={`Kopiuj motyw ${theme.label}`} onclick={onduplicate}><Copy/></Button></Tooltip>{/if}
      {#if onedit}<Tooltip content="Edytuj motyw" {disabled}><Button variant="ghost" size="icon-xs" {disabled} aria-label={`Edytuj motyw ${theme.label}`} onclick={onedit}><Pencil/></Button></Tooltip>{/if}
      {#if ondownload}<Tooltip content="Eksportuj JSON" {disabled}><Button variant="ghost" size="icon-xs" {disabled} aria-label={`Eksportuj motyw ${theme.label}`} onclick={ondownload}><Download/></Button></Tooltip>{/if}
      {#if onremove}<Tooltip content="Usuń motyw" {disabled}><Button variant="ghost" size="icon-xs" {disabled} aria-label={`Usuń motyw ${theme.label}`} onclick={onremove}><Trash2/></Button></Tooltip>{/if}
    </div>
  </div>
</div>

<style>
  .theme-card{padding:14px 12px 12px;background:var(--background);border:1px solid var(--border);border-radius:14px;min-width:0;color:var(--foreground);font-family:var(--font-ui);transition:border-color var(--motion-duration,140ms)}
  .theme-card:hover{border-color:color-mix(in srgb,var(--foreground) 30%,var(--border))}
  .theme-swatches{display:flex;justify-content:center;gap:24px;padding:5px 0 17px}
  button{font:inherit;color:inherit;cursor:pointer}button:disabled{cursor:not-allowed;opacity:.64}button:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  .theme-orb{position:relative;width:44px;height:44px;display:block;border-radius:100%;border:0;padding:0;flex-shrink:0;outline-offset:5px;box-shadow:inset 0 0 0 1px #ffffff0a,0 2px 5px #0002}
  .theme-orb.assigned{outline:2px solid var(--focus)}.theme-orb:hover:not(:disabled){scale:1.04}
  .variant-badge{position:absolute;bottom:-5px;right:-5px;width:17px;height:17px;border:1px solid var(--border);border-radius:50%;display:grid;place-items:center;background:var(--background);color:var(--foreground)}
  .theme-orb.unavailable{background:repeating-linear-gradient(135deg,var(--surface) 0 4px,var(--border) 4px 5px);opacity:.35}
  .theme-caption{display:flex;align-items:center;justify-content:space-between;gap:4px;flex-wrap:wrap;font-size:var(--ui-text-12);font-weight:500;min-height:16px}
  .theme-name{font-weight:600;font-size:var(--ui-text-12);text-align:left;min-width:0;overflow-wrap:anywhere;flex:1;padding:3px 0;border:0;background:transparent}
  .card-actions{display:flex;align-items:center;gap:0;margin-left:auto}
  @media(min-width:1200px){.theme-orb{width:49px;height:49px}}
  @media(max-width:650px){.theme-swatches{gap:18px}}
</style>
