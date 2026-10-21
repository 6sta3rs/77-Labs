# Receptury i lokalna kolejka

**Automatyzacja** zapisuje receptury z 1–8 kolejnych kroków: rozpoznanie mowy,
synteza, konwersja głosu, lokalne tłumaczenie lub obróbka audio.
Wejściem jest tekst albo do 10 plików audio, każdy do 64 MB. Kolejka wykonuje
jedno zadanie na raz. To sekwencja kroków, bez grafu warunków i własnego kodu.

## Wykonanie

Typy wejścia i wyjścia są sprawdzane przed startem. Kroki modelowe potrzebują
zainstalowanych wag, właściwych głosów i gotowego runtime. Receptura nie instaluje
modeli. Tłumaczenie wykorzystuje wskazane lokalne Argos lub NLLB.
Krok obróbki audio może działać bez backendu: przycina, normalizuje lub zmienia
głośność i zapisuje osobny PCM WAV. Domyślny szczyt normalizacji to −3 dBFS.

Panel pokazuje bieżący krok i potwierdzone zakończenia. **Zatrzymaj po kroku**
czeka na wynik trwającego żądania, a następnie pomija kolejne kroki.
Przerwanie transportu nie potwierdza zatrzymania GPU; niepewna operacja nie
powinna automatycznie uruchamiać dalszej kolejki.

## Zapis i ponowienie

Receptury, snapshot wejścia, wyniki i stan są w IndexedDB
`voicestudio-next-automation`. Wejście musi zostać zapisane przed startem.
Audio jest Blobem, a adres `blob:` służy tylko bieżącemu odsłuchowi.
Zmiana widoku nie kończy kolejki. Po restarcie nieukończone zadania są
**Przerwane**; użytkownik decyduje o uruchomieniu od początku.
Pojedyncze usunięcie wymaga potwierdzenia i nie kasuje profilu głosu.

## Obserwowany folder w Windows

Wybierz własny folder i zapisaną recepturę, a następnie jawnie włącz obserwację.
Po każdym starcie lub przeładowaniu WebView źródło pozostaje wyłączone.
Obserwowane są pliki bezpośrednio w katalogu, bez podfolderów.

Skaner czeka na stabilny rozmiar i czas modyfikacji oraz zwolniony uchwyt.
Dowiązania, UNC, urządzenia, pliki puste i większe niż limit są odrzucane.
Stabilność pliku nie gwarantuje poprawności skompresowanego strumienia.
Producent powinien zapisać plik tymczasowy, zamknąć go i dopiero nadać
rozszerzenie docelowego audio.

Trwałe potwierdzenia ograniczają powtórzenia po restarcie. Zmieniony plik
stanowi nową wersję wejścia. Źródłowe pliki nie są kasowane ani przenoszone.
Wyłączenie obserwacji blokuje nowe wejścia; już zapisane zadania mają własny stan.

## Pliki i kontrola

- `src/lib/AutomationWorkspace.svelte`, `src/lib/automation.ts` — panel i kolejka.
- `src/lib/WatchFolderPanel.svelte`, `src/lib/watch-folder.ts` — źródło plikowe.
- `src-tauri/src/watch_folder.rs` — skaner, własność ścieżek i potwierdzenia.

Regresje: `node scripts/automation-check.mjs`,
`node scripts/watch-folder-check.mjs` i `node scripts/automation-audio-check.mjs`.
Rzeczywisty picker, uchwyty Windows i receptury ML wymagają osobnego odbioru.
Zobacz [weryfikację](weryfikacja.md) i [zasady danych](../SECURITY.md).
