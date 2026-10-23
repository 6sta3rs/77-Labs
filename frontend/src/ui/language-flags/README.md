# Lokalne flagi języków

62 okrągłe SVG pochodzą z [HatScripts/circle-flags](https://github.com/HatScripts/circle-flags),
z katalogu `flags/language`, z rewizji `379588b5da95482d6bbf10bd45644a35b0609ea6`.
Obowiązuje dołączona oryginalna licencja MIT w `LICENSE.md`. Pliki SVG nie były
modyfikowane; dowiązania symboliczne repozytorium źródłowego zastąpiono treścią
wskazywanego SVG. `provenance.json` podaje obie ścieżki źródłowe, rozmiary i SHA-256.

Zestaw obejmuje wszystkie 62 podstawowe kody języków nazwane w `voice-picker.ts`,
w tym komplet 18 jawnych języków tworzenia profilu (`profileLanguages`) i sześć
języków produkcji (`productionLanguages`). `LanguageFlag.svelte` wczytuje je w
czasie budowania aplikacji; działający interfejs nie odwołuje się do CDN.

Flaga jest umownym wizualnym oznaczeniem języka. Nie określa narodowości ani
akcentu mówcy i nie potwierdza obsługi języka przez model. Dopasowanie nazw,
aliasów ISO oraz BCP 47 korzysta z istniejącego `voiceLanguageCode`:
`Polish`, `pl` i `pol` wskazują tę samą flagę; `en-US` i `en-GB` wskazują
flagę ogólnego języka angielskiego. Nie wyprowadzamy flagi kraju z akcentu.
Automatyczne rozpoznawanie, wszystkie języki, nieznany język i języki spoza
zestawu pokazują glob; tekstowa nazwa języka pozostaje widoczna obok ikony.
