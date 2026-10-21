/** Stories compile directly to the existing /longform/render chapter/span contract. */
export type StoryBlock = { id: string; text: string; voiceId: string; pauseMs: number; speed: number | null }
export type StoryScene = { id: string; title: string; blocks: StoryBlock[] }
export type StorySettings = {
  defaultVoice: string; language: string; format: 'mp3' | 'm4b'; bitrate: string; loudness: string
  speed: number; lineGapMs: number; paragraphGapMs: number; trimEdges: boolean; varyRepeats: boolean
  customQuality: boolean; steps: number; guidance: number; seed: string; author: string; narrator: string
}
export type StoryState = { kind: 'stories'; version: 1; title: string; scenes: StoryScene[]; settings: StorySettings }
export type StoryProject = { id: string; name: string; state?: unknown; updated_at?: number }
export type StoryOutput = { job_id: string; type: string; title?: string; output: string; duration_s: number; chapters: number; created_at?: number }
export type StoryResume = { job_id: string; type: string; title: string; status: string; total_chapters: number; chapters_done: number }
export const STORIES_DRAFT_KEY = 'seventy-seven-labs.stories.draft.v1'
export const STORIES_MAX_BYTES = 1024 * 1024
const id = () => crypto.randomUUID()

export function newStoryBlock(voiceId = ''): StoryBlock { return { id: id(), text: '', voiceId, pauseMs: 0, speed: null } }
export function newStoryScene(title = 'Nowa scena'): StoryScene { return { id: id(), title, blocks: [newStoryBlock()] } }
export function newStory(): StoryState {
  return { kind: 'stories', version: 1, title: 'Nowa historia', scenes: [newStoryScene('Scena 1')], settings: {
    defaultVoice: '', language: 'Auto', format: 'mp3', bitrate: '128k', loudness: 'off', speed: 1,
    lineGapMs: 0, paragraphGapMs: 0, trimEdges: false, varyRepeats: false, customQuality: false,
    steps: 32, guidance: 2, seed: '', author: '', narrator: '',
  } }
}

export function moveStoryItem<T extends { id: string }>(items: T[], itemId: string, direction: -1 | 1) {
  const index = items.findIndex(item => item.id === itemId), target = index + direction
  if (index < 0 || target < 0 || target >= items.length) return items
  const next = [...items]; [next[index], next[target]] = [next[target], next[index]]
  return next
}

function finiteRange(value: number, min: number, max: number) { return Number.isFinite(value) && value >= min && value <= max }
export function storyError(story: StoryState, knownVoices?: ReadonlySet<string>, scenes = story.scenes) {
  if (!story.title.trim()) return 'Nadaj historii tytuł.'
  if (!scenes.length) return 'Dodaj przynajmniej jedną scenę.'
  if (story.scenes.length > 1000 || story.scenes.reduce((n, scene) => n + scene.blocks.length, 0) > 10_000) return 'Projekt przekracza limit 1000 scen lub 10 000 bloków.'
  if (new TextEncoder().encode(JSON.stringify(story)).length > STORIES_MAX_BYTES) return 'Projekt przekracza limit 1 MB. Podziel historię na mniejsze projekty.'
  const settings = story.settings
  if (!['mp3', 'm4b'].includes(settings.format) || !['64k', '128k', '192k', '256k'].includes(settings.bitrate) || !['off', 'acx', 'podcast'].includes(settings.loudness)) return 'Wybierz obsługiwany format, bitrate i profil głośności.'
  if (!finiteRange(settings.speed, 0.5, 2) || !Number.isInteger(settings.lineGapMs) || !finiteRange(settings.lineGapMs, 0, 5000) || !Number.isInteger(settings.paragraphGapMs) || !finiteRange(settings.paragraphGapMs, 0, 5000)) return 'Tempo musi mieścić się w zakresie 0,5–2×, a przerwy wspólne w zakresie 0–5000 ms.'
  if (settings.customQuality && (!Number.isInteger(settings.steps) || !finiteRange(settings.steps, 1, 512) || !finiteRange(settings.guidance, 0, 20))) return 'Podaj 1–512 kroków syntezy i współczynnik prowadzenia 0–20.'
  if (settings.seed.trim() && (!/^\d+$/.test(settings.seed.trim()) || !finiteRange(Number(settings.seed), 0, 4_294_967_295))) return 'Seed musi być liczbą całkowitą od 0 do 4 294 967 295 albo pozostać pusty.'
  const sceneIds = new Set<string>(), blockIds = new Set<string>()
  for (const [sceneIndex, scene] of scenes.entries()) {
    if (!scene.id || sceneIds.has(scene.id)) return 'Sceny muszą mieć różne identyfikatory.'
    sceneIds.add(scene.id)
    if (!scene.title.trim()) return `Scena ${sceneIndex + 1}: wpisz tytuł.`
    if (!scene.blocks.length) return `Scena „${scene.title}”: dodaj blok wypowiedzi.`
    for (const [index, block] of scene.blocks.entries()) {
      if (!block.id || blockIds.has(block.id)) return 'Bloki muszą mieć różne identyfikatory.'
      blockIds.add(block.id)
      if (!Number.isInteger(block.pauseMs) || !finiteRange(block.pauseMs, 0, 10_000)) return `Scena „${scene.title}”, blok ${index + 1}: przerwa musi mieścić się w zakresie 0–10 000 ms.`
      if (block.speed !== null && !finiteRange(block.speed, 0.5, 2)) return `Scena „${scene.title}”, blok ${index + 1}: tempo musi mieścić się w zakresie 0,5–2×.`
      if (!block.text.trim() && block.pauseMs === 0) return `Scena „${scene.title}”, blok ${index + 1}: wpisz wypowiedź lub dodaj przerwę.`
      const voice = block.voiceId || settings.defaultVoice
      if (block.text.trim() && (!voice || knownVoices && !knownVoices.has(voice))) return `Scena „${scene.title}”, blok ${index + 1}: wybierz dostępny głos dla wypowiedzi.`
    }
  }
  return ''
}

