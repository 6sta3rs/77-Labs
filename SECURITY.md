# Bezpieczeństwo i prywatność

Seventy Seven Labs jest rozwijanym lokalnym studiem głosu. Nie deklarujemy
audytu bezpieczeństwa, gwarantowanego czasu odpowiedzi ani wsparcia wszystkich
starszych wersji. Zgłoszenie powinno dotyczyć możliwie aktualnego publicznego
commita i wskazywać wersję Windows oraz używanego silnika.

## Zgłaszanie podatności

Jeżeli publiczne repozytorium udostępnia **Security → Report a vulnerability**,
użyj prywatnego zgłoszenia. Jeżeli ta opcja jest wyłączona, załóż zgłoszenie
z prośbą o prywatny kanał kontaktu, bez opisu umożliwiającego wykorzystanie
podatności i bez wrażliwych załączników. Projekt nie publikuje obecnie
dedykowanego adresu e-mail do zgłoszeń.

Po uzyskaniu prywatnego kanału przekaż:

- commit i wersję aplikacji, silnika oraz środowiska;
- minimalny scenariusz odtworzenia na fikcyjnych danych;
- oczekiwane zachowanie, rzeczywisty skutek i oceniany zakres dostępu;
- zanonimizowany log albo minimalny plik potrzebny do odtworzenia.

Nie przesyłaj tokenów, plików logowania, prywatnych nagrań, całej bazy ani
pełnego profilu użytkownika. Zwykłe błędy interfejsu można zgłaszać publicznie
po usunięciu danych z treści i zrzutów.

## Gdzie są dane

Domyślne runtime, baza, profile, referencje, wyniki i część ustawień znajdują się
poza repozytorium w `%LOCALAPPDATA%\VoiceStudioNext`. Lokalizacje danych i modeli
można zmienić. Interfejs używa też localStorage i IndexedDB konkretnego profilu
przeglądarki lub WebView. Kopie bezpieczeństwa i eksporty mogą zawierać pełne
nagrania oraz tekst projektów. Nie są publicznymi materiałami testowymi.

Nie należy zakładać szyfrowania bazy, nagrań ani wszystkich zapisanych
poświadczeń. Chroń konto Windows, uprawnienia do katalogów, nośniki i kopie.
Usunięcie wpisu z interfejsu nie jest obietnicą bezpiecznego wymazania pliku,
cache, kopii ani danych z wcześniejszego eksportu.

## Granice sieci i procesów

Lokalny nadzorowany silnik używa `127.0.0.1:4312`. Marker własności procesu
pomaga odróżnić właściwy backend; nie zastępuje zabezpieczeń konta systemowego.
Portu nie należy wystawiać do Internetu. Zdalny transport, MCP i integracje
wymagają osobnej konfiguracji oraz przeglądu uprawnień.

Synteza na wcześniej pobranych modelach może działać lokalnie. Instalacja
zależności i wag wymaga pobierania. Wybrany LLM, tłumacz, zdalny backend albo
usługa TTS może otrzymywać tekst, referencje lub media. Przed uruchomieniem
sprawdź dostawcę i ustawienia; lokalny charakter aplikacji nie oznacza, że
każda opcjonalna integracja pozostaje offline.

Pliki audio/wideo, dokumenty, pakiety głosów i modele są wejściami zewnętrznymi.
Importuj je ze znanych źródeł. Zależności i modele mogą wymagać wykonywania
kodu; samo przypięcie SHA-256 potwierdza tożsamość pliku, nie jego bezpieczeństwo.

## Zgoda na głos i nagranie

Klonuj własny głos albo głos osoby, która udzieliła odpowiedniej zgody,
z nagrania, do którego masz prawa. Nie publikuj cudzej referencji w repozytorium,
zgłoszeniu lub paczce demo. Potwierdzenie w aplikacji nie weryfikuje tożsamości,
nie udziela praw do materiału i nie zastępuje warunków modelu.

Nie używaj wygenerowanej mowy do podszywania się w celu oszustwa. Watermark
i metadane pochodzenia, gdy są dostępne, nie stanowią gwarancji wykrycia
syntetycznej mowy ani dowodu zgody.

## Ujawnienie danych w repozytorium

W razie ujawnienia sekretu unieważnij go u dostawcy. Usunięcie go z bieżącego
pliku nie unieważnia wcześniejszych kopii. Ogranicz dalszą publikację,
powiadom opiekuna prywatnym kanałem i wskaż commit oraz rodzaj ujawnionych danych
bez ponownego ich wklejania. Czyszczenie historii i opublikowanych artefaktów
wymaga oddzielnej kontroli; nie zapewnia usunięcia kopii pobranych przez innych.
