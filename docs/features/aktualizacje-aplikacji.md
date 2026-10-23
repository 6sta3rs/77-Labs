# App updates

The desktop app updates itself from signed releases of this repository on GitHub, using the Tauri updater (`tauri-plugin-updater`).

## For the user

- The circular-arrows button in the bottom-left corner of the sidebar (**Sprawdź aktualizacje**, "Check for updates") opens **Ustawienia → Aktualizacje** (Settings → Updates) and checks immediately against the update feed of this project's GitHub repository. The same check is the **Sprawdź aktualizacje** button on that page.
- When a newer version exists, the page shows it with its notes and **Pobierz i zainstaluj** ("Download and install"). The app downloads the installer, verifies its signature, runs it in passive mode, and restarts. Voices, projects, recordings, models and the Python environment live in `%LOCALAPPDATA%` and are not touched.
- Nothing is contacted until you click. The browser preview cannot install updates.
- The updater installs NSIS builds. A copy started from `src-tauri\target\release\seventy-seven-labs.exe` (the `npm run desktop:build` output) can check for updates, but the update installs the app as a per-user program; from then on start it from the Start menu.
- The studio refresh that this button used to run (reconnecting to the engine, reloading voices and the model catalog) is **Odśwież stan** ("Refresh status") on **Ustawienia → Silnik**.

## For the maintainer: publishing a release

1. Set the same new version in `package.json` and `src-tauri/tauri.conf.json` (the updater only offers a higher version).
2. `npm run desktop:release -- --notes "Co nowego"` builds the signed NSIS installer and writes `.tmp/release/v<version>/` with the installer, its `.sig` and `latest.json`.
3. Review, then publish with the `gh release create …` command the script prints. The script takes the repository from `git remote get-url origin` and builds the app with the endpoint `https://github.com/<owner>/<repo>/releases/latest/download/latest.json` (`tauri build --config`), so the newest non-draft release must contain `latest.json`. `tauri.conf.json` keeps an empty endpoint list: builds made without the script (`npm run desktop:build`) report that no update source is configured. In such a build the Updates page asks the app (`app_updates_supported`, which reads `plugins.updater.endpoints` of the merged config), disables "Sprawdź aktualizacje" and explains that this copy does not support updates, instead of showing the raw plugin error.

Signing key: the private key is `%USERPROFILE%\.tauri\seventy-seven-labs-updater.key` (or `TAURI_SIGNING_PRIVATE_KEY`). It never goes into the repository. Back it up: if it is lost, installed copies cannot accept any further update, and a new key requires users to reinstall manually. The public key is in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).

## Files

- `src/lib/platform/app-update.ts` — check, download/install, restart.
- `src/lib/settings/pages/UpdatesPage.svelte` — the "Aktualizacja aplikacji" section.
- `src-tauri/tauri.conf.json` — bundle target `nsis`, `createUpdaterArtifacts`, public key (endpoint injected by the release script); `src-tauri/capabilities/main.json` — `updater:default`, `process:allow-restart`.
- `tools/release/build-update.mjs` — release build and `latest.json`.
