# Modele i katalog wag

**Ustawienia → Modele i silnik** rozdzielają środowisko z bibliotekami,
pobierane wagi oraz wybór aktywnego silnika. Pobranie modelu nie instaluje
zależności każdej rodziny i nie potwierdza prawa do jej użycia.

## Wybór katalogu

Panel pokazuje ścieżkę skonfigurowaną i efektywną dla bieżącego procesu.
**Zapisz katalog** zmienia `OMNIVOICE_CACHE_DIR` w prywatnym `data/environment`.
Nie przenosi istniejących modeli. Uruchom ponownie silnik, aby użyć nowej
ścieżki. Własny katalog wag musi być oddzielony od danych i runtime;
nieprawidłowe ścieżki oraz dowiązania są odrzucane.

## Pobranie i anulowanie

**Pobierz wagi** uruchamia własny nadzorowany proces z przypiętymi rewizjami
repozytoriów. Używany jest wyłącznie token zapisany dla tej aplikacji.
Postęp pokazuje rzeczywiste bajty, gdy znany jest rozmiar. Stan zadania jest
trwały; niedokończone pobranie może zostać uzupełnione po ponowieniu.

Anulowanie czeka na zakończenie własnego procesu i jego potomków. Obce procesy
pozostają poza nadzorem. Samo przerwanie połączenia nie dowodzi zakończenia pracy.
Główny proces syntezy korzysta z lokalnych plików, bez pobierania w czasie inferencji.

## Usuwanie i warunki

Usunięcie pojedynczego modelu wymaga wskazania identyfikatora oraz stanu bez
aktywnego użycia. Dotyczy własnego cache; nie usuwa cudzych bibliotek lub
modeli w innych instalacjach. Przejrzyj [warunki modelu](licencje-modeli.md),
w tym zależności tokenizera. Stan `installed` opisuje kompletność plików,
a nie udany test syntezy.

## Pliki

- `src/lib/EngineCatalog.svelte`, `src/lib/model-management.ts` — katalog i UI.
- `scripts/runtime/model_management.py` — zadania, cache, pobieranie i usuwanie.
- `scripts/runtime/launcher.py` — efektywna konfiguracja procesu.

Regresje: `scripts/runtime/test_model_management.py`.
Do pełnego odbioru potrzebny jest dodatkowo rzeczywisty transfer, restart,
próba wybranego modelu i kontrola danych. Zobacz [instalację runtime](instalacja-runtime.md)
oraz [dodatkowe TTS](dodatkowe-modele-tts.md).
