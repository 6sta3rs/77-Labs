# Postęp publicznego projektu

## 21.10.2026 — pierwsze przygotowanie open source

Powstało osobne repozytorium z nową historią i neutralnym autorem. Prywatny checkout miał niezapisane zmiany oraz checkpointy z danymi; pozostawiono go nietkniętego, a eksport oparto na ostatnim lokalnym commicie.

Usunięto prywatne nagrania, raporty, zrzuty i wygenerowane podglądy HTML z osadzonym audio. Imię, prywatny profil syntezy i lokalne ścieżki zastąpiono neutralnymi danymi lub jawnymi parametrami. Testy mowy wymagają własnej referencji. Raporty trafiają do ignorowanego `.tmp/qa`.

Materiały odzyskane ze strony komercyjnej i logotypy bez pełnej podstawy licencyjnej zastąpiono autorską wizualizacją i ikonami Lucide. Zachowano odczyt starszych ustawień. Dodano wybraną przez właściciela AGPL-3.0-only oraz oddzielne notices dla upstream, motywów i flag.

README, PRD, zasady współpracy/bezpieczeństwa, skaner publikacji i CI opisują publiczny punkt startowy. Demo ma fikcyjne projekty i proceduralny ton bez ludzkiego głosu. Trzy nowe zrzuty 1440×960 obejrzano; pięć kontroli demo przeszło bez żądań do prywatnego backendu.

Kontrole bieżącego drzewa: check 0/0, build, pełny test UI i cargo check PASS. Testy skanera: 17 PASS, 1 SKIP z powodu braku uprawnień Windows do testowego symlinka. Audyt plików i indeksu z prywatnym wykazem wzorców poza repo przeszedł; historia jest kontrolowana ponownie po commicie. Szczegóły i ograniczenia: [weryfikacja](weryfikacja.md). Poprawiono też kodowanie polskich znaków w nowej dokumentacji i sprawdzono lokalne odnośniki.

Pozostaje ostrzeżenie builda o głównym chunku ok. 728 kB. Nie odebrano wszystkich modeli, pełnych renderów dubbingu/audiobooków, CUDA ani instalacji na czystej maszynie. Nie wykonano nowej inferencji, pobierania wag, publikacji zdalnej ani migracji prywatnych danych. Rzeczywiste dane runtime, prywatne commity i niezapisana praca pozostały w oryginalnym katalogu.
