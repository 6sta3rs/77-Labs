import { builtInThemes, getTheme, colorsForTheme, themeSwatch, loadThemeLibrary } from '../themes/library'
import { getThemeColorsForAppearance, type ThemeColors } from '../themes/t3-palettes'
import { normalizeOrbVariant, orbPalettes, setOrbPalette, type OrbVariant } from '../playback/voice-orb'
import { neutralSelectionForColor } from '../styles/neutral-selection'
import { uiColorsForPalette } from '../styles/ui-colors'

export type ThemeName = string
export type AppearanceSettings = {
  mode: 'system' | 'light' | 'dark'
  theme: ThemeName
  lightTheme: ThemeName
  darkTheme: ThemeName
  contrast: number
  interfaceFontSize: number
  editorFontSize: number
  glassOpacity: number
  reduceMotion: boolean
  orbVariant: OrbVariant
  /** 'voice' = each voice keeps its own colour; otherwise an `orbPalettes` id. */
  orbPalette: string
}

export const defaultAppearance: AppearanceSettings = {
  mode: 'dark', theme: 'studio', lightTheme: 'studio', darkTheme: 'studio', contrast: 100,
  interfaceFontSize: 13, editorFontSize: 18, glassOpacity: 95, reduceMotion: false, orbVariant: 'storm', orbPalette: 'voice',
}

export const themeColors = colorsForTheme
export const themes = builtInThemes.map(theme => ({
  name: theme.id, label: theme.label,
  light: themeSwatch(themeColors(theme.id, 'light')), dark: themeSwatch(themeColors(theme.id, 'dark')),
}))

const STORAGE_KEY = 'voicestudio.appearance.v2'
const clamp = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
export function loadAppearance(): AppearanceSettings {
  loadThemeLibrary()
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    const legacy = typeof saved.theme === 'string' && getTheme(saved.theme) ? saved.theme : defaultAppearance.theme
    const validHalf = (id: unknown, mode: 'light' | 'dark') => {
      const theme = typeof id === 'string' ? getTheme(id) : undefined
      return theme && getThemeColorsForAppearance(theme, mode) ? theme.id : 'studio'
    }
    return {
      mode: ['light', 'dark', 'system'].includes(saved.mode) ? saved.mode : defaultAppearance.mode,
      theme: legacy,
      lightTheme: validHalf(saved.lightTheme ?? legacy, 'light'),
      darkTheme: validHalf(saved.darkTheme ?? legacy, 'dark'),
      contrast: clamp(saved.contrast, 100, 75, 150),
      interfaceFontSize: clamp(saved.interfaceFontSize, 13, 12, 16),
      editorFontSize: clamp(saved.editorFontSize, 18, 16, 24),
      glassOpacity: clamp(saved.glassOpacity, 95, 70, 100),
      reduceMotion: typeof saved.reduceMotion === 'boolean' ? saved.reduceMotion : false,
      orbVariant: normalizeOrbVariant(saved.orbVariant, defaultAppearance.orbVariant),
      orbPalette: orbPalettes.some(palette => palette.id === saved.orbPalette) ? saved.orbPalette : 'voice',
    }
  } catch { return { ...defaultAppearance } }
}

export function saveAppearance(settings: AppearanceSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); return true } catch { return false }
}

