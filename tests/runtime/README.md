# Python checks

`tests/manifest-python.json` lists every Python file under `tests/runtime/` and `tests/frontend/` and says whether CI runs it. `python tools/dev/run_runtime_tests.py` runs the `ci` group (one process per file) and fails when a file is missing from the manifest, so a new test is never skipped by accident. CI installs `requirements-ci.txt` (no torch, no engine) in a virtual environment and runs the group on Windows, then `ruff check .` with the small rule set in `ruff.toml`.

Measured on 23 October 2026 on Windows with CPython 3.12 (27 pass, one command, about 90 s). The CI image uses CPython 3.11 and was not run there yet. `tools/dev/test_runtime.py` runs every `tests/runtime/test_*.py` with the real private runtime and the extracted engine; use it before changing the engine adapters.

| File | Group | Why |
| --- | --- | --- |
| `tests/runtime/test_acceptance_guards.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_ai_tagging.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_analytics_switch.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_audio_cpp_acceptance.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_bootstrap.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_completeness.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_engine_bundle.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_engine_catalogue_metadata.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_engine_installation.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_integration_settings.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_launcher_contract.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_license_onboarding_fixture.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_model_onboarding.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_native_publication.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_preview_cache.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_private_tts_identity.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_publication_check.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_release_cpu_smoke.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_remote_backend.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_runtime_backup.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_storage_settings.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_tts_extensions.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_watch_folder_acceptance.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/activity_check.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/runtime_stop_check.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/watchdog_check.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/frontend/test_audit_upstream.py` | CI | passes in a Windows venv with `requirements-ci.txt` (CPython 3.12 here and 3.11; not yet run on a GitHub runner) |
| `tests/runtime/test_general_settings.py` | needs-engine | imports the engine's torch-based modules |
| `tests/runtime/test_system_settings.py` | needs-engine | takes --engine <extracted engine.zip>, needs torch and PyYAML |
| `tests/runtime/test_tts_registry.py` | needs-engine | imports torch |
| `tests/runtime/test_model_management.py` | needs-runtime | 13 of 14 tests pass on a runner; one needs the real private-runtime layout (.venv and engine/backend/core/contained_subprocess.py) |
| `tests/runtime/test_windows_runtime_paths.py` | needs-runtime | needs the private runtime .venv with the mcp package |
| `tests/runtime/bootstrap_docopt_regression.py` | manual | builds docopt on Windows with explicit arguments, never installs the runtime |
| `tests/runtime/license_onboarding_ui_check.py` | manual | browser acceptance, needs Playwright/Chromium and a built dist |
| `tests/frontend/speech_settings_backend_check.py` | manual | reads a path outside the repository that this checkout does not have |
| `tests/frontend/audit_upstream.py` | helper | the upstream audit module that test_audit_upstream.py loads; not a test |
| `tests/runtime/test_audiobook_streaming.py` | needs-ffmpeg | 2 of 5 tests need a real ffmpeg, which the GitHub Windows runner does not have (found on the first runner run) |
