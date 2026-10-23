# Task board

The 31 tasks of the 22 October audit (implemented in 0.2.2) are in `audit-2026-10-22.md` with files and test steps; their open leftovers are T-0021 to T-0024.

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
| T-0010 | Run `test:structure` in CI | open | The 600-line limit is only enforced when someone runs it. Add it to `ci.yml` or to `test:ui`. | |
| T-0011 | `frontend/src/` and `desktop/` instead of `src/lib/` and `src-tauri/` | open | Decided layout and blast radius in `specs/T-0011-rename-src-folders.md` (sources up from `src/lib`, UI config into `frontend/`, `package.json` stays in the root). Still needs a full `tauri build` proof on the new layout. |
| T-0012 | Create `tools/` with an index of what each tool is for | open | See `specs/T-0012-tools-folder.md`. | |
| T-0013 | Create `prototypes/` | open | Move the approved settings prototype and the orb prototype out of the ignored `.tmp`; every prototype gets a `STATUS.md` (draft / approved / ported in commit X). | |
| T-0014 | Clean `.tmp` | blocked | Owner confirms the delete list first (about 28k files, mostly repo copies, `*-dist`, a 2 GB cargo target). Keep `qa/`, `release/` and the pinned checkouts. | filemap map |
| T-0015 | English names for docs | open | `postep.md` to `progress.md`, `uwagi-ui.md` to `ui-feedback.md`, `kontekst-projektu.md` to `project-context.md`, `struktura-projektu.md` to `project-structure.md`; update all links; `npm run test:structure`. | `docs/README.md` says docs are English |
| T-0016 | Share `no_links` with a message parameter | open | `watch_folder.rs` and `installer.rs` have the same loop but differ on unreadable or missing ancestors and in messages. Use the stricter behaviour; `cargo check`. | |
| T-0017 | Move the audit and task lists out of `.tmp/qa` | open | Review `.tmp/qa/zadania-audyt-2026-10-22.md` and `audyt-aplikacji-2026-10-22.md` for private data, then add them to `tasks/audits/` in English or as a summary. | |
| T-0019 | Publication check fails on local T3 refs | blocked | `publication_check.py` reports four old T3 checkpoint snapshots (`refs/t3/...`). The working tree is clean (0 findings) and only `main` is public. Decide: ignore those refs in the check, or delete them. | |
| T-0020 | Add `postcss` to devDependencies | open | `tests/frontend/ui-colors-check.mjs` imports it, only a transitive dependency provides it (knip). | |
| T-0021 | Codex bridge for AI functions (audit task A-02, target step) | blocked | `launcher.py` sets `VOICESTUDIO_LLM_AGENTS=["codex"]` and serves a local `/complete` through `codex exec` (like `ai_tagging.run_codex`). Needs a real ChatGPT login to test; the minimum step (message "ChatGPT account supports tagging only") is done. Steps in `audit-2026-10-22.md`. | audit list |
| T-0022 | Check in the running app what was only checked in code | open | A-06, A-07, A-09 (incl. migration of `voicestudio.ai.providers.v1`), A-11, A-13, A-18, A-21, A-22 and the English window for A-23, A-25, A-28 ("Zapisano" in English). Steps per task in `audit-2026-10-22.md`; evidence into `.tmp/qa/T-0022/`. | verification notes in `docs/postep.md` |
| T-0023 | Pixel comparison of the "Wydajność i limity" report with the prototype (A-31) | open | Screenshots at 1280 and 900 px next to `.tmp/settings-redesign/real/ustawienia-prototyp.html` (needs T-0013 first, the prototype lives in the ignored `.tmp`). | known limitation of 0.2.2 |
| T-0024 | Test the update from 0.2.1 to 0.2.2 | open | Install 0.2.1, publish or serve 0.2.2 in a test channel, press "Sprawdź aktualizacje" and "Pobierz i zainstaluj". Not tested yet. | `docs/postep.md` (0.2.2) |
| T-0025 | Locale-aware formatting and plurals for new languages | open | Replace the fixed `pl-PL` / `pl` in `src/lib/models/engine-installation.ts`, `TranscriptionWorkspace.svelte`, `src/lib/voices/voice-picker.ts` (`Intl.DisplayNames('pl')`) with `tr.locale`; make `plural.ts` use `Intl.PluralRules` so languages with more than three plural forms work. Details in `docs/features/i18n.md`. | i18n audit |
| T-0026 | Right-to-left layout | blocked | Only when the first RTL language is added: the stylesheets use physical left/right properties; `dir: 'rtl'` is already set on the document. | `docs/features/i18n.md` |
| T-0027 | Load language catalogs on demand | blocked | Only when more than about five languages exist (about 0.4 MB of text each, imported statically in `languages.ts`). | `docs/features/i18n.md` |

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
