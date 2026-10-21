# Seventy Seven Labs

Lokalne studio głosu na Windows. Pisz narrację, przypisuj głosy mówcom, pracuj z transkrypcją i przechowuj projekty na swoim komputerze.

**Svelte 5 · TypeScript · Tauri 2 · Python/FastAPI · AGPL-3.0-only**

Wersja rozwojowa **0.2.0**. Repozytorium zawiera kod aplikacji i przypięte źródła silnika VoiceStudio 0.5.7. Modele, środowisko Python, prywatne nagrania i dane kont nie są dołączone.

![Edytor narracji z przykładowym dialogiem](docs/screenshots/studio.png)

## Możliwości

- Edytor wielu mówców, znaczniki OmniVoice i cofanie zmian.
- Wybór głosu i silnika TTS, odtwarzanie, przewijanie i eksport wyników.
- Lokalna biblioteka projektów oraz nagrań.
- Transkrypcja audio i redakcja rozpoznanego tekstu.
- Przygotowanie dubbingu, audiobooków i receptur automatyzacji.
- Zarządzanie środowiskiem CPU/CUDA, wagami, warunkami modeli i wyglądem.

Synteza i rozpoznawanie wymagają przygotowanego silnika i odpowiednich wag. Pełny dubbing, długie audiobooki, wszystkie kombinacje modeli i instalacja na czystym Windows wymagają dalszego odbioru. [PRD](docs/PRD.md) opisuje zakres oraz kryteria, a [weryfikacja](docs/weryfikacja.md) podaje kontrole publicznego wydania.

## Podgląd bez modeli

Wymagania: Node.js **22.12 lub nowszy** z npm oraz Git. Python ani GPU nie są potrzebne.

```powershell
npm ci
npm run dev
```

Otwórz **http://127.0.0.1:4310/?demo=tts**. Podgląd ma fikcyjne głosy, dialogi i historię. Przykłady audio odtwarzają jeden proceduralny ton bez ludzkiego głosu. To demonstracja interfejsu; nie są to wyniki wymienionych modeli. Dane demo pozostają w pamięci.

Katalog komponentów: **http://127.0.0.1:4310/inputy.html**. [Opis demo](docs/tts-demo.md).

![Biblioteka fikcyjnych głosów](docs/screenshots/voices.png)

## Aplikacja desktopowa

Windows wymaga także Rust stable, narzędzi C++ z Visual Studio Build Tools i WebView2. Zobacz [wymagania Tauri](https://v2.tauri.app/start/prerequisites/).

```powershell
npm run desktop:dev
npm run desktop:build
```

Build tworzy EXE bez instalatora: `src-tauri/target/release/seventy-seven-labs.exe`.

Okno otwiera się bez ładowania modeli. W **Ustawienia → Modele i silnik** przygotuj środowisko CPU albo NVIDIA CUDA i osobno pobierz model. Przed użyciem przeczytaj i zaakceptuj jego warunki. EXE zawiera kod backendu, ale nie wielogigabajtowe biblioteki i wagi. [Instalacja środowiska](docs/instalacja-runtime.md), [działanie silnika](docs/runtime.md).

Przeglądarka pokazuje UI, lecz nie uruchamia nadzorcy Tauri. Aktywna synteza w trybie web wymaga osobno uruchomionego backendu na `127.0.0.1:4312`.

## Dane i prywatność

Projekty web są zapisywane w localStorage/IndexedDB danego profilu przeglądarki. Dane silnika desktopowego trafiają domyślnie do `%LOCALAPPDATA%/VoiceStudioNext`, poza repozytorium. Starsze identyfikatory katalogów, pamięci i Tauri zachowano dla zgodności istniejących danych.

Publiczna historia zaczyna się od nowa z neutralnym autorem. Nie zawiera prywatnej historii rozwoju, checkpointów, baz, próbek głosu ani zapisanych decyzji licencyjnych. [Zasady publikacji](docs/publikacja.md).

Integracje sieciowe są opcjonalne. Pobieranie modeli i wybrana usługa językowa mogą wymagać internetu. Klonuj wyłącznie głos, do którego użycia masz zgodę. [Bezpieczeństwo](SECURITY.md).

![Ustawienia wyglądu](docs/screenshots/appearance.png)

## Rozwój

```powershell
npm run check
npm run build
npm run test:ui
python scripts/publication_check.py
cargo check --manifest-path src-tauri/Cargo.toml
```

Kontrola publikacji sprawdza pliki, zagnieżdżone archiwum silnika, dozwolone audio oraz osiągalne rewizje Git. Raporty lokalnych harnessów trafiają do ignorowanego `.tmp/qa`. Testy mowy wymagają własnej, jawnie wskazanej referencji; ton demo służy do odtwarzacza i UI.

Zasady zmian: [CONTRIBUTING.md](CONTRIBUTING.md), [kontekst techniczny](docs/kontekst-projektu.md).

### Gdzie zmienić X?

| Obszar | Plik |
| --- | --- |
| Nawigacja i składanie aplikacji | `src/App.svelte` |
| Edytor i znaczniki | `src/lib/SpeechEditor.svelte`, `src/lib/tags.ts` |
| Wybór głosu/modelu | `src/lib/VoicePicker.svelte`, `src/lib/ModelPicker.svelte` |
| Trwałe nagrania | `src/lib/library.ts` |
| Odtwarzacz/wizualizacja | `src/lib/Player.svelte`, `src/lib/VoiceOrb.svelte` |
| Kontrolki i motywy | `src/lib/ui/`, `src/lib/appearance.ts`, `src/styles.css` |
| Dane przykładowe | `src/lib/tts-demo.ts`, `public/demo/` |
| API i nadzór | `src/lib/api.ts`, `src-tauri/src/runtime.rs` |
| Uruchamianie i instalacja Pythona | `scripts/runtime/launcher.py`, `scripts/runtime/bootstrap.py` |
| Specyfikacja produktu | `docs/PRD.md` |

## Licencja i pochodzenie

Kod Seventy Seven Labs: **AGPL-3.0-only** — [LICENSE](LICENSE). Dołączony VoiceStudio używa AGPL-3.0-only; jego pakiet `omnivoice/` ma odrębne warunki Apache-2.0. Motywy T3 Code i flagi zachowują swoje licencje oraz atrybucje. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) opisuje te granice.

Wagi mają własne warunki; licencja aplikacji nie udziela praw do wszystkich modeli. Źródło i SHA-256 backendu: `scripts/runtime/engine-provenance.json`. Projekt nie jest oficjalnym wydaniem T3 Code ani dostawców modeli.
