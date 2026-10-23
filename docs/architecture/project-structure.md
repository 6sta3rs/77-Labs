# Project map

Sources are split by application feature. When changing voices, start in
`frontend/src/voices/`; when changing playback, start in `frontend/src/playback/`.

## Where do I change X?

| Area | Location | Example entry point |
| --- | --- | --- |
| App composition | `frontend/src/App.svelte` | Screens, shared state, and flow wiring |
| Navigation and dashboard | `frontend/src/shell/` | `NavigationSidebar.svelte`, `Dashboard.svelte` |
| TTS editor and generation | `frontend/src/tts/` | `SpeechEditor.svelte`, `speech-settings.ts`, `tags.ts` |
| Voice picker, creation, and folders | `frontend/src/voices/` | `VoicePicker.svelte`, `voice-folders.ts` |
| Models and licenses | `frontend/src/models/` | `ModelLicenseReview.svelte`, `model-management.ts`, `engine-installation.ts` |
| Playback, waveforms, and audio orbs | `frontend/src/playback/` | `Player.svelte`, `VoiceOrb.svelte`, `playback-meter.ts` |
| Projects and recording history | `frontend/src/projects/` | `library.ts`, `history-view.ts` |
| Settings shell, catalog, and appearance | `frontend/src/settings/` | `SettingsShell.svelte`, `settings-catalog.ts` (12 pages in 4 groups), `appearance.ts` |
| Settings pages | `frontend/src/settings/pages/` | One component per page, e.g. `EnginePage.svelte`, `ModelsPage.svelte`, `NetworkPage.svelte` |
| Transport, Tauri, and engine supervision | `frontend/src/platform/` | `api.ts`, `runtime.ts` |
| Transcription and dictation | `frontend/src/tools/transcription/`, `dictation/` | The matching `*Workspace.svelte` |
| Dubbing and audiobooks | `frontend/src/tools/production/` | `ProductionWorkspace.svelte`, `production.ts` |
| Stories, automation, and audio processing | `frontend/src/tools/stories/`, `automation/`, `audio-lab/` | Each has its own view and logic side by side |
| Shared tool layout | `frontend/src/tools/` | `ToolWorkspace.svelte`, `studio-tools.ts` |
| Shared controls | `frontend/src/ui/` | `Button.svelte`, `Select.svelte`, `overlay.ts` |
| Examples and demo data | `frontend/src/gallery/` | `ControlGallery.svelte`, `tts-demo.ts` |
| Shared styles | `frontend/src/styles/`, `frontend/src/styles.css` | `ui.css`, `typography.css`, `ui-colors.ts` |
| Palettes | `frontend/src/themes/` | Kept as a separate folder |
| Shared types and time format | `frontend/src/data.ts` | Existing voice, project, and recording contracts |
| Demo audio | `public/demo/interface-tone.wav` | Procedural tone (`tools/dev/generate_demo_tone.py`); list in `docs/public-assets.json` |
| Interface build configuration | `frontend/` | `vite.config.ts`, `tsconfig.json`, `index.html`, `inputy.html` (the npm scripts pass `--config frontend/vite.config.ts`; the build goes to the root `dist/`) |
| Native Windows app | `desktop/src/` | `main.rs`, `runtime.rs`, `installer.rs`; configuration in `desktop/tauri.conf.json` |
| Backend adapter | `scripts/runtime/app/` | `launcher.py`, `model_management.py` |
| Environment installation | `scripts/runtime/install/` | `bootstrap.py`, `prepare.py` |
| Pinned sources and provenance | `scripts/runtime/vendor/` | `engine.zip`, `engine-provenance.json` |
| Release builders | `tools/release/` | `build-update.mjs` (installer and feed), `bundle.py` (engine archive) |
| Developer tools | `tools/dev/` | `check-structure.mjs`, `run-checks.mjs`, `publication_check.py`, `test_runtime.py`, `filemap/` (Rust file-tree scanner) |
| Standalone previews | `tools/preview/` | `inline-preview.mjs`, `capture_screenshots.py` |
| Index of every tool | `tools/README.md` | Purpose, when to run, who calls it; acceptance scripts are in `tests/acceptance/README.md` |
| CI | `.github/workflows/ci.yml` | Checks run on push and pull requests |

## Tests and artifacts

- `tests/frontend/` - regression tests for logic, contracts, and controls
  (including `theme-compatibility-check.mjs`); browser-side JS files need the
  proper harness.
- `tests/runtime/` - isolated Python tests and lightweight supervisor checks
  (including `test_publication_check.py`).
- `tests/acceptance/` - explicit browser, EXE, and real-engine acceptance runs.
  They are not run automatically by `npm run test:ui`.
- `tests/fixtures/` - explicit test inputs; `tests/helpers/` - shared
  verification helpers. The `sourceUrl()` resolver serves harnesses that
  compile a source file with controlled dependencies and rejects ambiguous names.
- `.tmp/` (including QA reports in `.tmp/qa/`), `dist/`, `desktop/target/` -
  ignored local artifacts.

Basic checks:

```powershell
npm run check
npm run build
npm run test:ui
npm run test:structure
node tests/frontend/tag-check.mjs
cargo check --manifest-path desktop/Cargo.toml
& "$env:LOCALAPPDATA/VoiceStudioNext/runtime/.venv/Scripts/python.exe" -B tools/dev/test_runtime.py
```

The full Python tests require a prepared private venv with the backend
dependencies, FFmpeg, and MCP. The runner starts each module in a separate
process and passes the settings tests temporarily unpacked, pinned engine
sources. It does not install libraries, download models, or run inference.

## Rules for further changes

1. Keep a feature's view, logic, and own styles in one area.
2. Generic controls such as Button/Input/Slider stay independent of TTS and
   project flows. VoiceAvatar and ModelTrigger are domain controls and use the
   voice and model contracts.
3. Prefer direct imports. Do not add re-export files that preserve the old flat
   directory, and do not add generic `utils/` or `components/` buckets.
4. After moving a source file, also check test harnesses, preview entry points,
   documentation, and `include_str!` / `include_bytes!` in Rust.
5. The Python layout `app/`, `install/`, `vendor/` applies to the repository.
   The EXE still ships the modules next to the launcher in the existing private
   runtime. Local path adapters are not an extra dependency of the installed app.
6. Do not change Tauri identifiers, data keys, an existing VoiceStudio
   installation, or shared weights and libraries while tidying code.
7. Keep source files under 600 lines (a file that is not data never exceeds 1000). `npm run test:structure` enforces it;
   a file that legitimately needs more (a translation or colour table) is
   listed with a reason in `tools/dev/line-limit-exceptions.json`, and a
   listed file's `max` must equal its current size (it fails when the file grows, and when it shrinks until the limit is lowered with `node tools/dev/check-structure.mjs --write-baselines`; an entry with `"data": true` is a table). The same ratchet covers long lines: `tools/dev/line-length-baseline.json` records, for each file with a line over 200 characters, how many lines are over 200 and over 400 and the longest; none of these may grow, and a new file may have no line over 200.

## Scope of this reorganization

This changed where sources live and how they are found. `App.svelte` still
contains shared generation and draft-saving handling, and `production.ts` still
combines the shared production transport with dubbing and audiobook types.
Splitting those responsibilities, and `runtime.rs`, needs separate changes and
behavior tests; it is not a prerequisite for using the new folder layout.

Documentation: [index](../README.md), [context](project-context.md),
[engine](runtime.md), [progress](../progress.md).
