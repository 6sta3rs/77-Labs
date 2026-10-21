# Kopie danych przed aktualizacją

`scripts/runtime/runtime_backup.py` tworzy punkt przywracania prywatnego DATA
przed importem backendu i migracjami nowej wersji. Launcher przekazuje SHA
zweryfikowanego archiwum. Błąd `BackupError` zatrzymuje start przed migracją.

## Co jest kopiowane

Kopia powstaje w `DATA/backups/backup-<UTC>-<SHA>-<id>/data`.
Baza jest czytana przez SQLite Backup API, z uwzględnieniem WAL, i sprawdzana
przez `quick_check`. Nie wystarczy kopiowanie samego otwartego pliku `.db`.
Kopiowane są powiązane pliki DATA: referencje, głosy, portrety, nagrania,
projekty i ustawienia. Manifest zapisuje rozmiary oraz SHA-256.

Modele, cache, środowiska i wcześniejsze backupy są pomijane. Kopia nie obejmuje
localStorage/IndexedDB profilu WebView ani dowolnych plików spoza DATA.
Nie jest kopią całego komputera. Może zawierać wrażliwe nagrania i konfigurację;
chroń ją tak samo jak dane źródłowe.

## Spójność i postęp

Przed startem sprawdzane jest wolne miejsce. Kopiowane pliki muszą pozostać
stabilne; dowiązania i niezgodne ścieżki są odrzucane. Kompletny manifest
oraz znacznik powstają dopiero na końcu. Uszkodzony znacznik lub brak pliku
w kopii blokują dalszy start. Przerwana kopia pozostaje do inspekcji.

Zdarzenia `NEXT_BACKUP_EVENT` opisują plan, strony bazy i skopiowane bajty.
Nie zastępuje się tego sztucznym procentem z liczby etapów. Ponowny start tej
samej paczki może użyć istniejącej zweryfikowanej kopii zamiast tworzyć następną.

## Odtworzenie

Nie ma automatycznego przywracania ani kasowania kopii. Przed ręcznym
odtworzeniem zatrzymaj wszystkie procesy korzystające z DATA, sprawdź wszystkie
hashe i zgodność wersji backendu. Zachowaj bieżące dane przed zastąpieniem.

Kontrola modułu na danych tymczasowych:
`python -S scripts/runtime/test_runtime_backup.py`.
Wynik takiej kontroli nie potwierdza odtworzenia prywatnej instalacji.
Zobacz [aktualizację silnika](aktualizacja-silnika.md), [runtime](runtime.md)
i [ochronę danych](../SECURITY.md).
