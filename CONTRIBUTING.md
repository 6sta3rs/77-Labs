# Współtworzenie Seventy Seven Labs

Zacznij od [README](README.md), [wymagań produktu](docs/PRD.md),
[kontekstu](docs/kontekst-projektu.md) i [AGENTS.md](AGENTS.md).
Interfejs oraz dokumentację użytkową pisz po polsku. Nazwa produktu to
**Seventy Seven Labs**; starsze identyfikatory techniczne zachowujemy tam,
gdzie służą zgodności danych.

## Uruchomienie

Do interfejsu potrzebne są Node.js zgodny z przypiętą wersją Vite oraz npm.
Do desktopu Windows potrzebne są Rust, narzędzia kompilacji C++ dla Tauri
i WebView2. Kompilacja EXE nie instaluje automatycznie modeli.

```powershell
npm ci
npm run dev
```

Podgląd: `http://127.0.0.1:4310`. Dane przykładowe TTS:
`http://127.0.0.1:4310/?demo=tts`; katalog komponentów: `/inputy.html`.
Demo służy pracy nad interfejsem. Nie dowodzi działania lokalnej syntezy.

```powershell
npm run desktop:dev
# Lokalny build bez paczki instalacyjnej:
npm run desktop:build
```

Synteza wymaga własnego środowiska Python i wag. Konfigurację uruchamia się
jawnie w **Ustawienia → Modele i silnik**. Zobacz
[instalację runtime](docs/instalacja-runtime.md) i [kontrakt silnika](docs/runtime.md).
Nie kopiuj prywatnej bazy, profili ani potwierdzeń warunków z innej instalacji.

## Zakres zmiany i sprawdzanie

Najpierw sprawdź stan Git i ostatnie commity. Zachowuj niezwiązane zmiany.
Opis zmiany powinien wyjaśniać problem, wynikowe zachowanie, wykonane kontrole
oraz ograniczenia. Przy błędzie podaj krótki, powtarzalny scenariusz na czystych
danych. Przy zmianie przepływu pokaż widok lub kroki do ręcznego odbioru.

| Zmieniany obszar | Wymagane kontrole |
| --- | --- |
| Svelte / TypeScript | `npm run check` i `npm run build`; odpowiedni przepływ UI. |
| Tagi narracji | Dodatkowo `node scripts/tag-check.mjs`. |
| Wspólne kontrolki / zachowanie UI | Dodatkowo właściwe regresje z `npm run test:ui`; klawiatura, focus i istotne rozmiary okna. |
| Rust / Tauri | `cargo check --manifest-path src-tauri/Cargo.toml`; dla zachowania natywnego rzeczywisty EXE. |
| Python / runtime | Składnia i testy zmienionego modułu w wydzielonym środowisku; kontrakt lub przepływ runtime odpowiedni do zmiany. |
| Dokumentacja | Treść, odnośniki i `git diff --check`; bez kosztownych generacji. |

```powershell
npm run check
npm run build
node scripts/tag-check.mjs
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check
```

Dobieraj zakres do zmiany. Udany build, katalog modeli i `/health` nie zastępują
syntezy. Test transportu z fixture opisuj jako fixture. Nie przedstawiaj
historycznego wyniku jako kontroli wykonanej w bieżącej pracy. Test generacyjny
powinien wskazać model, rewizję, sprzęt, własne wejście i granice odbioru.

## Czyste dane i zrzuty ekranu

- Korzystaj z fikcyjnych nazw, krótkich neutralnych tekstów i proceduralnych
  sygnałów audio. Do mowy używaj własnego nagrania z prawem do publikacji.
- Prowadź QA w osobnym profilu przeglądarki/WebView i osobnym katalogu danych.
  Nie testuj migracji, retencji ani usuwania na prywatnej bibliotece.
- Nie dodawaj do Git nagrań użytkownika, modeli, baz SQLite, tokenów,
  `.env`, logów zawierających dane, środowisk, buildów ani profili WebView.
- Przed zrzutem sprawdź tekst projektu, listę głosów, tytuł okna, ścieżki,
  nazwy kont i diagnostykę. Zrzut demo powinien być opisany jako demo.
- Samo dodanie pliku do `.gitignore` nie usuwa go z wcześniejszych commitów.
  Podejrzenie ujawnienia zgłoś zgodnie z [SECURITY.md](SECURITY.md).

## Licencje i pochodzenie

Wkład do kodu projektu musi być zgodny z **AGPL-3.0-only** i
[wyjątkami osób trzecich](THIRD_PARTY_NOTICES.md). Zachowuj istniejące notices
i autorstwo upstream. Nie przenoś cudzych shaderów, zrzutów, logotypów lub
nagrań wyłącznie dlatego, że można je pobrać ze strony.

Nowa zależność albo zasób potrzebuje źródła, rewizji, licencji i opisu zmian.
Licencje kodu, wag i tokenizera mogą być różne. Warunki modelu potwierdza
użytkownik; testy nie mogą automatycznie zatwierdzać ich za niego.

Przed lokalnym commitem obejrzyj diff, dodaj jawnie pliki zadania i zaktualizuj
`docs/postep.md`. Zmiany architektury lub uruchamiania wymagają również
aktualizacji kontekstu i właściwej dokumentacji. Nie publikuj ani nie przepisuj
cudzej historii Git bez wyraźnego uzgodnienia.
