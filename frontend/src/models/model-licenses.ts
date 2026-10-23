import { translateUi } from '../i18n';
export type ModelLicenseCategory = 'commercial' | 'conditions' | 'unknown' | 'noncommercial'
export type ModelAcceptance = {
  repo_id: string; license: string | null; category: ModelLicenseCategory; required: boolean; accepted: boolean
  state: 'not_required' | 'accepted' | 'not_accepted' | 'withdrawn' | 'terms_updated'
  fingerprint: string; accepted_at?: string | null; changed_fields?: string[]
  last_action?: { action: string; at?: string | null; fingerprint?: string | null; app_version?: string | null } | null
}
export type LicenseVariant = Record<string, unknown> & { id?: string; label?: string; observations?: Record<string, unknown> }
export type ModelLicenseDetails = {
  repo_id: string
  info: Record<string, unknown> & { variants?: LicenseVariant[] }
  acceptance: ModelAcceptance
  history: Array<{ action: string; at?: string | null; fingerprint?: string | null; app_version?: string | null }>
}
export type RequiredModelLicense = { repo_id: string; license: string | null; category: ModelLicenseCategory; fingerprint?: string }
export type ModelLicenseTransport = (path: string, options?: RequestInit) => Promise<Response>

const categories = new Set(['commercial', 'conditions', 'unknown', 'noncommercial'])
const states = new Set(['not_required', 'accepted', 'not_accepted', 'withdrawn', 'terms_updated'])
const fingerprintPattern = /^v2:[a-f0-9]{64}$/

export function validModelRepo(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200 && /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/.test(value) && !value.split('/').some(part => part === '.' || part === '..')
}
export function requiredLicenseRepos(models: unknown): string[] {
  if (!Array.isArray(models)) return []
  return [...new Set(models.flatMap(model => model && typeof model === 'object' && validModelRepo(model.repo_id) ? [model.repo_id] : []))]
}
export function licenseLink(value: unknown) {
  if (typeof value !== 'string') return ''
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : '' } catch { return '' }
}
export function licenseText(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Nieustalone w rejestrze'
  if (Array.isArray(value)) return value.map(licenseText).join(', ')
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
}
export function licenseCategoryLabel(value: unknown) {
  return ({ commercial: translateUi("Komercyjne według klasyfikacji rejestru"), conditions: 'Dodatkowe warunki', unknown: 'Nieustalona / niezweryfikowana', noncommercial: translateUi("Niekomercyjna według rejestru") } as Record<string, string>)[String(value)] || 'Nieustalona / niezweryfikowana'
}
export function licenseStateLabel(value: string) {
  return ({ not_required: translateUi("Rejestr nie wymaga potwierdzenia"), accepted: translateUi("Lokalne potwierdzenie zapisane"), not_accepted: translateUi("Brak lokalnego potwierdzenia"), withdrawn: translateUi("Potwierdzenie cofnięte"), terms_updated: translateUi("Warunki zmieniły się — przeczytaj ponownie") } as Record<string, string>)[value] || 'Stan nieustalony'
}

export class ModelLicenseTermsChangedError extends Error {
  readonly code = 'terms_changed'
  constructor() { super(translateUi("Warunki modelu zmieniły się od chwili ich odczytania. Odśwież informacje i podejmij nową decyzję.")); this.name = 'ModelLicenseTermsChangedError' }
}
export class ModelLicenseRequiredError extends Error {
  readonly code = 'model_licence_required'
  constructor(readonly models: RequiredModelLicense[]) {
    super(models.length ? translateUi("Przed generowaniem wymagane jest sprawdzenie warunków modeli: {arg0}. Otwórz Ustawienia → Modele → Warunki modelu.", { arg0: String(models.map(model => `${model.repo_id} (${model.license || 'licencja nieustalona'})`).join('; ')) }) : translateUi("Silnik nie może zweryfikować rejestru licencji modeli. Otwórz Ustawienia → Modele i sprawdź informacje o modelach."))
    this.name = 'ModelLicenseRequiredError'
  }
}
export function modelLicenseFailure(body: unknown, status: number): ModelLicenseRequiredError | undefined {
  if (status !== 403 || !body || typeof body !== 'object') return undefined
  const raw = body as Record<string, unknown>, detail = raw.detail && typeof raw.detail === 'object' ? raw.detail as Record<string, unknown> : raw
  if (detail.code !== 'model_licence_required') return undefined
  const models = (Array.isArray(detail.models) ? detail.models : []).flatMap((model): RequiredModelLicense[] => {
    if (!model || typeof model !== 'object' || !validModelRepo(model.repo_id)) return []
    return [{ repo_id: model.repo_id, license: typeof model.license === 'string' ? model.license : null, category: categories.has(model.category) ? model.category : 'unknown', ...(typeof model.fingerprint === 'string' && fingerprintPattern.test(model.fingerprint) ? { fingerprint: model.fingerprint } : {}) }]
  })
  return new ModelLicenseRequiredError(models)
}
export function announceModelLicenseRequired(error: ModelLicenseRequiredError) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('studio:model-license-required', { detail: { models: error.models } }))
}
/** Inspect only the stock HTTP 403 shape; preserve the original response body. */
export async function assertModelLicenseResponse(response: Response, signal?: AbortSignal) {
  if (response.status !== 403) return
  signal?.throwIfAborted()
  let body: unknown
  try { body = await response.clone().json() } catch { signal?.throwIfAborted(); return }
  signal?.throwIfAborted()
  const error = modelLicenseFailure(body, response.status)
  if (error) { announceModelLicenseRequired(error); throw error }
}

