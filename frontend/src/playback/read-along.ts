export type Portion = { text: string; duration: number }

// Relative speaking time of a word: longer words take longer, a trailing sentence/clause mark adds a pause.
// ponytail: heuristic weights; exact word times need forced alignment (the engine /transcribe route returns segments only).
export function wordWeight(word: string): number {
  const letters = word.replace(/[^\p{L}\p{N}]/gu, '').length
  const pause = /[.!?…]["')\]]*$/u.test(word) ? 4 : /[,;:—–]["')\]]*$/u.test(word) ? 2 : 0
  return Math.max(1, letters) + pause
}

// Index of the word being spoken `elapsed` seconds into a portion whose measured audio length is `duration`.
export function wordAtTime(words: string[], elapsed: number, duration: number): number {
  if (!words.length) return -1
  if (!(duration > 0)) return 0
  const target = Math.min(1, Math.max(0, elapsed / duration)) * words.reduce((sum, word) => sum + wordWeight(word), 0)
  let acc = 0
  for (let index = 0; index < words.length; index++) { acc += wordWeight(words[index]); if (target < acc) return index }
  return words.length - 1
}

// Portion `current` (1-based) and word for global book time, using each portion's measured duration.
export function readingAt(portions: Portion[], current: number, time: number): { words: string[]; word: number } | undefined {
  const portion = portions[current - 1]
  if (!portion?.text) return undefined
  const words = portion.text.split(/\s+/).filter(Boolean)
  const start = portions.slice(0, current - 1).reduce((sum, item) => sum + item.duration, 0)
  return { words, word: wordAtTime(words, time - start, portion.duration) }
}
