# Pierwsze wejście i przygotowanie modeli

Okno **Przygotuj modele do pracy** nie ładuje modeli przy samym wyświetleniu.
Gdy silnik jest zatrzymany, powitanie nie uruchamia Pythona. Przycisk
**Sprawdź modele i warunki** jawnie łączy się z silnikiem i w desktopie
uruchamia zainstalowane środowisko. Środowisko i wagi instaluje się osobno
w **Ustawienia → Modele i silnik**.

## Decyzje użytkownika

Plan pokazuje każde wymagane repozytorium oddzielnie. Dla głównego OmniVoice
może obejmować zarówno model, jak i tokenizer. Każdy składnik ma własne
informacje, źródła oraz początkowo puste potwierdzenie. Nie ma zbiorczej zgody.
Zapis dotyczy dokładnego odcisku przejrzanych informacji.

**Później**, zamknięcie i Escape odkładają przegląd. Można wrócić przez
**Przejrzyj warunki modeli** w ustawieniach. Nieukończony przegląd może wrócić
przy następnym wejściu. Zamknięcie i zmiana modelu są blokowane podczas zapisu
oraz potwierdzania jego wyniku. Po błędzie odczytu dostępne jest ponowienie.

## Stan i kontrakt

`GET /next/models/onboarding` odczytuje plan wybranego TTS i przypiętego rejestru.
Nie importuje ML, nie pobiera wag i nie zapisuje decyzji. Nieobsługiwany model
lub starszy backend daje czytelny błąd, zamiast pustego planu oznaczającego sukces.
Sam plan nie potwierdza pełnej listy praw do wszystkich składników.

Klucz `voicestudio.license-onboarding.v1` w localStorage jest tylko wskazówką
ukończenia. Autorytatywny stan pochodzi z backendu. Cofnięcie decyzji lub zmiana
odcisku usuwa wskazówkę i ponownie wymaga przeglądu. HTTP 409 nie ponawia zgody
automatycznie. Zapis jest uznany za udany po ponownym odczycie stanu.

## Pliki i kontrola

- `src/lib/ModelLicenseOnboarding.svelte`, `src/lib/license-onboarding.ts` — UI i stan.
- `src/lib/ModelLicenseReview.svelte` — osobne decyzje.
- `scripts/runtime/model_management.py` — plan.

Regresje: `node scripts/license-onboarding-check.mjs`,
`node scripts/model-licenses-check.mjs` i
`node scripts/model-onboarding-monitor-check.mjs`.
Odbiór UI prowadź na własnym fixture, bez rzeczywistych decyzji i modeli.
Zobacz [warunki modeli](licencje-modeli.md), [instalację](instalacja-runtime.md)
i [weryfikację](weryfikacja.md).
