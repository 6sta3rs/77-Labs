import { get, writable } from 'svelte/store'

export type TranslationQuality = 'fast' | 'autofit' | 'cinematic'
export type GeneralPreferences = { reviewMode: boolean; translationQuality: TranslationQuality }
const key = 'voicestudio.general.v1'
const defaults: GeneralPreferences = { reviewMode: true, translationQuality: 'fast' }
function read(): GeneralPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}')
    return { reviewMode: typeof saved.reviewMode === 'boolean' ? saved.reviewMode : true,
      translationQuality: ['fast', 'autofit', 'cinematic'].includes(saved.translationQuality) ? saved.translationQuality : 'fast' }
  } catch { return { ...defaults } }
}
export const generalPreferences = writable<GeneralPreferences>(read())
export const currentGeneralPreferences = () => get(generalPreferences)
export function saveGeneralPreferences(value: GeneralPreferences) {
  if (typeof value.reviewMode !== 'boolean' || !['fast', 'autofit', 'cinematic'].includes(value.translationQuality)) throw new Error('Nieprawidłowe preferencje ogólne.')
  const next = { reviewMode: value.reviewMode, translationQuality: value.translationQuality }
  localStorage.setItem(key, JSON.stringify(next))
  generalPreferences.set(next)
}

export type LlmProvider = { id: string; display_name: string; local: boolean; needs_account?: boolean; base_url: string; model: string; account_id?: string; has_key: boolean; key_from_env?: boolean; active_from_env?: boolean; configured: boolean }
export type LlmProviders = { active?: string | null; engine_active?: string; engine_from_env?: boolean; providers: LlmProvider[] }
export type LlmSkill = { id: string; enabled: boolean; provider_override?: string; provider_display_name?: string; ready: boolean; reason?: string }
export type RefinementSettings = { auto: boolean; smart_cleanup: boolean; self_correction: boolean; preserve_technical: boolean; llm_ready: boolean; last_refine_status?: { ok: boolean; reason?: string; at?: number } }
export type AsrEndpoint = { base_url: string; model: string; has_key: boolean }
export type ConnectionResult = { ok: boolean; detail?: string; reply?: string; kind?: string; model?: string; latency_ms?: number; status?: string }
export const skillLabels: Record<string, string> = {
  dub_translation: 'Tłumaczenie dubbingu', cinematic_translation: 'Naturalne tłumaczenie i dopasowanie',
  slot_fitting: 'Dopasowanie tekstu do czasu', glossary_extract: 'Wydobywanie słownika terminów',
  direction_parse: 'Rozpoznawanie wskazówek wykonania', dictation_refinement: 'Redakcja transkrypcji i dyktowania',
}
export function connectionMessage(result: ConnectionResult): string {
  if (result.ok) return `Połączenie potwierdzone${result.model ? ` · ${result.model}` : ''}${typeof result.latency_ms === 'number' ? ` · ${Math.round(result.latency_ms)} ms` : ''}.`
  const labels: Record<string, string> = { config: 'Uzupełnij konfigurację dostawcy.', auth: 'Serwer odrzucił uwierzytelnienie.', not_found: 'Nie znaleziono modelu lub endpointu.', rate_limit: 'Dostawca odrzucił żądanie z powodu limitu.', network: 'Nie można połączyć się z serwerem.' }
  return labels[result.kind || ''] || result.detail || 'Test nie potwierdził połączenia.'
}
