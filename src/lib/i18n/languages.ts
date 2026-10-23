// The one place that lists interface languages. Add a language with `npm run i18n:add` (see docs/features/i18n.md).
import { catalog as en } from './en/index'

export interface LanguageDef {
  /** BCP 47 code, also the folder name of the catalog (`src/lib/i18n/<code>/index.ts`). */
  code: string
  /** Name in the language itself (shown in the picker). */
  name: string
  /** Locale for numbers and dates (`Intl`). */
  locale: string
  dir?: 'ltr' | 'rtl'
  /** true: every key of the English catalog must be translated (checked by tests/frontend/i18n-languages-check.mjs). */
  complete?: boolean
  /** Polish source text -> text in this language; null for the source language itself. */
  catalog: Record<string, string> | null
}

/** The language the code is written in: its strings are the translation keys. */
export const SOURCE_LANGUAGE = 'pl'
/** Used for a key a language has not translated yet (before showing the Polish source). */
export const FALLBACK_LANGUAGE = 'en'

export const LANGUAGES = [
  { code: 'pl', name: 'Polski', locale: 'pl-PL', complete: true, catalog: null },
  { code: 'en', name: 'English', locale: 'en-US', complete: true, catalog: en },
  // i18n:add-language-above
] as const satisfies readonly LanguageDef[]
