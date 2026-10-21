# Bezpieczny podgląd interfejsu

Po `npm ci` i `npm run dev` otwórz http://127.0.0.1:4310/?demo=tts.

Głosy, dialogi, modele, projekty i historia to fikcyjne dane z `src/lib/tts-demo.ts`, przechowywane w pamięci. Nie jest kopiowana biblioteka silnika. Zrzuty README wykonano w tym trybie, w osobnym profilu przeglądarki.

Wszystkie karty używają `public/demo/interface-tone.wav`: 3,43 sekundy, mono PCM16, 24 kHz. Plik jest proceduralną sumą sinusoid 220 i 440 Hz z obwiednią. Nie zawiera głosu człowieka, nie wymaga modelu i nie demonstruje brzmienia fikcyjnych profili.

Ton pozwala sprawdzić metadane, play/pause, przewijanie, pobranie i wizualizację. Nie służy do jakości TTS, ASR ani klonowania; użyj własnej referencji poza Git.

Generator: `python scripts/generate_demo_tone.py`. Kontrola mediów: `python scripts/publication_check.py`.
