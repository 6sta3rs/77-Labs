# Developer tools

Everything a developer runs by hand lives here; nothing under `tools/` ships in the application. The backend that is embedded in the EXE stays in `scripts/runtime/`, and tests live in `tests/` (the acceptance scripts that drive a real engine, browser or EXE stay in `tests/acceptance/`, listed in [its README](../tests/acceptance/README.md)).

Rules:
- `.mjs` and `.ts` files are kebab-case, `.py` files are snake_case.
- Every file under `tools/` has a row in the table below (`npm run test:structure` fails for a missing one).
- A tool that nothing calls says so in the last column; it is a candidate for deletion, not a promise.

Folders: `tools/dev` (checks and generators run before commits), `tools/preview` (standalone preview pages and servers), `tools/release` (installer, update feed and engine archive builders).

## Known problems

- `tools/preview/voice-audit-preview.mjs` and `voice-picker-preview.mjs` resolve their root one folder too high and serve check scripts from `scripts/<name>.js`, which does not exist; there is no runner for `voice-audit-build.mjs`. Owner decision T-0008 (keep or delete).
- `tools/preview/feature-preview.mjs`, `tools-workspace-preview.mjs` and `ui-performance-preview.mjs` serve check scripts from paths that do not exist (`tools-workspace-check.js` is missing from the repository), so `npm run qa:ui` does not work as documented. Manual previews are part of the owner decision T-0009.
- `tests/frontend/voice-audit-build.mjs` (used by the voice-audit tools): the full mode no longer builds since the move to `frontend/` (its page imports `/src/main.ts` against the repository root); only `--fixture-only` works. Part of T-0008.
- `tools/preview/orb_product_preview.py` computes the repository root one level too high.

## Tools

