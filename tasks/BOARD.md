# Task board

The 31 tasks of the 22 October audit (implemented in 0.2.2) are in `audit-2026-10-22.md` with files and test steps; their open leftovers are T-0021 to T-0024.

The path from 6/10 to about 8/10 (T-0028 to T-0052 and the re-scoped older rows) is in `specs/ROADMAP-to-8.md`.

Last updated: 23 October 2026. Source: the over-engineering audit reviewed by a three-model council (reports in the ignored `.tmp/qa/council/`) and the project-structure review.

## Open and blocked

| ID | Title | Status | Next step | Evidence |
| --- | --- | --- | --- | --- |
| T-0001 | Remove dead exports | open | Delete or un-export `BUILT_IN_THEMES`, `BuiltInThemeId`, `MobileThemeId`, `UNPUBLISHABLE_THEME_IDS`, `MOBILE_THEME_IDS`, `MOBILE_DEFAULT_THEME_ID` (t3-palettes.ts), `systemSectionTitles`, `sharingLinks` (system-settings.ts), `remoteProxyPath`, `remoteSocketUrl` (remote-backend.ts), `initialText` (data.ts), `downloadLabels` (model-management.ts). Then `npm run check`, `npm run build`, `npm run test:ui`. | git grep: each name appears only in its own file |
| T-0002 | Fix stale paths in docs | open | `docs/features/podglad-kontrolek.md:26` and `docs/verification/weryfikacja.md:38` cite `scripts/controls-preview.mjs`; the file is `scripts/preview/controls-preview.mjs`. Make `test:structure` also check backticked `scripts/...` paths. | file does not exist at the old path |
| T-0003 | `hashlib.file_digest` in bootstrap | open | Replace the hand-written chunked hash in `scripts/runtime/install/bootstrap.py` (`sha256`, lines 48-54); `launcher.py` and `engine_installation.py` already use it, bootstrap runs under CPython 3.11. | |
| T-0004 | Rename one `durationLabel` | open | `src/lib/data.ts` and `src/lib/settings/system-settings.ts` export the same name with different output; rename one after its format. | |
| T-0005 | Delete orphan fixtures and one-off script | open | Remove `tests/fixtures/ui-style-fixes.svelte`, `tests/fixtures/button-system-audit.svelte` (no references; keep `voice-picker-audit.svelte`, it is used) and `scripts/dev/i18n-svelte.mjs` (only mentioned in `docs/postep.md:194`, update that note). | |
| T-0006 | One helper for the legacy kittentts check | open | `engine_id == "kittentts" and not environment_python(...).is_file()` is repeated at `tts_extensions.py` lines 145, 159, 187, 227. Extract it; run `tests/runtime`. | |
| T-0007 | Triage the 36 checks that never run | open | See `specs/T-0007-unrun-checks.md`. Only after it, replace the `&&` chain in `test:ui` with a loop. | 36 of 69 `tests/frontend/*-check.mjs` are in no npm script; CI runs only `npm run test:ui` |
| T-0008 | Decide on the broken voice-audit tools | blocked | Owner: keep or delete? `scripts/preview/voice-audit-preview.mjs` and `voice-picker-preview.mjs` resolve `scripts/scripts/...` (does not exist), `voice-audit-build.mjs` has no runner. | |
| T-0009 | Decide on manual previews and the orb-music demo | blocked | Owner: delete `scripts/preview/{audiobook,orb-product,tools-workspace}-preview*`, `orb-reactivity-gpu.html`, and `orb-demo.html` + `src/orb-music-demo.ts` + `src/OrbMusicDemo.svelte` + `scripts/dev/generate_demo_music.py`? Keep `inline-preview`, `capture_screenshots`, `controls-preview`, the performance previews (documented or used). | nothing references the candidates |
| T-0010 | Run `test:structure` in CI | open | Merged into T-0028 (Windows CI job); do the one-line step first. | |
| T-0011 | `frontend/src/` and `desktop/` instead of `src/lib/` and `src-tauri/` | open | Decided layout and blast radius in `specs/T-0011-rename-src-folders.md` (sources up from `src/lib`, UI config into `frontend/`, `package.json` stays in the root). Still needs a full `tauri build` proof on the new layout. |
| T-0012 | Create `tools/` with an index of what each tool is for | open | See `specs/T-0012-tools-folder.md`. | |
| T-0013 | Create `prototypes/` | blocked | Deferred by `specs/ROADMAP-to-8.md`: needs a privacy review of what leaves `.tmp`, nothing depends on it. | |
| T-0014 | Clean `.tmp` | blocked | Owner confirms the delete list first (about 28k files, mostly repo copies, `*-dist`, a 2 GB cargo target). Keep `qa/`, `release/` and the pinned checkouts. | filemap map |
| T-0015 | English names for docs | open | `postep.md` to `progress.md`, `uwagi-ui.md` to `ui-feedback.md`, `kontekst-projektu.md` to `project-context.md`, `struktura-projektu.md` to `project-structure.md`; update all links; `npm run test:structure`. | `docs/README.md` says docs are English |
| T-0016 | Share `no_links` with a message parameter | open | `watch_folder.rs` and `installer.rs` have the same loop but differ on unreadable or missing ancestors and in messages. Use the stricter behaviour; `cargo check`. | |
| T-0017 | Move the audit and task lists out of `.tmp/qa` | open | Review `.tmp/qa/zadania-audyt-2026-10-22.md` and `audyt-aplikacji-2026-10-22.md` for private data, then add them to `tasks/audits/` in English or as a summary. | |
| T-0019 | Remove the local `refs/t3` | blocked | Owner: 273 local refs today (growing; the T3 tool recreates them), not four. Delete them (`git update-ref -d`), acceptance is zero refs matching `refs/t3/`. CI clones are already green. | `publication_check.py:236` |
| T-0020 | Add `postcss` to devDependencies | open | `tests/frontend/ui-colors-check.mjs` imports it, only a transitive dependency provides it (knip). | |
| T-0021 | Codex bridge for AI functions (audit task A-02, target step) | blocked | `launcher.py` sets `VOICESTUDIO_LLM_AGENTS=["codex"]` and serves a local `/complete` through `codex exec` (like `ai_tagging.run_codex`). Needs a real ChatGPT login to test; the minimum step (message "ChatGPT account supports tagging only") is done. Steps in `audit-2026-10-22.md`. | audit list |
| T-0022 | Check in the running app what was only checked in code | open | A-06, A-07, A-09 (incl. migration of `voicestudio.ai.providers.v1`), A-11, A-13, A-18, A-21, A-22 and the English window for A-23, A-25, A-28 ("Zapisano" in English). Steps per task in `audit-2026-10-22.md`; evidence into `.tmp/qa/T-0022/`. | verification notes in `docs/postep.md` |
| T-0023 | Pixel comparison of the "Wydajność i limity" report with the prototype (A-31) | open | Screenshots at 1280 and 900 px next to `.tmp/settings-redesign/real/ustawienia-prototyp.html` (needs T-0013 first, the prototype lives in the ignored `.tmp`). | known limitation of 0.2.2 |
| T-0024 | Test the update from 0.2.1 to 0.2.2 | open | Install 0.2.1 (installer in the ignored `.tmp/release/v0.2.1`, the tag `v0.2.1` does not exist) on isolated data and update from the REAL GitHub feed (0.2.2 is current). A local feed is unreachable: the endpoint is fixed at build time (`build-update.mjs:15,26`). Gate for T-0033. | `docs/postep.md` (0.2.2) |
| T-0025 | Locale-aware formatting and plurals for new languages | open | 32 fixed Polish locale uses outside `i18n/` (display formatting, `Intl.DisplayNames('pl')`, `'pl-PL'` defaults, `toLocaleLowerCase('pl')`); a test with an allow-list for `languages.ts` and `i18n/index.ts`; `Intl.PluralRules` plurals. Size M-L. See `docs/features/i18n.md`. | i18n audit |
| T-0026 | Right-to-left layout | blocked | Only when the first RTL language is added: the stylesheets use physical left/right properties; `dir: 'rtl'` is already set on the document. | `docs/features/i18n.md` |
| T-0027 | Load language catalogs on demand | blocked | Only when more than about five languages exist (about 0.4 MB of text each, imported statically in `languages.ts`). | `docs/features/i18n.md` |
| T-0028 | Windows CI job (includes T-0010) | open | `npm ci && npm run build` first, rust-cache, `cargo check --locked`, `cargo test` (52 tests; skip the two interactive `#[cfg(windows)]` tests in `dictation_desktop.rs`), `test:structure`, `concurrency`, a path-filtered `tauri build --no-bundle` proof job, clippy fix-up then gate; fix path portability of the UI checks first. See `specs/ROADMAP-to-8.md`. | council 23 Oct |
| T-0029 | Python runtime tests in CI | open | After T-0012: the 27-module table first (CI / Windows-only / needs engine), then `requirements-ci.txt` with only what the tests import, the green subset gated, a manifest failing on unlisted files, then `ruff`. | `specs/ROADMAP-to-8.md` |
| T-0030 | Playwright smoke and axe scan | open | After T-0011. Mocked runtime API, five named pages, 0 serious/critical violations, a Tab-order assertion; two steps (mock server plus two pages, then three more). Size L. | |
| T-0031 | Release workflow on tag | open | `release.yml`: gates first, signing secrets from a protected environment with reviewers, provenance attestation, DRAFT release, post-release job verifying the feed signature. After T-0032 and T-0033. Size L. | |
| T-0032 | Release guards | open | `build-update.mjs`: clean tree, HEAD = tag (also detached), version parity of package.json, package-lock.json, tauri.conf.json, Cargo.toml, Cargo.lock (also in `test:structure`). | |
| T-0033 | Updater key rotation, two-feed scheme | blocked | Owner. New key with a password; new-key builds use a new endpoint (for example `latest-v2.json`), every later release re-uploads the bridge `latest.json` with its old-key `.sig`; old key kept offline until the bridge is published. After T-0024. | `build-update.mjs:15,26` |
| T-0034 | Supply-chain hygiene | open | SHA-pinned actions, `dependabot.yml`, scheduled `npm audit --omit=dev` and `cargo audit`, checksum for the NSIS download. | |
| T-0035 | Dev origins out of production | open | Only with a dev flag in `launcher.py:219`, `ai_tagging.py:67`, `remote_backend.py:396`, `integration_settings.py:82`; negative test (`http://127.0.0.1:4310` rejected in production). The per-run token is not an access control, so no token criterion. | council 23 Oct |
| T-0036 | Security docs | open | Extend `SECURITY.md`, add `docs/architecture/security.md` (token is a marker, CSP `unsafe-inline` rationale, trust boundaries). | |
| T-0037 | Free open-source code signing | blocked | Owner: apply to SignPath Foundation or Azure Trusted Signing (eligibility unverified), wire into `release.yml` if granted. | |
| T-0038 | `check-structure` rules | open | After T-0012: naming per extension, every file under `tools/` listed in the README, no orphan scripts. | |
| T-0039 | Split large modules, ratchet limits | open | Burn-down. Split `runtime.rs` (tests into their own file) and `engine_catalogue_metadata.py`; ratchet every exception to its current size; per-file longest-line ratchet (`App.svelte`: 85 lines over 200 characters); no non-data file over 1000 lines. Size XL. | |
| T-0040 | Silent-error rule | open | Empty `catch {}` and statement-less `catch {` without a `// reason` fail in `check-structure`; `App.svelte:164` shows a toast when `saveAppearance` returns false. | |
| T-0042 | Generated numbers, CHANGELOG, CONTRIBUTING | open | Bundle size and test counts written by a script into `docs/verification/`; user-facing `CHANGELOG.md`; extend `CONTRIBUTING.md` (add a tool, language, task; run each gate). | |
| T-0044 | Accessibility fixes | open | Fixes from the axe scan and Tab-order assertion (T-0030). | |
| T-0046 | Bundle budget and lazy `en` | open | Dynamic imports for settings shell, tool workspaces, landing orb; `en` loaded on demand (language initialised before mount); a build-failing budget set from the measured numbers (`App` chunk is 895 kB today). | |
| T-0047 | Cold-start baseline and busy port | open | (a) baseline in `docs/verification/` re-checked weekly (fail at +50%); (b) a busy engine port gives a clear Polish message within 5 s. Dynamic port deferred (CSP and about 57 files). | |
| T-0048 | Launcher contract test | open | The wrapper and middleware (`launcher.py:359`, `activity.py:477`) under `TestClient` with a stub app, no torch in CI. | |
| T-0049 | Weekly EXE start check | open | Start the built EXE on isolated data on a Windows runner and check over CDP that the UI loads. `/health` plus synthesis stays manual until the runtime can be cached. | |
| T-0050 | Engine analytics kill switch and privacy doc | open | The engine ships `backend/core/analytics.py` (PostHog, switch `OMNIVOICE_ANALYTICS_DISABLED`) and `launcher.py` does not set it. Verify the default, set the switch, negative test, `docs/architecture/privacy.md`. | verified in `engine.zip` |
| T-0051 | Branch protection | blocked | Owner: required checks on `main` (Windows job, structure, publication), so the gates are not advisory. | |
| T-0052 | Coverage baselines | open | Publish Python `coverage` (CI modules) and `cargo llvm-cov` numbers, no threshold yet. | |

