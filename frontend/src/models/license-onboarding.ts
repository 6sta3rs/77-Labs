import { translateUi } from '../i18n';
import { parseModelLicenseDetails, validModelRepo, type ModelAcceptance, type ModelLicenseTransport } from './model-licenses'

export type LicenseOnboardingPlan = {
  schema: 1
  source: string
  engine: { id: string; label?: string; model_id?: string }
  models: ModelAcceptance[]
}
export const onboardingStorageKey = 'voicestudio.license-onboarding.v1'

/** This is a UI hint only. The backend remains the source of every decision. */
export function completedOnboarding(storage: Pick<Storage, 'getItem'>): boolean {
  try {
    const hint = JSON.parse(storage.getItem(onboardingStorageKey) || 'null')
    return hint?.schema === 1 && typeof hint.key === 'string' && hint.key.length > 0
  } catch { return false }
}
export function pendingLicenses(plan: LicenseOnboardingPlan) {
  return plan.models.filter(model => model.required && !model.accepted)
}
export function onboardingPlanKey(plan: LicenseOnboardingPlan) {
  return JSON.stringify([plan.source, plan.engine.id, plan.engine.model_id || '', ...plan.models.map(model => [model.repo_id, model.fingerprint]).sort((a, b) => a[0].localeCompare(b[0]))])
}
export function rememberOnboarding(storage: Pick<Storage, 'setItem' | 'removeItem'>, plan: LicenseOnboardingPlan) {
  if (pendingLicenses(plan).length) storage.removeItem(onboardingStorageKey)
  else storage.setItem(onboardingStorageKey, JSON.stringify({ schema: 1, key: onboardingPlanKey(plan) }))
}
export function parseOnboardingPlan(raw: unknown): LicenseOnboardingPlan {
  if (!raw || typeof raw !== 'object') throw new Error(translateUi("Silnik nie zwrócił planu warunków modeli."))
  const plan = raw as LicenseOnboardingPlan
  if (plan.schema !== 1 || typeof plan.source !== 'string' || !plan.source || plan.source.length > 500 || !plan.engine || typeof plan.engine.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(plan.engine.id) || (plan.engine.model_id !== undefined && !validModelRepo(plan.engine.model_id)) || (plan.engine.label !== undefined && typeof plan.engine.label !== 'string') || !Array.isArray(plan.models) || plan.models.length > 100) throw new Error(translateUi("Niepełny plan warunków. Zaktualizuj silnik lub ponów sprawdzanie."))
  if (!plan.models.length) throw new Error(translateUi("Plan nie wskazuje żadnego sprawdzonego modelu. Otwórz ustawienia i wybierz obsługiwany silnik."))
  const seen = new Set<string>()
  for (const model of plan.models) {
    if (!model || !validModelRepo(model.repo_id) || seen.has(model.repo_id)) throw new Error(translateUi("Nieprawidłowa lista modeli w planie warunków."))
    parseModelLicenseDetails({ repo_id: model.repo_id, info: {}, acceptance: model, history: [] }, model.repo_id)
    if ((model.accepted && model.state !== 'accepted' && model.state !== 'not_required') || (!model.accepted && model.state === 'accepted') || (!model.required && model.state !== 'not_required') || (model.required && model.state === 'not_required')) throw new Error(translateUi("Niespójny stan warunków modelu. Odśwież informacje."))
    seen.add(model.repo_id)
  }
  return plan
}
export async function readOnboardingPlan(transport: ModelLicenseTransport, signal: AbortSignal) {
  const response = await transport('/next/models/onboarding', { signal })
  signal.throwIfAborted()
  if (response.status === 404 || response.status === 501) throw new Error(translateUi("Ten silnik nie obsługuje przeglądu warunków przy starcie. Zaktualizuj prywatny silnik do bieżącej wersji aplikacji. Brak API nie potwierdza zgód."))
  const text = await response.text()
  signal.throwIfAborted()
  if (text.length > 1024 * 1024) throw new Error(translateUi("Plan warunków przekracza limit 1 MB."))
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error(translateUi("Nie udało się odczytać planu warunków modeli.")) }
  if (!response.ok) {
    const detail = (raw as { detail?: unknown })?.detail
    const message = typeof detail === 'string' ? detail : detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string' ? detail.message : ''
    throw new Error(message ? message.slice(0, 500) : translateUi("Nie można ustalić wymaganych modeli ({arg0}). Ponów sprawdzanie po uruchomieniu silnika.", { arg0: String(response.status) }))
  }
  return parseOnboardingPlan(raw)
}
