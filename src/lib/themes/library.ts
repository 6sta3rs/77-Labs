import { T3_CODE_LIGHT_THEME_COLORS, T3_CODE_DARK_THEME_COLORS, T3_CHAT_THEME, GROVE_THEME, OCEAN_THEME, EMBER_THEME, IRIS_THEME, THEME_COLOR_ROLES, RESERVED_THEME_IDS, getThemeColorsForAppearance, type ThemeColors, type ThemeDefinition, type ThemeAppearance } from './t3-palettes'

export const THEME_LIBRARY_KEY = 'voicestudio.themes.v1'
export const MAX_THEME_BYTES = 256 * 1024
export const builtInThemes: ThemeDefinition[] = [
  // Public display names; the imported palette definitions retain upstream attribution.
  { id: 'studio', label: 'Labs', appearance: 'light', colors: T3_CODE_LIGHT_THEME_COLORS, variants: { dark: T3_CODE_DARK_THEME_COLORS } },
  { ...T3_CHAT_THEME, id: 'rose', label: 'Róża' }, GROVE_THEME, OCEAN_THEME, EMBER_THEME, IRIS_THEME,
]
const reserved = new Set([...RESERVED_THEME_IDS, ...builtInThemes.map(theme => theme.id), 't3-code'])
let customThemes: ThemeDefinition[] = []
let loaded = false
export let libraryWarning = ''
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const isMode = (value: unknown): value is ThemeAppearance => value === 'light' || value === 'dark'
export const defaultColors = (mode: ThemeAppearance) => mode === 'light' ? T3_CODE_LIGHT_THEME_COLORS : T3_CODE_DARK_THEME_COLORS
export function validThemeColor(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 160 && !/[;{}]|\b(var|env|url|attr|light-dark)\s*\(|currentcolor|inherit|initial|unset|revert/i.test(value) && typeof CSS !== 'undefined' && CSS.supports('color', value)
}
function parseColors(value: unknown, mode: ThemeAppearance): ThemeColors {
  if (!isRecord(value) || Object.keys(value).length === 0) throw new Error('Dodaj przynajmniej jeden kolor w obiekcie colors.')
  const colors = { ...defaultColors(mode) }
  for (const [role, color] of Object.entries(value)) {
    if (!(THEME_COLOR_ROLES as readonly string[]).includes(role)) throw new Error(`Nieznana rola koloru: ${role}.`)
    if (!validThemeColor(color)) throw new Error(`Nieprawidłowy kolor „${role}”. Użyj np. #346bf1 lub oklch(0.62 0.2 280).`)
    colors[role as keyof ThemeColors] = color.trim()
  }
  return colors
}
export function parseThemeFile(text: string): ThemeDefinition {
  if (new TextEncoder().encode(text).length > MAX_THEME_BYTES) throw new Error('Motyw może mieć najwyżej 256 KB.')
  let data: unknown
  try { data = JSON.parse(text) } catch { throw new Error('Nieprawidłowy JSON. Sprawdź przecinki i cudzysłowy.') }
  if (!isRecord(data) || data.version !== 1) throw new Error('Wymagany format motywu JSON: version: 1.')
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 48) throw new Error('Nazwa musi mieć od 1 do 48 znaków.')
  if (!isMode(data.appearance)) throw new Error('Pole appearance musi mieć wartość light lub dark.')
  const id = data.id ?? `custom-${crypto.randomUUID()}`
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,95}$/.test(id) || reserved.has(id)) throw new Error('Identyfikator id musi być unikalny, z małych liter, cyfr i myślników. Nazwy motywów wbudowanych są zarezerwowane.')
  const variants: Partial<Record<ThemeAppearance, ThemeColors>> = {}
  if (data.variants !== undefined) {
    if (!isRecord(data.variants)) throw new Error('Pole variants musi być obiektem.')
    for (const [mode, colors] of Object.entries(data.variants)) {
      if (!isMode(mode) || mode === data.appearance) throw new Error('W variants dodaj wyłącznie drugi wariant: light lub dark.')
      variants[mode] = parseColors(colors, mode)
    }
  }
  return { id, label: data.name.trim(), appearance: data.appearance, colors: parseColors(data.colors, data.appearance), ...(Object.keys(variants).length ? { variants } : {}) }
}
export const serializeTheme = (theme: ThemeDefinition) => JSON.stringify({ version: 1, id: theme.id, name: theme.label, appearance: theme.appearance, colors: theme.colors, ...(theme.variants ? { variants: theme.variants } : {}) }, null, 2) + '\n'
export function loadThemeLibrary() {
  if (loaded || typeof localStorage === 'undefined') return
  loaded = true
  try {
    const files: unknown = JSON.parse(localStorage.getItem(THEME_LIBRARY_KEY) || '[]')
    if (!Array.isArray(files)) throw new Error()
    const seen = new Set<string>()
    for (const file of files) {
      try {
        const theme = parseThemeFile(JSON.stringify(file))
        if (seen.has(theme.id)) throw new Error()
        seen.add(theme.id); customThemes.push(theme)
      } catch { libraryWarning = 'Pominięto uszkodzony motyw. Oryginalne dane pozostają w pamięci przeglądarki.' }
    }
  } catch { libraryWarning = 'Nie udało się odczytać biblioteki własnych motywów. Nie nadpisano jej danych.' }
}
export function getThemes() { loadThemeLibrary(); return [...builtInThemes, ...customThemes] }
export function getTheme(id: string) { return getThemes().find(theme => theme.id === id) }
export function colorsForTheme(id: string, mode: ThemeAppearance) { const theme = getTheme(id); return (theme && getThemeColorsForAppearance(theme, mode)) || defaultColors(mode) }
export function isCustomTheme(id: string) { return customThemes.some(theme => theme.id === id) }
function persist(themes: ThemeDefinition[]) {
  if (libraryWarning) throw new Error('Biblioteka zawiera uszkodzone dane. Zachowaj jej kopię i napraw ją przed zapisem nowych motywów.')
  try { localStorage.setItem(THEME_LIBRARY_KEY, JSON.stringify(themes.map(theme => JSON.parse(serializeTheme(theme))))) }
  catch { throw new Error('Nie udało się zapisać motywu. Pamięć lokalna jest niedostępna lub pełna.') }
  customThemes = themes
}
export function saveCustomTheme(theme: ThemeDefinition, editingId?: string) {
  const checked = parseThemeFile(serializeTheme(theme))
  loadThemeLibrary()
  if (getTheme(checked.id) && checked.id !== editingId) throw new Error('Motyw o tym id już istnieje. Zmień id w JSON lub edytuj istniejący motyw.')
  if (editingId && (!isCustomTheme(editingId) || checked.id !== editingId)) throw new Error('Nie można zastąpić tego motywu.')
  persist(editingId ? customThemes.map(item => item.id === editingId ? checked : item) : [...customThemes, checked])
  return checked
}
export function removeCustomTheme(id: string) { loadThemeLibrary(); persist(customThemes.filter(theme => theme.id !== id)) }
export function duplicateTheme(theme: ThemeDefinition): ThemeDefinition {
  return { ...JSON.parse(JSON.stringify(theme)) as ThemeDefinition, id: `custom-${crypto.randomUUID()}`, label: `${theme.label.slice(0, 42)} kopia` }
}
export function themeSwatch(colors: ThemeColors) { return `radial-gradient(circle at 28% 22%, ${colors.accent}, ${colors.sidebar} 68%, ${colors.canvas})` }
