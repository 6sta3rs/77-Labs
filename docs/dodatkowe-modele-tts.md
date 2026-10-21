# Dodatkowe modele TTS

Adaptery rozszerzają katalog bez zmiany oryginalnego archiwum backendu.
Każda rodzina może mieć własne środowisko Python, poza bazowym venv.
Wagi, biblioteki, warunki i wybór aktywnego silnika są odrębnymi krokami.

| Rodzina | Typ wejścia głosu | Wykonanie |
| --- | --- | --- |
| Chatterbox Multilingual | Nagranie referencyjne | Własny Python CPU/CUDA. |
| Kokoro | Wbudowany głos odpowiedni do języka | CPU. |
| KittenTTS 0.8 | Wbudowany głos | Adapter lub osobne środowisko. |
| KittenTTS 2 | Nagranie i jego tekst | Własny Python CPU/CUDA. |
| Qwen3-TTS Base 0.6B / 1.7B | Nagranie i jego tekst | CPU/CUDA. |
| Qwen3-TTS VoiceDesign | Opis głosu | CPU/CUDA. |
| Fish S2 Pro | Nagranie i jego tekst | Osobna usługa Linux/WSL i lokalny adapter HTTP. |

Obsługiwane języki i dokładne rewizje wynikają z `scripts/runtime/tts_catalog.py`
i aktywnego katalogu. Wybranie nieobsługiwanego języka ma dać czytelny błąd;
nie wolno wyprowadzać obsługi polskiego z samej nazwy rodziny.

## Przygotowanie

W **Modele i silnik → Dodatkowe modele TTS** wybierz właściwy wariant CPU/CUDA
oraz **Przygotuj biblioteki**. Instalator tworzy własny katalog rodziny,
instaluje pakiety i sprawdza importy. Później pobierz komplet wymaganych wag
w katalogu modeli i przejrzyj osobne warunki modelu oraz zależności.
Nieudany import nie powinien być prezentowany jako gotowość.

Rodziny mają środowiska w `runtime/tts-envs`, manifest `environment.json`
i zapis faktycznie rozwiązanych zależności. Wybrany CPU/CUDA pochodzi
z manifestu, nie z przypadkowo dostępnego urządzenia. Biblioteki innych
instalacji i współdzielone niezmienne pliki nie są aktualizowane w miejscu.

## Fish S2 Pro

Operator przygotowuje zgodny serwer Fish w Linux/WSL i konkretny checkpoint.
W panelu podaje adres loopback oraz deklaruje zgodny model i rewizję.
Sprawny `/health` potwierdza transport, a nie tożsamość modelu.
Adapter przesyła referencję do tej lokalnej usługi; nie włączaj jej na publicznym
interfejsie. Dane logowania w URL i przekierowania są odrzucane.

## Gdzie zmienić zachowanie

- `scripts/runtime/tts_catalog.py` — rewizje, pliki, języki i warianty.
- `scripts/runtime/tts_extensions.py` — rejestr, statusy i API `/next/tts/*`.
- `scripts/runtime/tts_worker.py` — parametry i wykonanie syntezy.
- `scripts/runtime/prepare_tts.py` — przygotowanie bibliotek.
- `src/lib/ExtraTtsEnvironments.svelte` — panel.

Regresje: `scripts/runtime/test_tts_extensions.py`
i `scripts/runtime/test_tts_registry.py`. Nie wykonują zbiorczego odbioru
brzmienia wszystkich modeli. Próbę generacji planuj osobno na czystych danych,
z modelem i sprzętem zapisanymi w raporcie. Zobacz [warunki modeli](licencje-modeli.md)
i [katalog wag](modele-produkcja.md).
