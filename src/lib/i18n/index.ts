import { enCore } from './en-core'
import { enStudio } from './en-studio'
import { enTools } from './en-tools'
import { enDemo } from './en-demo'
import { enAdditions } from './en-additions'

export type UiLanguage = 'pl' | 'en'
export type UiArguments = Record<string, string | number>
export type UiTranslator = ((source: string, args?: UiArguments) => string) & {
  readonly language: UiLanguage
  readonly locale: 'pl-PL' | 'en-US'
}
export type UiLanguageResult = { ok: true; language: UiLanguage } | { ok: false; language: UiLanguage; error: string }
export const UI_LANGUAGE_KEY = 'seventy-seven-labs.ui-language.v1'
const english: Record<string, string> = Object.assign(Object.create(null), enAdditions, enCore, enStudio, enTools, enDemo)
let language: UiLanguage = 'pl'
let lastError = ''
const subscribers = new Set<(value: UiLanguage) => void>()
const validLanguage = (value: unknown): value is UiLanguage => value === 'pl' || value === 'en'

/** Svelte's readable-store contract without a framework dependency. */
export const uiLanguage = {
  subscribe(run: (value: UiLanguage) => void) {
    subscribers.add(run)
    run(language)
    return () => { subscribers.delete(run) }
  },
}
const reverse = new Map<string, string>()
const messageCache = new Map<string, { source: string; args?: UiArguments }>()
const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function templatePattern(text: string) {
  const names: string[] = []
  let offset = 0, pattern = '^', literalLength = 0
  for (const match of text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)) {
    const literal = text.slice(offset, match.index)
    literalLength += literal.trim().length
    pattern += escapePattern(literal) + '([\\s\\S]*?)'
    names.push(match[1]); offset = match.index! + match[0].length
  }
  const tail = text.slice(offset)
  pattern += escapePattern(tail) + '$'; literalLength += tail.trim().length
  return names.length && literalLength >= 3 ? { pattern: new RegExp(pattern), names, literalLength } : undefined
}
const templates = Object.entries(english).flatMap(([source, translated]) => {
  if (!reverse.has(translated)) reverse.set(translated, source)
  return [source, translated].flatMap(text => {
    const entry = templatePattern(text)
    return entry ? [{ ...entry, source }] : []
  })
}).sort((a, b) => b.literalLength - a.literalLength)
function resolveMessage(text: string): { source: string; args?: UiArguments } {
  if (Object.prototype.hasOwnProperty.call(english, text)) return { source: text }
  const exact = reverse.get(text)
  if (exact) return { source: exact }
  const cached = messageCache.get(text)
  if (cached) return cached
  let resolved: { source: string; args?: UiArguments } = { source: text }
  if (text.length <= 8192) for (const template of templates) {
    const match = template.pattern.exec(text)
    if (!match) continue
    resolved = { source: template.source, args: Object.fromEntries(template.names.map((name, index) => [name, match[index + 1]])) }
    break
  }
  if (messageCache.size >= 512) messageCache.delete(messageCache.keys().next().value!)
  messageCache.set(text, resolved)
  return resolved
}
export function createUiTranslator(value: UiLanguage): UiTranslator {
  const selected = validLanguage(value) ? value : 'pl'
  const translate = (source: string, args?: UiArguments) => {
    const message = resolveMessage(source)
    const text = selected === 'en' && typeof english[message.source] === 'string' ? english[message.source] : message.source
    const values = message.args || args ? { ...message.args, ...args } : undefined
    return values ? text.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, name: string) =>
      Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder) : text
  }
  return Object.assign(translate, { language: selected, locale: selected === 'en' ? 'en-US' as const : 'pl-PL' as const })
}
export const getUiLanguage = () => language
export function translateUi(source: string, args?: UiArguments) { return createUiTranslator(language)(source, args) }
export function getUiLanguageError() { return lastError ? translateUi(lastError) : '' }
function updateDocument() {
  if (typeof document === 'undefined') return
  document.documentElement.lang = language
  const page = document.documentElement.dataset.page
  const title = page === 'controls' ? 'Kontrolki — Seventy Seven Labs'
    : page === 'dictation-widget' ? 'Dyktowanie — Seventy Seven Labs' : 'Seventy Seven Labs'
  document.title = translateUi(title)
}
function publish(next: UiLanguage) {
  const changed = language !== next
  language = next
  updateDocument()
  if (changed) for (const run of [...subscribers]) run(language)
}
/** Load only the interface preference. No runtime or speech settings are touched. */
export function initUiLanguage(): UiLanguageResult {
  try {
    const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem(UI_LANGUAGE_KEY)
    lastError = ''
    publish(validLanguage(saved) ? saved : 'pl')
    return { ok: true, language }
  } catch {
    lastError = 'Nie udało się odczytać języka interfejsu. Włączono polski.'
    publish('pl')
    return { ok: false, language, error: getUiLanguageError() }
  }
}
/** Persist before publishing, so a failed save cannot claim a lasting change. */
export function setUiLanguage(next: UiLanguage): UiLanguageResult {
  if (!validLanguage(next)) {
    lastError = 'Wybierz język polski lub angielski.'
    return { ok: false, language, error: getUiLanguageError() }
  }
  try {
    if (typeof localStorage === 'undefined') throw new Error('Storage unavailable')
    localStorage.setItem(UI_LANGUAGE_KEY, next)
  } catch {
    lastError = 'Nie udało się zapisać języka interfejsu. Poprzedni język pozostaje aktywny.'
    return { ok: false, language, error: getUiLanguageError() }
  }
  lastError = ''
  publish(next)
  return { ok: true, language }
}
