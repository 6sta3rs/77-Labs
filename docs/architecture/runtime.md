# Local engine

The Seventy Seven Labs engine runs as a supervised Python/FastAPI process at `127.0.0.1:4312`. The EXE includes its pinned backend code and local adapters; Python/GPU libraries and weights are installed separately. The repository does not supply ready-made voice profiles, a private database, or accepted model terms. [Third-party notices](../../THIRD_PARTY_NOTICES.md) record imported source identities, versions, authors, and licenses.

## First launch

1. Run `npm run desktop:dev` or the built EXE.
2. Under **Ustawienia → Silnik → Środowiska → Samodzielne środowisko Python** (Settings → Engine → Environments → Standalone Python environment), choose CPU or a compatible NVIDIA CUDA configuration.
3. Wait for the download and actual candidate validation, then activate the ready environment.
4. Read the selected model's terms and download its weights separately.
5. Add your own profile from a recording you have permission to use, then test a short utterance in the UI.

See the [full installation guide](../features/runtime-installation.md). Installed libraries or weights do not prove inference works. Clean Windows installation and CUDA variants require separate acceptance tests.

## Directories and isolation

Data defaults to `%LOCALAPPDATA%/VoiceStudioNext`. `data/` contains the database, voices, output, and configuration; `runtime/` and `runtime_<id>/` contain environments. `active-runtime.json` points to the selected environment. Source generations and pinned ZIPs are stored in runtime directories.

Read data and model locations from settings. Optional `VOICESTUDIO_NEXT_PYTHON` selects an explicit interpreter and takes precedence over the activated environment; disable this override when testing activation.

The launcher creates a consistent backup before migration. Compatibility import may open the old OmniVoice database read-only and copy profiles into the new directory. This is not a full project/history migration. Do not modify hardlinked libraries or models in place. See [backups](../features/runtime-backups.md).

## Supervision

