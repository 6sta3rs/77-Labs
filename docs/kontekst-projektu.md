# Kontekst projektu

**Seventy Seven Labs 0.2.0** to lokalne studio głosu na Windows. Publiczne źródła mają nową historię bez danych poprzedniego użytkownika. Nazwę produktu zapisuj dokładnie jako Seventy Seven Labs.

## Architektura

- Svelte 5 / TypeScript / Vite: interfejs, edytor, biblioteka i transport.
- Tauri 2 / Rust: okno, natywne pliki, nadzór procesów i instalacja.
- Python / FastAPI: przypięty VoiceStudio 0.5.7 z adapterami w `scripts/runtime/`.
- `engine.zip` i `engine-provenance.json`: niezmienne źródła upstream, licencje i pochodzenie.
- Dane: domyślnie `%LOCALAPPDATA%/VoiceStudioNext`, poza repozytorium.

Identyfikator Tauri `local.studioa1tts.voicestudio-next`, klucze `voicestudio.*` i katalogi runtime zachowano dla zgodności. Kosmetyczna zmiana nazwy produktu nie powinna zmieniać tych identyfikatorów.

## Uruchamianie i rozwój

`npm ci`, potem `npm run dev`: http://127.0.0.1:4310. `/?demo=tts` pokazuje fikcyjne dane i proceduralny ton. `inputy.html` otwiera katalog komponentów.

`npm run desktop:dev` uruchamia Tauri; `npm run desktop:build` tworzy EXE bez instalatora. Backend 4312 startuje na żądanie, kończy się po potwierdzonej bezczynności i wymaga własnego środowiska oraz wag. [Runtime](runtime.md), [instalacja](instalacja-runtime.md).

Mapa „gdzie zmienić X?” jest w [README](../README.md). Zakres i kryteria: [PRD](PRD.md), bieżące wyniki: [weryfikacja](weryfikacja.md), przekazanie pracy: [postęp](postep.md).

Build i health nie potwierdzają syntezy ani całego dubbingu/audiobooka. Dawnych wyników prywatnego wdrożenia nie przenoszono do nowej historii.

## Prywatność i licencje

Nie dodawaj nagrań, baz, kont, tokenów ani prywatnych ścieżek. Wyniki QA zapisuj pod `.tmp/qa`. Autorskie audio demo to wyłącznie proceduralny ton; upstream zachowuje swoje opisane zasoby w przypiętym archiwum.

Nie edytuj modeli/bibliotek współdzielonych hardlinkami. Publiczna wersja używa neutralnych ikon i autorskich wizualizacji. Legacy wariant kuli `elevenlabs` jest kompatybilnym identyfikatorem; nie oznacza dołączenia kodu ani tekstur tej firmy.

Każdą logiczną zmianę commituj wraz z aktualizacją postępu zgodnie z [AGENTS.md](../AGENTS.md). Przed publikacją wykonaj [kontrolę](publikacja.md).
