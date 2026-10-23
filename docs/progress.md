# Public project progress

## 23 October 2026 — two oversized modules split (T-0039, step 1)

- `scripts/runtime/app/engine_catalogue_metadata.py` (1,950 lines) held a 1,400-line JSON blob of declarations. The blob is now `scripts/runtime/app/engine_catalogue_data.json`, loaded next to the module (`_DATA`); the module is 543 lines and its line-limit exception is gone. `desktop/src/runtime.rs` embeds and writes the JSON beside the module at every start (a new `include_str!`), `tests/acceptance/engine_benchmark.py` copies it, and `check-structure.mjs` reads the pinned catalogue hash from the JSON.
- `desktop/src/runtime.rs` (1,407 lines): its unit tests moved to `desktop/src/runtime/tests.rs` (a child module, same test names); `runtime.rs` is 935 lines.

Checks: `test_engine_catalogue_metadata.py` 38 OK, `test_engine_bundle.py`, `test_model_onboarding.py` OK, `cargo test --locked` 51 passed / 2 ignored, clippy clean, `npm run check`/`build`/`test:ui`/`test:structure` exit 0. Not verified: the built EXE starting with the new embedded JSON (no new EXE was built; the write list and the loader are covered by the unit tests only).

## 23 October 2026 — board correction (T-0024)

A helper call in the previous commit moved T-0024 to the Done table by mistake. It is blocked, not done (the install step needs an owner decision, see `tasks/specs/T-0024-update-test.md`); the row is back in the open table with its status and evidence. No other change.

## 23 October 2026 — fixes from the independent review of M3

A fresh read-only reviewer (Opus, clean clone, real feed) found no blocking defect: all action SHAs match their version tags, `verify-feed.mjs` is valid against the published feed, the `zip` 2 to 9 bump and the ignores are justified, a clean clone passes. Fixed from its list:

