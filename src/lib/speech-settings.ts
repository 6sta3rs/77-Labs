/** Audited against the bundled /generate route and exact adapter IDs.
 * GET /engines/tts currently exposes cloning/emotion flags, not a parameter
 * schema. Keep this explicit map in sync when replacing engine.zip.
 */
export type SpeechEngineMetadata = { id: string; display_name?: string; supports_cloning?: boolean | null; supports_emotion?: boolean | null; supports_voice_design?: boolean | null; preset_voices?: string[]; default_voice?: string | null };
export type VoiceDesignRecipe = { description: string; picks: Partial<Record<'Gender' | 'Age' | 'Pitch' | 'Style' | 'EnglishAccent' | 'ChineseDialect', string>> };
export const voiceDesignCategories = [{ key: 'Gender', label: 'Barwa' }, { key: 'Age', label: 'Wiek' }, { key: 'Pitch', label: 'Wysokość' }, { key: 'Style', label: 'Styl' }, { key: 'EnglishAccent', label: 'Akcent angielski' }, { key: 'ChineseDialect', label: 'Dialekt chiński' }] as const;
export type SpeechSettings = {
  instruct: string;
  guidance_scale?: number;
  t_shift?: number;
  denoise: boolean;
  postprocess_output?: boolean;
  layer_penalty_factor?: number;
  position_temperature?: number;
  class_temperature?: number;
  max_chunk_chars: number;
  crossfade_ms: number;
  pronounce: boolean;
  wav_bits: '16' | '24' | '32';
  preset_voice?: string;
  design_recipe?: VoiceDesignRecipe;
};
export type SpeechParameter = keyof SpeechSettings;
export type SpeechConditioning = { hasReference?: boolean; supportsWavBits?: boolean; supportsPresetVoice?: boolean; supportsDesignRecipe?: boolean; presetVoice?: string };
export type SpeechCapabilities = { engineId: string; knownAdapter: boolean; instruction: 'taxonomy' | 'freeform' | 'none'; fields: ReadonlySet<SpeechParameter> };
export function speechLanguageChoices(values: string[]): string[] {
  const seen = new Set<string>(), choices: string[] = [];
  for (const raw of values) { const value = raw.trim(); if (value && !seen.has(value.toLowerCase())) { choices.push(value); seen.add(value.toLowerCase()); } }
  if (!seen.has('auto')) choices.unshift('Auto');
  return choices;
}
export function preferredSpeechLanguage(values: string[], current = 'Polish'): string {
  return values.find(value => value.toLowerCase() === current.toLowerCase()) || values.find(value => value.toLowerCase() === 'auto') || 'Auto';
}
export function speechLanguageLabel(value: string): string {
  return ({ polish: 'Polski', pl: 'Polski', english: 'Angielski', en: 'Angielski', auto: 'Automatycznie' } as Record<string, string>)[value.toLowerCase()] || value.charAt(0).toUpperCase() + value.slice(1);
}
const commonParameters: SpeechParameter[] = ['max_chunk_chars', 'crossfade_ms', 'pronounce'];
const nativeParameters: SpeechParameter[] = ['instruct', 'guidance_scale', 't_shift', 'denoise', 'postprocess_output', 'layer_penalty_factor', 'position_temperature', 'class_temperature'];
const auditedAdapters: Record<string, { fields: SpeechParameter[]; instruction: 'taxonomy' | 'freeform' | 'none'; referenceRequired?: boolean }> = {
  omnivoice: { fields: nativeParameters, instruction: 'taxonomy' },
  'omnivoice-subprocess': { fields: nativeParameters, instruction: 'taxonomy' },
  'omnivoice-gguf': { fields: ['instruct', 'denoise'], instruction: 'taxonomy' },
  voxcpm2: { fields: ['instruct', 'guidance_scale'], instruction: 'freeform' },
  cosyvoice: { fields: ['instruct'], instruction: 'freeform', referenceRequired: true },
  kittentts: { fields: [], instruction: 'none' },
  'sherpa-onnx': { fields: [], instruction: 'none' },
};
export function speechCapabilities(engine?: SpeechEngineMetadata, context: SpeechConditioning = {}): SpeechCapabilities {
  const adapter = engine ? auditedAdapters[engine.id] : undefined;
  const fields = new Set<SpeechParameter>(commonParameters);
  if (context.supportsWavBits) fields.add('wav_bits');
  if (context.supportsPresetVoice && context.hasReference !== true && engine?.preset_voices?.length) fields.add('preset_voice');
  if (context.supportsDesignRecipe && context.hasReference !== true && engine?.supports_voice_design !== false && !context.presetVoice) fields.add('design_recipe');
  for (const field of adapter?.fields || []) if (!(field === 'instruct' && (context.presetVoice || adapter?.referenceRequired && context.hasReference !== true))) fields.add(field);
  return { engineId: engine?.id || '', knownAdapter: !!adapter, instruction: fields.has('instruct') ? adapter?.instruction || 'none' : 'none', fields };
}
export function defaultSpeechSettings(): SpeechSettings {
  return { instruct: '', denoise: true, max_chunk_chars: 800, crossfade_ms: 50, pronounce: true, wav_bits: '16' };
}
export function readDesignRecipe(value: unknown): VoiceDesignRecipe | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Szkic projektowania głosu musi mieć opis i jawne wybory.');
  const raw = value as Record<string, unknown>;
  if (typeof raw.description !== 'string' || raw.description.length > 2000 || !raw.picks || typeof raw.picks !== 'object' || Array.isArray(raw.picks)) throw new Error('Opis szkicu może mieć do 2000 znaków; wybory muszą być obiektem.');
  const picks: VoiceDesignRecipe['picks'] = {};
  for (const [key, detail] of Object.entries(raw.picks)) {
    if (!voiceDesignCategories.some(category => category.key === key) || typeof detail !== 'string' || detail.length > 64) throw new Error('Nieprawidłowa kategoria szkicu lub wartość dłuższa niż 64 znaki.');
    picks[key as keyof VoiceDesignRecipe['picks']] = detail;
  }
  const recipe = { description: raw.description, picks };
  if (JSON.stringify(recipe).length > 8000) throw new Error('Szkic projektowania głosu jest zbyt duży.');
  return recipe;
}
export function cloneSpeechSettings(value: SpeechSettings): SpeechSettings {
  return { ...value, ...(value.design_recipe ? { design_recipe: readDesignRecipe(value.design_recipe) } : {}) };
}
export function readStoredSpeechSettings(raw: unknown): SpeechSettings {
  const result = defaultSpeechSettings();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  const saved = raw as Record<string, unknown>;
  if (typeof saved.instruct === 'string') result.instruct = saved.instruct;
  for (const key of ['denoise', 'postprocess_output', 'pronounce'] as const) if (typeof saved[key] === 'boolean') result[key] = saved[key];
  for (const key of ['guidance_scale', 't_shift', 'layer_penalty_factor', 'position_temperature', 'class_temperature'] as const) if (typeof saved[key] === 'number' && Number.isFinite(saved[key])) result[key] = saved[key];
  if (Number.isSafeInteger(saved.max_chunk_chars) && Number(saved.max_chunk_chars) >= 0) result.max_chunk_chars = Number(saved.max_chunk_chars);
  if (Number.isSafeInteger(saved.crossfade_ms) && Number(saved.crossfade_ms) >= 0 && Number(saved.crossfade_ms) <= 1000) result.crossfade_ms = Number(saved.crossfade_ms);
  if (saved.wav_bits === '16' || saved.wav_bits === '24' || saved.wav_bits === '32') result.wav_bits = saved.wav_bits;
  if (typeof saved.preset_voice === 'string' && saved.preset_voice.length <= 128) result.preset_voice = saved.preset_voice;
  try { result.design_recipe = readDesignRecipe(saved.design_recipe); } catch { /* A broken optional draft cannot prevent opening old text. */ }
  return result;
}
export function resetPresetForEngine(value: SpeechSettings, engine?: SpeechEngineMetadata, supported = false): SpeechSettings {
  const choices = supported ? engine?.preset_voices?.filter(voice => typeof voice === 'string') || [] : [];
  const current = value.preset_voice || '';
  const next = choices.includes(current) ? current : engine?.supports_cloning === false ? choices.includes(engine.default_voice || '') ? engine.default_voice! : choices[0] || '' : '';
  return { ...value, preset_voice: next };
}
export const speechEngineDefaults = { guidance_scale: 2, t_shift: 0.1, layer_penalty_factor: 5, position_temperature: 5, class_temperature: 0 } as const;
export const speechNumericFields = [
  { key: 'guidance_scale', label: 'Siła instrukcji', min: 0, step: 0.1, description: 'Guidance scale: siła prowadzenia generacji.' },
  { key: 't_shift', label: 'Przesunięcie kroków', min: 0.001, step: 0.01, description: 'T-shift: rozkład kroków generowania.' },
  { key: 'layer_penalty_factor', label: 'Kara warstw', min: 0, step: 0.1, description: 'Kolejność odtwarzania warstw kodu audio.' },
  { key: 'position_temperature', label: 'Losowość pozycji', min: 0, step: 0.1, description: 'Temperatura wyboru pozycji w generacji.' },
  { key: 'class_temperature', label: 'Losowość tokenów', min: 0, step: 0.1, description: 'Temperatura próbkowania tokenów; 0 wybiera najbardziej prawdopodobny token.' },
] as const;

