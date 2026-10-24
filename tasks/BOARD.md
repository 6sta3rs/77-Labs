# Task board

The 31 tasks of the 22 October audit (implemented in 0.2.2) are in `audits/audit-2026-10-22.md` (the original findings, translated, in `audits/app-audit-2026-10-22.md`) with files and test steps; their open leftovers are T-0021 to T-0024.

The path from 6/10 to about 8/10 (T-0028 to T-0052 and the re-scoped older rows) is in `specs/ROADMAP-to-8.md`.

Last updated: 24 October 2026 (independent audit added T-0105 to T-0123). Source: the over-engineering audit reviewed by a three-model council (reports in the ignored `.tmp/qa/council/`), the project-structure review and `specs/ROADMAP-to-8.md`.

## Open and blocked

| ID | Title | Status | Next step | Evidence |
| --- | --- | --- | --- | --- |
| T-0008 | Decide on the broken voice-audit tools | blocked | Owner: keep or delete? `tools/preview/voice-audit-preview.mjs` and `voice-picker-preview.mjs` resolve `scripts/scripts/...` (does not exist), `voice-audit-build.mjs` has no runner. | |
| T-0009 | Decide on manual previews and the orb-music demo | blocked | Owner: delete `tools/preview/{audiobook,orb-product,tools-workspace}-preview*`, `orb-reactivity-gpu.html`, and `orb-demo.html` + `frontend/src/orb-music-demo.ts` + `frontend/src/OrbMusicDemo.svelte` + `tools/dev/generate_demo_music.py`? Keep `inline-preview`, `capture_screenshots`, `controls-preview`, the performance previews (documented or used). | nothing references the candidates |
| T-0013 | Create `prototypes/` | blocked | Deferred by `specs/ROADMAP-to-8.md`: needs a privacy review of what leaves `.tmp`, nothing depends on it. | |
| T-0014 | Clean `.tmp` | blocked | Owner confirms the delete list first (about 28k files, mostly repo copies, `*-dist`, a 2 GB cargo target). Keep `qa/`, `release/` and the pinned checkouts. | filemap map |
| T-0019 | Remove the local `refs/t3` | blocked | Owner: 273 local refs today (growing; the T3 tool recreates them), not four. Delete them (`git update-ref -d`), acceptance is zero refs matching `refs/t3/`. CI clones are already green. | `publication_check.py:236` |
| T-0021 | Codex bridge for AI functions (audit task A-02, target step) | blocked | `launcher.py` sets `VOICESTUDIO_LLM_AGENTS=["codex"]` and serves a local `/complete` through `codex exec` (like `ai_tagging.run_codex`). Needs a real ChatGPT login to test; the minimum step (message "ChatGPT account supports tagging only") is done. Steps in `audits/audit-2026-10-22.md`. | audit list |
| T-0022 | Check in the running app what was only checked in code | doing | Browser checks added in tests/e2e/english-and-ai.spec.mjs (A-09 migration, A-21, A-23, A-25, A-28 mechanism, A-06 button present). Still only code-checked: A-07, A-11 (needs a cold engine), A-13, A-18, A-22, the RAM switch of A-28. Evidence: .tmp/qa/T-0022/. | verification notes in `docs/progress.md` |
| T-0023 | Pixel comparison of the "Wydajność i limity" report with the prototype (A-31) | open | Screenshots at 1280 and 900 px next to `.tmp/settings-redesign/real/ustawienia-prototyp.html` (needs T-0013 first, the prototype lives in the ignored `.tmp`). | known limitation of 0.2.2 |
| T-0024 | Test the update from 0.2.1 to 0.2.2 | blocked | Partly verified against the real feed (reachable, asset identical to the local build, signature valid for the embedded key). The install step is blocked: this machine has a real installation of the same identifier; owner question and steps in `specs/T-0024-update-test.md`. Gate for T-0033. | `.tmp/qa/T-0024/` |
| T-0026 | Right-to-left layout | blocked | Only when the first RTL language is added: the stylesheets use physical left/right properties; `dir: 'rtl'` is already set on the document. | `docs/features/i18n.md` |
| T-0027 | Load language catalogs on demand | blocked | Only when more than about five languages exist (about 0.4 MB of text each, imported statically in `languages.ts`). | `docs/features/i18n.md` |
| T-0028 | Windows CI job (includes T-0010) | doing | Local gates pass (cargo check/test/clippy, test:ui, test:structure); the first green GitHub run is only possible after a push. Then T-0051 (owner) can make the jobs required. | council 23 Oct |
| T-0029 | Python runtime tests in CI | doing | Everything is built and passes locally (28 of 28 in a `.venv` with `requirements-ci.txt`, also on CPython 3.11). Open: the first green run of the Windows job on GitHub. | commits 5485461 |
| T-0030 | Playwright smoke and axe scan | doing | 11 browser tests pass locally. Open: the first green run of the Ubuntu job on GitHub; scans of dialogs and further pages (T-0044). | commits 64eb989, bc1e96d |
| T-0049 | Weekly EXE start check | doing | `tests/acceptance/exe_smoke.py` passes locally on the built EXE. Open: the first run of `exe-smoke.yml` on a Windows runner, then record `runnerSeconds` in `tests/acceptance/cold-start-baseline.json`. | commits 87beb6f |
| T-0031 | Release workflow on tag | doing | Workflows written (release.yml, verify-release.yml), gates and feed verification tested locally; the first real run needs the owner's one-time setup (environment, secrets, reviewers) and a push. See docs/publishing.md. |  |
| T-0033 | Updater key rotation, two-feed scheme | blocked | Owner. Design, steps and acceptance in `specs/T-0033-updater-key-rotation.md`; build script already takes `--feed`. Needs T-0024 (real install) first. | `build-update.mjs:15,26` |
| T-0037 | Free open-source code signing | blocked | Owner: apply to SignPath Foundation or Azure Trusted Signing (eligibility unverified), wire into `release.yml` if granted. | |
| T-0039 | Split large modules, ratchet limits | doing | Done: `runtime.rs` tests and the catalogue JSON split out, size and long-line ratchets (4eada9b, ebdd9b7). Open: shorten `App.svelte` long lines (needs the component split first), other long-line files, `installer.rs`/`dictation_desktop.rs`/`EnginePage.svelte` splits. |  |
| T-0046 | Bundle budget and lazy `en` | doing | Budget enforced (test:bundle). Lazy `en` and component lazy imports evaluated and NOT done: see docs/verification/performance.md. Needs the T-0039 component split. |  |
| T-0051 | Branch protection | blocked | Owner: required checks on `main` (Windows job, structure, publication), so the gates are not advisory. | |
| T-0053 | Stale page name in engine messages | open | Six user-facing messages still send the user to "Modele i silnik", a page that no longer exists (Settings → Silnik and Modele are separate pages): `desktop/src/runtime.rs:393`, `scripts/runtime/app/engine_catalogue_metadata.py:260`, `tts_catalog.py:67`, `tts_extensions.py:104,106,187`. `tts_catalog.py` is covered by the pinned catalogue hash in `engine_catalogue_metadata.py`, so the hash must be updated with it, and the English catalog keys must follow. Found in the T-0011 smoke run. | screenshot of Settings → Silnik in `.tmp/qa/T-0011/` |
| T-0107 | Installer: any provenance change invalidates a working environment | open | `installer.rs:336` compares the whole certificate. Compare only runtime-relevant fields, fall back to the previous pointer. | audit 24 Oct, code-verified |
| T-0109 | Installer: CUDA default without GPU preflight; disk size never shown | open | Detect NVIDIA (nvidia-smi/NVML) before the download, default CPU if absent; show the 20/35 GB requirement in the panel. | audit 24 Oct |
| T-0110 | Installer: activation drops `storage-location.json` and the model-cache pointer | open | `installer.rs:370-377`: copy the relocated-data pointer; read the active id without `validate_ready`. | audit 24 Oct |
| T-0111 | Installer: retries re-download everything, failed attempts leak disk | open | Shared build cache across candidates; "clean up failed attempts" action (`runtime_*`, `ssb-*`). | audit 24 Oct |
| T-0112 | Installer: proxy/cert env vars stripped, health probe may use system proxy | open | `clean_command` `env_clear()` drops `HTTP(S)_PROXY`, `SSL_CERT_FILE`; `probe_health` needs `ProxyHandler({})`. Proxy part unverified. | audit 24 Oct |
| T-0113 | Installer: smaller robustness items | open | Panic guard on the installer thread; single-instance guard; `activate` vs engine-start lock; cancel waits 2 s for a stdin it never reads; unbounded redirects; raw AV/access-denied errors; `prepare_tts.py` uses an unpinned PATH `uv`; dead `prepare.py`. | audit 24 Oct |
| T-0114 | Engine: bad data pointer or stale backup marker blocks start forever | open | `storage_settings.py:106-113,216`, `runtime_backup.py:182-213,251`, `launcher.py:310,317`: catch in `main()`, readable error, "use default data" / re-backup action. | audit 24 Oct, code-read |
| T-0115 | Engine: ownership token doubles as an authorization secret | open | `launcher.py:295`, `system_settings.py:237`, `activity.py:477`: separate never-echoed secret, `hmac.compare_digest`. Check what `/next/settings/media-tool` validates. | audit 24 Oct |
| T-0116 | Engine: finished download can be reported failed; delete leaves stale job | open | `model_management.py:355-372` (`wait(timeout=5)` after `complete`), `:454-486`. | audit 24 Oct |
| T-0117 | Engine: "clear temporary" deletes the live process TEMP; AI settings ignore DATA | open | `preview_cache.py:42-47` (use a dedicated cache folder, skip bad entries), `ai_tagging.py:96` (pass `DATA`). | audit 24 Oct |
| T-0118 | Engine: smaller items | open | Phantom "installing" state after a crash (`tts_extensions.py:307`); any 403 drops the remote session; corrupt `model-cache.json`/`environment` crashes startup; no GPU→CPU fallback or CUDA OOM cleanup (`tts_worker.py`); Fish health list → 500; backups copy tokens and are never pruned; unbounded `/generate` buffering; `audiobook_streaming.py:167` non-`data:` frame (unverified); fixed port reuse (unverified). | audit 24 Oct |
| T-0119 | Frontend: start-up card stuck after engine stops within 3 s; timer in live region | open | `EngineStartup.svelte` cleanup should reset `finished`/`seen`; `aria-hidden` on `.time`. | audit 24 Oct |
| T-0120 | Frontend: one bad stored run/recipe breaks Automation and watch-folder | open | `automation.ts` `initialize`: per-item try/catch, mark `failed`. Also `watch-folder.ts` `tick` stops on any exception; a changed file is queued twice. | audit 24 Oct |
| T-0121 | Watch folder opens sources with exclusive sharing | open | `watch_folder.rs:123,230`: use `FILE_SHARE_READ \| FILE_SHARE_WRITE` for the probe. | audit 24 Oct |
| T-0122 | Projects: no delete, no cap, empty projects saved, repeating save toast | open | `App.svelte:175-177,413-415`: skip empty, add delete/trim, throttle toast, restore from `.backup`; one `null` row drops all. Also `importText` size limit, `importAudio` try/catch, search ignores English labels, `loadRecordings` race. | audit 24 Oct |
| T-0123 | Tauri hardening | open | Minimal capability for `dictation-widget` (no updater/restart); CSP add `base-uri 'none'; form-action 'none'; object-src 'none'`; flush the project save on window close; stale "185 s" comment in `api.ts`. | audit 24 Oct |