## Done

| ID | Title | Commit |
| --- | --- | --- |
| T-0100 | `filemap` Rust file-tree scanner | c367daa |
| T-0101 | 600-line limit with an exceptions list | 9a8cd6f |
| T-0018 | Commit the pending working tree (the three untracked tests are in git, `test:ui` no longer depends on untracked files) | 71043fc, c111710 |
| T-0102 | Audits: ponytail, knip and the three-model council review of the ponytail report (score 5/10) | no code change |

## Rejected (do not propose again without new evidence)

| ID | Proposal | Why |
| --- | --- | --- |
| R-1 | Delete 68 "source-text" tests in `tests/frontend` | About 5 are pure source-text, the rest compile and run code; it would also remove `tag-check` that `AGENTS.md` requires. |
| R-2 | Replace `filemap` with `git ls-files` | `filemap` also lists ignored files such as `.tmp` and writes the HTML views. |
| R-3 | One static worker template in `tts_extensions.py` | The pinned engine gives no per-engine env or argument hook; the generated file is 6 lines. |
| R-4 | Simplify `scripts/dev/ai-dev.ts` | The port search and proxy order are there on purpose; dev-only, low value. |
| R-5 | One i18n table per language | Breaks the 600-line rule; the split exists because of it. |
| R-6 | Import `byteLabel` in `download-eta.ts` | The injected formatter is the test seam (the test loads the module from a `data:` URL). |
| R-7 | Merge the three `clamp` functions | They are three different functions. |
| R-8 | Fold `remote-state.ts` into `remote-backend.ts` | It prevents an import cycle (api, remote-backend, production). Only the re-export can go. |
