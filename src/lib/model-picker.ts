import type { EngineFamily } from './studio-tools'
import { engineReadinessLabel, needsEngineVerification } from './engine-readiness'

/** A selectable engine, not a cached weights repository. */
export type ModelPickerItem = {
  id: string
  name: string
  description: string
  languages: string[]
  installed: boolean
  available: boolean
  reason?: string
  tags?: string[]
  recommended?: boolean
  brand?: string
  /** False when the backend does not report installation and is unavailable. */
  installationKnown?: boolean
  /** Explicit verification is separate from backend availability/installation. */
  canVerify?: boolean
  readinessLabel?: string
}

export function normalizeTtsModels(family?: EngineFamily): ModelPickerItem[] {
  if (!family) return []
  return family.backends.map(engine => {
    const licenseBlocked = Boolean(engine.license_required && !engine.license_accepted)
    const verificationNeeded = needsEngineVerification(engine)
    const routingBlocked = engine.routing_status === 'unavailable' && !verificationNeeded
    const reasons = [
      engine.reason || engine.unavailable_reason,
      routingBlocked ? engine.routing_reason || 'Ten silnik nie obsługuje dostępnej konfiguracji sprzętowej.' : undefined,
      licenseBlocked ? 'Silnik wymaga zaakceptowania licencji w ustawieniach.' : undefined,
      family.env_override ? 'Wybór silnika jest wymuszony przez konfigurację środowiska.' : undefined,
    ].filter(Boolean)
    return {
      id: engine.id,
      name: engine.display_name || engine.name || engine.id,
      description: engine.description || (engine.supports_cloning ? 'Synteza mowy z możliwością klonowania głosu.' : 'Silnik syntezy mowy.'),
      languages: engine.supported_language_names || [],
      installed: engine.installed ?? (engine.available === true),
      installationKnown: engine.weights_check !== 'not_checked' && (typeof engine.installed === 'boolean' || engine.available === true),
      available: engine.available === true && !routingBlocked && !licenseBlocked && !family.env_override,
      canVerify: verificationNeeded && !licenseBlocked && !family.env_override,
      readinessLabel: engine.availability_check ? engineReadinessLabel(engine) : undefined,
      reason: [...new Set(reasons)].join(' ') || undefined,
      tags: engine.supports_cloning ? ['Klonowanie głosu'] : [],
    }
  })
}

export function modelSearchText(value: string): string {
  return value.toLocaleLowerCase('pl').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replaceAll('ł', 'l')
}

export function matchesModel(model: ModelPickerItem, query: string): boolean {
  const words = modelSearchText(query).trim().split(/\s+/).filter(Boolean)
  const text = modelSearchText([model.name, model.id, model.description, ...model.languages, ...(model.tags || [])].join(' '))
  return words.every(word => text.includes(word))
}

export function modelStatus(model: ModelPickerItem): string {
  if (model.readinessLabel) return model.readinessLabel
  if (model.available && model.installed) return 'Dostępny silnik'
  if (model.installationKnown === false) return 'Stan instalacji niepotwierdzony'
  return model.installed ? 'Silnik zainstalowany · niedostępny' : 'Silnik niezainstalowany'
}

export function canSelectModel(model: ModelPickerItem): boolean {
  return model.canVerify === true || model.available && model.installed
}

export function modelSelectionLabel(model: ModelPickerItem): string {
  return model.canVerify && !model.available ? 'Sprawdź i wybierz' : 'Wybierz'
}
