/** Polish noun form for a count: 1 plik, 2-4 pliki, 5+ plików (12-14 and 0 take the genitive plural). */
export function polishPlural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10, mod100 = n % 100
  if (n === 1) return one
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many
}
