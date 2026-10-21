import { request, type Profile } from './api';
import { postJson, productionJson } from './production';
import { assertModelLicenseResponse } from './model-licenses';

export type Archetype = {
  id: string; name: string; use_case: string; instruct: string; attrs: Record<string, string>;
  sample_script: string; is_featured: boolean; language: string;
  facets: { gender?: string; age?: string; pitch?: string; accent?: string; whisper?: boolean };
};
export type ArchetypePage = { items: Archetype[]; total: number; limit: number; offset: number };
export type ArchetypeFilters = { query: string; category: string; language: string; gender: string; age: string; pitch: string; accent: string; whisper: string; featured: string };
export type Personality = { id: string; name: string; description: string; instruct: string; attrs?: Record<string, string>; script?: string; language?: string };
export type PersonaInspection = {
  format: string; schema_version: number; name: string; kind: string; language: string; personality: string;
  is_locked: boolean; license_spdx: string; tags: string[]; preview_only: boolean; watermarked_preview: boolean;
  schema_version_ahead: boolean;
  consent?: { verified_claimed: boolean; method: string; has_recording: boolean; would_verify: boolean } | null;
};
export type PersonaImport = { success: boolean; profile_id: string; name: string; kind: string; verified_own_voice: boolean; preview_only: boolean; license_spdx: string; watermarked_preview: boolean; source_bundle: string; schema_version_ahead: boolean };
export type ImportedPersonaMetadata = { license: string; tags: string[]; source: string; importedAt: string; previewOnly: boolean };
const metadataKey = 'voicestudio.personaMetadata.v1';
export function importedPersonaMetadata(id: string): ImportedPersonaMetadata | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(metadataKey) || '{}')[id];
    if (!value || typeof value.license !== 'string' || !Array.isArray(value.tags) || typeof value.source !== 'string') return;
    return { ...value, tags: value.tags.filter((tag: unknown) => typeof tag === 'string') };
  } catch { return; }
}
export function rememberPersonaMetadata(id: string, inspection: PersonaInspection, source: string): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(metadataKey) || '{}');
    const records = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    records[id] = { license: inspection.license_spdx, tags: inspection.tags, source, importedAt: new Date().toISOString(), previewOnly: inspection.preview_only } satisfies ImportedPersonaMetadata;
    localStorage.setItem(metadataKey, JSON.stringify(records)); return true;
  } catch { return false; }
}
export const emptyArchetypeFilters = (): ArchetypeFilters => ({ query: '', category: '', language: '', gender: '', age: '', pitch: '', accent: '', whisper: '', featured: '' });
export const personaLicenses = [
  { value: 'LicenseRef-VoiceStudio-Personal', label: 'VoiceStudio Personal' },
  ...['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'CC-BY-NC-SA-4.0', 'CC-BY-ND-4.0', 'MIT', 'Apache-2.0'].map(value => ({ value, label: value })),
];
export const archetypeCategories: Record<string, string> = { narration: 'Narracja i opowieści', conversational: 'Rozmowa', characters: 'Postacie i animacja', social: 'Media społecznościowe', entertainment: 'Rozrywka i telewizja', advertisement: 'Reklama', informative: 'Informacje i edukacja' };
export const personalityLabels: Record<string, { name: string; description: string }> = {
  narrator: { name: 'Narrator', description: 'Dojrzały głos o niskim brzmieniu.' },
  casual: { name: 'Swobodna rozmowa', description: 'Młody dorosły głos o średniej wysokości.' },
  news_anchor: { name: 'Prezenter wiadomości', description: 'Dojrzały głos ze średnią wysokością i amerykańskim akcentem.' },
  storyteller: { name: 'Opowiadacz', description: 'Dojrzały głos ze średnią wysokością i brytyjskim akcentem.' },
  corporate: { name: 'Prezentacja firmowa', description: 'Dojrzały głos o średniej wysokości.' },
  energetic: { name: 'Energia', description: 'Młody dorosły głos o wysokim brzmieniu.' },
  audiobook_uk_narrator: { name: 'Bibliotekarka', description: 'Niski dojrzały głos żeński z brytyjskim akcentem.' },
  us_news_anchor: { name: 'Prezenter amerykański', description: 'Dojrzały głos męski o średniej wysokości.' },
  indian_support_agent: { name: 'Konsultantka', description: 'Młody głos żeński z indyjskim akcentem angielskim.' },
  gravelly_villain: { name: 'Kapitan', description: 'Bardzo niski starszy głos męski.' },
  aussie_podcaster: { name: 'Podcasterka', description: 'Wysoki młody głos żeński z australijskim akcentem.' },
  bedtime_storyteller: { name: 'Młody pomocnik', description: 'Wysoki młody dorosły głos.' },
  mandarin_sichuan: { name: 'Przyjaciółka z Syczuanu', description: 'Młody głos żeński mówiący w dialekcie syczuańskim.' },
};

export function archetypeQuery(filters: ArchetypeFilters, offset = 0, limit = 24): string {
  const query = new URLSearchParams({ limit: String(limit), offset: String(Math.max(0, offset)) });
  for (const [key, value] of Object.entries({ q: filters.query.trim(), use_case: filters.category, lang: filters.language, gender: filters.gender, age: filters.age, pitch: filters.pitch, accent: filters.accent, whisper: filters.whisper, featured: filters.featured })) if (value) query.set(key, value);
  return `/archetypes?${query}`;
}
export const loadArchetypes = (filters: ArchetypeFilters, offset: number, signal?: AbortSignal) => productionJson<ArchetypePage>(archetypeQuery(filters, offset), { signal });
export const loadPersonalities = (signal?: AbortSignal) => productionJson<Personality[]>('/personalities', { signal });
export const loadLibraryProfiles = (signal?: AbortSignal) => productionJson<Profile[]>('/profiles', { signal });

export async function useArchetype(id: string, name: string, signal?: AbortSignal): Promise<Profile> {
  const query = new URLSearchParams(); if (name.trim()) query.set('name', name.trim());
  const result = await productionJson<{ profile_id: string }>(`/archetypes/${encodeURIComponent(id)}/use${query.size ? `?${query}` : ''}`, { method: 'POST', signal });
  signal?.throwIfAborted();
  return productionJson<Profile>(`/profiles/${encodeURIComponent(result.profile_id)}`, { signal });
}

export async function createPersonalityProfile(personality: Personality, name: string, language: string, signal?: AbortSignal, sampleText?: string): Promise<Profile> {
  if (!name.trim()) throw new Error('Podaj nazwę projektowanego głosu.');
  const recipe = personality.attrs ?? (await productionJson<{ attrs: Record<string, string> }>('/design/describe', postJson({ description: personality.instruct }, signal))).attrs;
  signal?.throwIfAborted();
  const body = new FormData();
  for (const [key, value] of Object.entries({ name: name.trim(), kind: 'design', language, personality: personality.id, instruct: personality.instruct, ref_text: sampleText?.trim() ?? personality.script ?? '', vd_states: JSON.stringify(recipe) })) body.append(key, value);
  return productionJson<Profile>('/profiles', { method: 'POST', body, signal });
}

export function personaFileError(file: File): string {
  if (!/\.(ovsvoice|omnivoice)$/i.test(file.name)) return 'Wybierz pakiet głosu .ovsvoice lub .omnivoice.';
  if (!file.size) return 'Pakiet głosu jest pusty.';
  if (file.size > 100 * 1024 * 1024) return 'Pakiet głosu przekracza limit 100 MB.';
  return '';
}
function personaForm(file: File): FormData { const invalid = personaFileError(file); if (invalid) throw new Error(invalid); const body = new FormData(); body.append('file', file); return body; }
export async function inspectPersona(file: File, signal?: AbortSignal): Promise<PersonaInspection> {
  const value = await productionJson<PersonaInspection>('/personas/inspect', { method: 'POST', body: personaForm(file), signal });
  return { ...value, tags: Array.isArray(value.tags) ? value.tags.filter(tag => typeof tag === 'string') : [] };
}
export const importPersona = (file: File, signal?: AbortSignal) => productionJson<PersonaImport>('/personas/import', { method: 'POST', body: personaForm(file), signal });

export async function exportPersona(id: string, options: { license: string; tags: string; includeReference: boolean }, signal?: AbortSignal) {
  const query = new URLSearchParams({ license_spdx: options.license, tags: options.tags, include_reference: String(options.includeReference) });
  const response = await request(`/personas/export/${encodeURIComponent(id)}?${query}`, { method: 'POST', signal });
  signal?.throwIfAborted();
  if (!response.ok) {
    await assertModelLicenseResponse(response, signal);
    const raw = await response.text(); let message = raw;
    try { const value = JSON.parse(raw); message = typeof value.detail === 'string' ? value.detail : value.detail?.message || raw; } catch { /* Plain response. */ }
    throw new Error(message.slice(0, 350) || `Nie można wyeksportować głosu (${response.status}).`);
  }
  const blob = await response.blob(); signal?.throwIfAborted();
  if (!blob.size) throw new Error('Silnik zwrócił pusty pakiet głosu.');
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  let filename = /filename="([^"]+)"/i.exec(disposition)?.[1] || `glos-${id}.ovsvoice`;
  if (encoded) { try { filename = decodeURIComponent(encoded); } catch { /* Use quoted fallback. */ } }
  filename = filename.split(/[\\/]/).at(-1)!.replace(/[<>:"|?*\x00-\x1f]/g, '_');
  if (!filename.toLowerCase().endsWith('.ovsvoice')) filename = `glos-${id}.ovsvoice`;
  return { blob, filename };
}

export async function previewArchetype(id: string, signal?: AbortSignal): Promise<Blob> {
  // local=true bypasses gallery fetches and its background update request.
  const response = await request(`/archetypes/${encodeURIComponent(id)}/preview?local=true`, { signal });
  signal?.throwIfAborted();
  await assertModelLicenseResponse(response, signal);
  if (!response.ok) throw new Error(`Nie można przygotować lokalnej próbki (${response.status}). ${(await response.text()).slice(0, 250)}`);
  const blob = await response.blob(); signal?.throwIfAborted();
  if (!blob.type.startsWith('audio/') || !blob.size) throw new Error('Silnik nie zwrócił próbki audio.');
  return blob;
}