The window starts without Python and the app then starts the engine itself unless **Ustawienia → Silnik → Uruchamianie i pamięć → „Uruchamiaj silnik przy starcie aplikacji”** (Settings → Engine → Startup and memory → start the engine when the app opens) is off; an operation that needs the engine starts it too, for example after an idle stop or when autostart is off. The autostart flag (`voicestudio.engineAutostart`, default on) is read once at launch by `App.svelte`, so a change applies from the next launch. The owned process, whose marker is checked in the health response. An unrelated server is not taken over. Startup and backup have bounded waits and report actual progress. Stop terminates only owned processes; automatic shutdown requires confirmed inactivity for the time chosen in **… → „Utrzymuj silnik i model po bezczynności”** (keep the engine and model after inactivity): 5, 15, 30 or 60 minutes (default 15) or **Zawsze** (always), via `runtime_set_idle_minutes` (0 = always: the idle budget never elapses, so the supervisor never stops the engine for inactivity; a manual Stop still works). The choice is also written to the engine (`PUT /next/settings/model-idle`, preference `idle_timeout_seconds`, which the engine's own model idle clock reads every 30 s; „Zawsze” is stored as ten years). Rust sends it in the background whenever the engine becomes ready and whenever the choice changes while it runs, so a choice made while the engine was stopped also takes effect. An `OMNIVOICE_IDLE_TIMEOUT_S` environment pin still wins on the engine side (the route reports `env_pinned`). „Zawsze” keeps the voice model resident (about 1.9 GB of GPU memory); the page warns when it is combined with „Przenieś model do RAM po generowaniu”.

Catalog GET requests use lightweight metadata. Explicit verification and synthesis perform the actual availability checks. Catalog and health responses do not prove a model works. `GET /api/settings/gpu-report` is answered the same way: inside that request `list_backends()` of the TTS and ASR modules returns the declarations (dependency presence plus the pure `routing_fields` host arithmetic) instead of importing every adapter cold, so the report describes hardware suitability only and says nothing about whether an engine runs. The UI states this under the report, and the status read has a 120 s limit (the other status reads keep 15 s).

Vite proxies `/backend` to port 4312, but the browser does not start the Tauri supervisor. Use `/?demo=tts` without models.

## Startup, stop and diagnostics

- At launch the app starts the engine (unless autostart is off) and, because Rust sets `VOICESTUDIO_NEXT_PRELOAD_TTS` to `1` by default (the gate patched into the pinned `main.py` by `launcher.py`), the engine warms the TTS model in the background; warm-up is skipped silently when the model terms are not accepted or no weights are installed. **„Ładuj model głosowy do pamięci po uruchomieniu”** (load the voice model into memory at startup) sets the flag to `0` instead: the frontend stores `voicestudio.enginePreload` (default on) and applies it once per session through `runtime_set_preload` before the engine is spawned (Rust reads it per spawn, so it applies to the next start). The switch is shown disabled while autostart is off. Memory use is the cost: the model stays resident until the engine's own model idle timeout (the idle choice above, 900 s by default) or a stop.
- **„Załaduj model teraz”** (load the model now) calls `POST /next/settings/model-preload`, which starts the engine's own `model_manager.preload_model()` as a tracked asyncio task and returns the `/model/status` payload plus `running`. The task is counted as work by `activity.backend_work_busy()` (`system_settings.preload_busy()`), so the idle monitor cannot stop the engine mid-load; progress is read from `/model/status` (a monitor read). Like the startup warm-up, it silently skips when the licence is not accepted or the weights are missing; the page then says so after two idle polls.
- The route lives under `/next/settings` (not `/next/model`) because FastAPI applies a router's prefix to its own routes only; nesting a second router is version dependent.
- Progress shown by the card in `frontend/src/platform/EngineStartup.svelte` is real: `launcher.py` writes `NEXT_STARTUP_EVENT {"stage":…}` lines to `engine.log` (`engine_files`, `backup`, `modules`, `server`), Rust adds the engine's own `/startup/progress` step (`env_prefs` … `services_start`) to `RuntimeStatus.startup.stage` (stages only move forward), and after `/health` the UI follows `/model/status`. Remaining time is not estimated; the card shows elapsed time.
- Cold start may take up to 300 s (`STARTUP_BUDGET`) when libraries and weights load from a slow or external disk. A graceful stop closes stdin and waits up to 15 s (3 s while still starting) before ending only the owned process tree; a ready engine that stops answering for 90 s can be stopped manually, never automatically.
- An interrupted mutating request without a tracked job keeps the engine awake for 30 minutes (`UNCERTAIN_WORK_WINDOW_S`), not until restart.
- If the model folder from `OMNIVOICE_CACHE_DIR` is missing (for example an unplugged external drive), synthesis requests get an immediate 503 with a readable message instead of an obscure model-load error.
- `POST /generate` forms are checked before the engine: empty text returns 422 and an unknown `profile_id` returns 404 (the engine would otherwise synthesize silence or a random voice). Valid forms are replayed unchanged.
- The launcher keeps a private bytecode cache under the runtime directory (`PYTHONPYCACHEPREFIX`) and points `IMAGEIO_FFMPEG_EXE` at the bundled ffmpeg to avoid a slow, unbounded probe. Every synthesis request logs a `[next-diag]` line with duration, VRAM and RAM before/after in `engine.log`.
- `tests/acceptance/engine_benchmark.py <label>` measures a real cold start, generations and stop the way the EXE starts the engine and writes `.tmp/qa/engine-benchmark-<label>.json`.

## File map

| Responsibility | File |
| --- | --- |
| Supervision and IPC | `desktop/src/runtime.rs`, `frontend/src/platform/runtime.ts` |
| Installation and doctor | `scripts/runtime/install/bootstrap.py`, `desktop/src/installer.rs` |
| Startup and adapters | `scripts/runtime/app/launcher.py` |
| Request activity, idle safety, input guards | `scripts/runtime/app/activity.py` |
| Lightweight metadata | `scripts/runtime/app/engine_catalogue_metadata.py` |
| Weights and downloads | `scripts/runtime/app/model_management.py` |
| Source provenance | `scripts/runtime/vendor/engine-provenance.json`, `tools/release/bundle.py` |

## Verification

`cargo check --manifest-path desktop/Cargo.toml` checks Rust code. `tests/acceptance/smoke.py` checks start/health/stop, not generation. `tests/acceptance/qa_session.py` starts a disposable backend with local weights; `production_acceptance.py` and `tools_acceptance.py` then exercise real inference and the built-in tools against it. Speech tests require an explicitly chosen profile or reference. Write results to ignored `.tmp/qa`.

The demo tone is for player and UI tests, not cloning or valid speech in ASR. Full acceptance requires short UI synthesis, playback, save/reload, stop, and port release. Dubbing, audiobooks, and hardware configurations need separate tests. Preparing the public release did not involve new inference or weight downloads.

## Development origins

The Vite dev server origin (`http://127.0.0.1:4310`, `http://localhost:4310`) is trusted by the engine only when `VOICESTUDIO_DEV_ORIGINS=1`. The Rust supervisor sets it in debug builds (`tauri dev`) and sets `0` in release builds; `tools/dev/ai-dev.ts` sets it for its own adapter. The per-run token is a marker, not an access control (it is echoed on every response), so production safety rests on the origin allow-lists in `launcher.py`, `ai_tagging.py`, `remote_backend.py` and `integration_settings.py`.
