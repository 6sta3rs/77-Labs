# Project map

Sources are split by application feature. When changing voices, start in
`src/lib/voices/`; when changing playback, start in `src/lib/playback/`.

## Where do I change X?

| Area | Location | Example entry point |
| --- | --- | --- |
| App composition | `src/App.svelte` | Screens, shared state, and flow wiring |
| Navigation and dashboard | `src/lib/shell/` | `NavigationSidebar.svelte`, `Dashboard.svelte` |
| TTS editor and generation | `src/lib/tts/` | `SpeechEditor.svelte`, `speech-settings.ts`, `tags.ts` |
| Voice picker, creation, and folders | `src/lib/voices/` | `VoicePicker.svelte`, `voice-folders.ts` |
| Models and licenses | `src/lib/models/` | `ModelLicenseReview.svelte`, `model-management.ts`, `engine-installation.ts` |
| Playback, waveforms, and audio orbs | `src/lib/playback/` | `Player.svelte`, `VoiceOrb.svelte`, `playback-meter.ts` |
| Projects and recording history | `src/lib/projects/` | `library.ts`, `history-view.ts` |
| Settings shell, catalog, and appearance | `src/lib/settings/` | `SettingsShell.svelte`, `settings-catalog.ts` (12 pages in 4 groups), `appearance.ts` |
| Settings pages | `src/lib/settings/pages/` | One component per page, e.g. `EnginePage.svelte`, `ModelsPage.svelte`, `NetworkPage.svelte` |
| Transport, Tauri, and engine supervision | `src/lib/platform/` | `api.ts`, `runtime.ts` |
| Transcription and dictation | `src/lib/tools/transcription/`, `dictation/` | The matching `*Workspace.svelte` |
| Dubbing and audiobooks | `src/lib/tools/production/` | `ProductionWorkspace.svelte`, `production.ts` |
| Stories, automation, and audio processing | `src/lib/tools/stories/`, `automation/`, `audio-lab/` | Each has its own view and logic side by side |
| Shared tool layout | `src/lib/tools/` | `ToolWorkspace.svelte`, `studio-tools.ts` |
| Shared controls | `src/lib/ui/` | `Button.svelte`, `Select.svelte`, `overlay.ts` |
| Examples and demo data | `src/lib/gallery/` | `ControlGallery.svelte`, `tts-demo.ts` |
| Shared styles | `src/lib/styles/`, `src/styles.css` | `ui.css`, `typography.css`, `ui-colors.ts` |
| Palettes | `src/lib/themes/` | Kept as a separate folder |
| Shared types and time format | `src/lib/data.ts` | Existing voice, project, and recording contracts |
| Demo audio | `public/demo/interface-tone.wav` | Procedural tone (`scripts/dev/generate_demo_tone.py`); list in `docs/public-assets.json` |
| Native Windows app | `src-tauri/src/` | `main.rs`, `runtime.rs`, `installer.rs` |
| Backend adapter | `scripts/runtime/app/` | `launcher.py`, `model_management.py` |
| Environment installation | `scripts/runtime/install/` | `bootstrap.py`, `prepare.py` |
| Pinned sources and provenance | `scripts/runtime/vendor/` | `engine.zip`, `engine-provenance.json` |
| Engine archive rebuild | `scripts/build/` | `bundle.py` |
| Developer tools | `scripts/dev/` | `check-structure.mjs`, `publication_check.py`, `test-runtime.py`, `filemap/` (Rust file-tree scanner) |
| Standalone previews | `scripts/preview/` | `inline-preview.mjs`, `capture_screenshots.py` |
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
- `.tmp/` (including QA reports in `.tmp/qa/`), `dist/`, `src-tauri/target/` -
  ignored local artifacts.

Basic checks:

```powershell
npm run check
npm run build
npm run test:ui
npm run test:structure
node tests/frontend/tag-check.mjs
cargo check --manifest-path src-tauri/Cargo.toml
& "$env:LOCALAPPDATA/VoiceStudioNext/runtime/.venv/Scripts/python.exe" -B scripts/dev/test-runtime.py
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
7. Keep source files under 600 lines. `npm run test:structure` enforces it;
   a file that legitimately needs more (a translation or colour table) is
   listed with a reason in `scripts/dev/line-limit-exceptions.json`, and a
   listed file may not grow past its `max`.

## Scope of this reorganization

This changed where sources live and how they are found. `App.svelte` still
contains shared generation and draft-saving handling, and `production.ts` still
combines the shared production transport with dubbing and audiobook types.
Splitting those responsibilities, and `runtime.rs`, needs separate changes and
behavior tests; it is not a prerequisite for using the new folder layout.

Documentation: [index](../README.md), [context](kontekst-projektu.md),
[engine](runtime.md), [progress](../postep.md).
