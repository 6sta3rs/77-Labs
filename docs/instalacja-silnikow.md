# Środowiska dodatkowych silników

Panel **Środowiska dodatkowych silników** przygotowuje osobne środowiska Python
lub program audio.cpp. To inna operacja niż pobranie wag. Sam odczyt katalogu
nie instaluje pakietów i nie testuje modeli.

## Przepływ

1. Wybierz recepturę i sprawdź źródła, wersje, warunki oraz szacunek miejsca.
2. Jawnie rozpocznij instalację. Katalog może pokazać brak obsługi platformy
   lub wymagania CUDA zamiast oferować pozornie działającą opcję.
3. Śledź etapy i log. Anulowanie czeka na zakończenie własnego drzewa procesów.
4. Po udanej weryfikacji udostępnij środowisko osobną akcją i zrestartuj silnik.
5. Oddzielnie pobierz wagi, przejrzyj ich warunki i wybierz model.

Receptury pochodzą z przypiętego backendu, m.in. dla IndexTTS, MOSS, Confucius,
Supertonic, PocketTTS, VoxCPM, CosyVoice i audio.cpp. Aktualna lista oraz
wymagania są w panelu; obecność receptury nie oznacza odbioru każdej instalacji.

## Izolacja

Próby trafiają do `runtime_root/sidecars/<engine_id>/<attempt_id>`. Korzystają
z własnego narzędzia uv i cache, bez instalacji do głównego venv lub globalnego
Python. Gotowego venv nie należy przenosić: może zawierać ścieżki bezwzględne.
Nowa receptura tworzy własny katalog, a częściowe dane pozostają do inspekcji.

Aktywacja zmienia wyłącznie dozwolony klucz prywatnego środowiska i wymaga
restartu. Nie zmienia bieżącego modelu i nie akceptuje warunków za użytkownika.
Część zależności przechodnich jest rozwiązywana podczas instalacji; receptura
nie stanowi pełnego zahaszowanego locka każdego zewnętrznego środowiska.

## Pliki i sprawdzanie

- `scripts/runtime/engine_installation.py` — katalog AST, worker i statusy.
- `scripts/runtime/private_environment.py` — atomowy zapis konfiguracji.
- `src/lib/EngineRuntimeInstaller.svelte` — panel.
- `src/lib/engine-installation.ts` — transport i zgoda na recepturę.

Kontrole bez kosztownej inferencji:
`python -S scripts/runtime/test_engine_installation.py`
i `node scripts/engine-installation-check.mjs`.
Testy fixture nie potwierdzają instalacji wszystkich silników na każdym Windows.
Zobacz [instalację bazowego runtime](instalacja-runtime.md),
[dodatkowe TTS](dodatkowe-modele-tts.md) i [licencje](licencje-modeli.md).
