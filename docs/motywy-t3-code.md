# Motywy i palety T3 Code

Palety pochodzą z `pingdotgg/t3code`,
[themePalettes.ts w przypiętej rewizji](https://github.com/pingdotgg/t3code/blob/86534db4d3525a070589a234d660a3e0373a42ea/packages/shared/src/themePalettes.ts).
Copyright (c) 2026 T3 Tools Inc.; licencja MIT i pełny tekst:
[LICENSE-T3](../src/lib/themes/LICENSE-T3).

## Zachowanie

Studio oferuje T3 Code, Ocean, Grove, Ember, Iris i T3 Chat w wariantach jasnym
i ciemnym. `src/lib/themes/t3-palettes.ts` zachowuje wartości źródłowe,
a `appearance.ts` mapuje je na role interfejsu. Kontrast może zmieniać wynikowe
obramowania. Miniatury korzystają z rzeczywistych palet.

Tryb **System** odczytuje schemat systemowy i wybiera osobne przypisanie dla
jasnego oraz ciemnego wyglądu. Kulki na karcie przypisują wariant do danego
trybu; nazwa karty ustawia dostępne warianty. Starsze identyfikatory `studio`
i `rose` zachowują zgodność ustawień.

Własny motyw można utworzyć, skopiować, edytować, eksportować i importować jako
JSON T3 Code v1. Import ma limit 256 KB i walidację ról. Usunięcie wymaga
potwierdzenia; usunięcie aktywnego motywu przywraca odpowiednią paletę domyślną.
Uszkodzona lokalna biblioteka blokuje zapis, aby nie utracić danych do odzyskania.
Nie ma synchronizacji z T3 Code ani galerii online.

## Gdzie zmienić

- `src/lib/Appearance.svelte` — karty, przypisania i ustawienia.
- `src/lib/ThemeDialog.svelte` — edytor i import.
- `src/lib/themes/library.ts` — format, walidacja i lokalna biblioteka.
- `src/lib/appearance.ts` — stosowanie palet i zapis preferencji.

Biblioteka używa localStorage `voicestudio.themes.v1`, a preferencje
`voicestudio.appearance.v2`. Testuj w osobnym profilu, by nie zmienić własnych
ustawień. Zobacz [katalog kontrolek](podglad-kontrolek.md)
i [notices](../THIRD_PARTY_NOTICES.md).
