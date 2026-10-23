import { LANGUAGES, SOURCE_LANGUAGE, FALLBACK_LANGUAGE, type LanguageDef } from './languages'

export { LANGUAGES, SOURCE_LANGUAGE, FALLBACK_LANGUAGE } from './languages'
export type UiLanguage = (typeof LANGUAGES)[number]['code']
export type UiArguments = Record<string, string | number>
export type UiTranslator = ((source: string, args?: UiArguments) => string) & {
  readonly language: UiLanguage
  readonly locale: string
}
export type UiLanguageResult = { ok: true; language: UiLanguage } | { ok: false; language: UiLanguage; error: string }
export const UI_LANGUAGE_KEY = 'seventy-seven-labs.ui-language.v1'
let language: UiLanguage = SOURCE_LANGUAGE
let lastError = ''
const subscribers = new Set<(value: UiLanguage) => void>()
const languageDef = (code: string): LanguageDef | undefined => LANGUAGES.find(entry => entry.code === code)
const validLanguage = (value: unknown): value is UiLanguage => typeof value === 'string' && LANGUAGES.some(entry => entry.code === value)

/** Svelte's readable-store contract without a framework dependency. */
export const uiLanguage = {
  subscribe(run: (value: UiLanguage) => void) {
    subscribers.add(run)
    run(language)
    return () => { subscribers.delete(run) }
  },
}
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

// Lookup tables over ALL catalogs, so text that is already translated (for example an English message from the engine)
// is mapped back to its Polish source and then shown in the selected language. Built on first use and rebuilt when
// a language is added at runtime (tests do that).
type Template = NonNullable<ReturnType<typeof templatePattern>> & { source: string }
let preparedFor = -1
let sources = new Set<string>()
let reverse = new Map<string, string>()
let templates: Template[] = []
function prepare() {
  if (preparedFor === LANGUAGES.length) return
  sources = new Set(); reverse = new Map(); messageCache.clear()
  const found: Template[] = []
  for (const entry of LANGUAGES) {
    if (!entry.catalog) continue
    for (const [source, translated] of Object.entries(entry.catalog)) {
      if (typeof translated !== 'string') continue
      const firstSeen = !sources.has(source)
      sources.add(source)
      if (!reverse.has(translated)) reverse.set(translated, source)
      for (const text of firstSeen ? [source, translated] : [translated]) {
        const template = templatePattern(text)
        if (template) found.push({ ...template, source })
      }
    }
  }
  templates = found.sort((a, b) => b.literalLength - a.literalLength)
  preparedFor = LANGUAGES.length
}
function resolveMessage(text: string): { source: string; args?: UiArguments } {
  prepare()
  if (sources.has(text)) return { source: text }
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
/** Text for a Polish source key in one language, or undefined when that language has not translated it. */
function lookup(code: string, key: string) {
  const value = languageDef(code)?.catalog?.[key]
  return typeof value === 'string' ? value : undefined
}
export function createUiTranslator(value: UiLanguage): UiTranslator {
  const selected = validLanguage(value) ? value : SOURCE_LANGUAGE
  const translate = (source: string, args?: UiArguments) => {
    const message = resolveMessage(source)
    // Chain: the language itself, then the fallback language, then the Polish source.
    const text = selected === SOURCE_LANGUAGE ? message.source
      : lookup(selected, message.source) ?? lookup(FALLBACK_LANGUAGE, message.source) ?? message.source
    const values = message.args || args ? { ...message.args, ...args } : undefined
    return values ? text.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, name: string) =>
      Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder) : text
  }
  return Object.assign(translate, { language: selected, locale: languageDef(selected)?.locale ?? 'pl-PL' })
}
export const getUiLanguage = () => language
export function translateUi(source: string, args?: UiArguments) { return createUiTranslator(language)(source, args) }
export function getUiLanguageError() { return lastError ? translateUi(lastError) : '' }
function updateDocument() {
  if (typeof document === 'undefined') return
  document.documentElement.lang = language
  document.documentElement.dir = languageDef(language)?.dir ?? 'ltr'
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
    publish(validLanguage(saved) ? saved : SOURCE_LANGUAGE)
    return { ok: true, language }
  } catch {
    lastError = 'Nie udało się odczytać języka interfejsu. Włączono polski.'
    publish(SOURCE_LANGUAGE)
    return { ok: false, language, error: getUiLanguageError() }
  }
}
/** Persist before publishing, so a failed save cannot claim a lasting change. */
export function setUiLanguage(next: UiLanguage): UiLanguageResult {
  if (!validLanguage(next)) {
    lastError = 'Wybierz obsługiwany język interfejsu.'
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
