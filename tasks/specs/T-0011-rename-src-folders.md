# T-0011: `frontend/src/` and `desktop/` instead of `src/lib/` and `src-tauri/`

**Decided layout (owner, 23 October 2026).**

```
frontend/                 the Svelte interface
  index.html, inputy.html, vite.config.ts, tsconfig.json, svelte.config.js
  src/
    App.svelte, main.ts, styles.css, data.ts
    ui/ voices/ models/ settings/ platform/ tools/ tts/ shell/ playback/ projects/ themes/ i18n/ gallery/ styles/ assets/
desktop/                  the native Windows app (Rust, Tauri)
  Cargo.toml, tauri.conf.json, build.rs, capabilities/, icons/
  src/                    main.rs, runtime.rs, installer.rs, ...
package.json              stays in the repository root (npm scripts, CI, lockfile)
```

**Why.**
- `src` and `src-tauri` say little: they differ only by a suffix and neither says what it holds.
- `src/lib/` is a leftover of the Vite Svelte template. The project is plain Vite + Svelte 5, not SvelteKit: `svelte.config.js` is empty, there is no `$lib` alias and no `$lib` import (all ~790 imports are relative), so `lib` groups nothing. The 283 files in 16 area folders move up one level, to `frontend/src/<area>/`.
- `frontend/` mirrors `desktop/`: configuration next to a `src/` with the sources.

**Blast radius (counted on 23 October 2026).**
- 113 imports from files in `src/` (mostly `App.svelte`, `main.ts`, `gallery.ts`) point to `./lib/...` and become `./...`.
- Imports inside `src/lib` stay as they are (the folders move together), except one that leaves it: `settings/pages/UpdatesPage.svelte` imports `../../../../package.json`.
- 75 files outside `src/` (tests, scripts, CI, config) and 28 documents mention `src/lib`; 16 tests use the `sourceUrl()` helper; `scripts/dev/check-structure.mjs` has a rule about `src/lib`; 6 entries of `scripts/dev/line-limit-exceptions.json` use `src/lib` paths.
- 24 tracked files outside `src-tauri/` mention `src-tauri` (AGENTS.md, README, docs, `.gitignore`, `vite.config.ts`, `scripts/release/build-update.mjs`, `check-structure.mjs`, a few frontend files and tests).
- Moving the HTML entries and Vite configuration into `frontend/` needs Vite `root: 'frontend'` (or `--config`), `build.outDir` pointing back to the repository `dist/` (Tauri `frontendDist` is `../dist` relative to `tauri.conf.json`, it must keep resolving after the rename), and updated `package.json` scripts.

**Known facts.** `tauri info` found a renamed app directory in a scratch copy (it read the Rust dependencies from it). A full `tauri build` on the renamed layout was **not** tested. The Tauri docs do not describe renaming the folder, so this must be proven before merging.

**Precondition.** A clean working tree (T-0018 is done); check `git status` again before starting, other sessions commit here.

**Steps.**
1. `git mv` the sources: `src/lib/*` to `frontend/src/`, `src/App.svelte`, `main.ts`, `styles.css` to `frontend/src/` (keep history; do the move in one commit with the path rewrite, so imports are never half-updated). Move `gallery.ts`, `OrbMusicDemo.svelte`, `orb-music-demo.ts` into `frontend/src/gallery/` only if T-0009 keeps them.
2. `git mv` the UI configuration and entries into `frontend/`; adjust Vite `root`, `build.outDir`, `tsconfig.json` `include`, `package.json` scripts, `index.html` entry paths, test helpers (`sourceUrl()`), scripts and docs.
3. `git mv src-tauri desktop`; update `.gitignore` (`src-tauri/target/`, `src-tauri/gen/`), `package.json` tauri scripts, `build-update.mjs`, `check-structure.mjs`, CI, docs, and the Rust `include_str!` / `include_bytes!` paths.
4. Rewrite paths with a script that also reports every remaining `src/lib` and `src-tauri` string; update `check-structure.mjs` (the `src/lib` rule becomes a rule for `frontend/src`) and the line-limit exceptions list.
5. Checks: `npm run check`, `npm run build`, `npm run test:ui`, `npm run test:structure`, `cargo check --manifest-path desktop/Cargo.toml`, and a real `npm run desktop:build`. Open the built app once.
6. Do not change Tauri identifiers or data keys (rule 6 in `docs/architecture/struktura-projektu.md`).

**Done when.** All checks above pass, no tracked file mentions `src/lib` or `src-tauri` except as history, and the built EXE starts.
