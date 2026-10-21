# Seventy Seven Labs — wymagania produktu

Wersja dokumentu: 1.0, 21.10.2026. Dotyczy publicznego kodu aplikacji 0.2.0.
To opis produktu i kryteriów dalszego rozwoju. Sam dokument nie potwierdza
wykonania testów, dostępności instalatora ani działania każdego modelu.

## Cel i odbiorcy

Seventy Seven Labs to lokalne studio głosu na Windows z polskim interfejsem.
Łączy przygotowanie narracji, syntezę mowy, pracę z wieloma mówcami,
transkrypcję i dalszą produkcję audio w jednym miejscu. Użytkownik powinien
wiedzieć, gdzie są jego dane, co jest wykonywane lokalnie oraz kiedy operacja
wymaga pobrania modeli lub połączenia z wybranym dostawcą.

Główne potrzeby:

- Autor narracji przygotowuje tekst, wybiera głos, generuje i pobiera nagranie.
- Twórca materiałów wielogłosowych przypisuje głosy do bloków tekstu.
- Osoba potrzebująca czytelnego zapisu mowy importuje plik i eksportuje tekst
  lub napisy z czasami.
- Zaawansowany użytkownik przygotowuje dubbing, audiobook albo lokalną recepturę
  automatyzacji i śledzi rzeczywisty postęp zadania.
- Współtwórca uruchamia interfejs bez prywatnej biblioteki głosów i bez GPU.

## Zakres obecnego kodu

„Dostępny” oznacza obecny interfejs i implementację. Nie oznacza pełnego odbioru
na czystym komputerze, wszystkich modelach ani dowolnej długości materiału.
Publiczna wersja nie zawiera głosów, projektów, nagrań, decyzji licencyjnych,
tokenów ani środowiska runtime autora. Dane demonstracyjne są przykładowe.

| Obszar | Obecne zachowanie | Granica |
| --- | --- | --- |
| Edytor narracji | Bloki mówców, wybór głosu i silnika, tagi OmniVoice, cofanie i ponawianie. | Obsługa tagów zależy od silnika; tag nie gwarantuje określonej ekspresji. |
| Synteza i odtwarzanie | Parametry żądania, zadanie TTS, rzeczywisty wynik, fala, play/pause, przewijanie i pobranie. | Wymaga zainstalowanego runtime, zgodnego modelu i jego warunków. |
| Projekty i historia | Lokalny tekst, mówcy, ustawienia i nagrania jako Blob-y w IndexedDB; biblioteka backendu. | Dane przeglądarki i desktopu mogą należeć do odrębnych profili. Pełna migracja starej aplikacji nie jest obiecana. |
| Głosy | Profile, referencje, próbki, edycja, klonowanie i projektowanie zależne od modelu. | Materiał referencyjny wymaga praw i zgody właściciela głosu. Jakość podobieństwa nie jest gwarantowana. |
| Transkrypcja | Import pliku, wybór trybu i języka, edycja, historia, TXT/SRT/VTT i opcjonalna redakcja LLM. | ASR może się mylić. Tekst pełny i segmenty napisów mają osobne zasady edycji. |
| Dubbing | Przygotowanie źródła, transkrypcja, tłumaczenie, segmenty, głosy i eksport. | Pełny przepływ wideo, tło, wszystkie timingi i warianty eksportu wymagają dalszego odbioru. |
| Audiobooki i sceny | Import i podział tekstu, rozdziały, głosy, biblioteka, render, anulowanie/wznowienie i odsłuch porcji. | Długie zadania, wszystkie importy i modele wymagają oddzielnych testów. |
| Narzędzia audio | Lokalna obróbka, konwersja głosu, diagnostyka i narzędzia tekstowe. | Efekty wymagające modelu lub LLM mają osobne zależności; sama obecność panelu nie dowodzi ich gotowości. |
| Automatyzacja i dyktowanie | Receptury, kolejka, obserwowany folder, dyktowanie i widget Windows. | Funkcje systemowe wymagają jawnego włączenia. Fizyczny mikrofon i wklejanie do innych aplikacji wymagają osobnego odbioru. |
| Wygląd i dostępność | Motywy jasne/ciemne, palety, klawiatura, focus, skalowanie tekstu i ograniczenie animacji. | Animacja głosu jest wizualizacją, nie oceną jakości lub emocji. |
| Modele i środowisko | Katalog, przypięte źródła, instalator CPU/CUDA, doctor, cache, postęp transferu i przegląd warunków. | EXE nie zawiera wielogigabajtowych bibliotek i wag. Cały wariant CUDA oraz czysta VM wymagają odbioru. |
| Integracje | Opcjonalne usługi LLM, lokalne API, MCP i zdalny transport. | Połączenie z usługą może wysłać tekst lub media poza komputer i wykorzystać limit konta. |

