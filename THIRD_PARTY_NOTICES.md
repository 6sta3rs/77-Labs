# Licencje i pochodzenie składników

Kod Seventy Seven Labs jest udostępniany na **AGPL-3.0-only**; pełny tekst
znajduje się w [LICENSE](LICENSE). Poniższy spis opisuje istotne dostarczone
składniki i granice ich licencji. Nie zmienia ich warunków.

## VoiceStudio — backend

- Źródło: [debpalash/VoiceStudio](https://github.com/debpalash/VoiceStudio),
  wersja 0.5.7, commit `7a6c8980bb9c04db145357a8190a37a0e9f462da`.
- Dostarczone źródła: `scripts/runtime/engine.zip`; manifest plików i SHA-256:
  `scripts/runtime/engine-provenance.json`.
- Licencja aplikacji upstream: **AGPL-3.0-only**.
- Copyright 2024-present Palash Debnath and VoiceStudio contributors.
- Oryginalne `LICENSE` oraz `LICENSE-NOTICE.md` pozostają w archiwum.
  [Przypięty notice upstream](https://github.com/debpalash/VoiceStudio/blob/7a6c8980bb9c04db145357a8190a37a0e9f462da/LICENSE-NOTICE.md)
  rozdziela kod aplikacji, pakiet OmniVoice i pobierane modele.

Seventy Seven Labs dostarcza osobny interfejs Svelte/Tauri oraz rozszerzenia
w `scripts/runtime`. Launcher przygotowuje własną kopię backendu i stosuje
udokumentowane adaptery. Zakres uruchamiania opisuje [runtime](docs/runtime.md).
Nie jest to oficjalne wydanie VoiceStudio ani produkt jego autorów.

## OmniVoice — pakiet Python

Katalog `omnivoice/` wewnątrz archiwum silnika jest według oryginalnego
`LICENSE-NOTICE.md` osobnym pakietem autorstwa Han Zhu i autorów OmniVoice,
na **Apache License 2.0**. Nie jest przez projekt ponownie licencjonowany.
Kod aplikacji AGPL nie zmienia tej licencji ani warunków wag.

Źródło: [k2-fsa/OmniVoice](https://github.com/k2-fsa/OmniVoice).
Pełny tekst: [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt);
wersja kanoniczna: [Apache Software Foundation](https://www.apache.org/licenses/LICENSE-2.0).
Przy przygotowaniu paczki binarnej trzeba dołączyć wymagane teksty i notices
każdego faktycznie dostarczanego składnika.

## T3 Code — palety i wybrane style kontrolek

Przeniesione palety i style pochodzą z
[pingdotgg/t3code](https://github.com/pingdotgg/t3code).
Copyright (c) 2026 T3 Tools Inc. Licencja **MIT**; pełny tekst pozostaje w
[src/lib/themes/LICENSE-T3](src/lib/themes/LICENSE-T3).

- Palety: rewizja `86534db4d3525a070589a234d660a3e0373a42ea`,
  `packages/shared/src/themePalettes.ts`.
- Referencja stylów kontrolek:
  `89424d9fa01c6bd24664315c7ccda8d6cb1eab61`.
- Komponenty oraz zachowanie są dostosowane do Svelte i lokalnego studia.
  Szczegóły: [motywy](docs/motywy-t3-code.md), [kontrolki](docs/t3-controls.md).

## Circle Flags — oznaczenia języków

62 lokalne SVG pochodzą z
[HatScripts/circle-flags](https://github.com/HatScripts/circle-flags),
rewizja `379588b5da95482d6bbf10bd45644a35b0609ea6`.
Copyright (c) 2026 HatScripts. Licencja **MIT**;
[oryginalny tekst](src/lib/ui/language-flags/LICENSE.md),
[opis](src/lib/ui/language-flags/README.md) i `provenance.json` są dołączone
do katalogu flag. Rozwiązanie dowiązań do plików źródłowych opisuje manifest.

## Zależności i materiały interfejsu

Zależności npm, Rust i Python zachowują własne licencje. Dokładne wersje
opisują `package-lock.json`, `src-tauri/Cargo.lock` oraz `uv.lock` w archiwum
silnika. Wersje i licencje należy oceniać dla faktycznej paczki; ten dokument
nie jest kompletnym wykazem zależności przechodnich ani notices dla EXE.

Publiczna wersja nie dostarcza odzyskanego shadera, symulacji płynu ani tekstur
ze strony ElevenLabs. Nie dostarcza też skopiowanych avatarów i logotypów
wydawców modeli. Nazwy modeli służą ich identyfikacji; nie oznaczają patronatu
ani powiązania z ich autorami. Starsze wewnętrzne identyfikatory mogą pozostać
dla zgodności ustawień i nie udzielają praw do cudzych materiałów.

Zrzuty aplikacji powinny przedstawiać własny interfejs i czyste dane demo.
Systemowe kroje pisma są używane przez nazwę; repozytorium nie dostarcza plików
fontów systemu Windows.

## Modele, tokenizery i nagrania

Repozytorium nie zawiera wag modeli, prywatnych profili głosów, nagrań,
baz ani potwierdzeń warunków użytkownika. AGPL aplikacji nie udziela praw do
pobieranych wag, tokenizerów, danych treningowych ani głosów. Poszczególne
rewizje mogą mieć warunki komercyjne, niekomercyjne, atrybucyjne lub dostępu
wymagające samodzielnego przeglądu.

Dotyczy to także zależności głównego modelu, np. tokenizera audio.
Odczyt metadanych ani lokalne potwierdzenie w panelu nie są zapewnieniem
kompletności praw. Korzystaj ze źródeł wskazanych przy dokładnym modelu.
Zgoda na klonowanie i prawa do referencyjnego nagrania są odrębne od licencji
kodu i modelu.

## Przed dystrybucją gotowych paczek

Publikacja kodu źródłowego nie oznacza gotowości do redystrybucji wszystkich
zależności binarnych. Przed dołączeniem bibliotek lub wag do wydania trzeba:

1. Sporządzić wykaz faktycznie dostarczonych plików i ich wersji.
2. Dołączyć właściwe licencje, copyright, notices i odpowiadające źródła,
   zgodnie z warunkami każdego składnika.
3. Sprawdzić dystrybucje FFmpeg/PyAV, dołączone kodeki i opcjonalne biblioteki
   GPU; sama licencja źródeł pakietu Python nie opisuje wszystkich jego binariów.
4. Oddzielnie ocenić warunki wag i tokenizerów. Nie przenosić osobistych
   potwierdzeń ani dostępu do modeli na odbiorców paczki.

Przy dystrybucji lub udostępnieniu zmodyfikowanego programu przez sieć
obowiązki wynikają z pełnego tekstu AGPL. Zachowuj oryginalne notices,
oznaczenia zmian i dostęp do odpowiednich źródeł. Licencje oprogramowania
nie są zezwoleniem na użycie znaków towarowych jako własnych.
