# Format WAV, presety i projektowanie głosu

Dodatkowe kontrolki włączają się po odkryciu rzeczywistej sygnatury `/generate`
w aktywnych źródłach przez `generateCapabilities`. Sam numer wersji ani nazwa
silnika nie wystarczają. Starszy backend bez metadanych nie otrzymuje nowych pól.

## Format wyniku

**Zaawansowane ustawienia mowy** mogą oferować PCM WAV16, PCM WAV24 i WAV32 float.
To format zapisu, nie obietnica poprawy jakości modelu. Wiele bloków jest łączonych
bez ukrytego resamplingu, z zachowaniem częstotliwości, kanałów i pauz. Niezgodne
parametry wejściowych WAV dają czytelny błąd. Limit wyniku wynosi 512 MiB.

## Presety i szkic

Lista wbudowanych głosów pochodzi z `preset_voices` aktywnego katalogu.
Wybór presetu wysyła `preset_voice`, zamiast udawać profil klonu. Zmiana silnika
usuwa niepasujący wybór.

Szkic projektowania jest opcjonalną metadaną: opis do 2000 znaków i wybory sześciu
kategorii. Nie zastępuje referencji ani instrukcji brzmienia. Nie jest wysyłany
jednocześnie z referencją klonu lub wybranym presetem. Backend wykonuje właściwe
mapowanie. Nieobsługiwany silnik nie powinien pokazywać tej funkcji jako dostępnej.

Projekt i nagranie zachowują ustawienia, format, preset i szkic. Przywrócenie
historycznego wyniku nie przełącza aktywnego silnika po cichu. Starsze dane bez
opcjonalnych metadanych pozostają czytelne.

## Pliki i sprawdzanie

- `scripts/runtime/integration_settings.py` — odkrycie kontraktu źródeł.
- `src/lib/speech-settings.ts` — walidacja i serializacja.
- `src/lib/AdvancedSpeechSettings.svelte` — kontrolki.
- `src/lib/audio.ts` — odczyt i łączenie PCM/float.
- `src/App.svelte`, `src/lib/data.ts` — generacja, zapis i przywrócenie.

Regresje: `node scripts/speech-settings-check.mjs`,
`node scripts/wav-format-check.mjs` oraz
`node scripts/speech-app-contract-check.mjs`.
Testy proceduralnego WAV nie wymagają klonowania głosu i nie potwierdzają TTS.
Zobacz [parametry modelu](parametry-tts.md) i [warunki modeli](licencje-modeli.md).