// OmniVoice's exact six-category taxonomy, including its supported Chinese
// aliases. Each category accepts one value; unrestricted prose is not valid.
const omniInstructionCategories: string[][] = [
  ['male', 'female', '男', '女'],
  ['child', 'teenager', 'young adult', 'middle-aged', 'elderly', '儿童', '少年', '青年', '中年', '老年'],
  ['very low pitch', 'low pitch', 'moderate pitch', 'high pitch', 'very high pitch', '极低音调', '低音调', '中音调', '高音调', '极高音调'],
  ['whisper', '耳语'],
  ['american accent', 'british accent', 'australian accent', 'chinese accent', 'canadian accent', 'indian accent', 'korean accent', 'portuguese accent', 'russian accent', 'japanese accent'],
  ['河南话', '陕西话', '四川话', '贵州话', '云南话', '桂林话', '济南话', '石家庄话', '甘肃话', '宁夏话', '青岛话', '东北话'],
];
function instructionErrors(instruct: string): string[] {
  const errors: string[] = [], used = new Set<number>();
  for (const raw of instruct.split(/[,，]/)) {
    const token = raw.trim().toLowerCase(); if (!token) continue;
    const category = omniInstructionCategories.findIndex(values => values.includes(token));
    if (category < 0) errors.push(`Nieobsługiwana cecha OmniVoice: „${raw.trim()}”. Użyj cech, np. female, middle-aged, low pitch.`);
    else if (used.has(category)) errors.push('Instrukcja OmniVoice zawiera kilka cech z tej samej kategorii. Wybierz po jednej barwie, wieku, wysokości, stylu, akcencie i dialekcie.');
    else used.add(category);
  }
  return errors;
}
export function speechSettingsErrors(settings: SpeechSettings, engine?: SpeechEngineMetadata, context: SpeechConditioning = {}): string[] {
  const capabilities = speechCapabilities(engine, { ...context, presetVoice: settings.preset_voice }), errors: string[] = [];
  if (capabilities.fields.has('wav_bits') && !['16', '24', '32'].includes(settings.wav_bits)) errors.push('Wybierz WAV 16-bit, 24-bit lub 32-bit float.');
  if (capabilities.fields.has('preset_voice') && settings.preset_voice && !engine?.preset_voices?.includes(settings.preset_voice)) errors.push('Wybierz wbudowany głos z listy bieżącego silnika.');
  if (capabilities.fields.has('design_recipe') && settings.design_recipe !== undefined) { try { readDesignRecipe(settings.design_recipe); } catch (cause) { errors.push((cause as Error).message); } }
  if (capabilities.fields.has('instruct')) {
    if (typeof settings.instruct !== 'string') errors.push('Instrukcja brzmienia musi być tekstem.');
    else if (capabilities.instruction === 'taxonomy') errors.push(...instructionErrors(settings.instruct));
  }
  for (const row of speechNumericFields) {
    const value = settings[row.key];
    if (!capabilities.fields.has(row.key) || value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${row.label}: wpisz skończoną liczbę.`);
    else if (row.key === 't_shift' ? value <= 0 : value < 0) errors.push(`${row.label}: wartość musi być ${row.key === 't_shift' ? 'większa od zera' : 'nieujemna'}.`);
  }
  if (!Number.isSafeInteger(settings.max_chunk_chars) || settings.max_chunk_chars < 0) errors.push('Długość fragmentu musi być całkowitą liczbą znaków od 0.');
  if (!Number.isSafeInteger(settings.crossfade_ms) || settings.crossfade_ms < 0 || settings.crossfade_ms > 1000) errors.push('Przenikanie fragmentów musi mieścić się w zakresie 0–1000 ms.');
  for (const key of ['denoise', 'postprocess_output', 'pronounce'] as const) if (capabilities.fields.has(key) && settings[key] !== undefined && typeof settings[key] !== 'boolean') errors.push(`Ustawienie ${key} musi być włączone albo wyłączone.`);
  return [...new Set(errors)];
}
/** Only effective parameters are sent; stale values from another engine are
 * omitted rather than silently presented as working controls. Undefined native
 * overrides retain the backend performance profile/model defaults.
 */
export function serializeSpeechSettings(settings: SpeechSettings, engine?: SpeechEngineMetadata, context: SpeechConditioning = {}): Record<string, string> {
  const errors = speechSettingsErrors(settings, engine, context);
  if (errors.length) throw new Error(errors.join('\n'));
  const result: Record<string, string> = {}, capabilities = speechCapabilities(engine, { ...context, presetVoice: settings.preset_voice });
  for (const key of capabilities.fields) {
    const value = settings[key];
    if (value === undefined || (key === 'instruct' || key === 'preset_voice') && !String(value).trim()) continue;
    result[key] = key === 'design_recipe' ? JSON.stringify(readDesignRecipe(value)) : key === 'instruct' ? String(value).trim() : String(value);
  }
  return result;
}
export function appendSpeechSettings(form: FormData, settings: SpeechSettings, engine?: SpeechEngineMetadata, context: SpeechConditioning = {}) {
  for (const [key, value] of Object.entries(serializeSpeechSettings(settings, engine, context))) form.set(key, value);
}
