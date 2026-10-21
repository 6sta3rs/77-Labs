# Dyktowanie Windows i pływające okno

Globalny skrót oraz wklejanie do innych aplikacji są domyślnie wyłączone.
Samo otwarcie widgetu nie uruchamia mikrofonu, modelu ani Pythona.

## Przepływ użytkownika

1. W ustawieniach dyktowania wybierz kombinację i jawnie włącz skrót.
   Konflikt z inną aplikacją daje błąd i zachowuje dotychczasowe przypisanie.
2. Skrót pokazuje lub ukrywa pływające okno. Przytrzymanie klawiszy nie powinno
   wielokrotnie przełączać widoku.
3. **Wczytaj modele bez nagrywania** przygotowuje silnik. Dopiero
   **Rozpocznij dyktowanie** prosi o mikrofon i rozpoczyna sesję.
4. **Zatrzymaj i zakończ** czeka na końcowy wynik. Anulowanie lub ukrycie
   kończy nagrywanie. Tekst pozostaje edytowalny.
5. **Kopiuj tekst** zapisuje tekst do schowka. Wklejenie wymaga oddzielnego
   włączenia oraz kliknięcia przy wskazanym celu.

## Okno, rezerwacja i cel

Widget ma osobny lokalny WebView. Korzysta ze wspólnego `LiveDictation`
i AudioWorklet oraz własnej rezerwacji nadzorcy runtime. Ukrycie, zamknięcie
lub wyjście zwalniają wyłącznie rezerwacje widgetu. Brak potwierdzenia
zatrzymania ukrytego widoku prowadzi do zniszczenia tego WebView; tekst
przechowywany jedynie w pamięci może zostać utracony.

Wklejanie nie następuje automatycznie po rozpoznaniu. Cel pochodzi z wywołania
widgetu skrótem z innego procesu i jest ponownie sprawdzany przed wysłaniem
Ctrl+V. Windows może odmówić zmiany fokusu lub wejścia do aplikacji o wyższych
uprawnieniach. Kod nie obchodzi tych ograniczeń; tekst można wkleić ręcznie.
Samo wysłanie klawiszy nie dowodzi, że docelowy program przyjął tekst.

## Gdzie zmienić

- `src-tauri/src/dictation_desktop.rs` — skrót, widget, cel i rezerwacje.
- `src/lib/dictation-desktop.ts` — IPC i cykl sesji.
- `src/lib/DictationDesktopSettings.svelte` — jawne ustawienia.
- `src/lib/DictationWidget.svelte` — tekst, Start/Stop i kopiowanie.
- `src/lib/dictation.ts`, `src/lib/dictation-worklet.js` — transmisja PCM.

Kontrole: `node scripts/dictation-desktop-check.mjs`
oraz `cargo test --locked --manifest-path src-tauri/Cargo.toml dictation_desktop::tests`.
Testy kontraktu nie zastępują fizycznego mikrofonu i uruchomionego EXE.
Wklejanie sprawdzaj wyłącznie we własnym kontrolowanym oknie testowym.
Zobacz [weryfikację](weryfikacja.md) i [prywatność](../SECURITY.md).
