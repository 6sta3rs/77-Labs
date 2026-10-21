import type { Voice } from './data'
import type { Profile } from './api'

export function profileCreatedAt(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? Number(value) : undefined
  const date = new Date(numeric === undefined ? String(value) : numeric < 1e12 ? numeric * 1000 : numeric)
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return
  return date.toISOString()
}
const accents: Record<string, string> = { 'american accent': 'Amerykański', 'british accent': 'Brytyjski', 'australian accent': 'Australijski', 'canadian accent': 'Kanadyjski', 'indian accent': 'Indyjski', 'chinese accent': 'Chiński', 'korean accent': 'Koreański', 'japanese accent': 'Japoński', 'portuguese accent': 'Portugalski', 'russian accent': 'Rosyjski' }
export function profileAccent(profile: Profile): string | undefined {
  if (typeof profile.accent === 'string' && profile.accent.trim()) return profile.accent.trim()
  try {
    const attrs = typeof profile.vd_states === 'string' ? JSON.parse(profile.vd_states) : profile.vd_states
    const value = attrs?.EnglishAccent
    if (typeof value === 'string' && value !== 'Auto') return accents[value] || value
    if (typeof attrs?.ChineseDialect === 'string' && attrs.ChineseDialect !== 'Auto') return attrs.ChineseDialect
  } catch { /* An absent or invalid recipe is not a declared accent. */ }
}
export function profileVoiceMetadata(profile: Profile): Pick<Voice, 'createdAt' | 'accent'> {
  return { createdAt: profileCreatedAt(profile.created_at), accent: profileAccent(profile) }
}
export function voiceAge(createdAt?: string, now = Date.now()): string {
  if (!createdAt) return 'Brak daty'
  const age = now - new Date(createdAt).getTime()
  if (!Number.isFinite(age) || age < 0) return 'Brak daty'
  const days = Math.floor(age / 86400000), years = Math.floor(days / 365.25), months = Math.floor(days / 30.44)
  const plural = (n: number, one: string, few: string, many: string) => `${n} ${n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many}`
  return years ? plural(years, 'rok', 'lata', 'lat') : months ? plural(months, 'miesiąc', 'miesiące', 'miesięcy') : days ? plural(days, 'dzień', 'dni', 'dni') : 'Dzisiaj'
}