- `release.yml`: the job that runs build code (and holds the signing secrets) now has only `contents: read`, `persist-credentials: false` and no caches; a separate `publish` job, which runs no build code, downloads the artifact and holds the write, OIDC and attestation permissions. New gate: the tag must equal the `package.json` version; `test_analytics_switch.py` also runs there and in the Ubuntu CI job (verified to work with a bare stdlib-only Python). Artifact actions are SHA-pinned.
- `docs/publishing.md`: the environment is the real control (a tag can be pushed on an unreviewed commit): restrict the `release` environment to `v*` tags, add a tag ruleset, and review that the tagged commit is on `main`.
- Privacy: the page notice no longer says analytics can be turned on (new text and English key: data leaves only when the user chooses a remote provider, downloads a model or checks for updates); a stored opt-in is not shown as active; new `tests/frontend/privacy-analytics-check.mjs` (kill switch in the launcher, disabled switch, truthful notice). `privacy.md` states the caveat that the engine's own `environment` file can override launcher variables (local tampering only). `security.md` says the release workflow exists but has not run.
- `verify-feed.mjs`: the trusted comment and its signature are mandatory (as in Tauri's verifier), the NSIS-specific platform key is preferred when present, `--pubkey` and `--expect-version` are documented. `verify-release.yml` skips pre-releases; `audit.yml` pins `cargo-audit` 0.22.2; `changelog-notes.mjs` escapes the whole version in its regex; the tauri-build change filter in `ci.yml` no longer uses `grep -q` under `pipefail`.
- `tasks/specs/T-0033-updater-key-rotation.md` lists the tooling that must change at rotation (feed-aware verification with the old key, the second feed upload).

Not changed: re-running the `build` job after a draft exists fails at `gh release create` (delete the draft first); the launcher does not strip analytics keys from the engine's environment file.

Checks: `release-feed-check` (9 steps incl. the stripped-signature case), `release-guards-check`, `privacy-analytics-check`, `npm run check` 0/0, `build`, `test:ui` (74 checks), `test:structure` exit 0; `verify-feed.mjs` still valid against the real feed; workflows parse as YAML. Not verified: the workflows on GitHub.

## 23 October 2026 — release workflow and feed verification (T-0031, preparation for T-0033)

New: `.github/workflows/release.yml` (tag `v*`): a `gates` job on the tagged commit (check, build, `test:ui`, `test:structure`, publication check, `cargo test`, clippy, a CHANGELOG section for the version), then a `build` job in the protected environment `release` (required reviewers, the only place the signing secrets are readable) that runs `npm run desktop:release` (guards first), attests build provenance (`actions/attest-build-provenance`) and creates a DRAFT release with the installer, `.sig`, `.sha256` and `latest.json`; a draft is never "latest", so the update reaches installed copies only when the owner publishes. `.github/workflows/verify-release.yml` (on `release: published`, and by hand) downloads the feed installed copies poll and its installer and verifies the signature against the key in `desktop/tauri.conf.json` with the new `tools/release/verify-feed.mjs` (Node `crypto`: Ed25519 over blake2b512, minisign's format, trusted comment included; `--expect-version` checks the feed version). `tools/release/changelog-notes.mjs` and the new user-facing `CHANGELOG.md` provide the notes (`build-update.mjs` uses them when `--notes` is absent); `build-update.mjs --feed <name>` makes the feed file name a parameter. All actions are SHA-pinned (enforced). `docs/publishing.md` has a Releases section with the process and the owner's one-time setup; `tasks/specs/T-0033-updater-key-rotation.md` describes the two-feed key rotation (not done: owner step).

Checks: `tests/frontend/release-feed-check.mjs` (8 steps; synthetic Ed25519 keys): prehashed and legacy signatures verify, a modified installer, a different key, an altered trusted comment and a malformed signature are rejected, notes come from the matching section only, the current version has a CHANGELOG section. `verify-feed.mjs` against the REAL published feed and installer: "SIGNATURE VALID for the key in desktop/tauri.conf.json" (also through the downloaded copy), and `--expect-version 0.2.3` fails as it should. Workflows parse as YAML; `npm run check` 0/0, `build`, `test:ui`, `test:structure` exit 0.

Not verified: any of the workflows on GitHub (nothing is pushed, the environment and secrets do not exist yet, `actions/attest-build-provenance` and `gh release create --verify-tag` behaviour on the runner, the 20-30 minute build there), `--feed` with a real build, the old-key check of the bridge feed (T-0033 is blocked on the owner and on T-0024). The board keeps T-0031 as `doing` until a first real run.

## 23 October 2026 — update test against the real feed, first part (T-0024)

Verified from the real GitHub release feed of the project: `latest.json` is reachable and says 0.2.2; the installer it points to downloads and is byte-identical (SHA-256) to the locally built `.tmp/release/v0.2.2` installer; the feed signature equals the local `.sig`; and the signature verifies against the public key embedded in `desktop/tauri.conf.json` (scratch project with `minisign-verify` under the ignored `.tmp/qa/T-0024/`, result "SIGNATURE VALID").

NOT verified: the actual install of 0.2.1 and the update to 0.2.2. The machine has a real per-user installation of the same application identifier (registry entries and install folder exist); running the 0.2.1 installer would replace it with an older version and the updater's passive install acts on the registered location, so the test was not run (rule: do not touch an existing installation). The task stays `blocked` with the question and the steps in `tasks/specs/T-0024-update-test.md`; T-0033 (key rotation) is gated by it.

## 23 October 2026 — security documentation (T-0036)

New `docs/architecture/security.md` (linked from `docs/README.md`, `SECURITY.md` and the privacy page): trust boundaries (WebView, Tauri IPC with the listed capabilities, supervisor, loopback engine, user-chosen external services), the origin allow-list and the dev-flag rule (T-0035), why the `x-voicestudio-next` token is a marker and not an access control (it is echoed on every response; the 23 October review found no access control claims to make from it), the content security policy and why `style-src 'unsafe-inline'` stays (Svelte inline styles and runtime CSS variables, about two dozen uses; scripts are `'self'` only), updates and releases (signature check, release guards, checksum file, no code-signing certificate, key without a password pending T-0033), supply chain (pinned actions, Dependabot, weekly audit and its three documented ignores), and an explicit "Not claimed" list (no audit, no sandbox against other processes of the same Windows user, no encryption at rest, no certificate, no reproducible builds). `SECURITY.md` links to it, states that the marker is not an access control, and gains an "Updates and releases" section (SmartScreen warning, download only from the project's releases, compare the SHA-256 file).

Facts were checked against the code (capabilities file, CSP in `tauri.conf.json`, `launcher.py` origins and the `OwnedBackend` header, the engine's `core/csrf.py` header name, the `style=` count). Not verified: the exact set of methods `core/csrf.py` enforces (only the header and the safe-method list were read), that the supervisor waits for the marker on `/health` in every start path (taken from the existing runtime documentation), and anything about behaviour on non-Windows systems. Board: T-0034 done (04e5d23, c207430).

## 23 October 2026 — supply-chain hygiene (T-0034)

- Every GitHub Action in `.github/workflows/` is pinned to a full commit SHA with the version in a comment (`actions/checkout` 4.4.0, `actions/setup-node` 4.4.0, `actions/setup-python` 5.6.0, `Swatinem/rust-cache` 2.9.3: the latest of the majors already in use; the SHAs come from `git ls-remote --tags` of each repository, peeled for annotated tags). `npm run test:structure` fails for an unpinned `uses:` (proved with a temporary unpinned workflow).
- `.github/dependabot.yml`: weekly update pull requests for GitHub Actions, npm (`/`) and Cargo (`/desktop`).
- `.github/workflows/audit.yml` (weekly and on demand): `npm audit --omit=dev --audit-level=high` and `cargo audit` on `desktop/Cargo.lock`, with the three `zip` 4.6.1 advisories ignored for the reason in the previous entry.
- `tools/release/build-update.mjs` writes `<installer>.sha256` next to the installer and the signature, so a manual download can be verified (`certutil -hashfile <installer> SHA256`); the "checksum for the NSIS download" of the roadmap is read this way.

Checks: all three YAML files parse; `npm audit --omit=dev` finds 0 vulnerabilities; `cargo audit` with the ignores exits clean; `npm run check` 0/0, `build`, `test:ui`, `test:structure` exit 0; `node --check tools/release/build-update.mjs`. Not verified: the new workflows on GitHub (nothing is pushed; `cargo install cargo-audit` takes minutes on the runner), Dependabot's handling of the `# vX.Y.Z` comments, a release build that writes the checksum file (needs the signing key). Branch protection that would make these checks required is T-0051 (owner).

## 23 October 2026 — known advisories in the Rust dependencies fixed (T-0034, step 1)

Running `cargo audit` once for the first time (cargo-audit 0.22.2 installed under the ignored `.tmp/`; the advisory database is fetched live) reported 9 vulnerabilities in `desktop/Cargo.lock`. Fixed by `cargo update`: `tokio` 1.54.0 to 1.54.1 (RUSTSEC-2026-0384, a race in `time::Interval`), `rustls-webpki` 0.103.15 to 0.103.16 (RUSTSEC-2026-0382, distrusted intermediates accepted), `webpki-roots` 1.0.9 to 1.0.11 (RUSTSEC-2026-0381); and by moving the direct `zip` dependency from 2 to 9 (`desktop/Cargo.toml`; RUSTSEC-2026-0367/0368/0369 are about `extract()` creating symlinks and keeping SUID bits; the installer only copies one entry by hand, but the fix costs nothing). No code change was needed for the new `zip` API.

Remaining: `zip` 4.6.1 with the same three advisories comes in through `tauri-plugin-updater` 2.14.0; it cannot be bumped from this repository. On Windows the updater runs an NSIS installer and does not extract archives, so the weekly audit (next commit) lists the three IDs as ignored with that reason; this must be revisited when the plugin updates. Also reported and left as warnings: `proc-macro-error` (unmaintained), `glib` 0.18.5 (unsound `VariantStrIter`; a Linux-only GTK dependency of Tauri), and yanked `clipboard-win` 5.4.1 (unchanged by this change).

Checks: `cargo check`, `cargo test --locked` (51 passed, 2 ignored, includes the uv extraction tests on the new `zip`), `cargo clippy --all-targets -D warnings` clean, `cargo audit` afterwards: 3 advisories left (the updater's `zip` 4.6.1). Not verified: a release build and the installer flow with the new `zip` and `tokio` (no EXE was run after this change), `rustls` behaviour in a real update check.

## 23 October 2026 — engine analytics kept off, and a privacy page (T-0050)

Finding: the pinned engine ships `backend/core/analytics.py`, an opt-in PostHog client with an upstream project key as the default destination (`token_configured()` is true even in a source build), and the app's **Prywatność i użycie** page offered a consent switch for it while `launcher.py` did not set the engine's kill switch `OMNIVOICE_ANALYTICS_DISABLED`. Default behaviour verified by reading the engine code and by the new test: with no opt-in `enabled()` is false (nothing is sent by default), but after the user turned the switch on, events would have gone to the upstream project.

Change: `scripts/runtime/app/launcher.py` sets `OMNIVOICE_ANALYTICS_DISABLED=1` (the hard switch outranks the opt-in); `ANALYTICS_OFFERED = false` in `frontend/src/settings/system-settings.ts` makes the page show the existing "no analytics recipient" state with the switch disabled instead of a switch that does nothing; `docs/architecture/privacy.md` (new, linked from `docs/README.md`) lists every path by which data can leave the computer (updates on click only, explicit installs and downloads, a user-chosen LLM or remote engine, local MCP off by default) and what is off.

Checks: new `tests/runtime/test_analytics_switch.py` (2 tests, offline, loads the engine's `analytics.py` from the pinned archive with a stub preference store): off by default, on after an opt-in as a control, off again with the switch; the launcher's `configure_environment()` sets the switch. `npm run check` 0/0, `build`, `test:ui`, `test:structure`, `test_engine_bundle` and `cargo check` (the launcher is embedded) OK. Not verified: network capture of a running engine (no traffic was observed), the Privacy page in the running window (the existing English key is reused, no new string), and the explanatory sentence on that page ("data leaves only if you enable analytics or use a remote provider") stays as it was, now true for the second case only. Board: T-0032 done (b7de7c2).

## 23 October 2026 — release guards (T-0032)

`tools/release/release-guards.mjs` (new) reads the five version manifests (`package.json`, both versions in `package-lock.json`, `desktop/tauri.conf.json`, `desktop/Cargo.toml`, the `seventy-seven-labs` entry of `desktop/Cargo.lock`) and checks, for a release, that the working tree is clean (untracked files count) and that HEAD carries the tag `v<version>` (`git tag --points-at HEAD`, so a detached checkout works). `tools/release/build-update.mjs` calls it before building and throws with all failures listed; `--skip-guards` is a loud escape for a local trial build only. `npm run test:structure` also fails when the five versions disagree. The old check (package.json against tauri.conf.json) is replaced by this one.

Checks: new `tests/frontend/release-guards-check.mjs` (part of `test:ui`, 7 steps, throw-away git repository): manifests agree, untagged HEAD refused, clean tagged HEAD passes, detached checkout at the tag passes, detached HEAD after the tag refused, dirty tree refused, drift in each of `Cargo.toml`, `Cargo.lock`, `package-lock.json`, `tauri.conf.json` reported. The real script run in this dirty tree refuses with the clean-tree message. `npm run check` 0/0, `build`, `test:ui`, `test:structure` exit 0. Not verified: a full `desktop:release` with the guards on a tagged commit (needs the signing key and 20-30 minutes; the guards run before any build step). `docs/features/app-updates.md` describes the new steps.

## 23 October 2026 — fixes from the independent review of M2

A fresh read-only reviewer (Opus, clean clone of `a800b78` with `npm ci`) confirmed that `test:structure` (681 documented paths), `npm run check`, `build`, `run-checks` (71/71), `cargo check/test --no-run`, the dev and preview servers and the preview tools work on a clone. It found stale text and weak spots, fixed here:

- `check-structure.mjs`: retired roots (`src/`, `src-tauri/`, `scripts/dev|preview|release|build/`) now FAIL in current documents (history files are exempt: this log, the board, the roadmap, the T-0011 spec, the translated application audit); the flat-folder rules read `git ls-files` (an untracked scratch file no longer fails a local run); links are checked in every tracked Markdown file (152 links now, was docs/README/AGENTS only); the `--config` and `--tsconfig` files named in npm scripts must exist; names of documents under `docs/` must be English kebab-case. The checker found one more stale path at once (`src-tauri/target/...` in the generated audit checklist), regenerated from its source.
- Two source comments pointed at renamed docs (`landing-orb.frag`, `settings-page.css`); `tools/README.md` lost its "test planned" sentence and now names `frontend/vite.config.ts`; the `tauri-build` CI filter also reacts to `tools/dev/ai-dev.ts` (imported by the Vite config); `project-context.md` lists the orb demo files and `orb-demo.html`; the board has the hashes of T-0011 (a800b78) and T-0017 (8948226).
- Known and recorded, not fixed: `tests/frontend/voice-audit-build.mjs` full mode no longer builds after the move (only `--fixture-only` works; part of the owner decision T-0008), `OrbMusicDemo` imports two CSS files that never existed (T-0009), `orb_product_preview.py` root (already listed).

Checks: `npm run check` 0/0, `build`, `test:ui` (71 checks), `test:structure` PASS, workflow parsed as YAML. Not verified: the GitHub run. Reviewer note: the local `refs/t3/*` refs (282 now) still make `publication_check.py` report ref findings in this working copy; the file findings are 0 and the clean clone passes (T-0019, owner).

## 23 October 2026 — `frontend/src` and `desktop/` (T-0011)

Layout change decided by the owner: `src/lib/<area>/` is now `frontend/src/<area>/` (16 area folders), `src/App.svelte`, `main.ts`, `styles.css`, `gallery.ts`, `OrbMusicDemo.svelte`, `orb-music-demo.ts` sit in `frontend/src/`, the Vite/TypeScript/Svelte configuration and the HTML entries (`index.html`, `inputy.html`, `orb-demo.html`) moved to `frontend/`, `src-tauri/` is `desktop/`, and `package.json` stays in the root. 357 files were moved with `git mv` (history follows) and `desktop/target` (the cargo cache) was moved along so the release build did not start from nothing. A script rewrote 124 files: every relative specifier (`./lib/...`, `../../src/lib/...`, markdown links) was resolved against the old location and recomputed for the new one, then plain path mentions (`src/lib/` to `frontend/src/`, `src-tauri` to `desktop`) were replaced; the history files (this log, the roadmap, the T-0011 spec, the board) were left alone and fixed by hand. Hand fixes: `frontend/vite.config.ts` (`root` is `frontend/`, `publicDir` `../public`, `build.outDir` `../dist`; the npm scripts `dev`, `build`, `preview`, `check` pass `--config frontend/vite.config.ts` / `--tsconfig ./frontend/tsconfig.json`), the preview tools that call Vite directly (`controls-preview.mjs`, `inline-preview.mjs` now pass `configFile` and write their temporary entry inside `frontend/`; `editor-performance-preview.mjs` finds baselines in both layouts), tests with split paths (`button-system-check`, `ui-rules`, `i18n-coverage-check`, `engine-readiness-check`, `async-ui-check`, `engine-confirmed-check`, the voice-audit builder), `check-structure.mjs` (the flat-folder rule is now about `frontend/src` and its seven entry files; `pathRoots` lists `frontend`, `desktop`, `tools`), the CI path filter (`frontend/`, `public/`, `desktop/`) and the structure/context documents.

Proof before merging (the roadmap's condition): `npx tauri info` finds `desktop/tauri.conf.json`; `npm run desktop:build` (`tauri build --no-bundle`) succeeded in 3 min 52 s with no `--config` and no workaround, so the deferral clause was not needed; the built `desktop/target/release/seventy-seven-labs.exe` was started on a fresh `LOCALAPPDATA`/WebView profile with a script in the ignored `.tmp/qa/exe_smoke.py` over CDP: the window starts (title "Seventy Seven Labs", `http://tauri.localhost/`), the 12 settings pages mount, Settings → Silnik renders, no page errors (screenshot in `.tmp/qa/T-0011/`). Also: `npm run check` 0/0, `build`, `test:ui` (71 checks), `test:structure` (668 documented paths), `cargo check/test/clippy` on `desktop/Cargo.toml` (51 passed, 2 ignored, clippy clean), all 27 `tests/runtime` modules import, `test_native_publication`, `test_acceptance_guards`, `test_publication_check`, `test_engine_bundle`, `test_runtime_backup` OK.

Not verified: the installer build (`npm run desktop:release` was not run), `tauri dev`, the previews and `tools/preview` scripts that were already broken, the acceptance scripts (they need an engine), the GitHub CI run (the path filter and `workspaces: desktop` are untested there), and the unpinned `tauri-build` job. A Vite dev server that another session had running on port 4310 serves a folder that no longer exists and must be restarted (`npm run dev`).

New finding recorded as T-0053: six user-facing messages still send the user to "Modele i silnik", a page that no longer exists (seen on the Silnik page in the smoke screenshot).

## 23 October 2026 — audit documents moved out of `.tmp/qa` (T-0017)

`tasks/audits/` now holds both audit documents: `audit-2026-10-22.md` (the generated fix checklist with files and test steps; it moved there with the previous commit and its generator in `.tmp/qa` now writes to the new path) and `app-audit-2026-10-22.md`, an English translation of the internal Polish application audit (findings as of 22 October 2026, before the 0.2.2 fixes; it says so in its first paragraph). The Polish task list in `.tmp/qa/zadania-audyt-2026-10-22.md` is not copied: `audit-2026-10-22.md` is generated from the same data. The translation was made by a sub-agent from the Polish file, which contained no home paths, names, e-mail addresses, account names, voice-profile names or tokens (the sub-agent reported none and a grep for paths, `@`, names and key words found only the phrase "Hugging Face token" as a diagnostics warning). The board links point to the new folder.

Checks: `npm run test:structure` PASS (links and documented paths), publication check 0 file findings. Not verified: a human proofread of the translation against the Polish original (a sample of the opening and headings was read). Board: T-0038 done (8d5a1b0).

## 23 October 2026 — naming and index rules in `test:structure` (T-0038)

`tools/dev/check-structure.mjs` now enforces: file names under `tools/`, `tests/` and `scripts/runtime/` are kebab-case for `.mjs`, `.ts`, `.js`, `.svelte`, `.html`, `.css` and snake_case for `.py`; every tracked file under `tools/` has a row (or a folder row ending in `/`) in `tools/README.md`, and every file under `tests/acceptance/` in `tests/acceptance/README.md`. A deliberately badly named, unlisted file made the check fail with both messages (tried and removed). Nine existing outliers were renamed with `git mv` and their references updated (only full file names were replaced, not tokens that merely look like them): `tests/acceptance/ai_runtime_smoke.py`, `feature_smoke.py`, `select_ui_check.py`, `slider_ui_check.py`, `wav_format_verify.py`, `stop-observer-check.mjs`; `tests/frontend/audit_upstream.py`, `speech_settings_backend_check.py`; `tools/preview/orb_product_preview.py`. The check reports 223 named files and 69 indexed tools.

"No orphan scripts" is covered as: nothing can exist in `tools/` or `tests/acceptance/` without being described, and the "Called by" column says `nothing (manual)` where nothing references a script. A script nobody calls is still allowed; deleting such scripts is the owner's decision (T-0008, T-0009).

Checks: `npm run check` 0/0, `build`, `test:ui` (71 checks), `test:structure` PASS. Not verified: the renamed acceptance scripts were not started (they need an engine, a browser or the EXE); `python -m py_compile` is implied by the unchanged contents.

## 23 October 2026 — English names for all documentation files (T-0015)

27 files were renamed with `git mv` (history follows): `docs/postep.md` to `docs/progress.md`, `uwagi-ui.md` to `ui-feedback.md`, `publikacja.md` to `publishing.md`, `architecture/kontekst-projektu.md` to `project-context.md`, `architecture/struktura-projektu.md` to `project-structure.md`, `verification/weryfikacja.md` to `verification.md`, and 21 files in `docs/features/` (for example `zdalny-silnik` is `remote-engine`, `kopie-danych-runtime` is `runtime-backups`, `kula-plyn` is `orb-flow`, `motywy-t3-code` is `t3-code-themes`). `i18n.md`, `t3-controls.md` and `tts-demo.md` were already English. References were rewritten in 52 files (links, `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `check-structure.mjs`, the line-limit exceptions file, tests, the task board and specs). Old names inside this log's earlier entries are rewritten too, so the log's links are valid; its prose is otherwise unchanged. File names are the only thing that changed: titles and content are as before. Feature documents keep describing Polish UI labels.

Checks: `npm run check` 0/0, `build`, `test:ui` (71 checks), `test:structure` PASS (all links and documented paths resolve), `git grep` finds no old name outside this entry. Not verified: external links to the old file names (GitHub URLs in issues or the release page) would break; none were found in the repository. Board: T-0012 done (887fa1e). The owner's note file in the assistant memory still names `docs/uwagi-ui.md` and is updated separately.

## 23 October 2026 — `tools/` with an index of every developer tool (T-0012)

`scripts/dev`, `scripts/preview` and `scripts/release` moved to `tools/dev`, `tools/preview` and `tools/release`; `scripts/build/bundle.py` joined `tools/release/` (so `scripts/` now holds only the embedded backend, `scripts/runtime/`); `test-runtime.py` became `test_runtime.py`. `tools/README.md` has a row for each of the 28 tools (purpose, when to run, who calls it, what it needs) and a "Known problems" list; `tests/acceptance/README.md` does the same for the 40 acceptance scripts, which STAY in `tests/acceptance` (they are tests; decision of the roadmap review). The inventory behind both tables was produced by a read-only sub-agent and the callers column is a basename grep, not proof that something runs the file.

Paths rewritten in 32 files: `package.json`, `ci.yml`, `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `vite.config.ts` (imports `tools/dev/ai-dev.ts`, which now points at `../../scripts/runtime/app/ai_tagging.py`), `src-tauri/src/main.rs` (comment), `tests/runtime/test_publication_check.py`, `tests/runtime_paths.py` (`scripts/build` is now `tools/release`), `tests/frontend/app-update-support-check.mjs`, `bundle.py` (default output path), the line-limit exceptions file, `docs/public-assets.json` and the documentation. This log keeps its historical paths.

Nothing was deleted: T-0008 and T-0009 (broken voice-audit tools, manual previews, orb-music demo) need the owner's answer, so the candidates are only listed in the README. Inventory findings worth knowing: `npm run qa:ui` (`ui-performance-preview.mjs`) serves check scripts from a path that does not exist, `voice-audit-preview.mjs`, `voice-picker-preview.mjs`, `feature-preview.mjs` and `tools-workspace-preview.mjs` have wrong roots or missing checks, `orb-product-preview.py` computes the repository root one level too high. They were broken before the move and are unchanged.

The Vite dev server of another session was holding `scripts/dev` open, so the folder could not be renamed in place; the 11 files were moved one by one with `git mv` (the history follows) and an empty `scripts/dev/filemap` folder remains on disk only.

Checks: `python .tmp` import test of all 27 `tests/runtime/test_*.py` modules: 27 modules, 0 import errors; `test_publication_check.py` OK, `test_engine_bundle.py` OK; `npm run check` 0/0, `build`, `test:ui` (71 checks), `test:structure` PASS (542 documented paths); `node tools/dev/i18n-lang.mjs status` works. Not verified: `npm run desktop:release` and `desktop:build` after the move, the previews and `capture_screenshots.py`, `bundle.py` against a real upstream checkout, GitHub CI.

## 23 October 2026 — fixes from the independent review of M1

A fresh read-only reviewer (Opus) checked commits `f79cbaf..87cf207` against the roadmap criteria and found problems that are fixed here:

- `test:structure` failed on a fresh clone: the new documentation path check looked at the working tree, so build output mentioned in docs (`src-tauri/target/...exe`, `src-tauri/gen`) failed on CI. It now checks against `git ls-files` (files and their folders) and skips an explicit list of generated roots (`src-tauri/target`, `src-tauri/gen`, `dist`, `node_modules`). It also strips leading quotes, brackets and `--flag=`, accepts backslashes, and covers every tracked `.md` (not only `docs/`, `tasks/` and the root).
- The acceptance UI harness (`tests/acceptance/ui_server.py` forces the 4310 origin) would have been rejected by the engine after T-0035: `qa_session.py` now starts its disposable engine with `VOICESTUDIO_DEV_ORIGINS=1` (it is a QA session, not a release).
- `rust-toolchain.toml` pins Rust 1.97.1 with clippy so `clippy -D warnings` does not turn CI red when a new stable adds a lint (bump it deliberately).
- `scripts/dev/run-checks.mjs` kills a check after 120 s and counts it as failed.
- CI `concurrency` no longer cancels runs on `main`; the `tauri-build` job lost an always-true `if:` and also reacts to `scripts/runtime/`, `src/`, `rust-toolchain.toml` and the workflow itself.
- Bookkeeping: T-0007 has its hash (87cf207), T-0010 is done (f79cbaf, merged into T-0028), the roadmap no longer marks `run-checks.mjs` as planned, `tests/frontend/README.md` says which `.js` files it means (8 of 23).

Reviewer notes accepted without a change: `no_links_with` is stricter for the installer on unreadable (not missing) ancestors, which the T-0016 entry already states; no use of the 4310 origin remains in release paths (searched the whole repo).

Checks: `npm run check` 0/0, `build`, `test:ui` (71 checks), `test:structure` PASS (500 documented paths, tracked-file based), `cargo clippy --locked --all-targets -D warnings` clean under the pinned toolchain, workflow parsed as YAML. Not verified: the acceptance harnesses themselves (they need an engine and a browser; the fix follows from reading the code), the workflow on GitHub.

## 23 October 2026 — every frontend check runs (T-0007)

Triage: 36 `tests/frontend/*-check.mjs` files were in no npm script. A read-only run (one by one, results in the ignored `.tmp/qa/T-0007/`) gave 34 PASS and 2 FAIL; both failures were stale tests, not product bugs: `model-licenses-check.mjs` expected the old page name "Modele i silnik" (the message now says "Ustawienia → Modele → Warunki modelu"), and `speech-app-contract-check.mjs` evaluated the real `App.svelte` generate function without `userMessage`, `markEngineConfirmed` and `unmarkEngineConfirmed` in its fixture. Both were fixed in the tests only. Nothing was deleted.

Change: `scripts/dev/run-checks.mjs` replaces the 33-segment `&&` chain in `test:ui`. It runs every `*-check.mjs` plus `ui-rules.mjs` (sorted, four at a time), prints the tail of every failing check, exits 1 on any failure or when a name filter matches nothing, and has an empty `SKIPPED` list (file to reason) for checks that cannot run in CI. `ARGUMENTS` keeps `--summary` for `orb-reactivity-check.mjs`. `test:styles` and `test:buttons` stay as standalone scripts. The 8 unreferenced `*-check.js` files are browser-console scripts; they are documented in the new `tests/frontend/README.md` (kept, to be replaced by the Playwright smoke T-0030).

Checks: `node scripts/dev/run-checks.mjs` 71/71 passed in about 18 s; `npm run check` 0/0, `build`, `test:ui`, `test:structure` exit 0. Not verified: the runner on GitHub (Ubuntu and Windows); the failure output format with a real failing check (exit code and the empty-filter path were tested, a deliberately failing check was not added). Board: T-0002 done (ebdc9a7).

## 23 October 2026 — stale documentation paths fixed and checked (T-0002)

`npm run test:structure` now also checks every path written in backticks or in a fenced block in `docs/**` (except this log, which is history), `tasks/**`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `AGENTS.md` and `THIRD_PARTY_NOTICES.md`. Paths are recognised by one list of roots in `scripts/dev/check-structure.mjs` (`pathRoots`), so the check survives later moves (T-0012, T-0011 only edit that list); a path that does not exist yet or any more is marked `(planned)` or `(removed)` right after it. The first run found 67 stale paths in 17 documents (the old flat `src/lib/*.ts` and `scripts/runtime/*.py` layout, `scripts/*-check.mjs`, `scripts/controls-preview.mjs`, `CONTRIBUTING.md` citing `scripts/tag-check.mjs`); each was replaced by the unique tracked file of the same name, and the i18n example uses `src/lib/i18n/<code>/index.ts`. The check now covers 502 paths.

Board: T-0001, T-0003, T-0004, T-0005, T-0006, T-0016, T-0020, T-0035 moved to Done with their hashes; T-0028 is `doing` (local gates pass, the first green GitHub run needs a push).

Checks: `npm run test:structure` PASS (502 documented paths), `python tests/runtime/test_publication_check.py` OK, publication check 0 file findings. Not verified: that each auto-corrected path is the one the author meant beyond a basename match (spot-checked `engine-update.md`).

## 23 October 2026 — one helper for the legacy KittenTTS check (T-0006)

The condition `engine_id == "kittentts" and not environment_python(...).is_file()` was repeated four times in `scripts/runtime/app/tts_extensions.py`; it is now `uses_legacy_kitten(engine_id, root)`.

Checks: `tests/runtime/test_tts_extensions.py` 13 OK, `test:structure` PASS, `cargo check` PASS (embedded file). Not verified: KittenTTS synthesis (the pinned engine's legacy backend was not started).

## 23 October 2026 — one `no_links` implementation (T-0016)

`watch_folder.rs` and `installer.rs` each had their own loop that rejects symlinks and Windows reparse points. Both now use `installer::no_links_with(path, reparse_message, symlink_message)`; `installer::no_links` and the watch-folder wrapper only supply their Polish messages. Behaviour decision: a missing entry is skipped (a path that does not exist yet cannot be a link; the installer and the log/pointer callers rely on that), any other read failure is an error (this is the stricter variant for the installer, which used to ignore every error; the watch folder used to fail on a missing ancestor and now fails later in `is_dir`).

Checks: `cargo clippy --locked --all-targets -D warnings` clean, `cargo test --locked` 51 passed (new `missing_paths_are_not_links_but_real_directories_pass`), `test:structure` PASS. Not verified: a real junction/symlink rejection (creating one needs privileges; the existing tests that cover the reparse path were not changed) and the watch folder in the running app.

## 23 October 2026 — orphan fixtures and a one-off script removed (T-0005)

Deleted `tests/fixtures/ui-style-fixes.svelte` and `tests/fixtures/button-system-audit.svelte` (no references; `voice-picker-audit.svelte` stays, it is used) and `scripts/dev/i18n-svelte.mjs` (the one-off that wrapped static markup for the English catalog; only mentioned in this log, whose older entry now says it was removed).

Checks: `git grep` for the three names finds only this log and the task board; `npm run check`, `build`, `test:ui`, `test:structure` exit 0. Not verified: nothing else (no runtime effect).

## 23 October 2026 — `postcss` declared as a dev dependency (T-0020)

`tests/frontend/ui-colors-check.mjs` imports `postcss`, which only a transitive dependency provided. It is now a pinned devDependency (8.5.31, the version already in the lockfile); `package-lock.json` gained only the root entry.

Checks: `node tests/frontend/ui-colors-check.mjs` exit 0, `npm run test:structure` PASS. Not verified: a clean `npm ci` on CI.

## 23 October 2026 — `hashlib.file_digest` in the bootstrap (T-0003)

`sha256()` in `scripts/runtime/install/bootstrap.py` used a hand-written chunked loop; it now calls `hashlib.file_digest` (Python 3.11+, the version bootstrap runs under; `launcher.py` and `engine_installation.py` already use it).

Checks: `tests/runtime/test_bootstrap.py` 20 OK (run with CPython 3.12 here), `npm run test:structure` PASS, `cargo check` PASS (the file is embedded). Not verified: a real bootstrap run under the pinned CPython 3.11.14 (the 3.11 API is documented, not exercised here).

## 23 October 2026 — one `durationLabel` (T-0004)

`src/lib/settings/system-settings.ts` exported a second `durationLabel` with a different format (seconds, minutes, hours with "godz."). It is renamed `longDurationLabel` (one user: `PrivacyPage.svelte`); `src/lib/data.ts` keeps `durationLabel` (the `m:ss` player format) with its five users.

Checks: `npm run check` 0/0, `build`, `test:ui`, `test:structure` exit 0. Not verified: the privacy page in the running app.

## 23 October 2026 — remove dead exports (T-0001)

Deleted exports that nothing used (verified by `git grep` before and after): `BUILT_IN_THEMES`, `BuiltInThemeId`, `MobileThemeId`, `UNPUBLISHABLE_THEME_IDS`, `MOBILE_THEME_IDS`, `MOBILE_DEFAULT_THEME_ID` (`themes/t3-palettes.ts`), `systemSectionTitles`, `sharingLinks` (`settings/system-settings.ts`), `remoteProxyPath`, `remoteSocketUrl` (`platform/remote-backend.ts`), `initialText` (`data.ts`), `downloadLabels` (`models/model-management.ts`). 47 lines removed.

Checks: `npm run check` 0/0, `npm run build` PASS, `npm run test:ui` exit 0, `npm run test:structure` PASS. Not verified: the app in a running window (no behaviour depends on these symbols).

## 23 October 2026 — dev origins only with a dev flag (T-0035)

Before, the engine trusted `http://127.0.0.1:4310` and `http://localhost:4310` (the Vite dev server) in every build, so a page served on that port could call the production engine. Now `launcher.py` (`OMNIVOICE_ALLOWED_ORIGINS`), `ai_tagging.py` (`origin_allowed`), `remote_backend.py` (WebSocket origin) and `integration_settings.py` (MCP allowed hosts) add the dev origins only when `VOICESTUDIO_DEV_ORIGINS=1`. `src-tauri/src/runtime.rs` sets the flag from `cfg!(debug_assertions)` (so `tauri dev` keeps working, the release EXE does not trust 4310); `scripts/dev/ai-dev.ts` sets it for the dev AI adapter. Documented in `docs/architecture/runtime.md`. The per-run token is deliberately not part of the criterion: it is not an access control.

Checks: `tests/runtime/test_ai_tagging.py` 15 OK (new: 4310 gives 403 without the flag, 200 with it), `test_remote_backend.py` 15 OK (new negative test: the 4310 WebSocket origin is closed), `test_integration_settings.py` 11 OK (hosts without 4310 by default, with it under the flag), `test_general_settings.py` 9 OK, `cargo check` PASS, `npm run check` 0/0, `npm run test:structure` PASS. `test_windows_runtime_paths.py` has one failure (`test_real_private_mcp_import...` needs the private `.venv`), unrelated and environmental: input for the T-0029 module table. Not verified: `tauri dev` and the browser dev flow in a running session; the release EXE rejecting 4310 end to end (only the unit-level contract).

## 23 October 2026 — Windows CI job (T-0028, T-0010)

`.github/workflows/ci.yml` gains: `concurrency` with cancel-in-progress; a `windows` job (`npm ci`, `test:structure`, `test:ui`, `npm run build` first because `tauri::generate_context!` embeds `../dist`, `Swatinem/rust-cache`, `cargo check --locked`, `cargo test --locked`, `cargo clippy --locked --all-targets -D warnings`); and a `tauri-build` job (`npm run desktop:build`) that runs its steps only when `src-tauri/` or the npm manifests changed (decided by a `git diff` step, so the job always reports a status and can be made required). The Ubuntu job is unchanged. The interactive hotkey test in `dictation_desktop.rs` is already `#[ignore]`, so no extra skip list is needed; the other `#[cfg(windows)]` test only reads `GetForegroundWindow`.

Checks: workflow parsed as YAML (3 jobs); the same commands run locally on Windows with the results recorded in the previous entries (`test:ui`, `test:structure`, `cargo test` 50 passed / 2 ignored, clippy clean); `test:ui` passes on this Windows machine, so the "UI checks only ever ran on Ubuntu" risk did not show up here. NOT verified: the workflow on GitHub (nothing is pushed, actions are not pinned yet: T-0034), `tauri-build` timing, the `windows-latest` image. Making the jobs required is T-0051 (owner).

## 23 October 2026 — clippy fix-up before the Rust gate (T-0028)

Two lints blocked `cargo clippy -D warnings`: a needless borrow in `src-tauri/src/library.rs` and `Option::map_or(true, ..)` in `runtime.rs` (now `is_none_or`). No behaviour change.

Checks: `cargo clippy --locked --all-targets -- -D warnings` clean, `cargo test --locked` 50 passed, 2 ignored. Not verified: other Rust toolchains than the one installed here (1.97).

## 23 October 2026 — CI runs the structure check (T-0028, first step)

`ci.yml` now runs `npm run test:structure` after `npm run test:ui`; before, the structure, docs-link and line-limit rules were enforced only on the developer machine.

Checks: `npm run test:structure` PASS locally (same command). Not verified: the step on GitHub (nothing is pushed). Remaining for T-0028: Windows job, clippy gate.

## 23 October 2026 — roadmap from 6/10 to about 8/10

User request: score the whole repository, then work out what is needed to reach 8 to 10 out of 10 and have the plan tested by the council until it comes close.

Process: a three-model council (Opus 5.5, Fable 5.1, Sonnet 5.5; independent answers, anonymous peer review, chairman checks in code) scored the repository 6/10 (structure 7, code 7-7.5, tests+CI 4.5, security 6.5-7, build/release 5-5.5, docs 7-8, UX/i18n/a11y 6.5, performance 6). A roadmap was then reviewed in two rounds; its projected score was 7.4 / 7.4 / 7.6 for version 1 and 7.5 / 7.6 / 7.5 for version 2. The user stopped the iteration at that point.

Change: `tasks/specs/ROADMAP-to-8.md` (version 3: what 8 means per area, the order in five milestones, what is dropped) and 23 new or re-scoped rows in `tasks/BOARD.md` (T-0028 to T-0052; T-0010, T-0013, T-0019, T-0024, T-0025 re-scoped), `tasks/specs/T-0012` updated (`tests/acceptance` stays; extra path-rewrite targets). Facts the chairman verified on the way and the plan relies on: 27 runtime test modules (not 34), `SECURITY.md` and `CONTRIBUTING.md` already exist (the latter cites a missing `scripts/tag-check.mjs`), `cargo` needs a built `dist`, the updater endpoint is fixed at build time (`build-update.mjs:15,26`), 273 local `refs/t3`, the engine ships PostHog analytics code that the launcher does not switch off, `tests/runtime_paths.py` hard-codes `scripts/build` and `tests/acceptance`, 32 fixed Polish locale uses outside `i18n/`.

Checks: `npm run test:structure` PASS; the board and the roadmap were read back. Not verified: version 3 was NOT re-scored by the council, so 8 is a target, not a result; a real score needs a council run on the finished repository. Open assumptions listed at the end of the roadmap (free code-signing eligibility, `tauri build` on a renamed `desktop/`, how many Python modules run on Windows CI, the two-feed updater scheme).

Limitations: none of the roadmap tasks has been started; 10/10 is not a target (certificate, external audit, reproducible builds, several shipped languages).

## 23 October 2026 — audit checklist paths after the i18n move

The generator of `tasks/audit-2026-10-22.md` validates every listed file against git; after the English catalogs moved to `src/lib/i18n/en/` it reported two stale paths (`en-additions.ts`, `en-settings-engine.ts` in A-23 and A-26). Both lines now point to `src/lib/i18n/en/additions.ts` and `en/settings-engine.ts`. A comment in `src/lib/gallery/tts-demo.ts` named `i18n/en-demo.ts` and was corrected to `i18n/en/demo.ts`.

Checks: all 50 task file paths exist in git (generator), `npm run test:structure` PASS. Not verified: other documents that might mention the old `en-*.ts` names (a `git grep` over all tracked files except this log found only these two lists and that comment).

## 23 October 2026 — more interface languages

User request: make it possible to add more interface languages later (only English existed next to Polish).

Change: a language registry `src/lib/i18n/languages.ts` (code, name in the language itself, locale, optional `dir`, `complete` flag, catalog) replaces the hard-coded `'pl' | 'en'` in `src/lib/i18n/index.ts`; `UiLanguage` is derived from it and the language picker in Ustawienia → Ogólne is built from it. The English dictionaries moved from `src/lib/i18n/en-*.ts` to `src/lib/i18n/en/` (merged by `en/index.ts`, same merge order). Translation falls back from the language to English to the Polish source; text already translated (an English engine message) is mapped back through all catalogs. The document gets `lang` and `dir`. The error text "Wybierz język polski lub angielski." became "Wybierz obsługiwany język interfejsu." The translator API (`tr(...)`, `tr.locale`) is unchanged, so the 96 components that use it did not change (only the picker in `GeneralPage.svelte`). New: `scripts/dev/i18n-lang.mjs` with `npm run i18n:status`, `i18n:missing -- <code>` (a JSON of Polish source plus English reference for translators) and `i18n:add -- <code> "<Name>" <locale> [rtl]` (creates the catalog and registers it), `tests/frontend/i18n-languages-check.mjs` (registry rules, empty values, orphan keys, `{placeholder}` parity, `complete` languages, fallback chain, a runtime-added language, the `add` scaffold in a temporary copy) and `docs/features/i18n.md`.

Checks: `npm run check` 0/0, `npm run build` PASS, `npm run test:ui` PASS (new `i18n-languages-check` 5/5; `i18n-check` 14/14 and `i18n-coverage-check` unchanged results), `npm run test:structure` PASS, `npm run i18n:status` (English: 4,524 of 4,524 keys). Not verified: the picker with a third language in the running app (none is registered yet; only the runtime test added one), the real EXE.

Limitations (documented in `docs/features/i18n.md`, tracked as T-0025 to T-0027): plurals are Polish-based (`plural.ts`), a few places format with a fixed `pl-PL` or `pl` locale, the layout is not mirrored for right-to-left languages (about 105 stylesheet lines use physical left/right), engine and Rust messages are translated only when they match a catalog key, and all catalogs are bundled statically (about 0.4 MB of text per language).

## 23 October 2026 — new application icon "77"

User request: design a new logo in the style of T3 Code (black rounded square with a bold silver mark) and use variant A of three options.

Change: the mark is two heavy geometric sevens in a silver gradient on a black rounded square, drawn as plain SVG paths (no font). `assets/icon.svg` and `public/favicon.svg` (used by `index.html` and `inputy.html`) are replaced; `npm run tauri icon` (CLI 2.12.3) regenerated the 52 files in `src-tauri/icons/` (PNG sizes, Windows Store logos, `icon.ico` with 16-256 px frames, `icon.icns`, Android and iOS sets) from a 1024 px render of the SVG. Only the style is shared with T3 Code; the glyphs and shape are original.

Checks: `npm run build` PASS (the favicon is copied to `dist/`), `cargo check --manifest-path src-tauri/Cargo.toml` PASS (the icon is embedded by `tauri-build`); the 128 px result and the 16/32/64 px previews were viewed in a rendered image. Not verified: the icon in the built EXE, in the installer, on the taskbar and in the Start menu (no new EXE was built), legibility at 16 px on a real Windows taskbar, and the Android and iOS sets on a device.

Limitations: the installed copy keeps the old icon until a new release is built and installed; a Windows icon cache may keep showing the old one for a while.

## 23 October 2026 — frontend layout decision (T-0011)

User request: audit why every frontend folder sits under `src/lib/` and what the layout should be; the owner then chose `frontend/src/` instead of `lib`.

Finding: the project is plain Vite + Svelte 5 (no SvelteKit; `svelte.config.js` is empty), there is no `$lib` alias and no `$lib` import (about 790 relative imports), so `lib` groups nothing; it matches the Vite Svelte template layout. The publication history starts with a squashed commit, so the original reason cannot be read from it.

Decision recorded in `tasks/specs/T-0011-rename-src-folders.md` and `tasks/BOARD.md`: `frontend/` (UI configuration and HTML entries) with `frontend/src/` (App.svelte, main.ts, styles.css, data.ts and the 16 area folders directly, no `lib`), `desktop/` with `desktop/src/` for the Rust sources, `package.json` stays in the root. The spec lists the blast radius: 113 imports from `src/` into `./lib/`, 1 import leaving `lib`, 75 non-source files and 28 documents mentioning `src/lib`, 24 files mentioning `src-tauri`.

Checks: counts taken with `git grep` and a small import-resolution script; `npm run test:structure` PASS. Not done: no file was moved or renamed; a full `tauri build` on the new layout is untested; Vite `root`/`outDir` and Tauri `frontendDist` behaviour for the moved configuration is unverified.

Limitations: the layout is shown only in the ignored HTML map (`.tmp/qa/filemap-proposal.html`).

## 23 October 2026 — audit task list as a checklist with test steps

User request: the agent should have the task list from the 22 October audit with real tasks and instructions for testing them (the way one task was verified in the audit-verification thread), and the owner wants to see in HTML which files each task modifies.

Change: `tasks/audit-2026-10-22.md` lists the 31 tasks (A-01 to A-31) with status, how each was verified (APP / TEST / CODE, from the 0.2.2 verification), the files, the automated checks to run and the steps in the running app, plus a "How to test" section (the `AGENTS.md` gate, building the EXE, isolated data, WebView2 remote debugging as in `tests/acceptance/settings_desktop_acceptance.py`, evidence into `.tmp/qa/T-NNNN/`). `tasks/BOARD.md` got the open leftovers: T-0021 (Codex bridge), T-0022 (check in the app what was only checked in code), T-0023 (pixel comparison of "Wydajność i limity"), T-0024 (test the 0.2.1 to 0.2.2 update). The HTML map (`.tmp/qa/filemap-audit.html`, generated and ignored) shows the repository tree with the files of each task coloured by priority and the 88 files changed in `71043fc`.

Checks: the generator confirmed every listed file exists in git; the map was opened in a headless browser (no script errors, task selection highlights the right files); `npm run test:structure` PASS. Not verified: the automated-check lists were mapped by area and file name and were not re-run for this document; 50 files are named in tasks and 43 files changed in `71043fc` belong to no task (supporting edits such as i18n tables and tests); 20 of the 31 file lists include files inferred from the diff because the audit list named none.

Limitations: the HTML map and its generator live in the ignored `.tmp/qa` (they are not part of the repository); the checklist is plain Markdown and is not validated by a script.

## 23 October 2026 — task board

User request: agents had no single place to put tasks and carry them out; plans lived in the ignored `.tmp/qa`.

Change: `tasks/README.md` (statuses and rules for agents), `tasks/BOARD.md` (19 open or blocked tasks, 4 done, 8 rejected proposals with reasons) and three specs (`T-0007` unrun checks, `T-0011` renaming `src` and `src-tauri`, `T-0012` the `tools/` folder). `AGENTS.md` got a "Tasks" section. The tasks come from the ponytail over-engineering audit, a knip run, a three-model review of that audit (score 5/10; its wrong or unsafe items are recorded as rejected) and the structure review.

Checks: `npm run test:structure` PASS (docs and `AGENTS.md` links). Not verified: the board entries were re-checked by hand only for T-0001 (dead exports), T-0002 (stale doc paths), T-0006 (repeated kittentts check), T-0007 (36 of 69 checks unrun) and T-0008 (broken preview paths); the other rows rely on the audit and the council. The publication check still fails on four old local T3 checkpoint refs (T-0019); the working tree itself has 0 findings.

Limitations: the board is a Markdown table, so IDs are assigned by hand and nothing validates it yet. The `tasks/` content is in English like the other public docs.

## 23 October 2026 — audit task list implemented and verified, version 0.2.2

User request: check whether the 31 tasks of the 22 October audit list were really implemented (the UI of 0.2.1 lacked them), mark each as done or not, implement what was missing, test in a running environment, and publish a new version.

Finding: none of the tasks except 5 (build and install), 17 (Models page polls only during a download) and 24 (`FilePicker` plural) was in the code at 0.2.1; 20, 27, 28 and 30 were partial. Six read-only verifiers examined the tasks by area, five implementers worked on separate files in parallel, then independent second-pass verifiers read the diffs and found real defects, which were fixed (notably task 1, below).

Changes (task numbers refer to the audit list):

- **Engine page (3a–3f, 4, 19, 30).** New tab **Uruchamianie i pamięć** (Startup and memory): start the engine at launch (`voicestudio.engineAutostart`), load the voice model after start (`voicestudio.enginePreload`, applied through the new Rust command `runtime_set_preload`), keep the engine and model for 5/15/30/60 min or **Zawsze** (always; `0` in Rust means no idle stop; the engine gets `PUT /next/settings/model-idle` → `idle_timeout_seconds`), **Załaduj model teraz** (`POST /next/settings/model-preload`, counted as engine work), memory buttons moved here, warning when "always" meets "offload after generation". GPU report: 120 s limit, Polish message for a cancelled request, "Nie odczytano: …" rows with retry, and `/api/settings/gpu-report` now answers from metadata (0.1 s instead of importing every engine). Offload default (off) is stated in the row.
- **Speech recognition (1, 12, 15, 20).** The turbo weight (`deepdml/faster-whisper-large-v3-turbo-ct2`) can be selected on Modele (sends `model_id`). The adapter also sets `ASR_MODEL_FASTER`/`ASR_MODEL_WHISPERX` to turbo at engine start when only turbo is installed, so Dubbing, queue, conversion and "Rozpoznaj tekst" no longer ask for the 2.9 GB model; a saved pick survives restarts. A successful generation (or engine selection) marks the engine as confirmed, so "Aktywny" no longer sits next to "Sprawdź i użyj". The startup card explains a skipped warm-up (licence not accepted / model not downloaded). Gated models show a Hugging Face token hint.
- **AI i klucze (2, 6, 7, 8, 9, 13, 18, 21, 22).** ChatGPT account message ("only tagging"), manual model entry in the full picker, providers without a default model become selectable ("Wybierz model"), Claude Code hidden, the list of local providers persisted in the engine (`/next/settings/added-llm-providers`), a notice when an LLM tool has no provider, per-section loading, tagging switch shows the saved state, note on the shared per-provider model. **Not done:** the Codex bridge for AI functions (task 2 target step).
- **Other (10, 11, 14, 16).** Copy without an updater endpoint disables "Sprawdź aktualizacje" with a Polish explanation (`app_updates_supported`); dubbing shows "Przygotowanie silnika tłumaczenia…" during the cold translation import; pronunciation dictionary has one home (Ustawienia → Słownik wymowy); `/next/remote/state` is cached for 3 s.
- **Settings texts (26–29, 31).** About 120 new descriptions (Polish and English), section paragraphs moved into row descriptions, inline "Zapisano", `max-width: 64ch` for descriptions.
- **Translations (23, 25).** About 170 strings in the studio screens and the gallery are translated; new `tests/frontend/i18n-coverage-check.mjs` fails on a Polish `tr()` string without an English key (baseline now empty).

Checks: `npm run check` 0/0, `npm run build` PASS, full `npm run test:ui` PASS (new: engine-page, engine-confirmed, app-update-support, i18n-coverage; engine-idle, ai-settings and remote-routing added to the run), `npm run test:structure` PASS, `cargo check` OK, `cargo test runtime::` 18 passed, Python adapter tests (`test_engine_catalogue_metadata`, `test_system_settings` with the unpacked engine, onboarding, general/integration/storage settings, bootstrap, bundle, tagging, remote) OK. `test_model_management` has one test that needs the runtime `.venv` interpreter and fails with the system Python (environment, not a regression). `publication_check` finds private strings only in local `refs/t3/*` checkpoint objects that are not reachable from `main`; the working tree has no findings.

Run in the real desktop app (release EXE, real engine, driven over the WebView2 debugging port; user settings restored afterwards): the new tab and switches; "Zawsze" and 15 min reach the engine preference; startup card with real progress and the model warm-up (about 2 min after a cold start because the profile reconcile runs first); "Zwolnij" then "Załaduj model teraz"; a TTS generation (about 12 s with the warm model) and the "Sprawdzony — wygenerował nagranie" label afterwards; turbo selected on Modele and a transcription of that recording ran on turbo with no download (log: `faster-whisper loading deepdml/…turbo…`, text recognised exactly); `ASR_MODEL_*` set to turbo at start in the engine process; GPU report 0.1 s; autostart off (no engine at launch) and preload off (no warm-up after a restart); updates button disabled in a build without endpoint and enabled in the release build; Słownik wymowy redirect; Claude Code absent; ChatGPT-only message on Funkcje AI.

Not verified in the app: the dubbing translation message and dubbing/audiobook flows, the Codex bridge (not built), Ollama/LM Studio persistence and migration of the old list, the "model-only" provider flow (Together, Fireworks…), the LLM notices in the translation/dictation screens, English rendering of the new strings in the window, the update path from 0.2.1 to 0.2.2 (needs the published release), and the skip-reason text of the startup card for missing licence/weights.

Published: tag `v0.2.2` and GitHub release `v0.2.2` with the signed installer, its `.sig` and `latest.json` (created through the GitHub API because `gh` is not installed); `releases/latest/download/latest.json` reports 0.2.2 (it returned 404 for about a minute after the upload). The update from an installed 0.2.1 was not run.

Limitations: with a saved turbo pick and Systran not installed, WhisperX still defaults to large-v3; "Użyj" on turbo switches the ASR backend to Faster-Whisper (no forced alignment); the confirmed-engine mark is local (browser storage) and never expires; the skip reason of the warm-up is derived in the client because the engine does not report it.

## 23 October 2026 — 600-line limit for source files

User request: stop source files from growing unnoticed; 600 lines as the limit, with exceptions for files that legitimately hold a lot (translation and colour tables).

Change: `scripts/dev/check-structure.mjs` (`npm run test:structure`) now counts lines in every tracked `.svelte`, `.ts`, `.mjs`, `.js`, `.py`, `.rs` and `.css` file. A file over 600 lines fails unless it is listed in `scripts/dev/line-limit-exceptions.json` (each entry has a `max` and a `reason`); a listed file fails when it grows past its `max`, and an entry fails when the file fits the limit again, so the list cannot go stale. 15 files are listed today (3 translation tables, 1 colour table, the rest legacy modules and long scenarios). `LINE_LIMIT=<n>` overrides the limit for experiments.

Checks: `npm run test:structure` PASS (limit 600, 15 exceptions); `LINE_LIMIT=300` fails with 33 oversized files that are not listed; `LINE_LIMIT=700` flags two exceptions (`installer.rs`, `activity.py`) as no longer needed. Not verified: CI (`test:structure` is not part of `test:ui` or the workflow, so the limit is enforced only when someone runs it).

Limitations: counts physical lines, not complexity; only git-tracked files are checked, so a new untracked file is seen after `git add`. `max` values were set from the working tree on 23 October 2026, and a few listed files (`EnginePage.svelte`, `runtime.rs`) had uncommitted edits at the time.

## 23 October 2026 — filemap: file-tree scanner

User request: the repository is hard to explore (local work piles up in ignored `.tmp/`, naming is mixed, nobody knows which tool does what), so a fast way to see the whole tree, including what git does not track, was needed.

Change: `scripts/dev/filemap/` is a std-only Rust tool (`cargo build --release --manifest-path scripts/dev/filemap/Cargo.toml`, then run the binary with the repo root). It walks the tree (skipping `node_modules`, `.git`, `target`, `dist`, caches), marks every file as tracked or local using `git ls-files`, and writes `.tmp/qa/filemap.tsv` (for agents), `.tmp/qa/filemap.html` (one coloured table per folder) and `.tmp/qa/filemap-tree.html` (collapsible tree, folders above files, `.tmp/<name>` summarised). `FILEMAP_SKIP=.tmp` leaves `.tmp` out of the HTML.

Checks: built with `cargo build --release` (no dependencies); scanned about 35,200 files (35 thousand of them under `.tmp/`) in a few seconds; the tree and table were opened in a browser. Not verified: the tracked/local split against `git status`. Not run in CI and not covered by a test.

Limitations: reads `git ls-files`, so renamed-but-uncommitted files show as local; output text is Polish.

## 23 October 2026 — version 0.2.1 build

Bumped the version to 0.2.1 (package, lockfiles, `tauri.conf.json`, `Cargo.toml`, README) so installed copies see the UI batch above as an update. `npm run desktop:release` produced a signed `Seventy-Seven-Labs_0.2.1_x64-setup.exe` (24 MB), its `.sig` and `latest.json` in `.tmp/release/v0.2.1/`; `latest.json` reports 0.2.1.

Not done: the release is not published to GitHub (needs the user's go-ahead), the installer was not run, and an update from 0.2.0 to 0.2.1 was not tested.

## 23 October 2026 — UI feedback batch (UI-013 to UI-021, UI-037)

User request: implement the open UI feedback items and test them. Six parallel agents, one area each; integrated and checked in one pass.

Change: `ConfirmDialog` (promise helper `confirmDialog()`, mounted in `App.svelte`) replaces all 11 native `confirm()` calls; `VideoCard` replaces three native `<video controls>`; `Checkbox` and `Drawer` components (gallery sections 21–22), raw number inputs moved to `Input`; the file inputs now go through `FilePicker` (also fixed its Polish plural, `polishPlural` in `src/lib/i18n/plural.ts`); one toast queue for the whole app (the old single 6 s toast in `App.svelte` is gone) and `userMessage(error, fallback)` at the main catch sites; `ActionBar` explains why "Generuj" is disabled; Modele shows download speed and ETA (`download-eta.ts`) with a global header indicator that polls only while a job is active; audiobook read-along uses measured portion durations with word-length weights (`read-along.ts`); `tests/frontend/ui-rules.mjs` guards rule 2 and runs in `test:ui`. `docs/ui-feedback.md` statuses updated.

Checks: `npm run check` 0/0, `npm run build` PASS, `npm run test:ui` PASS (new checks: confirm-dialog, video-card, toast, user-message, download-eta, read-along, plural, ui-rules), `test:structure` PASS, `tag-check` PASS. `async-ui-check` needed its `ModelsPage` harness stubbed for the new download monitor (32/32). No Rust was changed, so `cargo check` was not run.

Not verified: none of the new components was exercised in a running window (dialog, video card, checkbox, drawer, indicator, hint); the header indicator may be hidden behind the settings overlay. Limitations: `userMessage` is not yet used at every catch site (ModelLicense*, AudioLab, VoiceManager, UpdatesPage, AiPage, EnginePage and others still show `.message`); `Drawer` is not yet used for the inspector; UI-019 is an estimate — exact word times need an engine change (faster-whisper `word_timestamps`). Still waiting for the user's decision: UI-010, 011, 027, 030, 034.

## 22 October 2026 — engine starts at launch, model warm-up, visible startup progress

User request: start the VoiceStudio TTS model immediately and show what is happening (and what already works) while the engine starts — previously nothing outside Ustawienia → Silnik showed startup, and only for the data backup.

Change: the app now starts the engine when it opens (`bootRuntime` in `App.svelte`; not in the browser demo) and `runtime.rs` sets `VOICESTUDIO_NEXT_PRELOAD_TTS=1`, enabling the existing preload gate so the TTS model loads in the background. New card `EngineStartup.svelte` (bottom-right) shows a checklist with elapsed time: engine files, backup, modules, local server (stages written by `launcher.py` as `NEXT_STARTUP_EVENT` lines and read by the existing log tail), the engine's own steps (`/startup/progress`, polled by Rust while starting, via a new shared `backend_get`), then the voice model from `/model/status` (sub-stage and percent when the engine reports one). `RuntimeStatus.startup.stage` is new; stages only move forward. English strings added; docs updated (README, context, runtime).

Checks: `npm run check` 0/0, `npm run build` PASS, `npm run test:ui` PASS (new `engine-startup-check.mjs`, it also pins the UI order to `STAGES` in `runtime.rs`), `test:structure` PASS, `runtime-startup/-client/-idle` and `engine-idle` checks PASS, `cargo check` OK. `cargo test runtime::`: 13 pass, 4 fail — the same 4 fail without my change because those tests need port 4312, which a running engine occupied. Real engine, isolated copy on port 4399 with empty data and no weights (the running engine on 4312 was not touched): stage events `engine_files → backup → modules → server` appeared in order, `/startup/progress` answered with the ownership marker (`env_prefs → native_preload → ml_imports → api_routes`), `/health` came after about 92 s on that cold first run, and the log shows the preload task now runs (`Preload skipped: … licence is not accepted yet`).

Not verified: the card in the real EXE (no screenshot), and the model warm-up with real weights — loading a second copy onto the GPU next to the user's running engine was avoided on purpose. Limitations: remaining time is not estimated (elapsed only); the resident model uses RAM/VRAM until the engine's 900 s model idle timeout or a stop; there is no setting yet to turn the launch start or the preload off.

## 22 October 2026 — app updates from GitHub Releases

User request: the bottom-left sidebar button should detect and download new versions, based on the owner's GitHub repository. Added the Tauri updater (`tauri-plugin-updater`, `tauri-plugin-process`): the button (**Sprawdź aktualizacje**) opens Ustawienia → Aktualizacje and checks the `latest.json` feed of the project's GitHub repository (endpoint injected at release build time from `git remote`, so it is not stored in the repository); a newer signed release shows its version and notes with **Pobierz i zainstaluj** (download, signature check, passive NSIS install, restart). Bundling is now NSIS with updater artifacts; `npm run desktop:release` (`scripts/release/build-update.mjs`) builds the signed installer and `latest.json` into `.tmp/release/v<version>/`. The signing key lives outside the repository (`%USERPROFILE%\.tauri\`); the public key is in `tauri.conf.json`. The studio refresh the button used to run is **Odśwież stan** on Ustawienia → Silnik, now enabled while the engine is stopped (it also connects the browser preview); `catalog-ui-check.js` was retargeted to that path. Docs: `docs/features/app-updates.md`, README.

Checks: `npm run check` 0/0, `cargo check` OK, `npm run test:ui` PASS, `i18n-check` 14/14, `test:structure` PASS; `npm run desktop:release` produced a signed `Seventy-Seven-Labs_0.2.0_x64-setup.exe` (24 MB), its `.sig` and `latest.json`. Not verified yet: an update from one published version to a higher one (needs a second release), the browser QA `catalog-ui-check.js` run.

Limitations: only NSIS-installed copies can update; the `--no-bundle` EXE from `target/release` must be replaced by an installed copy once. The key has no password; losing it blocks future updates for installed copies.

## 22 October 2026 — settings: one search field

From the prototype review: the settings sidebar had two searches (the "Szukaj… Ctrl K" button that opens the global palette and a separate "Filtruj ustawienia…" field). Now there is one field in the "Szukaj…" button style with the magnifier, which filters the 12 settings pages by name (empty result: „Brak pasujących ustawień.”); the Ctrl K hint and the second field are gone. The rest of the app keeps the real `SidebarHeader` (button opening the palette).

Checks: `npm run check` 0/0; in the dev UI typing „sie” leaves only „Sieć i dostęp” under its group, compared with the prototype screenshot (`.tmp/qa/settings-port/final/`). Limitation: the filter matches page names, not the settings inside pages (same as the prototype); Ctrl+K inside Settings still opens the global palette.

## 22 October 2026 — docs follow the new settings structure

README, PRD, `project-context.md` (new short settings-structure note), `project-structure.md`, `runtime.md` and nine feature docs now use the new paths (for example Ustawienia → Silnik → Środowiska, Sieć i dostęp → Zdalny silnik, Prywatność i użycie → Znak wodny). Corrected an older error: the engine idle time is set in Silnik → Stan, not Ogólne.

Checks: `npm run test:structure` PASS (133 doc links), `git diff --check` clean.

## 22 October 2026 — settings: old components removed, tests retargeted, two regressions fixed

Removed the 16 settings components replaced by the new pages (SystemSettings, GeneralSettings, StorageSettings, UpdateSettings, DictionarySettings, AISettings, EngineCatalog, ExtraTtsEnvironments, EngineRuntimeInstaller, RuntimeDiagnostics, RuntimeInstaller, RemoteBackendSettings, IntegrationSettings, ApiReference, PreviewCacheSettings, DictationDesktopSettings) and the dead model-state JSON in `App.svelte`. The seven tests that read them (`ai-settings`, `async-ui`, `dictation-desktop`, `engine-idle`, `engine-installation`, `engine-readiness`, `preview-cache`; all passed on `368a416` before the change) now target the owning pages with the same intent; documented contract changes: tagging saves on each change, the idle hint wording. New `tests/helpers/runes-component.mjs` runs a page script with live Svelte reactivity, which exposed two regressions now fixed: the Środowiska tab polled install progress only once (the effect never re-ran), and AI tagging saves could overlap and restore stale settings (now serialised, and blocked during the tagging test). The Engine page shows "start it with the button at the top" only in the desktop app, where that button exists.

Checks: `npm run check` 0/0, `npm run build` PASS, `npm run test:ui` PASS, the seven retargeted tests PASS, `tag-check.mjs` PASS, `npm run test:structure` PASS, `git diff --check` clean; release EXE rebuilt (`npm run desktop:build`) and starts. Not verified: the settings pages against a live engine.

## 22 October 2026 — settings: Silnik ported

The reference page of the redesign. Sticky blurred status header (state, hardware, device and preset, start, red "Zatrzymaj" with a 4 s confirm, restart), live CPU/RAM/GPU/VRAM tiles from `/sysinfo` (a monitor read, does not keep the engine awake), the "Generowanie" card computed from the last 12 `/history` records (median speed "N×", "W 1 minutę … nagrania", bar chart with tooltips), model in memory with unload, then tabs Stan (idle time, data folder), Obliczenia (device, CUDA card, global and per-family preset, memory, offload, torch.compile, timeouts, GPU report), Środowiska (Python environment installer, extra engine environments, extra TTS libraries, FFmpeg/FFprobe/yt-dlp) and Dzienniki i diagnostyka (recent errors, system check, local readiness, log viewer with filter/copy/download/clear, support report).

Checks: `svelte-check` 0/0; screenshots against the prototype at 1280/900 px (ready state through a fetch mock, stopped state in the real app) in `.tmp/qa/settings-port/engine/`. Not verified: any real engine action, the Tauri installer and EXE picker, the chart tooltip on hover.

Limitations: no uptime ("Działa od") because no monitor endpoint exposes it; idle time offers 5/15/30/60 min only (Rust accepts no "no limit"); chart tooltips show the mode, not engine/device (history has neither); errors show the engine's class and message, without a plain-language table; environment size/install date are not reported.

## 22 October 2026 — settings: AI i klucze ported

Tabs Modele językowe (providers with brand icons, API keys, connect/test/model list via `/api/settings/llm-providers`, ChatGPT/Codex account row, Claude Code CLI shown as not detected), Funkcje AI (50/50 "Domyślny model"; function rows as model status + "Zmień" + switch, editor with Domyślny | Własny, one model list across providers, manual id; separate Tagowanie card with an inline test preview; Redakcja dyktowania) and Tłumaczenie i rozpoznawanie (translators through `/next/settings/credential(s)`, OpenAI-compatible ASR). New `pages/ModelPicker.svelte`. The style doc now describes the status + "Zmień" pattern.

Checks: `svelte-check` 0/0, `i18n-check.mjs` 14/14, screenshots against the prototype at 1280/900 px with intercepted fixture responses (`.tmp/qa/settings-port/ai/`); the real app only in the not-ready state.

Limitations (need engine or Tauri work): Claude Code needs an agent bridge that src-tauri does not provide; ChatGPT login is still `codex login` in a terminal (no in-app login/logout); tagging works only through Codex; the engine stores one model per provider, so a custom function model changes that provider's model everywhere; `/models` has no dates, so no "Najnowsze/Starsze" grouping or "nowy" mark; LLM and ASR keys are not returned masked.

## 22 October 2026 — settings: Przechowywanie and Prywatność i użycie ported

Przechowywanie: data folder move plan, model folder (now the only place to change model paths), restart to apply, disk usage per category, database backups, history limit, preview samples and temporary files with confirm steps. Prywatność i użycie has tabs Prywatność (analytics consent, translation provider), Znak wodny (the former Privacy toggle and the Integrations "invisible watermark" toggle are one switch; all three switches saved in one `POST /watermark/settings`, then re-read and confirmed; detector) and Użycie (former "Wykorzystanie" stats from `/stats/usage`).

Checks: `svelte-check` 0/0; `preview-cache-check.mjs` and `recording-retention-check.mjs` pass; screenshots of the not-ready state in the real app and of the ready state on a mocked fixture page (`.tmp/qa/settings-port/`). Not verified against a live engine: folder picker, restart, deletes, backup, watermark detection, sample generation.

Limitations: the folder picker exists only in the desktop app (the browser preview shows a path field); "Przywróć domyślny" for the data folder only clears the plan (no endpoint moves data back); restart progress has no stages; some engine-provided labels stay untranslated.

## 22 October 2026 — settings: Modele ported

Modele has tabs Synteza mowy, Rozpoznawanie mowy, Modele językowe, Pozostałe and Pobieranie i dostęp. Rows join engines with their weights (download, resume, cancel, delete behind a type-the-ID confirm, active model, licence state with inline review/accept/revoke), the "Przejrzyj warunki modeli" card lists engines and registry models needing a decision, the language tab lists cloud providers and links to AI i klucze. One Hugging Face token endpoint (`/next/settings/hf-token`, app store only), the HF mirror (moved from Sieć) and the model folder as a read-only link to Przechowywanie. The hard-coded OmniVoice/Faster-Whisper rows and the raw model-state JSON were removed.

Checks: `svelte-check` 0/0; screenshots against the prototype at 1280/900 px through a mocked harness (`.tmp/qa/settings-port/models/`) and the not-ready state in the real app. Not verified: a live engine, a completed download, licence accept/revoke against the backend.

Limitations: no download speed or time left (the engine reports bytes only); cloud providers show key state, not a tested connection or model count; mirror presets dropped (Auto covers them).

## 22 October 2026 — settings: Sieć i dostęp and Integracje ported

Sieć i dostęp has tabs Udostępnianie (LAN share with confirm, PIN, addresses, base port, Tailscale Serve), Zdalny silnik (former "Dostęp zdalny" and "Zdalne procesy robocze", one copy; opened directly from the remote-engine pill) and Serwer proxy. Integracje: OpenAI-compatible API test, MCP settings/test/client config, voice bindings for MCP clients, API reference (search, method filter, safe GET send, export). The watermark moved to Prywatność and engine provenance to Aktualizacje.

Checks: `svelte-check` 0/0; `remote-routing-check.mjs` and `integrations-check.mjs` pass; screenshots against the prototype through a mocked-response harness (`.tmp/qa/settings-port/network|integrations/`) and the not-ready state in the real app. Not verified against a live engine, Tailscale, a remote engine or a real MCP client.

Limitations: the engine does not report whether Tailscale Serve is on, so "Włączony" reflects actions in the current visit; no hostname address (the engine returns IPs only); the API reference no longer shows parameter/schema detail.

## 22 October 2026 — settings: Aplikacja pages ported

Ported from the approved prototype: Ogólne (UI language, dubbing review, default translation mode), Wygląd (the real `Appearance` component inside the new page frame, reset with a 4 s confirm), Słownik wymowy (`/pronunciation` add/edit/delete/toggle, test, JSON export/import with confirm), Skróty i mikrofon (shortcut list, desktop dictation hotkey, microphone permission state, test and Windows settings link), Aktualizacje (app version, engine provenance from `/next/settings/update-source`, GitHub release check, changelog). Results are toasts; with the engine stopped each page shows one notice.

Checks: `svelte-check` 0/0; screenshots of all five pages next to the prototype at 1280 and 900 px in `.tmp/qa/settings-port/app/` (engine not running, so the not-ready state only). Not verified: ready state of Słownik and Aktualizacje against a live engine, the Tauri dictation hotkey, real microphone access.

Limitations: the dictionary test cannot highlight replaced words (`/pronunciation/test` returns only the whole text); the per-release notes list from the old check was dropped as in the prototype.

## 22 October 2026 — settings: new navigation and shared page pieces

User request: move the approved settings prototype (`.tmp/settings-redesign`, reviewed 2026-10-22) into the app without omissions. This commit adds the frame; pages are ported in the following commits.

Change: `settings-catalog.ts` now has 12 pages in 4 groups (Aplikacja, Silnik i modele, Połączenia, Dane) instead of 20 flat items; `SettingsShell` shows group headers; `App.svelte` routes each page to `src/lib/settings/pages/<Name>Page.svelte` (placeholders until ported), passes an optional intent (`openSettings('network','remote')` from the remote-engine pill), maps the old `ai-settings` target to `ai`, and drops the global "engine not running" notice (each page shows one notice itself). Shared pieces: `settings-page.css` (`p-` layout classes), `StatusBadge`, `toast.ts` + `Toaster` (bottom-centre result notifications), `ProviderIcon` with 8 MIT provider marks from lobe-icons (`THIRD_PARTY_NOTICES.md`, `src/lib/ui/provider-icons/`), per-group English files `en-settings-*.ts`, style rules in `docs/features/settings-style.md`. Texts across the app that pointed to „Modele i silnik” now point to „Silnik” (starting the engine) or „Modele” (downloads, terms); the device popover link opens Silnik.

Checks: `npm run check` 0/0, `git diff --check` clean. Not run at this step: build and UI tests (run after the pages land).

## 22 October 2026 — shared controls corrected as in the approved settings prototype

User request: move the approved settings prototype into the app, including the component corrections made during its review. This entry covers the shared components; the settings pages follow in separate commits.

Change (app-wide, `src/lib/ui`, `src/lib/styles`): list popups (`Select`) are solid `--surface-raised` without blur, and their scroll arrows are solid, so text under the popup no longer shows through; text fields are 32 px like `Select` and `Button` (was 30 px); fields, select triggers and outline buttons share one clearly visible border (`--foreground` 18 % over `--input-border`); `Button` text is 13 px like the fields (was 14 px); filled blue and red buttons lose the inset highlight and outer glow; a disabled filled button is flat (transparent, `--border`, muted text) instead of a dimmed fill; new `Button variant="light"` (white fill) for finishing or closing an inline editor.

Checks: `npm run check` 0/0, `npm run test:styles` PASS, `npm run test:buttons` PASS. `publication_check` reports only the known local `refs/t3/.../checkpoints` refs created by T3 Code; file contents pass.

Limitations: the 13 px button text and stronger borders apply to every screen, not only Settings; the mobile sizes (≤639 px) are unchanged. Not yet checked visually outside Settings.

## 22 October 2026 — Płyn preview shows the full effect

User request: the Płyn animation in the settings preview did not show the full potential of the style. Cause: the shared demo signal is a smooth, low-amplitude pulse (level ≤ 0.66), and the fluid only splashes while the overall level is rising, so the preview showed little of the flow.

Change: `orbShowcaseFrame` in `voice-orb.ts` — a 12 s loop (breathing, phrased speech at ~4.5 syllables/s, a pause, an emphatic burst with strong highs, decay) with a seamless wrap. The textured Płyn renderer uses it in preview mode; other styles keep `orbPreviewFrame`. Real playback is unchanged. Three tests added to `orb-preview-motion-check.mjs` (finite and bounded, contains quiet/pause/loud and loops, rises often enough to splash).

Checks: `npm run check` 0/0, orb tests PASS, `npm run test:structure` PASS. Runtime: a QA page mounting the Płyn preview orb rendered with `texture=ready`, `fluid=ready` and a clearly textured, grainy sphere in a screenshot; later screenshots of the loop timed out in the preview tool, so the loud phase was not captured visually — the tests cover the signal, not the look.

Limitations: the demo is still synthetic (no recorded audio); real playback shows the full effect with real speech.

## 22 October 2026 — Płyn orb restored to the ElevenLabs-derived material

User report: **Płyn** (formerly „ElevenLabs”) was supposed to be only a rename, but it rendered the plain procedural material identical to „Oryginalna”. Cause: when the public copy was prepared, the textured shader, fluid pass and images were left out and the saved `landing` style was aliased to the original shader (see the 21 October entry that lists them as not included).

Change: restored the `landing` branch from the earlier private state (kept in a local ignored checkout), preserving newer code — orb palettes, `normalizeOrbVariant`, translations. Added `landing-orb.frag`, `landing-fluid.ts`, `landing-orb.ts` and the three images in `src/lib/assets/landing-orb/` (SHA-256 identical to the pinned originals); the renderer, shared source and `VoiceOrb.svelte` load them lazily. A renderer without textures still degrades to the original material. The shader keeps using the chosen palette (`previewPalette` stays 1). Documented in [Płyn orb style](features/orb-flow.md), `THIRD_PARTY_NOTICES.md` and `docs/public-assets.json`. The only test change: `orb-preview-motion-check.mjs` passes `preview` as the third constructor argument again.

Checks: `npm run check` 0/0, `npm run build` OK, `tag-check.mjs` OK, `npm run test:structure` PASS, orb tests `orb-preview-motion`, `shared-voice-orb`, `voice-orb-renderer`, `orb-reactivity`, `orb-smoothing`, `orb-motion` PASS. Runtime: in the dev gallery (`inputy.html#control-14`, Płyn selected) the canvas reports `texture=ready`, `fluid=ready`, frames advancing, grain image loaded, and the screenshot shows the flowing textured sphere.

Limitations: ElevenLabs published no redistribution terms for these materials; they are included at the maintainer's explicit decision and must be cleared before wider distribution (removal steps in the feature doc). The earlier source-comparison and GPU evidence (`landing-*.json`) from the private history was not imported; the full audio-reactivity comparison against the source was not re-run. Nothing pushed.

## 21 October 2026 — desktop EXE: generated audio was rejected

User report: the new EXE did not return generated audio. The engine produced and sent the WAV (`200`, `content-type: audio/wav`), but the app showed „Silnik nie zwrócił pliku audio.” Cause: `@tauri-apps/plugin-http` 2.8 constructs its `Response` without headers and attaches them afterwards, so `Blob.type` is empty and every desktop audio check failed (TTS, audio cleanup, tools). The browser preview uses native `fetch` and was not affected. `request()` in `src/lib/platform/api.ts` now rebuilds the desktop response with its real headers; `runtime-client-check.mjs` covers this (fails without the fix).

Checks: `npm run check` 0/0, `runtime-client-check.mjs` 7/7, `npm run test:ui` PASS, rebuilt release EXE; a real generation through the EXE UI (sandbox WebView2 profile with CDP, real engine and model from the external disk, ~136 s cold) produced the card „Nagranie 1 · 0:05 · Gotowe do odtwarzania” with no console errors.

## 21 October 2026 — English interface option ported and completed

The unfinished English UI translation (prepared on the earlier flat layout) is now part of the current code. Visible Polish strings are wrapped with `tr(...)`/`translateUi(...)` and the interface language is chosen in **Ustawienia → Ogólne** (Settings → General); Polish stays the default and its output is unchanged. `src/lib/i18n/` holds the module (`index.ts`) and dictionaries; strings added since the original work and those it had left untranslated are in `en-additions.ts` (3221 keys in total). Tools: `scripts/dev/i18n-svelte.mjs` (wrapped static markup; a one-off, removed in T-0005), `tests/frontend/i18n-check.mjs` (core behaviour, now part of `test:ui`). Also included from the same work: the orb music demo (`orb-demo.html`, `src/OrbMusicDemo.svelte`, `scripts/dev/generate_demo_music.py`; the generated WAV is not tracked).

Node test harnesses that load single modules now get the real i18n module from `tests/helpers/i18n.mjs`. Stale tests fixed on the way: `runtime-startup-check.mjs` (startup budget is 305 s; one-time idle sync excluded), `audio-diagnostics-check.mjs` (source path), `voice-profile-check.mjs` (missing collaborators).

Checks: `npm run check` 0/0, `npm run build` PASS, `npm run test:ui` PASS, `test:structure` PASS, every `tests/frontend/*.mjs` check PASS (except `engine-readiness-app-transform.mjs`, a CLI transform that needs arguments), `activity_check.py` OK, `test_publication_check.py` OK, `publication_check.py` with a private deny list PASS. Not verified: the English UI was not reviewed screen by screen in a browser or the EXE; some engine-provided messages and a few option labels in the pronunciation dictionary remain Polish.

## 21 October 2026 — single working copy: development changes since the public snapshot

This repository is now the project's only working copy; the former private development checkout was archived outside the project folder and is not part of this history. Its changes since the public snapshot were brought over in one reviewed step, applying the same publication rules as before (no recordings, databases, evidence reports with local paths, private names, or third-party reference assets).

Included: the new folder layout (`src/lib/<area>/`, `tests/{frontend,runtime,acceptance}`, `scripts/{build,dev,preview,runtime}`; see [project structure](architecture/project-structure.md)); engine stability work (300 s startup budget, 15 s graceful stop, manual stop of an unresponsive engine, 30-minute window after an interrupted request, readable 503 when the model folder is missing, `/generate` input validation, bytecode cache, ffmpeg probe bypass, `[next-diag]` synthesis diagnostics, `engine_benchmark.py`); configurable idle time (5/15/30/60 min, default 15); dubbing translation now uses the engine selected in settings and offers to download a missing Argos language pack; speed below 1× keeps the pauses that carry the slowdown; `tools_acceptance.py` for built-in tools; recovery of damaged local projects and a single WAV decode when joining speakers; UI work (bottom-sheet panel, FilePicker, AudioPreview, Select, FilterChip, collapsible sections, control gallery, language flags in the form language list, orb palette colours, loading cards).

Not included: the textured orb material and shader adapted from a third-party website and the model publisher icons (no established redistribution terms) — the **Płyn** orb uses the original procedural material here; private QA evidence and audits. Public-only files moved into the new layout: `scripts/dev/publication_check.py`, `scripts/dev/generate_demo_tone.py`, `scripts/preview/capture_screenshots.py`, `tests/runtime/test_publication_check.py`, `tests/frontend/theme-compatibility-check.mjs`; CI updated.

Two stale tests were fixed: `runtime-client-check.mjs` (missing collaborators of `api.ts`; `/engines` is now a cold metadata read) and `async-ui-check.mjs` (dubbing translation reads the active engine and Argos pack state before translating, and sends `provider`).

Checks: `npm run check` 0 errors/0 warnings, `npm run build` PASS, `npm run test:ui` PASS, `test:structure` PASS (129 doc links), stories/production/speech-app/speech-settings/engine-idle/runtime-client/tag/wav-format checks PASS, `activity_check.py` 26/26, `test_publication_check.py` 24 OK (1 skipped), `cargo check` PASS, `publication_check.py` with a private deny list PASS (0 findings). No new inference in this step; real-engine results of the included fixes were measured in the development checkout before the move.

## 21 October 2026 — product-facing names

The user approved **Labs**, **Róża**, and **silnik Seventy Seven Labs** as the visible theme and engine names; the orb remains **Przepływ**. Ordinary UI descriptions and public guides use these names. Exact upstream identities, source versions, copyright statements, and licenses remain available in dedicated provenance details and third-party notices. Real model names and model terms remain accurate.

This changes presentation, not palette values, saved identifiers, local storage, API/transport fields, the theme JSON v1 contract, or the pinned backend archive. Added theme-compatibility coverage to the standard UI test suite. README screenshots are refreshed from fictional demo data, with new hashes recorded in the public asset manifest. The private development checkout, models, and runtime data remain untouched. Current validation and limitations are recorded in [verification](verification/verification.md).

Checks passed: Svelte/TypeScript 0 errors and 0 warnings, production build, full UI regression suite including 7 compatibility checks, 24 real theme interactions, and the five demo capture checks. New names and retained source attribution were verified in the browser with no JavaScript errors or private-backend requests. Three screenshots were refreshed and visually reviewed. The main-chunk warning remains (about 729 kB). No Rust or engine changes and no new inference/EXE acceptance. Final whitespace, documentation-link, privacy, and remote CI checks accompany the publication of this change.

## 21 October 2026 — GitHub publication setup

The user authorized uploading the prepared English source to the existing public `77-Labs` repository. The destination was confirmed to be empty, and `origin` was configured in this public checkout. The private development repository and its history are not part of the upload.

Pre-publication checks passed: clean `main`, neutral author and committer identities, only the public branch ref, and a full privacy scan using an external private deny list (549 files, 624 Git objects, the pinned engine archive, zero findings). The publication guide now describes checking `origin` and sending only reviewed `main`. Documentation content, links, and whitespace are checked before committing. Application code, dependencies, models, and media are unchanged; application builds and inference are not repeated for this publication setup. Push success, remote commit identity, and GitHub CI are verified separately after the commit.

## 21 October 2026 — English public documentation

Translated the README, PRD, contributor/security/provenance documents, agent instructions, and public technical guides into English at the user's request. The application interface and screenshots remain Polish. Actual Polish control labels are retained with English explanations. Existing filenames, commands, URLs, model names, and compatibility identifiers are preserved.

Updated the documentation language rule to English while retaining Polish application UI. Historical verification results remain explicitly historical; this documentation change does not claim new application or model testing. The private source checkout and runtime data are untouched.

The public package description and CI display name are also English. Scripts, dependencies, and application behavior are unchanged.

Checks passed: content review of 31 Markdown files, all 99 local links and heading anchors, UTF-8, whitespace, and a full publication/privacy audit with private deny patterns stored outside the repository. All five pinned assets (three screenshots, the demo tone, and the engine archive) are unchanged. A separate English source ZIP is generated from the new anonymous commit. Builds, UI/runtime acceptance tests, and inference were not rerun for this documentation-only change. Results are recorded in [verification](verification/verification.md).

## 21 October 2026 — fast audit of the entire history

The first public starting point was committed with neutral author and committer identities. The scanner now reads all objects in batches instead of starting a separate Git process for every file. It retains checks for unreachable objects, names in trees, every index stage, taggers, and object replacement attempts. It verifies object identity, type, size, and complete responses; an error cannot produce PASS.

Recorded checks: 23 tests PASS, 1 SKIP for Windows directory-symlink permissions. A real scan with private patterns stored outside the repository covered 549 files, 578 Git objects, and the pinned ZIP: zero findings in about 9 seconds. Diff checks for both files and documentation passed. This change covered only the scanner, its tests, and the verification record; UI builds and inference were not repeated. The history audit is repeated after committing. Nothing was published remotely.

## 21 October 2026 — initial open-source preparation

Created a separate repository with fresh history and a neutral author identity. The private checkout had uncommitted changes and checkpoints containing data; it was left untouched, and the export was based on its last local commit.

Removed private recordings, reports, screenshots, and generated HTML previews containing embedded audio. A personal name, private synthesis profile, and local paths were replaced with neutral data or explicit parameters. Speech tests require a user-supplied reference. Reports go into ignored `.tmp/qa`.

Assets recovered from a commercial website and logos without a complete redistribution basis were replaced with original visualization code and Lucide icons. Reading older settings remains supported. Added the owner's selected AGPL-3.0-only license and separate notices for upstream, themes, and flags.

The README, PRD, contribution/security policies, publication scanner, and CI define the public starting point. The demo uses fictional projects and a procedural tone without human speech. Three new 1440×960 screenshots were visually reviewed; five demo checks passed without requests to the private backend.

Recorded checks on that tree: check 0/0, build, the full UI test suite, and cargo check PASS. The scanner initially had 17 PASS and 1 SKIP because Windows could not create the test symlink. File/index auditing with private patterns stored outside the repository passed; history is checked again after committing. See [verification](verification/verification.md) for details and limits. Polish-character encoding in new documentation was also corrected, and local links were checked.

A build warning remains for the main chunk of approximately 728 kB. All models, full dubbing/audiobook renders, CUDA, and installation on a clean machine have not been accepted. No new inference, weight downloads, remote publication, or private-data migration were performed. Actual runtime data, private commits, and uncommitted work remain in the original directory.