export function compileStory(story: StoryState, knownVoices?: ReadonlySet<string>, scenes = story.scenes) {
  const error = storyError(story, knownVoices, scenes)
  if (error) throw new Error(error)
  const settings = story.settings
  return {
    chapters: scenes.map(scene => ({ title: scene.title.trim(), spans: scene.blocks.map(block => ({ text: block.text.trim(), voice_id: block.voiceId || settings.defaultVoice || null, pause_ms_after: block.pauseMs, speed: block.speed ?? settings.speed })) })),
    default_voice: settings.defaultVoice || null, language: settings.language || 'Auto',
    format: settings.format, bitrate: settings.bitrate, loudness: settings.loudness,
    line_gap_ms: settings.lineGapMs, paragraph_gap_ms: settings.paragraphGapMs, trim_edges: settings.trimEdges,
    vary_repeats: settings.varyRepeats,
    ...(settings.customQuality ? { num_step: settings.steps, guidance_scale: settings.guidance } : {}),
    ...(settings.seed.trim() ? { seed: Number(settings.seed.trim()) } : {}),
    metadata: { title: story.title.trim(), author: settings.author, narrator: settings.narrator },
  }
}

/** Strict shape read; never reinterpret an audiobook/dubbing project as a Story. */
export function readStory(value: unknown): StoryState {
  if (!value || typeof value !== 'object') throw new Error('Nieprawidłowy zapis historii.')
  const row = value as Record<string, unknown>, settings = row.settings as Record<string, unknown> | undefined
  if (row.kind !== 'stories' || row.version !== 1 || typeof row.title !== 'string' || !Array.isArray(row.scenes) || !settings || typeof settings !== 'object') throw new Error('To nie jest obsługiwany projekt Stories.')
  const defaults = newStory().settings
  for (const [key, fallback] of Object.entries(defaults)) if (typeof settings[key] !== typeof fallback || typeof fallback === 'number' && !Number.isFinite(settings[key])) throw new Error(`Nieprawidłowe ustawienie projektu: ${key}.`)
  const sceneIds = new Set<string>(), blockIds = new Set<string>()
  if (row.scenes.length > 1000) throw new Error('Projekt zawiera zbyt wiele scen.')
  for (const scene of row.scenes) {
    if (!scene || typeof scene !== 'object' || typeof scene.id !== 'string' || !scene.id || sceneIds.has(scene.id) || typeof scene.title !== 'string' || !Array.isArray(scene.blocks)) throw new Error('Nieprawidłowy zapis sceny.')
    sceneIds.add(scene.id)
    for (const block of scene.blocks) {
      if (!block || typeof block !== 'object' || typeof block.id !== 'string' || !block.id || blockIds.has(block.id) || typeof block.text !== 'string' || typeof block.voiceId !== 'string' || typeof block.pauseMs !== 'number' || !Number.isFinite(block.pauseMs) || (block.speed !== null && (typeof block.speed !== 'number' || !Number.isFinite(block.speed)))) throw new Error('Nieprawidłowy zapis bloku wypowiedzi.')
      blockIds.add(block.id)
    }
  }
  if (blockIds.size > 10_000 || new TextEncoder().encode(JSON.stringify(value)).length > STORIES_MAX_BYTES) throw new Error('Projekt przekracza limit rozmiaru.')
  // Svelte's editable state is a Proxy, which structuredClone rejects. The
  // validated project contract is JSON data, including when still reactive.
  return JSON.parse(JSON.stringify(value)) as StoryState
}

