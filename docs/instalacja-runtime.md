# Instalacja środowiska Python

Interfejs można uruchomić bez modeli. Do lokalnej syntezy potrzebne są osobno:
środowisko Python z bibliotekami, wagi modelu i przegląd jego warunków.
EXE zawiera kod backendu; nie zawiera wielogigabajtowych zależności GPU i wag.

## Przepływ w Windows

1. Otwórz **Ustawienia → Modele i silnik → Samodzielne środowisko Python**.
2. Wybierz CPU albo NVIDIA CUDA 12.8. Wariant CUDA wymaga zgodnego GPU
   i sterownika. Panel podaje szacowane wymagane miejsce.
3. Rozpocznij instalację. Powstaje nowy katalog `runtime_<id>` obok dotychczasowego
   środowiska, z przypiętymi dystrybucjami CPython/uv i kontrolą SHA-256.
4. Poczekaj na zakończenie kontroli doctor. Sprawdza ona importy, izolację
   i własny test startu backendu, bez pobierania modeli i generowania audio.
5. Zatrzymaj silnik i wybierz **Użyj tego środowiska**. Aktywacja jest osobnym
   krokiem i nie usuwa wcześniejszego środowiska.
6. Pobierz wybrane wagi w katalogu modeli, przejrzyj ich warunki i wykonaj
   własną krótką próbę syntezy.

Anulowanie czeka na zakończenie własnego drzewa procesów. Ponowienie tworzy
nowego kandydata. Instalacja nie powinna zmieniać globalnego Python/PATH,
innych aplikacji ani prywatnych danych. `VOICESTUDIO_NEXT_PYTHON` jest jawnym
nadpisaniem interpretera; wyłącz je przed użyciem wyboru z panelu.

## Pliki i granice

- `scripts/runtime/bootstrap-provenance.json` — źródła dystrybucji i hashe.
- `scripts/runtime/bootstrap.py` — przygotowanie zależności oraz doctor.
- `src-tauri/src/installer.rs` — pobieranie, procesy i aktywacja.
- `src/lib/RuntimeInstaller.svelte` — panel i rzeczywisty postęp.

Sam doctor nie potwierdza inferencji. Czysta maszyna CPU, CUDA oraz gotowa paczka
instalacyjna wymagają odrębnego odbioru opisanego w [weryfikacji](weryfikacja.md).
Zależności budowane ze źródeł mogą potrzebować narzędzi C++; przypięcie zależności
runtime nie oznacza pełnej reprodukowalności narzędzi budowania.
Zobacz [runtime](runtime.md) i [licencje składników](../THIRD_PARTY_NOTICES.md).
