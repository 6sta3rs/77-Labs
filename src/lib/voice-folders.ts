import { writable, get } from 'svelte/store'

export type VoiceFolder = { id: string; name: string; voiceIds: string[] }
export const voiceFoldersKey = 'voicestudio.voiceFolders.v1'
export const defaultVoiceFolder = (): VoiceFolder[] => [{ id: 'saved', name: 'Zapisane głosy', voiceIds: [] }]

export function parseVoiceFolders(raw: string | null): VoiceFolder[] {
  try {
    const value: unknown = JSON.parse(raw || 'null')
    if (!Array.isArray(value)) return defaultVoiceFolder()
    const seen = new Set<string>()
    const result: VoiceFolder[] = []
    for (const row of value) {
      if (!row) continue
      const validId = typeof row.id === 'string' && row.id.trim() && !seen.has(row.id)
      const validName = typeof row.name === 'string' && row.name.trim()
      if (!validId || !validName || !Array.isArray(row.voiceIds)) continue

      const voiceIds = (row.voiceIds as unknown[]).filter(
        (id): id is string => typeof id === 'string' && !!id.trim(),
      )
      seen.add(row.id)
      result.push({
        id: row.id,
        name: row.name.trim().slice(0, 80),
        voiceIds: [...new Set(voiceIds)],
      })
    }
    if (!seen.has('saved')) result.unshift(defaultVoiceFolder()[0])
    return result
  } catch {
    return defaultVoiceFolder()
  }
}

function readStoredVoiceFolders(): VoiceFolder[] {
  try {
    return parseVoiceFolders(localStorage.getItem(voiceFoldersKey))
  } catch {
    return defaultVoiceFolder()
  }
}

export const voiceFolders = writable<VoiceFolder[]>(readStoredVoiceFolders())

export function persistVoiceFolders(rows: VoiceFolder[]) {
  // Publish only after durable storage succeeds; no false "saved" state on quota errors.
  localStorage.setItem(voiceFoldersKey, JSON.stringify(rows))
  voiceFolders.set(rows)
}

export function folderWithVoice(rows: VoiceFolder[], folderId: string, voiceId: string): VoiceFolder[] {
  if (!voiceId || !rows.some(row => row.id === folderId)) throw new Error('Nie znaleziono folderu głosów.')
  return rows.map(row => {
    if (row.id !== folderId) return row
    return { ...row, voiceIds: [...new Set([...row.voiceIds, voiceId])] }
  })
}

export function saveVoiceToFolder(folderId: string, voiceId: string) {
  const updated = folderWithVoice(get(voiceFolders), folderId, voiceId)
  persistVoiceFolders(updated)
}

export function addVoiceFolder(name: string): string {
  const trimmed = name.trim().slice(0, 80)
  if (!trimmed) throw new Error('Podaj nazwę folderu.')
  const rows = get(voiceFolders)
  const existing = rows.find(row => row.name.toLocaleLowerCase('pl') === trimmed.toLocaleLowerCase('pl'))
  if (existing) return existing.id
  const id = crypto.randomUUID()
  persistVoiceFolders([...rows, { id, name: trimmed, voiceIds: [] }])
  return id
}
