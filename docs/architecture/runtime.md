# Local engine

The Seventy Seven Labs engine runs as a supervised Python/FastAPI process at `127.0.0.1:4312`. The EXE includes its pinned backend code and local adapters; Python/GPU libraries and weights are installed separately. The repository does not supply ready-made voice profiles, a private database, or accepted model terms. [Third-party notices](../../THIRD_PARTY_NOTICES.md) record imported source identities, versions, authors, and licenses.

## First launch

1. Run `npm run desktop:dev` or the built EXE.
2. Under **Ustawienia → Silnik → Środowiska → Samodzielne środowisko Python** (Settings → Engine → Environments → Standalone Python environment), choose CPU or a compatible NVIDIA CUDA configuration.
3. Wait for the download and actual candidate validation, then activate the ready environment.
4. Read the selected model's terms and download its weights separately.
5. Add your own profile from a recording you have permission to use, then test a short utterance in the UI.

See the [full installation guide](../features/instalacja-runtime.md). Installed libraries or weights do not prove inference works. Clean Windows installation and CUDA variants require separate acceptance tests.

## Directories and isolation

Data defaults to `%LOCALAPPDATA%/VoiceStudioNext`. `data/` contains the database, voices, output, and configuration; `runtime/` and `runtime_<id>/` contain environments. `active-runtime.json` points to the selected environment. Source generations and pinned ZIPs are stored in runtime directories.

Read data and model locations from settings. Optional `VOICESTUDIO_NEXT_PYTHON` selects an explicit interpreter and takes precedence over the activated environment; disable this override when testing activation.

The launcher creates a consistent backup before migration. Compatibility import may open the old OmniVoice database read-only and copy profiles into the new directory. This is not a full project/history migration. Do not modify hardlinked libraries or models in place. See [backups](../features/kopie-danych-runtime.md).

## Supervision

The window starts without Python. An operation that needs the engine starts an owned process, whose marker is checked in the health response. An unrelated server is not taken over. Startup and backup have bounded waits and report actual progress. Stop terminates only owned processes; automatic shutdown requires confirmed inactivity for the time chosen in **Ustawienia → Silnik → Stan → „Utrzymuj silnik po bezczynności”** (Settings → Engine → Status → keep the engine after inactivity): 5, 15, 30 or 60 minutes, default 15 (`runtime_set_idle_minutes`).

Catalog GET requests use lightweight metadata. Explicit verification and synthesis perform the actual availability checks. Catalog and health responses do not prove a model works.

Vite proxies `/backend` to port 4312, but the browser does not start the Tauri supervisor. Use `/?demo=tts` without models.

## Startup, stop and diagnostics

- Cold start may take up to 300 s (`STARTUP_BUDGET`) when libraries and weights load from a slow or external disk. A graceful stop closes stdin and waits up to 15 s (3 s while still starting) before ending only the owned process tree; a ready engine that stops answering for 90 s can be stopped manually, never automatically.
- An interrupted mutating request without a tracked job keeps the engine awake for 30 minutes (`UNCERTAIN_WORK_WINDOW_S`), not until restart.
- If the model folder from `OMNIVOICE_CACHE_DIR` is missing (for example an unplugged external drive), synthesis requests get an immediate 503 with a readable message instead of an obscure model-load error.
- `POST /generate` forms are checked before the engine: empty text returns 422 and an unknown `profile_id` returns 404 (the engine would otherwise synthesize silence or a random voice). Valid forms are replayed unchanged.
- The launcher keeps a private bytecode cache under the runtime directory (`PYTHONPYCACHEPREFIX`) and points `IMAGEIO_FFMPEG_EXE` at the bundled ffmpeg to avoid a slow, unbounded probe. Every synthesis request logs a `[next-diag]` line with duration, VRAM and RAM before/after in `engine.log`.
- `tests/acceptance/engine_benchmark.py <label>` measures a real cold start, generations and stop the way the EXE starts the engine and writes `.tmp/qa/engine-benchmark-<label>.json`.

## File map

| Responsibility | File |
| --- | --- |
| Supervision and IPC | `src-tauri/src/runtime.rs`, `src/lib/platform/runtime.ts` |
| Installation and doctor | `scripts/runtime/install/bootstrap.py`, `src-tauri/src/installer.rs` |
| Startup and adapters | `scripts/runtime/app/launcher.py` |
| Request activity, idle safety, input guards | `scripts/runtime/app/activity.py` |
| Lightweight metadata | `scripts/runtime/app/engine_catalogue_metadata.py` |
| Weights and downloads | `scripts/runtime/app/model_management.py` |
| Source provenance | `scripts/runtime/vendor/engine-provenance.json`, `scripts/build/bundle.py` |

## Verification

`cargo check --manifest-path src-tauri/Cargo.toml` checks Rust code. `tests/acceptance/smoke.py` checks start/health/stop, not generation. `tests/acceptance/qa_session.py` starts a disposable backend with local weights; `production_acceptance.py` and `tools_acceptance.py` then exercise real inference and the built-in tools against it. Speech tests require an explicitly chosen profile or reference. Write results to ignored `.tmp/qa`.

The demo tone is for player and UI tests, not cloning or valid speech in ASR. Full acceptance requires short UI synthesis, playback, save/reload, stop, and port release. Dubbing, audiobooks, and hardware configurations need separate tests. Preparing the public release did not involve new inference or weight downloads.