## Główne przepływy

### Pierwsze wejście

1. Studio otwiera się bez ładowania bibliotek ML i bez pobierania wag.
2. Użytkownik może obejrzeć interfejs, odłożyć konfigurację albo otworzyć
   **Ustawienia → Modele i silnik**.
3. Instalacja tworzy osobny kandydat środowiska CPU/CUDA. Doctor i aktywacja
   są odrębnymi krokami; niekompletny kandydat nie zastępuje działającego.
4. Modele pobiera się osobno. Ich warunki są pokazywane per repozytorium
   i wersja informacji, z początkowo pustym potwierdzeniem.
5. Odczyt katalogu i warunków nie jest akceptacją, pobraniem ani testem syntezy.

### Tekst na mowę

1. Użytkownik wpisuje tekst i wybiera głos dla każdego mówcy.
2. Ustawienia pokazują parametry właściwe dla wybranego silnika.
3. Generowanie uruchamia potrzebny lokalny silnik i rzeczywiste zadanie.
4. Błąd przedstawia powód oraz możliwość poprawy lub ponowienia. Licencja,
   brak modelu i brak środowiska mają czytelne komunikaty.
5. Wynik można odtworzyć, przewinąć, pobrać i zachować wraz z projektem.
   Przerwanie nie powinno usuwać już gotowych nagrań.

### Mowa na tekst

1. Użytkownik wybiera własny plik, silnik i tryb rozpoznawania.
2. Widzi postęp, tekst i segmenty czasowe.
3. Ręcznie poprawia wynik. Sugestia LLM jest opcjonalna i odwracalna.
4. Eksportuje TXT albo napisy. Eksport zachowuje polskie znaki i prawidłowe
   czasy segmentów; zmiana tekstu pełnego nie zgaduje nowych czasów.

## Architektura i przechowywanie

- **Svelte 5, TypeScript i Vite** tworzą interfejs oraz podgląd przeglądarkowy.
- **Tauri 2 i Rust** odpowiadają za okno Windows, komendy natywne,
  izolację procesów, pliki, instalację i nadzór runtime.
- **Python/FastAPI** uruchamia przypięty backend VoiceStudio 0.5.7 oraz lokalne
  rozszerzenia. Źródło i SHA-256 podaje `scripts/runtime/engine-provenance.json`.
- Nadzorowany backend używa `127.0.0.1:4312`; podgląd Vite używa portu 4310
  oraz proxy `/backend`. Podgląd przeglądarkowy sam nie zastępuje nadzorcy Tauri.
- Domyślne pliki runtime i danych trafiają do `%LOCALAPPDATA%\VoiceStudioNext`,
  a część stanu interfejsu do localStorage/IndexedDB. Nazwy techniczne
  `VoiceStudioNext` i starsze identyfikatory pozostają dla zgodności.
- Dodatkowe rodziny modeli mogą mieć osobne środowiska. Modele, zależności,
  logi i prywatne bazy nie należą do repozytorium.

Szczegóły: [runtime](runtime.md), [instalacja środowiska](instalacja-runtime.md)
oraz [kontekst projektu](kontekst-projektu.md).

## Prywatność i licencje

Licencją kodu projektu jest **AGPL-3.0-only**. Wagi, tokenizery, zależności
i materiały osób trzecich zachowują własne warunki; licencja aplikacji nie
udziela automatycznie praw do komercyjnego użycia modelu, nagrania lub głosu.
Pełny tekst: [LICENSE](../LICENSE), źródła i wyjątki:
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