## Done

| ID | Title | Commit |
| --- | --- | --- |
| T-0105 | Installer: activation blocked after a failed engine start | HASH |
| T-0106 | Installer: real failure reason replaced by "Etap failed zakończył się kodem…" | HASH |
| T-0108 | Environments tab shows green "Aktywne" when no environment exists | HASH |
| T-0100 | `filemap` Rust file-tree scanner | c367daa |
| T-0101 | 600-line limit with an exceptions list | 9a8cd6f |
| T-0018 | Commit the pending working tree (the three untracked tests are in git, `test:ui` no longer depends on untracked files) | 71043fc, c111710 |
| T-0103 | CI: Playwright browser install hung for 25 min | done | Install without `--with-deps`, step and job timeouts; runner install took 10 s. | 8c290a9 |
| T-0104 | Engine start card closed and reopened before the model warm-up | done | One card from engine start to model ready; checked with a mocked engine, not yet in the EXE. | see progress |
| T-0102 | Audits: ponytail, knip and the three-model council review of the ponytail report (score 5/10) | no code change |
| T-0001 | Remove dead exports | 5fc91bb |
| T-0003 | `hashlib.file_digest` in bootstrap | 44b59fa |
| T-0004 | Rename one `durationLabel` | 4192e04 |
| T-0005 | Delete orphan fixtures and one-off script | 4d7a63b |
| T-0006 | One helper for the legacy kittentts check | bd68b4f |
| T-0016 | Share `no_links` with a message parameter | 1530c99 |
| T-0020 | Add `postcss` to devDependencies | 2479c91 |
| T-0035 | Dev origins out of production | dce08fc |
| T-0002 | Fix stale paths in docs | ebdc9a7 |
| T-0007 | Triage the 36 checks that never run | 87cf207 |
| T-0010 | Run `test:structure` in CI | f79cbaf |
| T-0012 | Create `tools/` with an index of what each tool is for | 887fa1e |
| T-0015 | English names for docs | bf62bdb |
| T-0017 | Move the audit and task lists out of `.tmp/qa` | 8948226 |
| T-0011 | `frontend/src/` and `desktop/` instead of `src/lib/` and `src-tauri/` | a800b78 |
| T-0032 | Release guards | b7de7c2 |
| T-0050 | Engine analytics kill switch and privacy doc | efd5fea |
| T-0034 | Supply-chain hygiene | c207430 |
| T-0038 | `check-structure` rules | 8d5a1b0 |
| T-0040 | Silent-error rule | 96db58d |
| T-0048 | Launcher contract test | 5383cc6 |
| T-0052 | Coverage baselines | 3295c79, 3251508 |
| T-0044 | Accessibility fixes (the scan found one issue; dialogs and more pages are not scanned) | 64eb989 |
| T-0047 | Cold-start baseline and busy port | 87beb6f |
| T-0042 | Generated numbers, CHANGELOG, CONTRIBUTING | d014260, 81c21ef |
| T-0025 | Locale-aware formatting and plurals for new languages | 017107a |
| T-0036 | Security docs | 33539c5 |

## Rejected (do not propose again without new evidence)

| ID | Proposal | Why |
| --- | --- | --- |
| R-1 | Delete 68 "source-text" tests in `tests/frontend` | About 5 are pure source-text, the rest compile and run code; it would also remove `tag-check` that `AGENTS.md` requires. |
| R-2 | Replace `filemap` with `git ls-files` | `filemap` also lists ignored files such as `.tmp` and writes the HTML views. |
| R-3 | One static worker template in `tts_extensions.py` | The pinned engine gives no per-engine env or argument hook; the generated file is 6 lines. |
| R-4 | Simplify `tools/dev/ai-dev.ts` | The port search and proxy order are there on purpose; dev-only, low value. |
| R-5 | One i18n table per language | Breaks the 600-line rule; the split exists because of it. |
| R-6 | Import `byteLabel` in `download-eta.ts` | The injected formatter is the test seam (the test loads the module from a `data:` URL). |
| R-7 | Merge the three `clamp` functions | They are three different functions. |
| R-8 | Fold `remote-state.ts` into `remote-backend.ts` | It prevents an import cycle (api, remote-backend, production). Only the re-export can go. |