export function parseModelLicenseDetails(raw: unknown, repo: string): ModelLicenseDetails {
  if (!raw || typeof raw !== 'object') throw new Error(translateUi("Silnik nie zwrócił informacji o licencji modelu."))
  const data = raw as ModelLicenseDetails, acceptance = data.acceptance
  if (!validModelRepo(repo) || data.repo_id !== repo || !data.info || typeof data.info !== 'object' || Array.isArray(data.info) || !acceptance || acceptance.repo_id !== repo || typeof acceptance.required !== 'boolean' || typeof acceptance.accepted !== 'boolean' || !states.has(acceptance.state) || !categories.has(acceptance.category) || !fingerprintPattern.test(acceptance.fingerprint) || !Array.isArray(data.history)) throw new Error(translateUi("Niepełny kontrakt licencji modelu. Nie można zapisać potwierdzenia; odśwież informacje lub zaktualizuj silnik."))
  if (data.info.variants !== undefined && (!Array.isArray(data.info.variants) || data.info.variants.some(variant => !variant || typeof variant !== 'object' || Array.isArray(variant))) || data.history.some(entry => !entry || typeof entry !== 'object' || typeof entry.action !== 'string')) throw new Error(translateUi("Nieprawidłowe warianty lub historia warunków. Nie można zapisać potwierdzenia."))
  return data
}

/** No constructor/load side effects. Acceptance is one explicit call per model. */
export class ModelLicenseService {
  constructor(private transport: ModelLicenseTransport) {}
  private async json(path: string, options: RequestInit) {
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)
    const response = await this.transport(path, { ...options, signal })
    signal.throwIfAborted()
    const text = await response.text(); signal.throwIfAborted()
    if (text.length > 1024 * 1024) throw new Error(translateUi("Informacje o licencji przekraczają limit 1 MB. Nie zapisano potwierdzenia."))
    let data: unknown
    try { data = JSON.parse(text) } catch { if (response.ok) throw new Error(translateUi("Nieprawidłowe informacje o licencji modelu.")) }
    if (!response.ok) {
      const detail = data && typeof data === 'object' ? (data as { detail?: { code?: string } }).detail : undefined
      if (response.status === 409 && detail?.code === 'terms_changed') throw new ModelLicenseTermsChangedError()
      if (response.status === 404) throw new Error(translateUi("Ten silnik nie udostępnia informacji o warunkach modelu. Wymagany jest kontrakt licencji z wersji 0.5.7."))
      throw new Error(translateUi("Nie udało się odczytać lub zapisać warunków modelu ({arg0}). Nie zakładaj, że decyzja została zapisana; odśwież stan.", { arg0: String(response.status) }))
    }
    return data
  }
  async details(repo: string, signal?: AbortSignal) {
    if (!validModelRepo(repo)) throw new Error(translateUi("Wybierz poprawne repozytorium modelu w formacie autor/model."))
    return parseModelLicenseDetails(await this.json(`/models/licenses/details/${encodeURIComponent(repo)}`, { signal }), repo)
  }
  async accept(details: ModelLicenseDetails, confirmed: boolean, signal?: AbortSignal) {
    const reviewed = parseModelLicenseDetails(details, details.repo_id)
    if (confirmed !== true) throw new Error(translateUi("Potwierdź zapoznanie się z warunkami przed zapisaniem decyzji."))
    return this.json('/models/licenses/accept', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo_id: reviewed.repo_id, fingerprint: reviewed.acceptance.fingerprint, accepted: true }) })
  }
  async revoke(repo: string, signal?: AbortSignal) {
    if (!validModelRepo(repo)) throw new Error(translateUi("Nieprawidłowe repozytorium modelu."))
    return this.json('/models/licenses/revoke', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo_id: repo }) })
  }
}
