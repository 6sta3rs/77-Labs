# Instrukcje dla agentów

## Kontekst na początku pracy

1. Przeczytaj `docs/kontekst-projektu.md`, `docs/postep.md` i `README.md`.
2. Sprawdź `git status --short --branch` i `git log -5 --oneline`.
3. Dla silnika przeczytaj `docs/runtime.md`, a dla oceny gotowości `docs/weryfikacja.md`.
4. Stan kodu i aktualne wyniki mają pierwszeństwo przed starszym opisem. Nie przedstawiaj historycznego testu jako wykonanego w bieżącej sesji.

## Obowiązkowe commity

- Każdą ukończoną, logiczną zmianę zapisuj w osobnym lokalnym commicie bez dodatkowego pytania o zgodę. Dotyczy to również dokumentacji i konfiguracji. Commituj po sprawdzeniu zmiany, nie po każdym zapisie pliku.
- W tym samym commicie aktualizuj `docs/postep.md`: co zmieniono, dlaczego, jakie kontrole wykonano i z jakim wynikiem, ograniczenia oraz co pozostało. Przy zmianie architektury lub sposobu uruchamiania aktualizuj też `docs/kontekst-projektu.md` i odpowiednią dokumentację.
- Przed commitem obejrzyj diff i dodaj jawnie pliki należące do zadania. Nie nadpisuj, nie cofaj i nie dołączaj cudzych niezwiązanych zmian. Zastany brudny katalog opisz w postępie, jeśli wpływa na zadanie.
- Używaj krótkich, konkretnych komunikatów, np. `fix: popraw przewijanie nagrania`, `feat: dodaj filtr głosów`, `docs: uzupełnij kontekst silnika`.
- Nie commituj sekretów, `.env`, modeli, prywatnych baz, nagrań użytkownika, zależności ani katalogów wynikowych. Publiczne audio to proceduralny `public/demo/interface-tone.wav`; archiwum silnika ma przypięte źródło i opis pochodzenia. Raporty zapisuj do ignorowanego `.tmp/qa`.
- Nie wykonuj push, zmiany historii, amend ani usuwania gałęzi bez polecenia użytkownika. Brak zdalnego repozytorium nie blokuje lokalnych commitów.
- Po commicie sprawdź `git status --short` i podaj użytkownikowi skrót commita oraz wynik kontroli. Jeśli commit lub kontrola się nie uda, opisz przyczynę; nie deklaruj zakończenia ani zaliczenia testów.

## Weryfikacja i zasady projektu

- Dobieraj kontrole do zakresu zmiany. Dla kodu Svelte/TypeScript: `npm run check` i `npm run build`; dla tagów dodatkowo `node scripts/tag-check.mjs`.
- Dla Rust/Tauri: `cargo check --manifest-path src-tauri/Cargo.toml`. Dla zachowania produktu sprawdzaj odpowiedni przepływ UI/runtime; sam build lub health nie dowodzi działania syntezy.
- Dla zmian wyłącznie dokumentacyjnych sprawdź treść, odnośniki i `git diff --check` dla zmienionych plików; nie uruchamiaj kosztownych generacji bez potrzeby.
- Przed commitem i publikacją uruchom `python scripts/publication_check.py`. Prywatne wzorce `--deny-file` trzymaj poza repozytorium. Nie kopiuj prywatnej historii Git ani checkpointów do publicznego repozytorium.
- Interfejs i dokumentację użytkową pisz po polsku. Zachowuj czytelne komunikaty błędów i rzeczywisty postęp.
- Nie zmieniaj starej instalacji VoiceStudio, jej bazy ani współdzielonych przez hardlink bibliotek i modeli. Używaj wydzielonego runtime opisanego w `docs/runtime.md`.
- Nie deklaruj pełnej gotowości dubbingu, audiobooków, instalatora ani migracji bez testów tych funkcji.