Lokalna synteza i eksport powinny działać na pobranych wcześniej modelach.
Pobranie wag, usługi LLM, tłumacze i zdalny backend mogą wymagać sieci.
Użytkownik musi widzieć wybraną usługę i świadomie uruchamiać taką operację.
Tokeny i logowania nie są przenoszone do paczki projektu.

Do klonowania wolno używać własnego głosu lub materiału z odpowiednią zgodą.
Zapis lokalnego potwierdzenia nie zastępuje praw do nagrania ani zgody osoby.
Zasady raportowania i ochrony danych: [SECURITY.md](../SECURITY.md).

## Wymagania jakościowe i kryteria odbioru

Poniższe kryteria są warunkami odbioru, a nie listą zaliczonych testów.
Każdy raport podaje commit publicznego kodu, wersję silnika, środowisko,
rodzaj danych testowych, wynik i pominięte kroki.

| Kryterium | Mierzalny warunek |
| --- | --- |
| Czyste źródła | Zero prywatnych nagrań, profili, baz, tokenów i ścieżek autora w śledzonych plikach oraz publicznej historii Git. |
| Powtarzalny frontend | `npm ci`, `npm run check` i `npm run build` kończą się sukcesem z publicznego checkoutu. |
| Bezpieczny start | Otwarcie okna nie uruchamia inferencji ani pobierania; brak runtime daje dostęp do konfiguracji i czytelny stan. |
| Własność procesu | Zajęty port nie powoduje przejęcia obcego serwera; Stop i wyjście zamykają wyłącznie własne procesy. |
| TTS | Własna krótka referencja i tekst dają dekodowalny WAV z niezerową długością; play/pause/seek i pobranie działają; hash pobrania zgadza się z zapisem. |
| Trwałość projektu | Po zamknięciu i ponownym otwarciu zachowane są tekst, mówcy, wybór głosu i zapisany Blob audio. |
| Transkrypcja | Jawna próbka testowa daje edytowalny tekst; TXT/SRT/VTT zachowują UTF-8 i rosnące czasy. Błędy rozpoznania są odnotowane. |
| Warunki modelu | Samo wejście nie zapisuje decyzji. Zmieniony odcisk warunków wymaga ponownego przeglądu, bez automatycznej akceptacji. |
| Dostępność | Kluczowe przepływy są obsługiwane klawiaturą; focus jest widoczny, dialog przywraca focus, a reduced motion zatrzymuje ciągły ruch. |
| Odbiór Windows | Build oraz rzeczywiste uruchomienie EXE są raportowane osobno. Czysta instalacja i wariant GPU wymagają własnych prób. |
| Długie zadania | Dubbing i audiobook mają osobny test renderu, anulowania, wznowienia i końcowego pliku na wskazanym modelu. |

## Plan dalszego rozwoju

1. **Publiczny punkt startowy:** pełna dokumentacja, czyste demo, jawne notices,
   kontrola danych i powtarzalne budowanie źródeł.
2. **Instalacja Windows:** odbiór od zera na czystej maszynie CPU oraz osobno
   na zgodnej konfiguracji CUDA; błędy, brak miejsca, anulowanie i ponowienie.
3. **Macierz modeli:** osobne dowody TTS/ASR dla konkretnych rewizji, języków,
   sprzętu i warunków; brak zbiorczej deklaracji obsługi wszystkich adapterów.
4. **Dłuższe produkcje:** pełny dubbing wideo, długie książki, retake,
   synchronizacja, przywracanie po awarii i kompletność eksportów.
5. **Dystrybucja:** decyzje dotyczące podpisu, instalatora, aktualizacji
   i kompletnych notices binarnych zależności przed publikacją gotowych paczek.

Poza obecnymi zobowiązaniami pozostają: hosting usługi wielodostępnej,
gwarancja pracy na macOS/Linux, pełna zgodność z każdą funkcją upstream,
automatyczne przenoszenie wszystkich starych danych oraz zapewnienie praw do
cudzych głosów i wszystkich modeli.