let currentSettings: AppearanceSettings | undefined
let watchingSystem = false
export function applyAppearance(settings: AppearanceSettings, previewColors?: ThemeColors) {
  if (typeof document === 'undefined') return
  currentSettings = { ...settings }
  setOrbPalette(settings.orbPalette ?? 'voice')
  if (!watchingSystem && typeof matchMedia !== 'undefined') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (currentSettings?.mode === 'system') applyAppearance(currentSettings)
    })
    watchingSystem = true
  }
  const dark = settings.mode === 'dark' || (settings.mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  const root = document.documentElement
  const activeTheme = (dark ? settings.darkTheme : settings.lightTheme) || settings.theme
  const palette = previewColors || themeColors(activeTheme, dark ? 'dark' : 'light')
  const neutral = neutralSelectionForColor(palette.canvas, dark)
  const uiColors = uiColorsForPalette(palette, dark)
  const contrastColor = dark ? '#ffffff' : '#000000'
  const border = settings.contrast === 100 ? palette.border : `color-mix(in srgb, ${palette.border}, ${settings.contrast > 100 ? contrastColor : palette.canvas} ${Math.abs(settings.contrast - 100) * .5}%)`
  const tokens: Record<string, string> = {
    '--background': palette.canvas,
    '--neutral-selected-background': neutral.background,
    '--neutral-selected-foreground': neutral.foreground,
    '--neutral-selected-border': neutral.border,
    '--neutral-selected-hover': neutral.hover,
    '--surface': palette.surface,
    '--surface-raised': palette.surfaceRaised,
    '--surface-overlay': palette.surfaceOverlay,
    '--surface-hover': palette.accentSurface,
    '--sidebar': palette.sidebar,
    '--sidebar-foreground': palette.sidebarForeground,
    '--sidebar-muted': palette.sidebarMutedForeground,
    '--sidebar-hover': palette.sidebarRowHover,
    '--sidebar-selected': palette.sidebarRowSelected,
    '--sidebar-control': palette.sidebarControlSurface,
    '--sidebar-border': palette.sidebarBorder,
    '--foreground': palette.text,
    '--muted': palette.textMuted,
    '--overlay-muted': uiColors.overlayMuted,
    '--overlay-placeholder': uiColors.overlayPlaceholder,
    '--border': border,
    '--input-border': palette.input,
    '--control-background': dark ? `color-mix(in srgb, ${palette.input} 32%, transparent)` : palette.canvas,
    '--control-shadow': dark ? 'inset 0 -1px rgb(255 255 255 / 6%)' : 'inset 0 1px rgb(0 0 0 / 4%), 0 1px 2px rgb(0 0 0 / 2.5%)',
    '--placeholder': palette.placeholder,
    '--secondary': palette.secondary,
    '--secondary-foreground': palette.secondaryForeground,
    '--muted-surface': palette.muted,
    '--secondary-label': palette.secondaryLabel,
    '--icon-muted': palette.iconMuted,
    '--popover': palette.surfaceOverlay,
    '--popover-foreground': palette.text,
    '--destructive': palette.error,
    '--destructive-foreground': palette.errorForeground,
    '--destructive-surface': palette.errorSurface,
    '--destructive-button-background': uiColors.destructiveBackground,
    '--destructive-button-foreground': uiColors.destructiveForeground,
    '--destructive-button-hover': uiColors.destructiveHover,
    '--switch-on-background': uiColors.switchOnBackground,
    '--switch-on-foreground': uiColors.switchOnForeground,
    '--option-highlight': palette.accentSurface,
    '--accent': palette.accent,
    '--accent-foreground': palette.accentForeground,
    '--primary': palette.messageAction,
    '--primary-foreground': palette.messageActionForeground,
    '--primary-hover': palette.messageActionHover,
    '--focus': palette.focus,
    '--tag': palette.accent,
    '--tag-background': `color-mix(in srgb, ${palette.accent} 12%, transparent)`,
    '--danger': palette.errorForeground,
    '--success': dark ? '#8bc6a8' : '#28764e',
    '--editor-font-size': `${settings.editorFontSize}px`,
    '--ui-font-size': `${settings.interfaceFontSize}px`,
    '--font-ui': '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    '--radius': '8px',
    '--glass-opacity': `${settings.glassOpacity}%`,
    '--motion-duration': settings.reduceMotion ? '0ms' : '140ms',
    '--popup-shadow': dark ? '0 12px 40px #0008, 0 2px 8px #0005' : '0 12px 40px #17172418, 0 2px 8px #17172412',
  }
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value)
  root.dataset.theme = activeTheme
  root.dataset.colormode = dark ? 'dark' : 'light'
  root.dataset.reducedMotion = String(settings.reduceMotion)
  root.style.colorScheme = dark ? 'dark' : 'light'
}
