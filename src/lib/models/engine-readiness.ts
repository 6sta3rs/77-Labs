import { translateUi } from '../i18n';
/** Catalogue metadata is a preflight hint, never evidence of model inference. */
export type EngineAvailabilityCheck = 'dependencies_detected' | 'missing_dependencies' | 'platform_unsupported' | 'runtime_unconfigured';
export type EngineReadiness = {
  available?: boolean;
  availability_check?: EngineAvailabilityCheck;
  can_verify?: boolean;
  inference_verified?: boolean;
  hardware_check?: string;
  weights_check?: string;
  routing_status?: string;
};

export function needsEngineVerification(engine: EngineReadiness): boolean {
  return engine.available !== true && engine.availability_check === 'dependencies_detected' && engine.can_verify === true;
}

export function canSelectEngine(engine: EngineReadiness): boolean {
  return needsEngineVerification(engine) || engine.available === true && engine.routing_status !== 'unavailable';
}

export function engineReadinessLabel(engine: EngineReadiness): string {
  if (engine.available === true) return translateUi("Dostępny silnik");
  switch (engine.availability_check) {
    case 'dependencies_detected': return 'Biblioteki wykryte · wymaga sprawdzenia';
    case 'missing_dependencies': return translateUi("Brak wymaganych bibliotek");
    case 'platform_unsupported': return 'Niezgodny z tym komputerem';
    case 'runtime_unconfigured': return translateUi("Wymaga konfiguracji środowiska");
    default: return translateUi("Gotowość silnika niepotwierdzona");
  }
}

export function engineSelectionLabel(engine: EngineReadiness): string {
  return needsEngineVerification(engine) ? translateUi("Sprawdź i wybierz") : translateUi("Wybierz");
}
