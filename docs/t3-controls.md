# Wspólne kontrolki

Podstawowe wymiary i stany pól, list oraz przełączników są adaptacją stylów
[T3 Code](https://github.com/pingdotgg/t3code/tree/89424d9fa01c6bd24664315c7ccda8d6cb1eab61/apps/web/src/components/ui).
Copyright (c) 2026 T3 Tools Inc.; [licencja MIT](../src/lib/themes/LICENSE-T3).
Obsługa interakcji jest dostosowana do Svelte i studia głosu.

## Umowa komponentów

- Input i Textarea mają spójne role tła, obramowania, błędu, readonly i disabled.
- Select korzysta z portalu i pozycjonowania względem ekranu. Obsługuje strzałki,
  Home/End, Enter/Space, Escape, Tab oraz wyszukiwanie prefiksem.
- Slider pozostaje natywną kontrolką zakresu; pokazuje wartość, obsługuje
  klawiaturę, wariant zwijany i ograniczenie ruchu.
- Switch rozdziela semantyczny stan ON od neutralnego wyboru w listach.
- Button obsługuje wspólne warianty akcji, ikon, linków pobrania i etykiet importu.
- Modale i popupy przywracają focus; zamykane treści nie powinny przyjmować
  klawiatury. Powierzchnie i blur mają jednego właściciela stylów.

## Gdzie zmienić

| Zakres | Plik lub katalog |
| --- | --- |
| Implementacje komponentów | `src/lib/ui/` |
| Role i geometria pól | `src/lib/ui.css` |
| Kolory palet | `src/lib/appearance.ts`, `src/lib/ui-colors.ts` |
| Portal, pozycja i dismissal | `src/lib/ui/overlay.ts` |
| Powierzchnie popupów | `src/lib/ui/overlays.css` |
| Intencja fokusu | `src/lib/focus-intent.ts`, `src/lib/ui/focus-intent.css` |

Kontrole: `npm run check`, `npm run build` i właściwe regresje z
`npm run test:ui`. Osobno sprawdź rzeczywistą klawiaturę, powrót fokusu,
kontrast i reduced motion. Katalog przykładów opisuje
[podgląd kontrolek](podglad-kontrolek.md). Sam katalog nie odbiera przepływów ML.
