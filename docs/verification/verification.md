# Public release verification

## Product-facing naming update

The user approved **Labs**, **Róża**, and **silnik Seventy Seven Labs** for the visible themes and engine. General product descriptions use these names. Exact source identity, versions, copyright, and licenses remain in dedicated provenance details and third-party notices; model names and terms are unchanged.

Current checks: `npm run check` passed with 0 errors and 0 warnings; `npm run build` and the complete `npm run test:ui` passed. The suite now includes 7 theme-compatibility checks for existing IDs, stored assignments, unchanged light/dark colors, and JSON v1 import/export. The build retains its existing warning for the main chunk, now approximately 729 kB before gzip.

The real browser theme workflow passed 24 interaction checks, covering assignments, duplication, editing, import/export, deletion, validation, and storage failure. Additional UI checks confirmed the new visible names and the retained backend copyright/provenance section. There were no page errors or private-backend requests. The existing demo capture workflow passed its five playback/navigation checks, and three 1440×960 screenshots were refreshed and visually reviewed; their hashes are updated in `public-assets.json`.

The T3 snapshot endpoint again returned `Preview automation snapshot timed out after 15000ms.` twice. Browser acceptance and capture used the repository's isolated Chromium workflow. No Rust code, backend archive, license text, model weights, or private runtime data changed. No new EXE build, inference, model installation, or complete dubbing/audiobook acceptance is claimed.

## English documentation update

The English translation is a documentation change. Its checks cover content, local links and heading anchors, UTF-8, whitespace, and publication privacy. Application builds, UI/runtime tests, and inference from the earlier release preparation were not rerun for this translation.

Translation checks passed: 31 Markdown files reviewed, 99 local links checked, no missing targets or anchors, valid UTF-8, and a clean whitespace check. The full publication audit with anonymous identity checks and an external private deny list passed with no findings. All five pinned media/engine assets are unchanged. Package metadata remains valid JSON; the CI change affects only its display name.

The earlier results below are retained as recorded evidence, not presented as tests performed again during translation.

## Recorded source-release checks — 21 October 2026

These checks were performed on the public source tree, rather than copied from the former private deployment.

| Check | Recorded result and scope |
| --- | --- |
| `npm ci --no-audit --no-fund` | PASS — installation from the public lockfile. |
| `npm run check` | PASS — 0 Svelte/TypeScript errors or warnings. |
| `npm run build` | PASS — production bundle; the warning for the main chunk of approximately 728 kB before gzip remains. |
| `npm run test:ui` | PASS — the full suite, including tags, data, cancellation, catalog, folders, visualization, colors, focus, and overlays. |
| `cargo check --manifest-path desktop/Cargo.toml` | PASS — Rust/Tauri code, without building and running a new EXE. |
| Selected Python tests | PASS — 12 bundle tests, 9 acceptance guards, and 3 watch-folder guards. |
| Lightweight JS/format tests | PASS — history, diagnostics, audio automation, dictation, and PCM16/PCM24/FLOAT32 WAV with FFprobe checks. |
| QA script syntax | PASS — 88 Python and 94 JS/MJS files in the reviewed scripts. |
| Publication scanner tests | 23 PASS, 1 SKIP: the Windows account could not create a test directory symlink. Coverage includes UTF-16, media without extensions, unreachable objects and Git trees, all index stages, and batch-response errors/completeness. |
| Live demo preview | PASS — five checks: fictional data; WAV play/pause/seek/download link; voice library; appearance; no JavaScript errors or private-backend requests. |
| README screenshots | Three 1440×960 PNGs from a fresh Chromium profile, visually reviewed for content and privacy. |
| Audio preview generator | PASS — `node tools/preview/controls-preview.mjs --audio`; output in ignored `.tmp/qa` using the procedural tone. Opening it offline was checked. |
| Documentation | PASS — local links, character encoding, attributions, full AGPL/Apache texts, and retained MIT notices. |

The T3 preview returned `Preview automation snapshot timed out after 15000ms.` twice. Screenshots and interactions were checked with Python Playwright in a separate Chromium instance, with backend requests blocked.

The privacy audit covers files, the index, every Git object, and the pinned archive. Private deny strings are kept outside the repository. The full scan using `--require-anonymous --deny-file` passed with no findings; the batch implementation took about 9 seconds on the test computer. Public-history authors and committers are neutral. Repeat the audit after each commit before publication. See the [publication guide](../publishing.md).

No new GPU inference, voice-quality assessment, model downloads, model-term decisions, clean-VM installation, complete model matrix, full dubbing, or long audiobook were tested. A build and health response do not replace those acceptance tests. Screenshots and a procedural tone do not demonstrate TTS quality.
