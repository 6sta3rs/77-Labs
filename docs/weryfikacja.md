# Weryfikacja publicznego wydania

Kontrole wykonano 21.10.2026 na publicznym drzewie. Nie są przeniesieniem dawnych wyników prywatnego wdrożenia.

| Kontrola | Wynik i zakres |
| --- | --- |
| `npm ci --no-audit --no-fund` | PASS — instalacja z publicznego locka. |
| `npm run check` | PASS — 0 błędów i ostrzeżeń Svelte/TypeScript. |
| `npm run build` | PASS — produkcyjny bundle; pozostaje ostrzeżenie o głównym chunku ok. 728 kB przed gzip. |
| `npm run test:ui` | PASS — cały zestaw, w tym tagi, dane, anulowanie, katalog, foldery, wizualizacja, kolory, fokus i nakładki. |
| `cargo check --manifest-path src-tauri/Cargo.toml` | PASS — kod Rust/Tauri, bez budowania i uruchamiania nowego EXE. |
| Wybrane testy Python | PASS — 12 testów bundle, 9 guardów odbioru i 3 guardy obserwowanego folderu. |
| Lekkie testy JS i formatów | PASS — historia, diagnostyka, automatyzacja audio, dyktowanie oraz WAV PCM16/PCM24/FLOAT32 z kontrolą FFprobe. |
| Składnia harnessów | PASS — 88 plików Python oraz 94 JS/MJS z przeglądu zmienianych harnessów. |
| Testy skanera publikacji | 23 PASS, 1 SKIP: konto Windows nie pozwala utworzyć testowego symlinka katalogu. Sprawdzono UTF-16, media bez rozszerzeń, nieosiągalne obiekty i drzewa Git, wszystkie etapy indeksu oraz błędy i kompletność odpowiedzi zbiorczych. |
| Rzeczywisty podgląd demo | PASS — pięć kontroli: fikcyjne dane, WAV play/pause/seek/link pobrania, biblioteka, wygląd, brak błędów JS i żądań do prywatnego backendu. |
| Zrzuty README | Trzy PNG 1440×960 z nowego profilu Chromium; obejrzane pod kątem treści i prywatności. |
| Generator podglądu audio | PASS — `node scripts/controls-preview.mjs --audio`; wynik w ignorowanym `.tmp/qa` z proceduralnym tonem. Sprawdzono otwarcie offline. |
| Dokumentacja | PASS — lokalne odnośniki, polskie znaki, atrybucje i pełne teksty AGPL/Apache oraz zachowane notices MIT. |

Podgląd T3 dwukrotnie zwrócił `Preview automation snapshot timed out after 15000ms.` Zrzuty i interakcje sprawdzono Python Playwright w osobnym Chromium, z blokadą żądań backendu.

Kontrola prywatności obejmuje pliki, indeks, wszystkie obiekty Git i przypięte archiwum. Prywatny wykaz wzorców jest trzymany poza repozytorium. Pełny skan z `--require-anonymous --deny-file` przeszedł bez ustaleń; wariant zbiorczy zajął około 9 s na tym komputerze. Autor i committer publicznej historii są neutralni. Kontrolę powtarzaj po każdym commicie przed publikacją. Instrukcja: [publikacja](publikacja.md).

Nie wykonano nowej inferencji GPU, oceny jakości głosu, pobierania modeli, decyzji licencyjnych, instalacji na czystej VM, wszystkich modeli, pełnego dubbingu ani długiego audiobooka. Build i health nie zastępują takich odbiorów. Zrzuty i ton nie demonstrują jakości TTS.
