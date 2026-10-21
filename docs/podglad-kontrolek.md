# Katalog komponentów interfejsu

Uruchom `npm run dev` i otwórz `http://127.0.0.1:4310/inputy.html`.
Wejście `src/gallery.ts` pokazuje rzeczywiste komponenty Svelte studia:
pola, listy, suwaki, przełączniki, przyciski, tooltipy, karty motywów,
edytor, filtry, wybór modeli i przykłady audio.

## Dane i zachowanie

Przykłady używają własnego stanu w pamięci. Zmiana palety, reset i wpisywanie
nie powinny zmieniać prywatnych projektów, głosów lub preferencji aplikacji.
Wartości demonstracyjne, np. stabilność lub podobieństwo, są przykładami
kontrolek i nie tworzą nowych parametrów syntezy.

Suwaki obsługują klawiaturę i wyświetlanie wartości. Select ma klawiaturowy
wybór oraz powrót fokusu. Rozwijane panele i popupy respektują reduced motion;
zamknięte treści nie przyjmują fokusu. Przykłady audio używają jawnego
syntetycznego sygnału demonstracyjnego, bez głosu użytkownika i modelu.

## Gdzie zmienić

- `src/lib/ControlGallery.svelte` — układ i lokalny stan przykładów.
- `src/lib/ui/`, `src/lib/ui.css` — wspólne kontrolki.
- `src/lib/AudioExamples.svelte` — przykłady odtwarzania i materiałów kuli.
- `src/gallery.ts`, `inputy.html` — wejście developerskie.
- `scripts/controls-preview.mjs` — opcjonalny generator samodzielnego podglądu.

Wygenerowany HTML jest artefaktem, nie drugim źródłem komponentów. Przed jego
udostępnieniem sprawdź czyste dane i aktualność względem kodu.
Katalog służy odbiorowi wyglądu i interakcji. Nie wykonuje odbioru syntezy,
transkrypcji, instalacji modeli ani gotowości całej aplikacji.
Zobacz [kontrolki](t3-controls.md), [motywy](motywy-t3-code.md)
i [zasady współpracy](../CONTRIBUTING.md).
