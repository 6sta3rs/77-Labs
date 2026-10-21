# Połączenie z własnym serwerem

**Ustawienia → Udostępnianie** może połączyć studio z API VoiceStudio na własnym
serwerze. Tekst, referencje i media używane przez zdalną operację trafiają
na ten serwer. Dostępność GPU, modeli i warunków pozostaje jego cechą.
Test transportu nie wykonuje syntezy.

## Połączenie i powrót

Test odczytuje `/health`, wymienia klucz na sesję przez `/api/auth/session`
i sprawdza chronione `/system/info`. Nie zmienia aktywnego trybu.
Dopiero **Połącz i używaj zdalnego silnika** przełącza operacje.
Błąd zdalnego żądania nie uruchamia go automatycznie na lokalnym komputerze.

**Użyj lokalnego silnika** przywraca lokalny transport i czyści zapisaną sesję;
próba jej odwołania na serwerze może się nie powieść, gdy serwer jest niedostępny.
Po restarcie procesu połączenie trzeba włączyć jawnie. Przeładowanie samego
okna synchronizuje stan z działającym mostkiem.

Klucz administratora służy wymianie na sesję i nie trafia do pamięci przeglądarki.
Wygasająca sesja korzysta z magazynu sekretów backendu. Zmiana serwera,
wygaśnięcie lub odwołanie dostępu mogą wymagać ponownego logowania.
Korzystaj z HTTPS dla połączenia opuszczającego zaufany loopback.

## Granice transportu

Proxy obsługuje upload, pobranie, SSE i osobny bilet WebSocket. Nie przekazuje
lokalnych Cookie, Origin lub Authorization jako dowolnych nagłówków.
Przekierowania są odrzucane, ścieżka reverse proxy jest zachowywana,
a prywatne `/next/*` nie służą jako zdalne API. Zmiana serwera jest blokowana,
gdy trwają fizyczne transfery. Po wygaśnięciu sesji żądania pozostają zablokowane,
bez cichego przełączenia do innego backendu.

Połączenie nie importuje profili i plików serwera do lokalnej bazy.
Nie jest mechanizmem migracji danych ani przywróceniem historycznych workerów GPU.

## Pliki i kontrola

- `src/lib/RemoteBackendSettings.svelte` — ustawienia i jawne akcje.
- `src/lib/remote-backend.ts`, `src/lib/remote-state.ts`, `src/lib/remote-routing.ts` — stan.
- `scripts/runtime/remote_backend.py` — sesja i proxy.
- `src/lib/api.ts`, `src/lib/dictation.ts` — wybór transportu operacji.

Regresje: `scripts/runtime/test_remote_backend.py`, uruchamiane w wydzielonym
środowisku. Kontrolowany serwer loopback nie odbiera publicznego wdrożenia,
uwierzytelnienia reverse proxy ani inferencji. Zobacz [ochronę danych](../SECURITY.md)
i [weryfikację](weryfikacja.md).
