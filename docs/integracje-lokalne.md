# Lokalne API, MCP i pochodzenie audio

Panel integracji korzysta z prywatnego backendu na `127.0.0.1:4312`;
w Vite żądania przechodzą przez `/backend`. MCP jest domyślnie wyłączone.
Zapis ustawień nie uruchamia chmury, telefonii ani udostępnienia portu w sieci.

## API i MCP

Metadane `/v1/audio/capabilities`, `/.well-known/voicestudio-speech`
i `/v1/models` opisują protokół oraz modele/aliasy. Obecność wpisu nie dowodzi
pobranych wag lub udanej syntezy. Discovery może reklamować MCP również wtedy,
gdy listener jest wyłączony.

Włączenie MCP zapisuje `data/integration-settings.json` i wymaga restartu
prywatnego silnika. Test połączenia wykonuje initialize, initialized i tools/list,
a potem zamyka własną sesję. Nie wywołuje generacyjnych tools/call.
Przypisania klienta do głosu są oddzielne od profilu; usunięcie przypisania
nie usuwa głosu. Identyfikator klienta nie jest hasłem.

Lokalny transport ma ograniczenia hosta i Origin. Nie należy wystawiać portu
w Internecie ani traktować nagłówka własności procesu jako zabezpieczenia
zdalnego dostępu. Dla własnego serwera istnieje osobny [transport zdalny](zdalny-silnik.md).

## Watermark i źródła

Odczyt `/watermark/status` pokazuje konfigurację i dostępność biblioteki.
Nie uruchamia detektora. Detekcja wybranego pliku wymaga osobnego przycisku
i może załadować model AudioSeal. Odpowiedź z polem błędu nie jest ujemnym
wynikiem detekcji. Znak wodny nie dowodzi praw do głosu ani zgody osoby.

Diagnostyka pokazuje wersję źródeł, zainstalowaną dystrybucję, SHA archiwum
i przypięte pochodzenie, jeśli pasuje do aktywnego pakietu. Brak danych
jest pokazywany wprost. Warunki kodu oraz modeli pozostają odrębne.

## Pliki

- `src/lib/IntegrationSettings.svelte`, `src/lib/integrations.ts` — UI i transport.
- `scripts/runtime/integration_settings.py` — konfiguracja i diagnostyka.
- `scripts/runtime/windows_runtime_paths.py` — lokalne ścieżki bibliotek Windows.

Regresje: `node scripts/integrations-check.mjs`
i `scripts/runtime/test_integration_settings.py` w odpowiednim środowisku.
Handshake i katalog nie potwierdzają tools/call, watermark ani inferencji.
Zobacz [runtime](runtime.md), [weryfikację](weryfikacja.md)
i [notices](../THIRD_PARTY_NOTICES.md).
