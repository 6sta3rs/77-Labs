/** Polish noun form for a count: 1 plik, 2-4 pliki, 5+ plików (12-14 and 0 take the genitive plural); the rule comes from CLDR. */
const polishRules = new Intl.PluralRules('pl')
export function polishPlural(n: number, one: string, few: string, many: string): string {
  const category = polishRules.select(n)
  return category === 'one' ? one : category === 'few' ? few : many
}
