# Coverage baselines

Measured on 23 October 2026 on Windows (CPython 3.12, Rust 1.97.1), to see where the tests are thin. There is no threshold and no CI gate yet; the numbers say how much of the code the existing checks execute, not how well it is tested.

## Python runtime (`scripts/runtime/app` and `install`)

The 28 engine-free checks of `tests/manifest-python.json` (see `tests/runtime/README.md`), each run under `coverage`, then combined:

| Measure | Value |
| --- | --- |
| Statements | 5,845 |
| Missed | 1,940 |
| Covered | **67%** |

Best covered: `preview_cache` 96%, `tts_catalog` 96%, `audiobook_streaming` 95%, `private_environment` 94%, `engine_catalogue_metadata` 91%, `activity` 90%. Weakest: `general_settings`, `system_settings` and `prepare` 0% (their tests need the engine or the private runtime and are not in the CI group), `windows_runtime_paths` 29%, `tts_worker` 34%, `prepare_tts` 40%, `ai_tagging` 45%, `tts_extensions` 47%, `model_management` 49%.

Reproduce: in a virtual environment with `requirements-ci.txt` and `coverage`, run each `ci` file of the manifest as `python -m coverage run -p --data-file=<dir>/.coverage --source=scripts/runtime tests/<file>`, then `coverage combine --data-file=<dir>/.coverage <dir>` and `coverage report`.

## Rust (`desktop/src`)

`cargo llvm-cov --manifest-path desktop/Cargo.toml --locked --summary-only` (51 tests, 2 ignored):

| Measure | Value |
| --- | --- |
| Lines | 2,746 (1,610 missed), **41.4%** covered |
| Functions | 549 (387 missed), 29.5% executed |

By file (lines): `license_sources.rs` 77%, `watch_folder.rs` 58%, `installer.rs` 57%, `runtime.rs` 47%, `settings_native.rs` 39%, `dictation_desktop.rs` 17%, `library.rs` 12%, `main.rs` 0%. The dictation, library and window code is exercised only by the acceptance scripts and by hand.

Needs `cargo install cargo-llvm-cov --locked` and the `llvm-tools-preview` component of the pinned toolchain.

## Not measured

The Svelte/TypeScript frontend (its checks mostly compile and run single modules, so line coverage would be misleading) and everything under `tests/acceptance`.
