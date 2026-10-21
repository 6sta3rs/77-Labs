import type { Component } from 'svelte';
import type { Page } from './data';
export type NavigationItem = { id: Page; label: string; icon: Component<any> };
export type { SettingsSection } from './settings-catalog';
export const pinStorageKey = 'voicestudio.navigation.pins.v1';
export const defaultPins: Page[] = ['studio', 'transcription', 'dubbing', 'audiobooks', 'projects'];
export function parsePins(raw: string | null, allowed: Page[]): Page[] {
  // Głosy są stałym wejściem, także dla zapisanych wcześniej przypięć v1.
  const canPin = (id: Page) => id !== 'voices' && allowed.includes(id);
  if (raw === null) return defaultPins.filter(canPin);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultPins.filter(canPin);
    return [...new Set(parsed.filter((id): id is Page => typeof id === 'string' && canPin(id as Page)))];
  } catch { return defaultPins.filter(canPin); }
}
