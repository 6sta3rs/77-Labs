# Changelog

User-visible changes per release, newest first. Each version has a heading `## <version> - <date>`; an optional line starting with `Update notes (Polish):` is the text the in-app updater shows (the interface is Polish), and when it is missing the whole section is used. Engineering detail, checks and limitations of every change are in [docs/progress.md](docs/progress.md).

## Unreleased

- Developer tooling and documentation only so far: Windows CI, release guards, a security and privacy description, English file names, `frontend/` and `desktop/` folders. Nothing here changes the installed application's behaviour except that product analytics are now guaranteed off (the consent switch is shown as unavailable).

## 0.2.2 - 2026-10-23

Update notes (Polish): Zakładka Uruchamianie i pamięć w ustawieniach silnika, rozpoznawanie mowy na zainstalowanym modelu turbo, nowe opisy ustawień, poprawki AI i tłumaczeń.

- Settings → Silnik has a **Uruchamianie i pamięć** (Startup and memory) tab: engine start at launch, model warm-up, and how long the engine and model stay loaded after inactivity.
- Speech recognition works with the installed turbo model.
- Clearer descriptions of settings; fixes for the AI functions and translations (31 items of the 22 October audit).

## 0.2.1 - 2026-10-23

- Maintenance build (no separate notes).

## 0.2.0 - 2026-10-22

Update notes (Polish): Nowe ustawienia (12 stron w 4 grupach), poprawione komponenty, jedna wyszukiwarka w ustawieniach, aktualizacje aplikacji z GitHub.

- New settings: 12 pages in 4 groups with one search field.
- Reworked components.
- In-app updates from GitHub Releases (Settings → Aktualizacje).
