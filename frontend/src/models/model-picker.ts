import type { EngineFamily } from '../tools/studio-tools'
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
    const verified = engine.inference_verified === true // it already produced audio here; the catalogue's metadata-only flags are stale
    const routingBlocked = engine.routing_status === 'unavailable' && !verificationNeeded && !verified
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
      installed: verified || (engine.installed ?? (engine.available === true)),
      installationKnown: verified || engine.weights_check !== 'not_checked' && (typeof engine.installed === 'boolean' || engine.available === true),
      available: (verified || engine.available === true && !routingBlocked) && !licenseBlocked && !family.env_override,
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

/** Faster-Whisper engines accept `model_id` in /engines/select; the engine only takes Systran/faster-* or the deepdml turbo conversion. */
export const FASTER_WHISPER_ENGINES = ['faster-whisper', 'faster-whisper-isolated']
export const FASTER_WHISPER_DEFAULT = 'Systran/faster-whisper-large-v3'
export const isFasterWhisperModel = (repo: string) => repo.startsWith('Systran/faster-') || repo === 'deepdml/faster-whisper-large-v3-turbo-ct2'
/** True when `repo` is the CTranslate2 model the active ASR engine will use (an unset preference means the engine default). */
export const isActiveAsrModel = (family: Pick<EngineFamily, 'active' | 'active_model'> | undefined, repo: string) =>
  !!family && FASTER_WHISPER_ENGINES.includes(family.active) && (family.active_model || FASTER_WHISPER_DEFAULT) === repo
