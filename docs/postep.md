# Postęp publicznego projektu

## 21.10.2026 — szybki audyt całej historii

Pierwszy publiczny punkt startowy zapisano z neutralnym autorem i committerem. Skaner czyta teraz wszystkie obiekty zbiorczo, zamiast uruchamiać osobny proces Git dla każdego pliku. Zachowuje kontrolę nieosiągalnych obiektów i nazw w drzewach, wszystkich etapów indeksu, taggerów oraz prób zastępowania obiektów. Sprawdza identyfikator, typ, rozmiar i kompletność odpowiedzi; błąd nie daje wyniku PASS.

Kontrole: 23 testy PASS, 1 SKIP dotyczący uprawnień Windows do symlinków. Rzeczywisty skan z prywatnymi wzorcami poza repo: 549 plików, 578 obiektów Git, przypięty ZIP, zero ustaleń, około 9 s. Diff-check obu plików i dokumentacji PASS. Zmiana obejmuje wyłącznie skaner, jego testy i zapis odbioru; nie powtarzano builda UI ani inferencji. Kontrolę historii powtarzamy po commicie. Nie wykonano publikacji zdalnej.

## 21.10.2026 — pierwsze przygotowanie open source

Powstało osobne repozytorium z nową historią i neutralnym autorem. Prywatny checkout miał niezapisane zmiany oraz checkpointy z danymi; pozostawiono go nietkniętego, a eksport oparto na ostatnim lokalnym commicie.

Usunięto prywatne nagrania, raporty, zrzuty i wygenerowane podglądy HTML z osadzonym audio. Imię, prywatny profil syntezy i lokalne ścieżki zastąpiono neutralnymi danymi lub jawnymi parametrami. Testy mowy wymagają własnej referencji. Raporty trafiają do ignorowanego `.tmp/qa`.

Materiały odzyskane ze strony komercyjnej i logotypy bez pełnej podstawy licencyjnej zastąpiono autorską wizualizacją i ikonami Lucide. Zachowano odczyt starszych ustawień. Dodano wybraną przez właściciela AGPL-3.0-only oraz oddzielne notices dla upstream, motywów i flag.

README, PRD, zasady współpracy/bezpieczeństwa, skaner publikacji i CI opisują publiczny punkt startowy. Demo ma fikcyjne projekty i proceduralny ton bez ludzkiego głosu. Trzy nowe zrzuty 1440×960 obejrzano; pięć kontroli demo przeszło bez żądań do prywatnego backendu.

Kontrole bieżącego drzewa: check 0/0, build, pełny test UI i cargo check PASS. Testy skanera: 17 PASS, 1 SKIP z powodu braku uprawnień Windows do testowego symlinka. Audyt plików i indeksu z prywatnym wykazem wzorców poza repo przeszedł; historia jest kontrolowana ponownie po commicie. Szczegóły i ograniczenia: [weryfikacja](weryfikacja.md). Poprawiono też kodowanie polskich znaków w nowej dokumentacji i sprawdzono lokalne odnośniki.

Pozostaje ostrzeżenie builda o głównym chunku ok. 728 kB. Nie odebrano wszystkich modeli, pełnych renderów dubbingu/audiobooków, CUDA ani instalacji na czystej maszynie. Nie wykonano nowej inferencji, pobierania wag, publikacji zdalnej ani migracji prywatnych danych. Rzeczywiste dane runtime, prywatne commity i niezapisana praca pozostały w oryginalnym katalogu.
