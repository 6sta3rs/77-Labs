# Warunki modeli

Licencja aplikacji, kodu modelu, wag, tokenizera i referencji głosu mogą być
różne. **Modele i silnik → Warunki modelu** pokazuje informacje dla konkretnego
repozytorium oraz jego jawnie zadeklarowanych zależności. Dane `unknown`
i `NOASSERTION` pozostają nieustalone; nie są potwierdzeniem prawa użycia.

## Przegląd i decyzja

Panel pokazuje deklarację licencji, źródła, ograniczenia, odcisk informacji
i lokalną historię decyzji. Nie zastępuje pełnych dokumentów dostawcy.
Otwarcie źródła, pobranie wag i odczyt katalogu nie zapisują potwierdzenia.

Użytkownik przegląda warunki, zaznacza początkowo puste pole i wybiera zapis
potwierdzenia **jednego modelu**. Akcja nie uruchamia syntezy. Zmiana odcisku
w czasie zapisu wymaga ponownego przeglądu; aplikacja czyści zaznaczenie zamiast
automatycznie zatwierdzać nową treść. Cofnięcie jest osobną akcją i nie usuwa
wag ani nagrań. Lokalny zapis nie udziela praw do głosu i nie zastępuje zgody
lub dostępu wymaganego przez dostawcę.

## Kontrakt API

- `GET /models/licenses/details/{repo_id:path}` — informacje, stan i historia.
- `GET /models/licenses/acceptance/{repo_id:path}` — sam stan.
- `POST /models/licenses/accept` — `{ repo_id, fingerprint, accepted: true }`.
- `POST /models/licenses/revoke` — `{ repo_id }`.
- HTTP 409 `terms_changed` — odczyt nowych informacji, bez automatycznego POST.
- HTTP 403 `model_licence_required` — przejście do wymaganych repozytoriów;
  ponowienie generacji pozostaje jawną decyzją.

Starszy serwer bez tego kontraktu daje komunikat braku obsługi. Nie ma
zastępczego endpointu, który zapisywałby zgodę po cichu. Pobranie modelu
nie oznacza przejścia blokady pierwszego użycia.

## Pliki i sprawdzanie

- `src/lib/ModelLicenseReview.svelte` — przegląd, zapis i cofnięcie.
- `src/lib/model-licenses.ts` — parser, transport i obsługa 403/409.
- `src/lib/EngineCatalog.svelte` — wejście z katalogu.
- `src/lib/api.ts` — błędy generowania.

Regresja: `node scripts/model-licenses-check.mjs`. Zapis i cofnięcie w teście
powinny trafiać wyłącznie do kontrolowanego stanu testowego. Nie wolno
akceptować rzeczywistych warunków za użytkownika. Zobacz
[pierwsze wejście](onboarding-modeli.md), [licencje składników](../THIRD_PARTY_NOTICES.md)
i [zasady głosu oraz danych](../SECURITY.md).
