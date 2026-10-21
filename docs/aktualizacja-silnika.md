# Aktualizacja kodu silnika

Backend jest przypiętym archiwum `scripts/runtime/engine.zip`. Jego źródło,
wersję, commit upstream i hashe plików opisuje `engine-provenance.json`
w tym samym katalogu. Sam numer wersji nie identyfikuje zawartości.

## Przygotowanie źródeł

`scripts/runtime/bundle.py` odczytuje wskazany commit przez `git archive`,
bez importowania backendu. Kandydat powinien trafić do osobnego katalogu,
zamiast nadpisywać aktywny ZIP. Przykład dla własnego checkoutu upstream:

```powershell
python scripts/runtime/bundle.py .tmp/upstream --commit <pełny-SHA-upstream> --version <wersja> --output .tmp/engine-candidate/engine.zip
python scripts/runtime/check_engine_candidate.py --current scripts/runtime/engine.zip --candidate .tmp/engine-candidate/engine.zip --report .tmp/engine-candidate/report.json --prepare
python -m unittest discover -s scripts/runtime -p test_engine_bundle.py -v
```

Archiwum musi zachować zasoby potrzebne do uruchomienia, migracje, konfigurację,
lock i oryginalne notices. Wynik porównania statycznego nie dowodzi działania
syntezy. Po zmianie backendu trzeba ponownie sprawdzić adaptery i parametry UI.

## Wybór kompletnej generacji

Launcher publikuje nową wersję w osobnym `runtime/engines/engine-<SHA>-...`.
Waliduje archiwum, przygotowuje źródła, sprawdza kompletność i dopiero wtedy
atomowo zapisuje mały wskaźnik wyboru. Nie nadpisuje załadowanych plików Windows.
Nieznany kontrakt wyłączenia automatycznego preload przerywa przygotowanie.

Przed migracją istniejących danych powstaje [spójna kopia](kopie-danych-runtime.md).
Błąd kopii ma zatrzymać start. Nowe zależności instaluje się w osobnym środowisku,
bez zmiany współdzielonych bibliotek i modeli.

## Odbiór i powrót

1. Zakończ zadania i zatrzymaj wyłącznie własny backend.
2. Zachowaj poprzedni pakiet, manifest, konfigurację i kompletną kopię danych.
3. Najpierw uruchom kandydata na wydzielonym runtime i kopii danych.
4. Sprawdź migracje, marker własności, start/stop oraz potrzebne przepływy:
   zapis projektu, TTS, ASR, pobranie wyniku i funkcje objęte zmianą.
5. Zbuduj i uruchom EXE z tym samym kompletem ZIP, manifestu oraz adapterów.

Przywrócenie starego ZIP nie cofa migracji bazy. Starszy backend potrzebuje
zgodnej kopii danych; zachowaj także dane powstałe podczas próby. Czyszczenie
nieużywanych generacji jest osobną operacją. Zobacz [runtime](runtime.md),
[weryfikację](weryfikacja.md) i [zasady współpracy](../CONTRIBUTING.md).
