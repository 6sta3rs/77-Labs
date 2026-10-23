# Project context

**Seventy Seven Labs 0.2.2** is a local voice studio for Windows. The public source has a fresh history without private user data. Write the product name exactly as Seventy Seven Labs.

The application interface is Polish. Public documentation is English; filenames and compatibility identifiers remain stable.

## Architecture

- Svelte 5 / TypeScript / Vite: interface, editor, library, and transport.
- Tauri 2 / Rust: window, native files, process supervision, and installation. The Rust package is `seventy-seven-labs`; the release EXE is `seventy-seven-labs.exe`.
- Python / FastAPI: the Seventy Seven Labs engine, combining a pinned upstream backend (0.5.7) with adapters in `scripts/runtime/`. Exact upstream identity, version, authors, and license are documented in [third-party notices](../../THIRD_PARTY_NOTICES.md) and the engine provenance manifest.
- `engine.zip` and `engine-provenance.json` in `scripts/runtime/vendor/`: immutable upstream sources, licenses, and provenance.
- Data defaults to `%LOCALAPPDATA%/VoiceStudioNext`, outside the repository.

The Tauri identifier `local.studioa1tts.voicestudio-next`, `voicestudio.*` storage keys, and runtime directories are retained for compatibility. A cosmetic product rename should not change these identifiers.

## Source layout

Frontend sources are grouped by feature under `frontend/src/<area>/` (`shell`, `tts`, `voices`, `models`, `playback`, `projects`, `settings`, `platform`, `tools`, `ui`, `gallery`, `styles`, `themes`); the entry files (`App.svelte`, `main.ts`, `gallery.ts`, `styles.css`) and the shared `data.ts` sit directly in `frontend/src/`; the Vite, TypeScript and Svelte configuration and the HTML entries (`index.html`, `inputy.html`) are in `frontend/`, the Rust app is in `desktop/`, and `package.json` stays in the repository root. Tests are in `tests/{frontend,runtime,acceptance}` (plus `fixtures` and `helpers`). Developer tools are in `tools/{dev,preview,release}` (every tool is described in `tools/README.md`; acceptance scripts in `tests/acceptance/README.md`), and the Python engine sources embedded in the EXE are split into `scripts/runtime/{app,install,vendor}`. The "where do I change X?" map is in the [project map](project-structure.md). The published layout of the private runtime and the data format are unchanged.

Settings has 12 pages in 4 groups, defined in `frontend/src/settings/settings-catalog.ts`; each page is one component in `frontend/src/settings/pages/` and every control has exactly one home. **Aplikacja** (Application): Ogólne, Wygląd, Słownik wymowy, Skróty i mikrofon, Aktualizacje. **Silnik i modele** (Engine and models): Silnik (engine start/stop, status, compute, environments, logs and diagnostics) and Modele (catalog, downloads, terms, Hugging Face access). **Połączenia** (Connections): Sieć i dostęp, Integracje, AI i klucze. **Dane** (Data): Przechowywanie, Prywatność i użycie. The former single "Modele i silnik" page no longer exists. Visual rules are in [settings style](../features/settings-style.md).

## Running and development

Run `npm ci`, then `npm run dev`: http://127.0.0.1:4310. `/?demo=tts` displays fictional data and a procedural tone. `inputy.html` opens the component gallery.

`npm run desktop:dev` starts Tauri; `npm run desktop:build` creates an EXE without an installer, at `desktop/target/release/seventy-seven-labs.exe`. The window opens without Python, then the app starts the backend on port 4312 (and warms the TTS model in the background); after an idle stop it starts again on the next task. It stops after confirmed inactivity; it needs its own environment and weights. Rust reads voices and portraits without the backend. The browser uses the `/backend` proxy and does not start the Tauri supervisor.

Engine lifecycle:

- **Idle stop:** the engine stops after a configurable period of confirmed inactivity. The default is 15 minutes; the choice is 5, 15, 30, or 60 minutes, or **Zawsze** (never stopped for inactivity; keeps about 1.9 GB of GPU memory in use), in **Ustawienia → Silnik → Uruchamianie i pamięć** (Settings → Engine → Startup and memory), under **Utrzymuj silnik i model po bezczynności** (Keep the engine and model after inactivity). The same value is pushed to the engine's own model idle clock.
- **Start at launch:** `App.svelte` starts the engine when the desktop app opens (`bootRuntime`, silent in the browser demo) unless **Uruchamiaj silnik przy starcie aplikacji** (start the engine when the app opens) is off, and Rust sets `VOICESTUDIO_NEXT_PRELOAD_TTS=1` by default, so the TTS model loads in the background; **Ładuj model głosowy do pamięci po uruchomieniu** (load the voice model into memory at startup) turns that off, and **Załaduj model teraz** (load the model now) loads it on demand. The two switches are stored in `localStorage` and apply from the next launch / next engine start. `EngineStartup.svelte` shows the steps and the model warm-up.
- **Startup budget:** a cold start may take up to 300 s when libraries and weights load from a slow disk; progress is shown and waiting ends when progress stalls.
- **Graceful stop:** stdin is closed and the supervisor waits up to 15 s before ending only the process tree it owns.

See [runtime](runtime.md) and [installation](../features/runtime-installation.md).

The [documentation index](../README.md) lists all documents. See the [PRD](../PRD.md) for scope and criteria, [verification](../verification/verification.md) for recorded results, and [progress](../progress.md) for handover notes.

A build and a health response do not prove synthesis or a complete dubbing/audiobook workflow. Historical private-deployment results were not copied into the new history.

## Privacy and licenses

Do not add recordings, databases, accounts, tokens, or private paths. Write QA output under the ignored `.tmp/qa/`. The project's demo audio (`public/demo/interface-tone.wav`) is only a procedural tone; upstream retains its documented assets in the pinned archive.

Do not edit hardlinked models or libraries in place; do not change an existing VoiceStudio installation or its shared weights. The public version uses neutral icons and original visualizations. Product-facing themes are **Labs** and **Róża**, and the procedural orb variant is **Przepływ**. Older identifiers remain compatibility details, not product labels. Renaming a presentation label does not change ownership or licensing of imported sources; preserve source copyright, licenses, and factual model names.

Commit each logical change with a progress update, following [AGENTS.md](../../AGENTS.md). Run the [publication check](../publishing.md) (`tools/dev/publication_check.py`) before publishing; CI is defined in `.github/workflows/ci.yml`.
