# Odsłuch audiobooka w trakcie renderowania

Po przygotowaniu planu i wybraniu **Generuj audiobook** pierwsza gotowa porcja
może pojawić się w odtwarzaczu pod tekstem. Kolejne porcje dołączają w kolejności.
Gdy odsłuch dogoni generowanie, widoczny jest komunikat oczekiwania.
Ręczna pauza pozostaje aktywna po otrzymaniu następnej porcji.

Suwak obejmuje już wygenerowaną część. Po ukończeniu nadal powstaje pełny
plik M4B albo MP3; M4B zachowuje rozdziały. Końcowy mastering może zmienić
poziom głośności względem odsłuchu porcji. Pierwsze użycie modelu wymaga
jego wczytania i nie gwarantuje natychmiastowego odtwarzania.

## Kontrakt

Lokalny adapter obsługuje `/audiobook` i `/audiobook/resume/{id}` z nagłówkiem
`X-Next-Audiobook-Stream: 1`. Zdarzenia SSE `audio_chunk` wskazują osobne,
kompletne WAV. Nie są to bajty dopisywane do otwartego M4B/MP3.
Oryginalny renderer nadal odpowiada za licencje, zadania, historię i finał.

Wznowienie odtwarza kolejkę od początku z zachowanych porcji; nie przywraca
lokalnej pozycji odsłuchu. Przejście między porcjami może mieć krótką przerwę
dekodera. Zdalny lub starszy silnik może udostępniać dopiero gotowy pełny plik.
Odtwarzacz porcji i zwykły podgląd nie powinny grać jednocześnie.

## Gdzie zmienić

- `scripts/runtime/audiobook_streaming.py` — podział, cache i zdarzenia.
- `src/lib/audiobook-playback.ts` — kolejka, pauza, oczekiwanie i seek.
- `src/lib/AudiobookPlayer.svelte` — interfejs odsłuchu.
- `src/lib/ProductionWorkspace.svelte` — zadanie i przekazywanie zdarzeń.
- `scripts/runtime/launcher.py`, `src-tauri/src/runtime.rs` — osadzenie adaptera.

Regresje: `node scripts/audiobook-playback-check.mjs`
i `scripts/runtime/test_audiobook_streaming.py` we właściwym środowisku.
Fixture z proceduralnym WAV nie potwierdza jakości głosu, długiej książki ani
przepływu GPU. Osobno odbierz cancel/resume, pamięć, finał i uruchomione EXE.
Zobacz [weryfikację](weryfikacja.md) i [runtime](runtime.md).