export function storyStats(story: StoryState) {
  const blocks = story.scenes.flatMap(scene => scene.blocks)
  return { scenes: story.scenes.length, blocks: blocks.length, characters: blocks.reduce((sum, block) => sum + block.text.trim().length, 0), pauseMs: blocks.reduce((sum, block) => sum + (Number.isFinite(block.pauseMs) ? block.pauseMs : 0), 0), voices: new Set(blocks.filter(block => block.text.trim()).map(block => block.voiceId || story.settings.defaultVoice).filter(Boolean)).size }
}

export function storyAudioPath(output: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(mp3|m4b)$/i.test(output)) throw new Error('Silnik zwrócił nieprawidłową nazwę pliku historii.')
  return `/audio/${encodeURIComponent(output)}`
}

export type StoryRenderState = { phase: 'idle' | 'running' | 'assembling' | 'mastering' | 'done' | 'stopped' | 'error'; jobId: string; total: number; completed: number[]; failed: number[]; output: string; message: string; logs: string[] }
export function emptyStoryRender(): StoryRenderState { return { phase: 'idle', jobId: '', total: 0, completed: [], failed: [], output: '', message: '', logs: [] } }
export function applyStoryEvent(state: StoryRenderState, event: { type: string; [key: string]: unknown }): StoryRenderState {
  const next = { ...state, completed: [...state.completed], failed: [...state.failed], logs: [...state.logs] }
  const detail = [event.reason || event.error || event.message, event.hint].filter(value => typeof value === 'string').join(' ').slice(0, 900)
  if (event.type === 'started') { next.phase = 'running'; next.jobId = typeof event.job_id === 'string' ? event.job_id : ''; next.total = typeof event.chapters === 'number' && Number.isFinite(event.chapters) ? Math.max(0, event.chapters) : 0; next.message = 'Uruchomiono generowanie historii.' }
  else if (event.type === 'chapter') { if (Number.isInteger(event.index) && !next.completed.includes(event.index as number)) next.completed.push(event.index as number); next.message = `Scena gotowa: ${String(event.title || '')}${event.cached ? ' · z pamięci podręcznej' : ''}` }
  else if (event.type === 'chapter_error') { if (Number.isInteger(event.index) && !next.failed.includes(event.index as number)) next.failed.push(event.index as number); next.message = `Nie udało się nagrać sceny: ${detail || event.title || 'sprawdź dziennik'}` }
  else if (event.type === 'assembling' || event.type === 'mastering') { next.phase = event.type; next.message = event.type === 'assembling' ? 'Łączenie scen i zapis rozdziałów…' : 'Wyrównywanie głośności…' }
  else if (event.type === 'done') {
    try { storyAudioPath(String(event.output || '')); next.output = String(event.output); next.phase = 'done'; next.failed = Array.isArray(event.failed_chapters) ? event.failed_chapters.filter((index): index is number => typeof index === 'number' && Number.isInteger(index)) : next.failed; next.message = next.failed.length ? `Plik niepełny: nie nagrano ${next.failed.length} scen. Sprawdź dziennik.` : 'Historia gotowa do odsłuchania i pobrania.' }
    catch (cause) { next.phase = 'error'; next.message = cause instanceof Error ? cause.message : String(cause) }
  }
  else if (event.type === 'error') { next.phase = 'error'; next.message = detail || 'Generowanie historii nie powiodło się.' }
  else if (event.type === 'stopped' || event.type === 'cancelled') { next.phase = 'stopped'; next.message = 'Render przerwany. Gotowe sceny mogą być dostępne do wznowienia.' }
  else if (event.type === 'routing_notice') next.message = detail || 'Silnik zmienił sposób wykonania zadania.'
  else return state
  next.logs = [...next.logs.slice(-39), next.message]
  return next
}
