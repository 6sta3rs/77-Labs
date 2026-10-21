# Local engine

Seventy Seven Labs supervises its own Python/FastAPI process at `127.0.0.1:4312`. The EXE includes VoiceStudio 0.5.7 code; Python/GPU libraries and weights are installed separately. The repository does not supply ready-made voice profiles, a private database, or accepted model terms.

## First launch

1. Run `npm run desktop:dev` or the built EXE.
2. Under **Ustawienia → Modele i silnik → Samodzielne środowisko Python** (Settings → Models and engine → Standalone Python environment), choose CPU or a compatible NVIDIA CUDA configuration.
3. Wait for the download and actual candidate validation, then activate the ready environment.
4. Read the selected model's terms and download its weights separately.
5. Add your own profile from a recording you have permission to use, then test a short utterance in the UI.

See the [full installation guide](instalacja-runtime.md). Installed libraries or weights do not prove inference works. Clean Windows installation and CUDA variants require separate acceptance tests.

## Directories and isolation

Data defaults to `%LOCALAPPDATA%/VoiceStudioNext`. `data/` contains the database, voices, output, and configuration; `runtime/` and `runtime_<id>/` contain environments. `active-runtime.json` points to the selected environment. Source generations and pinned ZIPs are stored in runtime directories.

Read data and model locations from settings. Optional `VOICESTUDIO_NEXT_PYTHON` selects an explicit interpreter and takes precedence over the activated environment; disable this override when testing activation.

The launcher creates a consistent backup before migration. Compatibility import may open the old OmniVoice database read-only and copy profiles into the new directory. This is not a full project/history migration. Do not modify hardlinked libraries or models in place. See [backups](kopie-danych-runtime.md).

## Supervision

The window starts without Python. An operation that needs the engine starts an owned process, whose marker is checked in the health response. An unrelated server is not taken over. Startup and backup have bounded waits and report actual progress. Stop terminates only owned processes; automatic shutdown requires five minutes of confirmed inactivity.

Catalog GET requests use lightweight metadata. Explicit verification and synthesis perform the actual availability checks. Catalog and health responses do not prove a model works.

Vite proxies `/backend` to port 4312, but the browser does not start the Tauri supervisor. Use `/?demo=tts` without models.

## File map

| Responsibility | File |
| --- | --- |
| Supervision and IPC | `src-tauri/src/runtime.rs`, `src/lib/runtime.ts` |
| Installation and doctor | `scripts/runtime/bootstrap.py`, `src-tauri/src/installer.rs` |
| Startup and adapters | `scripts/runtime/launcher.py` |
| Lightweight metadata | `scripts/runtime/engine_catalogue_metadata.py` |
| Weights and downloads | `scripts/runtime/model_management.py` |
| Source provenance | `scripts/runtime/engine-provenance.json`, `scripts/runtime/bundle.py` |

## Verification

`cargo check --manifest-path src-tauri/Cargo.toml` checks Rust code. `scripts/runtime/smoke.py` checks start/health/stop, not generation. Speech tests require an explicitly chosen profile or reference. Write results to ignored `.tmp/qa`.

The demo tone is for player and UI tests, not cloning or valid speech in ASR. Full acceptance requires short UI synthesis, playback, save/reload, stop, and port release. Dubbing, audiobooks, and hardware configurations need separate tests. Preparing the public release did not involve new inference or weight downloads.
