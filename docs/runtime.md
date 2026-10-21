# Lokalny silnik

Seventy Seven Labs nadzoruje własny proces Python/FastAPI na `127.0.0.1:4312`. EXE zawiera kod VoiceStudio 0.5.7, a biblioteki Python/GPU oraz wagi instaluje się osobno. Repo nie dostarcza gotowych profili, bazy ani zgód modeli.

## Pierwszy start

1. Uruchom `npm run desktop:dev` lub zbudowany EXE.
2. W **Ustawienia → Modele i silnik → Samodzielne środowisko Python** wybierz CPU albo zgodną konfigurację NVIDIA CUDA.
3. Poczekaj na pobranie i rzeczywiste sprawdzenie kandydata, następnie aktywuj gotowe środowisko.
4. Przeczytaj warunki wybranego modelu i osobno pobierz jego wagi.
5. Dodaj własny profil z nagrania, do którego masz zgodę, i sprawdź krótką wypowiedź w UI.

[Pełna instrukcja instalacji](instalacja-runtime.md). Obecność bibliotek lub wag nie oznacza potwierdzonej inferencji. Instalacja na czystym Windows i warianty CUDA wymagają osobnego odbioru.

## Katalogi i izolacja

Domyślnie dane są pod `%LOCALAPPDATA%/VoiceStudioNext`. `data/` zawiera bazę, głosy, wyniki i konfigurację; `runtime/` oraz `runtime_<id>/` zawierają środowiska. `active-runtime.json` wskazuje wybrane środowisko. Generacje źródeł i przypięte ZIP są w katalogach runtime.

Lokalizacje danych i modeli odczytuj z ustawień. Opcjonalne `VOICESTUDIO_NEXT_PYTHON` wskazuje jawny interpreter i ma pierwszeństwo przed aktywowanym środowiskiem; wyłącz nadpisanie przy testach aktywacji.

Przed migracją launcher robi spójną kopię danych. Import zgodności może czytać dawną bazę OmniVoice tylko do odczytu i kopiować profile do nowego katalogu. Nie jest to pełna migracja projektów i historii. Nie edytuj bibliotek i modeli współdzielonych hardlinkami. [Kopie danych](kopie-danych-runtime.md).

## Nadzór

Okno startuje bez Pythona. Operacja wymagająca silnika uruchamia własny proces, którego marker jest sprawdzany w odpowiedzi health. Obcy serwer nie jest przejmowany. Start i kopie mają ograniczony czas oczekiwania oraz rzeczywisty postęp. Stop kończy wyłącznie własne procesy; automatyczne usypianie wymaga pięciu minut potwierdzonej bezczynności.

GET katalogu używa lekkich metadanych. Jawne sprawdzenie i synteza wykonują rzeczywiste kontrole. Katalog i health nie potwierdzają działania modeli.

Vite przekazuje `/backend` na port 4312, ale przeglądarka nie uruchamia nadzorcy Tauri. Bez modeli używaj `/?demo=tts`.

## Mapa plików

| Odpowiedzialność | Plik |
| --- | --- |
| Nadzór i IPC | `src-tauri/src/runtime.rs`, `src/lib/runtime.ts` |
| Instalacja i doctor | `scripts/runtime/bootstrap.py`, `src-tauri/src/installer.rs` |
| Start i adaptery | `scripts/runtime/launcher.py` |
| Lekkie metadane | `scripts/runtime/engine_catalogue_metadata.py` |
| Wagi i pobieranie | `scripts/runtime/model_management.py` |
| Pochodzenie źródeł | `scripts/runtime/engine-provenance.json`, `bundle.py` |

## Sprawdzanie

`cargo check --manifest-path src-tauri/Cargo.toml` sprawdza kod Rust. `scripts/runtime/smoke.py` bada start/health/stop, nie generowanie. Testy mowy wymagają świadomego wskazania własnego profilu lub referencji. Wyniki zapisuj do ignorowanego `.tmp/qa`.

Ton demo służy do odtwarzacza i UI, nie do klonowania ani poprawnej mowy w ASR. Pełny odbiór wymaga krótkiej syntezy w UI, odtwarzania, zapisu/reload, stopu i zwolnienia portu. Dubbing, audiobooki i konfiguracje sprzętowe mają osobne testy. W ramach publikacji nie wykonywano nowej inferencji ani pobierania wag.
