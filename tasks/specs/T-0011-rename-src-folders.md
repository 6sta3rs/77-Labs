# T-0011: rename `src/` to `frontend/` and `src-tauri/` to `desktop/`

**Why.** `src` and `src-tauri` say little: they differ only by a suffix and neither says what it holds. `frontend/` is the Svelte interface, `desktop/` is the native Windows app in Rust.

**Blast radius (counted on 23 October 2026).** 24 tracked files outside `src-tauri/` mention `src-tauri` (AGENTS.md, README, docs, `.gitignore`, `vite.config.ts`, `scripts/release/build-update.mjs`, `scripts/dev/check-structure.mjs`, a few frontend files and tests); about 107 files outside `src/` mention `src/` (index.html entries, tests, docs, preview scripts, `tsconfig`/`svelte.config.js` paths, `include_str!` paths in Rust).

**Known facts.** `tauri info` found a renamed app directory in a scratch copy (it read the Rust dependencies from it). A full `tauri build` on the renamed layout was **not** tested. The Tauri docs do not describe renaming the folder, so this must be proven before merging.

**Precondition.** A clean working tree (T-0018 is done, commits 71043fc and c111710); check `git status` again before starting, other sessions commit here.

**Steps.**
1. Make sure `git status` is clean (T-0018 done).
2. `git mv src frontend`; update `index.html`/`inputy.html` entry paths, `vite.config.ts`, `tsconfig.json`, `svelte.config.js`, test helpers (`sourceUrl()`), scripts and docs.
3. `git mv src-tauri desktop`; update `.gitignore` (`src-tauri/target/`, `src-tauri/gen/`), `package.json` tauri scripts, `build-update.mjs`, `check-structure.mjs`, CI, docs, and the Rust `include_str!` / `include_bytes!` paths.
4. Checks: `npm run check`, `npm run build`, `npm run test:ui`, `npm run test:structure`, `cargo check --manifest-path desktop/Cargo.toml`, and a real `npm run desktop:build`. Open the built app once.
5. Do not change Tauri identifiers or data keys (rule 6 in `docs/architecture/struktura-projektu.md`).

**Done when.** All checks above pass and the built EXE starts.
