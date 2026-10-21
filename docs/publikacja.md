# Publikacja źródeł

To repozytorium jest osobnym publicznym początkiem projektu. Prywatny checkout i jego historia nie są częścią publikacji. Nie kopiuj starego katalogu `.git`, checkpointów ani ignorowanych wyników do tego repozytorium.

## Zawartość

Kod aplikacji i adapterów, przypięty licencjonowany silnik, dokumentacja, fikcyjne dane demo, proceduralny ton oraz nowe zrzuty UI. Przykłady w `engine.zip` pochodzą z przypiętych źródeł upstream; nie są nagraniami użytkownika Seventy Seven Labs.

Nie przeniesiono prywatnych projektów, baz, nagrań, głosów, raportów, screenów konta ani decyzji licencyjnych. Materiały bez ustalonej licencji zastąpiono neutralnymi ikonami i autorską wizualizacją. Atrybucje zewnętrznych autorów zachowano.

## Kontrola

```powershell
npm ci
npm run check
npm run build
npm run test:ui
python -B scripts/test_publication_check.py
python scripts/publication_check.py
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check
git status --short
```

Skrypt bada pliki, indeks, wszystkie obiekty Git (także nieosiągalne), checkpoint refs, prywatne formaty, tokeny, ścieżki użytkownika, osadzone audio i dokładny SHA silnika. Ton jest przypięty w `public-assets.json` i odtwarzalny przez `scripts/generate_demo_tone.py`.

Dodatkowe prywatne wzorce podaj przez `--deny-file`: plik JSON z tablicą ciągów, przechowywany **poza repozytorium**. Dopasowane wartości nie są drukowane. Przy pierwszym wydaniu dodaj `--require-anonymous`, aby sprawdzić autora, committera i taggera.

Kontrola ma określone reguły i nie zastępuje przeglądu nowych screenów, nagrań ani licencji. Obecne zrzuty pokazują wyłącznie fikcyjne dane demo.

## Dalsza praca

Raporty harnessów zapisuj do ignorowanego `.tmp/qa`. Własną mowę wskaż jawnie argumentem skryptu i trzymaj poza Git. `integration.py` wymaga `--run --profile ID`; ASR/konwersja/dubbing wymagają własnej referencji zgodnie z `--help`. Ton demo nie jest mową.

Pierwsze publiczne commity mają neutralną tożsamość. Przed kolejnym commitem sprawdź lokalne `git config user.name` i `git config user.email`, aby nie przejąć prywatnych ustawień globalnych.

CI sprawdza frontend i źródła. Nie uruchamia modeli, nie akceptuje warunków i nie dowodzi działania GPU, instalatora ani pełnego dubbingu.

Repozytorium nie ma zdalnego adresu. Publikacja wymaga osobnego utworzenia repo i wysłania **tej publicznej historii**. Gotowe archiwum źródeł powstaje z publicznego commita przez `git archive`; nie zawiera zależności, wyników kompilacji ani `.git`.