| Tool | Purpose | When to run | Called by |
| --- | --- | --- | --- |
| `tools/dev/ai-dev.ts` | Vite plugin that runs AI in development without starting the GPU/TTS backend (spawns a dev AI server on a free port). | Automatically with npm run dev (loaded by frontend/vite.config.ts). Needs: none. | `docs/architecture/runtime.md`, `frontend/vite.config.ts` |
| `tools/dev/check-structure.mjs` | Asserts repository structure rules (frontend/src layout, pinned engine archive hash vs provenance, TTS catalogue contract, line-limit exceptions point at tracked files). | Before every commit; npm run test:structure; when moving files or editing docs links. Needs: none. | `package.json` |
| `tools/dev/filemap/` | Rust crate (std only) that scans the repo incl. ignored files and writes .tmp/qa/filemap.tsv and filemap.html. | Manually, or via the map refresh helper after a change. Needs: none (cargo to build). | documentation only |
| `tools/dev/generate_demo_music.py` | Creates Signal Bloom, original deterministic music for the public orb demo (no samples or models). | Manually, only when regenerating public/demo/orb-music.wav. Needs: none. | documentation only |
| `tools/dev/generate_demo_tone.py` | Generates the public playback fixture public/demo/interface-tone.wav without speech, models or recordings. | Manually, only when regenerating the public tone. Needs: none. | `docs/features/tts-demo.md`, `docs/public-assets.json`, `docs/publishing.md` |
| `tools/dev/i18n-lang.mjs` | Interface languages tool: coverage status, translator hand-off file and scaffolding of a new language. | Manually when adding or translating a UI language. Needs: none. | `docs/features/i18n.md`, `package.json`, `tests/frontend/i18n-languages-check.mjs` |
| `tools/dev/line-limit-exceptions.json` | Data file: per-file maximum line counts with reasons, read by the structure check. | Edited manually when a file legitimately exceeds the limit. Needs: none. | `tools/dev/check-structure.mjs` |
| `tools/dev/line-length-baseline.json` | Data file: per source file the number of lines over 200 and 400 characters and the longest line; a ratchet (may not grow, must be lowered when it shrinks). | Rewritten by `node tools/dev/check-structure.mjs --write-baselines` after shortening lines. Needs: none. | `tools/dev/check-structure.mjs` |
| `tools/dev/publication_check.py` | Checks the public tree, all Git objects and the pinned upstream archive for private strings (accepts a private deny list). | Before every commit and in CI. Needs: none (private deny file outside repo). | `.github/workflows/ci.yml`, `AGENTS.md`, `README.md`, `docs/architecture/project-context.md` … |
| `tools/dev/run-checks.mjs` | Runs every tests/frontend/*-check.mjs plus ui-rules.mjs, prints all failures, fails if any fails. | Before every commit touching frontend; npm run test:ui. Needs: none. | `package.json`, `tests/frontend/README.md` |
| `tools/dev/test_runtime.py` | Runs source-only Python regressions (no acceptance scripts or live models). | Before commit when changing scripts/runtime or backend Python. Needs: none. | documentation only |
| `tools/preview/audiobook-preview.mjs` | Isolated built-product acceptance server for audiobooks with explicit backend fixtures. | Manually when changing the audiobook UI (needs a build in .tmp/audiobook-dist). Needs: browser. | nothing (manual) |
| `tools/preview/capture_screenshots.py` | Captures public UI screenshots in a fresh Chromium profile with backend access blocked. | Manually when refreshing public screenshots (dev server on port 4310 first). Needs: browser. | `docs/public-assets.json` |
| `tools/preview/controls-preview.mjs` | Builds and serves the controls gallery (inputy.html or audio-only) for the offline component catalog. | Manually when changing UI controls. Needs: browser. | `docs/features/controls-preview.md`, `docs/verification/verification.md` |
| `tools/preview/editor-performance-preview.mjs` | Stable memory-only build and server of the isolated editor performance harness. | Manually when changing the speech editor (npm run qa:editor). Needs: browser. | `package.json` |
| `tools/preview/editor-performance-preview.svelte` | Svelte harness component for the editor performance check. | Loaded by the editor preview build. Needs: browser. | `tools/preview/editor-performance.html` |
| `tools/preview/editor-performance.html` | HTML shell mounting the editor performance harness. | Loaded by the editor preview. Needs: browser. | `tools/preview/editor-performance-preview.mjs`, `tests/frontend/editor-performance-check.js` |
| `tools/preview/feature-preview.mjs` | Stable production preview server for feature acceptance (needs npm run build and feature_smoke.py --hold on 4312). | Manually when verifying features in the built UI. Needs: engine (disposable backend), browser. | nothing (manual) |
| `tools/preview/inline-preview.mjs` | Builds a separate App entry into one self-contained document for UI preview. | Manually when previewing the app as a single document. Needs: browser. | documentation only |
| `tools/preview/motion-preview.svelte` | Svelte page exercising motion states of UI components. | Loaded by tests/frontend/motion-ui-check.js. Needs: browser. | `tests/frontend/motion-ui-check.js` |
| `tools/preview/orb-preview.svelte` | Svelte page exercising the orb with playback activity and recording. | Loaded by orb UI checks. Needs: browser. | `tests/frontend/README.md`, `tests/frontend/orb-ui-check.js` |
| `tools/preview/orb_product_preview.py` | Serves the built UI with read-only voice/audio fixtures on an isolated origin. | Manually when checking the orb in the built UI. Needs: browser. | nothing (manual) |
| `tools/preview/orb-reactivity-gpu.html` | Standalone page comparing four orb styles with identical clock and different frequency bands on GPU. | Manually when tuning orb shader reactivity. Needs: browser. | documentation only |
| `tools/preview/tools-workspace-preview.mjs` | Isolated UI preview for the tools workspace; every /backend request is answered by an explicit fixture. | Manually when changing the tools workspace. Needs: browser. | nothing (manual) |
| `tools/preview/ui-performance-preview.mjs` | Isolated receiver of the built UI for performance/playback/dashboard checks; no requests reach the private engine. | Manually (npm run qa:ui) after npm run build. Needs: browser. | `package.json`, `tests/frontend/ui-performance-check.js` |
| `tools/preview/voice-audit-preview.mjs` | QA-build server with fixtures for the voice picker audit (no header comment). | Manually when changing the voice picker audit UI. Needs: browser. | documentation only |
| `tools/preview/voice-picker-preview.mjs` | QA-build-only server with demo data for the voice picker; never forwards to the engine. | Manually when changing the voice picker. Needs: browser. | documentation only |
| `tools/release/bundle.py` | Builds a source-only engine archive from an exact upstream commit (or a resources dir) without importing upstream code. | Release only / when updating the pinned engine archive. Needs: engine source checkout (local git). | `docs/architecture/runtime.md`, `docs/features/engine-update.md`, `scripts/runtime/vendor/engine-provenance.json` |
| `tools/release/build-update.mjs` | Builds a signed NSIS installer and the updater feed latest.json for GitHub Releases. | Release only (npm run desktop:release). Needs: desktop build toolchain, signing key. | `docs/features/app-updates.md`, `package.json`, `desktop/src/main.rs`, `tests/frontend/app-update-support-check.mjs` |
| `tools/release/release-guards.mjs` | Release guards: the five version manifests agree, the working tree is clean and HEAD is the release tag (also on a detached checkout). | Imported by `build-update.mjs` and `check-structure.mjs`; run by `tests/frontend/release-guards-check.mjs`. Needs: git. | `tools/release/build-update.mjs`, `tools/dev/check-structure.mjs` |
| `tools/release/changelog-notes.mjs` | Prints the release notes of one version from `CHANGELOG.md` (the `Update notes (Polish):` line, else the section). | Imported by `build-update.mjs`; run by the release workflow as a gate. Needs: none. | `tools/release/build-update.mjs`, `.github/workflows/release.yml`, `tests/frontend/release-feed-check.mjs` |
| `tools/release/verify-feed.mjs` | Downloads a published updater feed and its installer and verifies the minisign signature against the key in `desktop/tauri.conf.json`. | After publishing a release (also run by `verify-release.yml`). Needs: network for a URL. | `.github/workflows/verify-release.yml`, `tests/frontend/release-feed-check.mjs` |
