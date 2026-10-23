# Contributing to Seventy Seven Labs

Start with the [README](README.md), [product requirements](docs/PRD.md),
[project context](docs/architecture/project-context.md), and [AGENTS.md](AGENTS.md).
Keep the application interface in Polish and public release documentation
in English. Preserve actual Polish UI labels when referring to controls,
with an English explanation where useful. The product name is
**Seventy Seven Labs**; keep legacy technical identifiers where they
preserve data compatibility.

## Getting started

The frontend needs npm and a Node.js version compatible with the pinned Vite
version. The Windows desktop application also needs Rust, the C++ build tools
required by Tauri, and WebView2. Building the EXE does not install models.

```powershell
npm ci
npm run dev
```

Preview: `http://127.0.0.1:4310`. TTS demo data:
`http://127.0.0.1:4310/?demo=tts`; component gallery: `/inputy.html`.
The demo supports interface development. It does not establish that local
synthesis works.

```powershell
npm run desktop:dev
# Local build without an installer package:
npm run desktop:build
```

Synthesis requires a dedicated Python environment and model weights.
Start setup explicitly in **Ustawienia > Silnik**
(Settings > Engine; models are on **Modele**). See [runtime installation](docs/features/runtime-installation.md)
and the [engine contract](docs/architecture/runtime.md). Do not copy a private database,
profiles, or terms acknowledgments from another installation.

## Scope and validation

Check Git status and recent commits first. Preserve unrelated changes.
Describe the problem, resulting behavior, checks performed, and limitations.
For a bug, provide a short reproducible scenario using clean data.
For a workflow change, show the screen or steps for manual acceptance testing.

| Changed area | Required checks |
| --- | --- |
| Svelte / TypeScript | `npm run check` and `npm run build`; the relevant UI workflow. |
| Narration tags | Also run `node tests/frontend/tag-check.mjs`. |
| Shared controls / UI behavior | Also run the relevant regressions in `npm run test:ui`; check keyboard use, focus, and relevant window sizes. |
| Rust / Tauri | `cargo check --manifest-path desktop/Cargo.toml`; use the actual EXE for native behavior. |
| Python / runtime | Syntax and tests for the changed module in an isolated environment; the runtime contract or workflow affected by the change. |
| Documentation | Content, links, and `git diff --check`; no costly generation runs. |

```powershell
npm run check
npm run build
node tests/frontend/tag-check.mjs
cargo check --manifest-path desktop/Cargo.toml
git diff --check
```

Match validation to the change. A successful build, model catalog, and `/health`
do not replace synthesis testing. Identify fixture-based transport tests
as such. Do not present a historical result as a check performed during
current work. A generation test should identify the model, revision, hardware,
owned input, and acceptance limits.

## Every gate

```powershell
npm ci
npm run check            # svelte-check
npm run build
npm run test:bundle      # size budget of dist/
npm run test:ui          # every tests/frontend check, one runner
npm run test:structure   # layout, names, links, file sizes, version parity, pinned actions
npm run test:e2e         # browser smoke and accessibility scan (needs: npx playwright install chromium)
cargo test --manifest-path desktop/Cargo.toml
cargo clippy --manifest-path desktop/Cargo.toml --all-targets -- -D warnings
python tools/dev/run_runtime_tests.py   # needs a venv with requirements-ci.txt, see tests/runtime/README.md
ruff check .
python tools/dev/publication_check.py --deny-file <private-list-outside-repo>.json
```

CI runs the same commands (`.github/workflows/ci.yml`); the weekly jobs are the dependency audit and the EXE start check. Release steps are in [publishing](docs/publishing.md).

## Adding things

- **A developer tool.** Put it in `tools/dev`, `tools/preview` or `tools/release`, name it in kebab-case (`.mjs`, `.ts`) or snake_case (`.py`), and add a row to [tools/README.md](tools/README.md) (purpose, when to run, who calls it); `npm run test:structure` fails for an unlisted file. Acceptance scripts that need an engine, a browser or the EXE go to `tests/acceptance` with a row in its README.
- **A test.** A frontend check is `tests/frontend/<name>-check.mjs` and is picked up by `npm run test:ui` without registration. A Python test goes into `tests/runtime` and must be listed in `tests/manifest-python.json` as `ci` or `skipped` with a reason.
- **An interface language.** `npm run i18n:add -- <code> "<Name>" <locale>`, then translate; see [i18n](docs/features/i18n.md).
- **A task.** Add a row to [tasks/BOARD.md](tasks/BOARD.md) with the next free `T-NNNN` (rules in [tasks/README.md](tasks/README.md)); a task that needs more than a line gets `tasks/specs/T-NNNN-<name>.md`.
- **A file over 600 lines or a line over 200 characters.** Not allowed to appear: `test:structure` fails, and existing exceptions are ratcheted (they may not grow). Split the file instead; see [project map](docs/architecture/project-structure.md), rule 7.

## Clean data and screenshots

- Use fictional names, short neutral texts, and procedural audio signals.
  For speech, use a recording you own and have the right to publish.
- Run QA in a separate browser/WebView profile and data directory. Do not test
  migration, retention, or deletion on a private library.
- Do not commit user recordings, models, SQLite databases, tokens, `.env`,
  logs containing data, environments, builds, or WebView profiles.
- Before taking a screenshot, review project text, the voice list, window title,
  paths, account names, and diagnostics. Label demo screenshots as demo.
- Adding a file to `.gitignore` does not remove it from earlier commits.
  Report a suspected disclosure according to [SECURITY.md](SECURITY.md).

## Licensing and provenance

Contributions to project code must be compatible with **AGPL-3.0-only**
and the [third-party exceptions](THIRD_PARTY_NOTICES.md). Keep existing notices
and upstream attribution. Do not copy someone else's shaders, screenshots,
logos, or recordings merely because they can be downloaded from a website.

A new dependency or asset needs a source, revision, license, and description
of modifications. Code, weights, and tokenizers may have different licenses.
The user acknowledges model terms; tests must not automatically accept them
on the user's behalf.

Before a local commit, review the diff, explicitly stage task files, and update
`docs/progress.md`. Architecture or startup changes also require updates to
the project context and relevant documentation. Do not publish or rewrite
someone else's Git history without explicit agreement.
